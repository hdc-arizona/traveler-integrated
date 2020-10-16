/* globals d3, oboe */
import { Model } from '/static/node_modules/uki/dist/uki.esm.js';

class LinkedState extends Model {
  constructor (label, metadata) {
    super();

    this.label = label;
    this.metadata = metadata;
    // Sometimes the locations aren't sorted (todo: enable interactive sorting?)
    if (this.metadata.locationNames) {
      this.metadata.locationNames.sort(function(a, b) {
        return d3.ascending(parseInt(a), parseInt(b));
      });
    }
    // Don't bother retrieving intervals if there are more than 7000 in this.intervalWindow
    this.intervalCutoff = 7000;
    this.intervalWindow = this.hasTraceData ? Array.from(this.metadata.intervalDomain) : null;
    this.primitiveHistogram = {};
    this.intervalHistogram = {};
    this.intervalHistogramWindow = {};
    this.cursorPosition = null;
    this.selectedPrimitive = null;
    this.selectedGUID = null;
    this.selectedIntervalId = null;
    this.selectedPrimitiveHistogram = null;
    this.caches = {};
    this._mode = 'Inclusive';
    this.histogramResolution = 512;
    this.selectedProcMetric = '';//'meminfo:MemFree';

    // Start processes for collecting data
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
    })();
    if (this.hasTraceData) {
      this.fetchGanttAggBins();
      this.caches.metricAggBins = {};
      this._metricAggTimeout = {};
      this.fetchMetricBins();
      this.updateHistogram();
    }
  }
  get begin () {
    return this.intervalWindow[0];
  }
  get end () {
    return this.intervalWindow[1];
  }
  get beginLimit () {
    return this.metadata.intervalDomain[0];
  }
  get endLimit () {
    return this.metadata.intervalDomain[1];
  }
  get mode () {
    return this._mode;
  }
  set mode (newMode) {
    this._mode = newMode;
    this.trigger('changeMode');
  }
  get intervalHistogramBegin () {
    return this.intervalHistogramWindow[this.selectedPrimitiveHistogram][0];
  }
  get intervalHistogramEnd () {
    return this.intervalHistogramWindow[this.selectedPrimitiveHistogram][1];
  }
  get intervalHistogramBeginLimit () {
    return this.intervalHistogram[this.selectedPrimitiveHistogram].metadata.begin;
  }
  get intervalHistogramEndLimit () {
    return this.intervalHistogram[this.selectedPrimitiveHistogram].metadata.end;
  }
  setGanttXResolution(value){
    this.ganttXResolution = value|0;//round down
    this.fetchGanttAggBins();
  }
  setMetricXResolution(value){
    this.metricXResolution = value|0;//round down
    this.fetchMetricBins();
  }
  setHistogramResolution (value) {
    this.histogramResolution = value;
    this.updateHistogram();
  }
  setIntervalWindow ({
    begin = this.begin,
    end = this.end
  } = {}) {
    if (this.intervalDomain === null) {
      throw new Error("Can't set interval window; no interval data");
    }
    const oldBegin = this.begin;
    const oldEnd = this.end;
    // Clamp to where there's actually data
    begin = Math.max(this.beginLimit, begin);
    end = Math.min(this.endLimit, end);
    this.intervalWindow = [begin, end];
    this.updateHistogram();
    this.fetchGanttAggBins();
    this.fetchMetricBins();
    if (oldBegin !== begin || oldEnd !== end) {
      this.stickyTrigger('newIntervalWindow', { begin, end });
    }
  }
  setIntervalHistogramWindow ({
                       begin = this.intervalHistogramBegin,
                       end = this.intervalHistogramEnd
                     } = {}) {
    if (this.intervalHistogram === null) {
      throw new Error("Can't set interval window; no interval histogram data");
    }
    const oldBegin = this.intervalHistogramBegin;
    const oldEnd = this.intervalHistogramEnd;
    // Clamp to where there's actually data
    begin = Math.max(this.intervalHistogramBeginLimit, begin);
    end = Math.min(this.intervalHistogramEndLimit, end);
    this.intervalHistogramWindow[this.selectedPrimitiveHistogram] = [begin, end];
    if (oldBegin !== begin || oldEnd !== end) {
      this.stickyTrigger('newIntervalHistogramWindow', { begin, end });
    }
  }
  selectPrimitive (primitive) {
    if (primitive !== this.selectedPrimitive) {
      this.selectedPrimitive = primitive;
      if (this.hasTraceData) {
        this.updateHistogram();
      }
      this.trigger('primitiveSelected', { primitive });
    }
  }
  selectGUID (guid) {
    if (guid !== this.selectedGUID) {
      this.selectedGUID = guid;
      this.trigger('guidSelected', { guid });
    }
  }
  selectIntervalId (intervalId) {
    if (intervalId !== this.selectedIntervalId) {
      this.selectedIntervalId = intervalId;
      this.trigger('intervalIdSelected', { intervalId });
    }
  }
  moveCursor (position) {
    this.cursorPosition = position;
    this.trigger('moveCursor');
  }
  getPrimitiveDetails (primitiveName = this.selectedPrimitive) {
    return this.primitives ? this.primitives[primitiveName] : null;
  }
  get timeScale () {
    // TODO: identify the color map based on the data, across views...
    return LinkedState.COLOR_SCHEMES[this.mode].timeScale;
  }
  get contentFillColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].contentFillColor;
  }
  get contentBorderColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].contentBorderColor;
  }
  get selectionColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].selectionColor;
  }
  get mouseHoverSelectionColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].mouseHoverSelectionColor;
  }
  get traceBackColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].traceBackColor;
  }
  getPossibleViews () {
    const views = {};
    for (const { fileType } of this.metadata.sourceFiles) {
      if (fileType === 'log' || fileType === 'newick') {
        views['TreeView'] = true;
      } else if (fileType === 'otf2') {
        views['GanttView'] = true;
        views['UtilizationView'] = true;
        views['IntervalHistogramView'] = false;
      } else if (fileType === 'cpp') {
        views['CppView'] = true;
      } else if (fileType === 'python') {
        views['PythonView'] = true;
      } else if (fileType === 'physl') {
        views['PhyslView'] = true;
      }
    }
    return views;
  }
  get hasTraceData () {
    return !!this.metadata.intervalDomain;
  }
  get isLoadingIntervals () {
    return !!this.caches.intervalStream;
  }
  get loadedIntervalCount () {
    return Object.keys(this.caches.intervals || {}).length +
      Object.keys(this.caches.newIntervals || {}).length;
  }
  get tooManyIntervals () {
    return !!this.caches.intervalOverflow;
  }
  get isLoadingTraceback () {
    return !!this.caches.intervalStream;
  }
  get isLoadingHistogram () {
    return !this.caches.histogram;
  }
  get isLoadingPrimitiveHistogram () {
    return !(this.selectedPrimitiveHistogram in this.intervalHistogram);
  }
  get isAggBinsLoaded(){
    return !(this.caches.ganttAggBins === {});
  }
  isMetricBinsLoaded(metric){
    return !(this.caches.metricAggBins[metric] === {});
  }
  getTimeStampFromBin(bin, metadata){
    var offset = (metadata.end - metadata.begin)/ metadata.bins;
    return metadata.begin + (bin*offset);
  }
  getCurrentIntervals () {
    // Combine old data with any new data that's streaming in for more
    // seamless zooming / panning
    const oldIntervals = this.caches.intervals || {};
    const newIntervals = this.caches.newIntervals || {};
    return Object.assign({}, oldIntervals, newIntervals);
  }
  getCurrentGanttAggregrateBins () {
    // Combine old data with any new data that's streaming in for more
    // seamless zooming / panning
    const ganttAggBins = this.caches.ganttAggBins || {};
    return Object.assign({}, ganttAggBins);
  }
  getCurrentMetricBins (metric) {
    // Combine old data with any new data that's streaming in for more
    // seamless zooming / panning
    const metricAggBins = this.caches.metricAggBins[metric] || {};
    return Object.assign({}, metricAggBins);
  }
  //we query intervals as a set of pre-aggregrated pixel-wide bins
  // the drawing process is significantly simplified and sped up from this
  fetchGanttAggBins(){
    var bins = this.ganttXResolution;
    var queryRange = this.intervalWindow[1] - this.intervalWindow[0];

    if(typeof this.caches.histogramDomain !== 'undefined'){
      var begin = (this.intervalWindow[0] - queryRange > this.caches.histogramDomain[0]) ? this.intervalWindow[0] - queryRange : this.intervalWindow[0];
      var end = (this.intervalWindow[1] + queryRange < this.caches.histogramDomain[1]) ? this.intervalWindow[1] + queryRange : this.intervalWindow[1];
    }
    else{
      var begin = this.intervalWindow[0];
      var end = this.intervalWindow[1];
    }

    //this function will replace the fetching of intervals
    window.clearTimeout(this._ganttAggTimeout);
    this._ganttAggTimeout = window.setTimeout(async () => {
      //*****NetworkError on reload is here somewhere******//
      if (bins){
        const label = encodeURIComponent(this.label);
        var endpt = `/datasets/${label}/ganttChartValues?bins=${bins}&begin=${Math.floor(begin)}&end=${Math.ceil(end)}`;
        fetch(endpt)
          .then((response) => {
            return response.json();
          })
          .then((data) => {
            this.caches.ganttAggBins = JSON.parse(data);
            this.trigger('intervalsUpdated');
          })
          .catch(err => {
            err.text.then( errorMessage => {
              console.warn(errorMessage);
            });
          });
      }
    }, 50);
  }

  fetchMetricBins() {
    if (this.selectedProcMetric.startsWith('PAPI') === true && !(this.selectedProcMetric in this.caches.metricAggBins)) {
      this.caches.metricAggBins[this.selectedProcMetric] = {}
    }

    for (const curMetric in this.caches.metricAggBins) {
      var bins = this.metricXResolution;
      var queryRange = this.intervalWindow[1] - this.intervalWindow[0];
      var begin = this.intervalWindow[0];
      var end = this.intervalWindow[1];
      if (typeof this.caches.histogramDomain !== 'undefined') {
        begin = (this.intervalWindow[0] - queryRange > this.caches.histogramDomain[0]) ? this.intervalWindow[0] - queryRange : this.intervalWindow[0];
        end = (this.intervalWindow[1] + queryRange < this.caches.histogramDomain[1]) ? this.intervalWindow[1] + queryRange : this.intervalWindow[1];
      }
      //this function will replace the fetching of intervals
      window.clearTimeout(this._metricAggTimeout[curMetric]);
      this._metricAggTimeout[curMetric] = window.setTimeout(async () => {
        //*****NetworkError on reload is here somewhere******//
        if (bins) {
          const label = encodeURIComponent(this.label);
          var endpt = `/datasets/${label}/newMetricData?bins=${bins}&metric_type=${curMetric}&begin=${Math.floor(begin)}&end=${Math.ceil(end)}`;
          fetch(endpt)
              .then((response) => {
                return response.json();
              })
              .then((data) => {
                this.caches.metricAggBins[curMetric] = data;
                this.trigger('metricsUpdated');
              })
              .catch(err => {
                err.text.then(errorMessage => {
                  console.warn(errorMessage)
                });
              });
        }
      }, 50);
    }
  }
  getCurrentHistogramData () {
    return {
      histogram: this.caches.histogram,
      domain: this.caches.histogramDomain,
      maxCount: this.caches.histogramMaxCount,
      error: this.caches.histogramError
    };
  }
  updateHistogram () {
    // Debounce...
    window.clearTimeout(this._histogramTimeoutNew);
    this._histogramTimeoutNew = window.setTimeout(async () => {
      delete this.caches.histogram;
      delete this.caches.histogramDomain;
      delete this.caches.histogramMaxCount;

      const label = encodeURIComponent(this.label);
      const urls = [`/datasets/${label}/drawValues?bins=${this.histogramResolution}`];
      try {
        [this.caches.histogram] = await Promise.all(urls.map(url => d3.json(url)));
      } catch (e) {
        this.histogramError = e;
        return;
      }
      delete this.histogramError;

      let maxCount = 0;

      let data = this.caches.histogram.data;
      let metadata = this.caches.histogram.metadata;
      const domain = [metadata.begin, metadata.end];
      for (let bin in data) {
        maxCount = Math.max(maxCount, data[bin]);
      }
      this.caches.histogramDomain = domain;
      this.caches.histogramMaxCount = maxCount;
      this.trigger('histogramsUpdated');
    }, 100);
  }
  fetchPrimitiveHistogramData(){
    window.clearTimeout(this._primitiveHistogramTimeout);
    this._primitiveHistogramTimeout = window.setTimeout(async () => {
      const currentPrimitive = this.selectedPrimitiveHistogram;
      delete this.primitiveHistogram[currentPrimitive];
      const durationBins = this.histogramResolution;
      const label = encodeURIComponent(this.label);
      const urls = [`/datasets/${label}/getUtilizationForPrimitive?bins=${this.histogramResolution}&duration_bins=${durationBins}&primitive=${currentPrimitive}`];
      try {
        [this.primitiveHistogram[currentPrimitive]] = await Promise.all(urls.map(url => d3.json(url)));
      } catch (e) {
        this.histogramError = e;
        return;
      }

      // do the precalculation here
      this.primitiveHistogram[currentPrimitive].aux = new Array(this.histogramResolution).fill(new Array(durationBins).fill(0));
      for(let i=0; i<durationBins; i++){
        this.primitiveHistogram[currentPrimitive].aux[0][i] = this.primitiveHistogram[currentPrimitive].data[0][i];
      }
      for(let i=0; i<this.histogramResolution; i++){
        for(let j=1; j<durationBins; j++){
          this.primitiveHistogram[currentPrimitive].aux[i][j] =
              this.primitiveHistogram[currentPrimitive].aux[i][j]
              + this.primitiveHistogram[currentPrimitive].aux[i][j-1];
        }
      }

      this.trigger('primitiveHistogramUpdated');
    }, 100);
  }
  getPrimitiveHistogramForDuration(begin, end){
    const currentPrimitive = this.selectedPrimitiveHistogram;
    const durationBins = this.histogramResolution;
    const rangePerDurationBin = (this.intervalHistogramEndLimit-this.intervalHistogramBeginLimit)/durationBins;
    const beginIndex = ((begin - this.intervalHistogramBeginLimit) / rangePerDurationBin) | 0;
    const endIndex = (((end - this.intervalHistogramBeginLimit) / rangePerDurationBin) | 0) - 1;
    var ret = new Array(this.histogramResolution).fill(0);
    const rangePerBin = (this.primitiveHistogram[currentPrimitive].metadata.end - this.primitiveHistogram[currentPrimitive].metadata.begin)
                    / this.primitiveHistogram[currentPrimitive].metadata.bins;
    for(let i=0;i<this.histogramResolution;i++){
      ret[i] = (this.primitiveHistogram[currentPrimitive].aux[i][endIndex] - this.primitiveHistogram[currentPrimitive].aux[i][beginIndex]) / rangePerBin;
    }
    return {'data': ret, 'metadata': this.primitiveHistogram[currentPrimitive].metadata} ;
  }
  fetchIntervalHistogram(primitive){
    var bins = this.histogramResolution;

    //this function will replace the fetching of intervals
    window.clearTimeout(this._intervalDomainTimeout);
    this._intervalDomainTimeout = window.setTimeout(async () => {
      //*****NetworkError on reload is here somewhere******//
      if (bins){
        const label = encodeURIComponent(this.label);
        var endpt = `/datasets/${label}/getIntervalDuration?bins=${bins}&primitive=${primitive}`;
        fetch(endpt)
            .then((response) => {
              return response.json();
            })
            .then((data) => {
              this.selectedPrimitiveHistogram = primitive;
              this.intervalHistogram[primitive] = data;
              this.intervalHistogramWindow[primitive] = [this.intervalHistogramBeginLimit, this.intervalHistogramEndLimit];
              this.trigger('intervalHistogramUpdated');
            })
            .catch(err => {
              err.text.then( errorMessage => {
                console.warn(errorMessage);
              });
            });
      }
    }, 50);
  }
}
LinkedState.COLOR_SCHEMES = {
  Inclusive: {
    contentFillColor: "#d9d9d9",
    contentBorderColor: "#737373",
    mouseHoverSelectionColor: '#ff0500', // red
    selectionColor: '#e6ab02', // yellow
    traceBackColor: '#000000', // black
    timeScale: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'] // purple
  },
  Exclusive: {
    contentFillColor: "#d9d9d9",
    contentBorderColor: "#737373",
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#7570b3', // purple
    traceBackColor: '#000000', // black
    timeScale: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'] // green
  },
  Difference: {
    contentFillColor: "#d9d9d9",
    contentBorderColor: "#737373",
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#4daf4a', // green
    traceBackColor: '#000000', // black
    timeScale: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'] // diverging red blue
  }
};
export default LinkedState;
