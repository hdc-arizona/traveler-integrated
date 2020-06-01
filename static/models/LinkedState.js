/* globals d3, oboe */
import { Model } from '/static/node_modules/uki/dist/uki.esm.js';

class LinkedState extends Model {
  constructor (label, metadata) {
    super();

    this.label = label;
    this.metadata = metadata;
    // Sometimes the locations aren't sorted (todo: enable interactive sorting?)
    if (this.metadata.locationNames) {
      this.metadata.locationNames.sort();
    }
    // Don't bother retrieving intervals if there are more than 7000 in this.intervalWindow
    this.intervalCutoff = 7000;
    this.intervalWindow = this.metadata.intervalDomain ? Array.from(this.metadata.intervalDomain) : null;
    this.cursorPosition = null;
    this.selectedPrimitive = null;
    this.selectedGUID = null;
    this.selectedIntervalId = null;
    this.caches = {};
    this._mode = 'Inclusive';
    this.histogramResolution = 512;
    this.selectedProcMetric = 'PAPI_TOT_CYC';//'meminfo:MemFree';

    // Start processes for collecting data
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
    })();
    this.fetchGanttAggBins();
    this.caches.metricAggBins = {};
    this._metricAggTimeout = {};
    this.fetchMetricBins();
    // this.startIntervalStream();
    this.startTracebackStream();
    this.updateHistogram();
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
  setGanttXResolution(value){
    this.ganttXResolution = value;
    this.fetchGanttAggBins();
  }
  setMetricXResolution(value){
    this.metricXResolution = value;
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
    // this.startIntervalStream();
    this.startTracebackStream();
    if (oldBegin !== begin || oldEnd !== end) {
      this.stickyTrigger('newIntervalWindow', { begin, end });
    }
  }
  selectPrimitive (primitive) {
    if (primitive !== this.selectedPrimitive) {
      this.selectedPrimitive = primitive;
      this.updateHistogram();
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
      this.startTracebackStream();
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
        views['LineChartView'] = false;
        views['LineChartViewNew'] = false;
        views['LineChartViewCanvas'] = true;
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
  getCurrentTraceback () {
    // Returns a right-to-left list of intervals
    let traceback = this.caches.traceback ||
      this.caches.newTraceback;

    if (traceback === undefined) {
      return [];
    }

    // Make a copy of the traceback so we don't mutate the cache
    traceback = Object.assign({}, traceback);

    // Derive a list of intervals from the streamed list of IDs
    const intervals = this.getCurrentIntervals();
    let linkData = [];
    for (const intervalId of traceback.visibleIds) {
      if (intervals[intervalId]) {
        linkData.push(intervals[intervalId]);
      } else {
        // The list of IDs came back faster than the intervals themselves, we
        // should cut off the line at this point (should only happen during
        // incremental rendering)
        delete traceback.leftEndpoint;
        break;
      }
    }

    if (linkData.length > 0) {
      if (traceback.rightEndpoint) {
        // Construct a fake "interval" for the right endpoint, because we draw
        // lines to the left (linkData is right-to-left)
        const parent = linkData[0];
        linkData.unshift({
          intervalId: traceback.rightEndpoint.id,
          Location: traceback.rightEndpoint.location,
          enter: { Timestamp: traceback.rightEndpoint.beginTimestamp },
          lastParentInterval: {
            id: parent.intervalId,
            endTimestamp: parent.leave.Timestamp,
            location: parent.Location
          }
        });
      }
      if (traceback.leftEndpoint) {
        // Copy the important parts of the leftmost interval object, overriding
        // lastParentInterval (linkData is right-to-left)
        const firstInterval = linkData[linkData.length - 1];
        linkData[linkData.length - 1] = {
          intervalId: firstInterval.intervalId,
          Location: firstInterval.Location,
          enter: { Timestamp: firstInterval.enter.Timestamp },
          lastParentInterval: traceback.leftEndpoint
        };
      } else if (!linkData[linkData.length - 1].lastParentInterval) {
        // In cases where an interval with no parent is at the beginning of the
        // traceback, there's no line to draw to the left; we can just omit it
        linkData.splice(-1);
      }
    }
    return linkData;
  }
  //we query intervals as a set of pre-aggregrated pixel-wide bins
  // the drawing process is significantly simplified and sped up from this
  fetchGanttAggBins(){
    var bins = this.ganttXResolution;
    var queryRange = this.intervalWindow[1] - this.intervalWindow[0];
    // console.log(this.getCurrentHistogramData().domain)
    if(typeof this.caches.histogramDomain !== 'undefined'){
      // console.log(this.caches.histogramDomain[0],this.caches.histogramDomain[1])
      var begin = (this.intervalWindow[0] - queryRange > this.caches.histogramDomain[0]) ? this.intervalWindow[0] - queryRange : this.intervalWindow[0];
      var end = (this.intervalWindow[1] + queryRange < this.caches.histogramDomain[1]) ? this.intervalWindow[1] + queryRange : this.intervalWindow[1];
    }
    else{
      var begin = this.intervalWindow[0];
      var end = this.intervalWindow[1];
    }

    // console.log(bins, begin, end);

    // console.log(begin, end);
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
              console.warn(errorMessage)
            });
          });
      }
    }, 50);

  }
  fetchMetricBins(){
    console.log("fetch metric bins called");
    if(!(this.selectedProcMetric in this.caches.metricAggBins)) {
      this.caches.metricAggBins[this.selectedProcMetric] = {}
    }

    for( const curMetric in this.caches.metricAggBins) {
      var bins = this.metricXResolution;
      var queryRange = this.intervalWindow[1] - this.intervalWindow[0];
      var begin = this.intervalWindow[0];
      var end = this.intervalWindow[1];
      if(typeof this.caches.histogramDomain !== 'undefined'){
        begin = (this.intervalWindow[0] - queryRange > this.caches.histogramDomain[0]) ? this.intervalWindow[0] - queryRange : this.intervalWindow[0];
        end = (this.intervalWindow[1] + queryRange < this.caches.histogramDomain[1]) ? this.intervalWindow[1] + queryRange : this.intervalWindow[1];
      }
      //this function will replace the fetching of intervals
      window.clearTimeout(this._metricAggTimeout[curMetric]);
      this._metricAggTimeout[curMetric] = window.setTimeout(async () => {
        //*****NetworkError on reload is here somewhere******//
        if (bins){
          const label = encodeURIComponent(this.label);
          var endpt = `/datasets/${label}/newMetricData?bins=${bins}&metric_type=${curMetric}&location=1&begin=${Math.floor(begin)}&end=${Math.ceil(end)}`;
          fetch(endpt)
              .then((response) => {
                return response.json();
              })
              .then((data) => {
                this.caches.metricAggBins[curMetric] = data;
                this.trigger('intervalsUpdated');
              })
              .catch(err => {
                err.text.then( errorMessage => {
                  console.warn(errorMessage)
                });
              });
        }
      }, 50);
    }



  }
  startIntervalStream () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._intervalTimeout);
    this._intervalTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.label);
      // First check whether we're asking for too much data by getting a
      // histogram with a single bin (TODO: draw per-location histograms instead
      // of just saying "Too much data; scroll to zoom in?")
      let bailEarly = this.intervalWindow === null;
      if (!bailEarly) {
        const histogram = await d3.json(`/datasets/${label}/histogram?bins=1&mode=count&begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`);
        const intervalCount = histogram[0][2];
        bailEarly = intervalCount === 0 || intervalCount > this.intervalCutoff;
        this.caches.intervalOverflow = intervalCount > this.intervalCutoff;
      }

      if (bailEarly) {
        // Empty out whatever we were looking at before and bail immediately
        delete this.caches.intervals;
        delete this.caches.newIntervals;
        delete this.caches.intervalStream;
        delete this.caches.intervalError;
        this.trigger('intervalStreamFinished');
        return;
      }

      // Start the interval stream, and collect it in a separate cache to avoid
      // old intervals from disappearing from incremental refreshes
      this.trigger('intervalStreamStarted');
      this.caches.newIntervals = {};
      this.caches.intervalOverflow = false;
      const self = this;
      const intervalStreamUrl = `/datasets/${label}/intervals?begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`;
      const currentIntervalStream = this.caches.intervalStream = oboe(intervalStreamUrl)
        .fail(error => {
          this.caches.intervalError = error;
          console.warn(error);
        })
        .node('!.*', function (interval) {
          delete self.caches.intervalError;
          if (currentIntervalStream !== self.caches.intervalStream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            self.caches.newIntervals[interval.intervalId] = interval;
            self.trigger('intervalsUpdated');
          }
        })
        .done(() => {
          delete this.caches.intervalStream;
          this.caches.intervals = this.caches.newIntervals;
          delete this.caches.newIntervals;
          this.trigger('intervalStreamFinished');
        });
    }, 100);
  }
  startTracebackStream () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._tracebackTimeout);
    this._tracebackTimeout = window.setTimeout(async () => {
      // Is there even anything to stream?
      if (!this.selectedIntervalId || this.intervalWindow === null) {
        delete this.caches.traceback;
        delete this.caches.newTraceback;
        delete this.caches.tracebackStream;
        delete this.caches.tracebackError;
        this.trigger('tracebackStreamFinished');
        return;
      }

      this.trigger('tracebackStreamStarted');
      this.caches.newTraceback = {
        visibleIds: [],
        rightEndpoint: null,
        leftEndpoint: null
      };
      const self = this;
      const label = encodeURIComponent(this.label);
      const tracebackStreamUrl = `/datasets/${label}/intervals/${this.selectedIntervalId}/trace?begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`;
      const currentTracebackStream = this.caches.tracebackStream = oboe(tracebackStreamUrl)
        .fail(error => {
          this.caches.tracebackError = error;
          console.warn(error);
        })
        .node('!.*', function (idOrMetadata) {
          delete self.caches.tracebackError;
          if (currentTracebackStream !== self.caches.tracebackStream) {
            this.abort();
            return;
          } else if (typeof idOrMetadata === 'string') {
            self.caches.newTraceback.visibleIds.push(idOrMetadata);
          } else if (idOrMetadata.beginTimestamp !== undefined) {
            self.caches.newTraceback.rightEndpoint = idOrMetadata;
          } else if (idOrMetadata.endTimestamp !== undefined) {
            self.caches.newTraceback.leftEndpoint = idOrMetadata;
          }
          self.trigger('tracebackUpdated');
        })
        .done(() => {
          delete this.caches.tracebackStream;
          this.caches.traceback = this.caches.newTraceback;
          delete this.caches.newTraceback;
          this.trigger('tracebackStreamFinished');
        });
    }, 100);
  }
  getCurrentHistogramData () {
    return {
      histogram: this.caches.histogram,
      primitiveHistogram: this.caches.primitiveHistogram,
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

      // console.log(this.newCaches.histogram);

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
}
LinkedState.COLOR_SCHEMES = {
  Inclusive: {
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#e6ab02', // yellow
    traceBackColor: '#000000', // black
    timeScale: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'] // purple
  },
  Exclusive: {
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#7570b3', // purple
    traceBackColor: '#000000', // black
    timeScale: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'] // green
  },
  Difference: {
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#4daf4a', // green
    traceBackColor: '#000000', // black
    timeScale: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'] // diverging red blue
  }
};
export default LinkedState;
