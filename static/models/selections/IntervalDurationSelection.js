import Selection from './Selection.js';

class IntervalDurationSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this._intervalDurationSpan = options.intervalDurationSpan;
    this.durationDomain = options.durationDomain;
    this.durationBins = options.durationBins;
    this.primitiveName = options.primitiveName;
    this.primitiveHistogram = {};
  }

  /**
   * Add selection-specific arguments to /getUtilizationForPrimitive API endpoint,
   * and fetch the data
   * TODO: this implementation may run slower for larger datasets. Find
   */
  async getUtilization (urlArgs) {
    // get utilization for the gantt view only
    if(urlArgs.utilType === 'gantt') {
      urlArgs.enter = this.intervalDurationSpan[0];
      urlArgs.leave = this.intervalDurationSpan[1];
      urlArgs.primitive = this.primitiveName;
      const url = `/datasets/${window.controller.currentDatasetId}/getIntervalList?` +
          Object.entries(urlArgs).map(([key, value]) => {
            return `${key}=${encodeURIComponent(value)}`;
          }).join('&');
      const response = await window.fetch(url);
      const json = await response.json();
      return this.getPrimitiveHistogramForGantt(json, urlArgs);
    }

    // get utilization for the utilization view only
    if(!(this.primitiveName in this.primitiveHistogram)) {
      urlArgs.primitive = this.primitiveName;
      urlArgs.duration_bins = this.durationBins;
      this.histogramResolution = urlArgs.bins;
      const url = `/datasets/${window.controller.currentDatasetId}/getUtilizationForPrimitive?` +
          Object.entries(urlArgs).map(([key, value]) => {
            return `${key}=${encodeURIComponent(value)}`;
          }).join('&');
      const response = await window.fetch(url);
      const json = await response.json();
      this.primitiveHistogram[this.primitiveName] = json;
      this.estimateHistogramsForPrimitive();
    }
    return this.getPrimitiveHistogramForUtilization();
  }

  estimateHistogramsForPrimitive() {
    // do the pre-calculation here
    const currentPrimitive = this.primitiveName;
    this.primitiveHistogram[currentPrimitive].aux = new Array(this.histogramResolution);
    for(let i=0; i<this.histogramResolution; i++){
      this.primitiveHistogram[currentPrimitive].aux[i] = new Array(this.durationBins);
    }
    for(let i=0; i<this.histogramResolution; i++){
      for(let j=0; j<this.durationBins; j++){
        var preValue = 0;
        if(j>0) {
          preValue = this.primitiveHistogram[currentPrimitive].aux[i][j-1];
        }
        this.primitiveHistogram[currentPrimitive].aux[i][j] =
            this.primitiveHistogram[currentPrimitive].data[i][j] + preValue;
      }
    }
  }

  getPrimitiveHistogramForGantt(utilData, urlArgs){
    if(!utilData){
      return null;
    }
    let ret = {'locations': {}, 'metadata': {'begin': urlArgs.begin, 'end': urlArgs.end, 'bins': urlArgs.bins}};
    const rangePerBin = (urlArgs.end - urlArgs.begin) / urlArgs.bins;

    for (const [location, intervalList] of Object.entries(utilData)) {
      if(!(location in ret['locations'])) {
        ret['locations'][location] = new Array(urlArgs.bins).fill(0);
      }
      for(const interval of intervalList) {
        let startingBin = Math.floor((interval.begin - urlArgs.begin) / rangePerBin);
        let endingBin =  Math.ceil((interval.end - urlArgs.begin) / rangePerBin);
        ret['locations'][location][startingBin] = 0.5;
        ret['locations'][location][endingBin] = 0.5;
        for(let i = startingBin+1; i < endingBin; i++) {
          ret['locations'][location][i] = 1;
        }
      }
    }
    return ret;
  }

  getPrimitiveHistogramForUtilization(){
    const begin = this.intervalDurationSpan[0];
    const end = this.intervalDurationSpan[1];
    const currentPrimitive = this.primitiveName;
    if(!this.primitiveHistogram || !(currentPrimitive in this.primitiveHistogram)){
      return null;
    }
    const rangePerDurationBin = (this.durationDomain[1]-this.durationDomain[0])/this.durationBins;
    const beginIndex = ((begin - this.durationDomain[0]) / rangePerDurationBin) | 0;
    let endIndex = (((end - this.durationDomain[0]) / rangePerDurationBin) | 0);
    if(endIndex > 0) {
      endIndex = endIndex - 1;
    }
    let ret = new Array(this.histogramResolution).fill(0);
    const rangePerBin = (this.primitiveHistogram[currentPrimitive].metadata.end - this.primitiveHistogram[currentPrimitive].metadata.begin)
        / this.primitiveHistogram[currentPrimitive].metadata.bins;
    for(let i=0;i<this.histogramResolution;i++){
      ret[i] = (this.primitiveHistogram[currentPrimitive].aux[i][endIndex] - this.primitiveHistogram[currentPrimitive].aux[i][beginIndex]) / rangePerBin;
    }
    return {'data': ret, 'metadata': this.primitiveHistogram[currentPrimitive].metadata} ;
  }

  set primitiveName(pName) {
    if(Array.isArray(pName)) {
      this._primitiveName = pName.join();
    } else if(pName === null || pName === '') {
      this._primitiveName = 'all_primitives';
    } else {
      this._primitiveName = pName;
    }
  }

  get primitiveName () {
    return this._primitiveName;
  }

  get intervalDurationSpan () {
    return this._intervalDurationSpan;
  }

  /**
   * Constrain that the span makes sense, and notify views when it changes
   */
  set intervalDurationSpan (span) {
    // Allow views to set just one of the values (e.g. dragging one brush
    // handle in UtilizationView)
    const newSpan = [
      span[0] === undefined ? this._intervalDurationSpan[0] : span[0],
      span[1] === undefined ? this._intervalDurationSpan[1] : span[1]
    ];
    // Clamp to the lowest / highest possible values
    newSpan[0] = Math.max(newSpan[0], this.durationDomain[0]);
    newSpan[1] = Math.max(newSpan[1], this.durationDomain[0]);
    newSpan[1] = Math.min(newSpan[1], this.durationDomain[1]);
    newSpan[0] = Math.min(newSpan[0], this.durationDomain[1]);
    // Ensure begin < end
    if (newSpan[1] < newSpan[0]) {
      const temp = newSpan[1];
      newSpan[1] = newSpan[0];
      newSpan[0] = temp;
    }
    // Ensure integer queries
    newSpan[0] = Math.floor(newSpan[0]);
    newSpan[1] = Math.ceil(newSpan[1]);
    // Only update if something is different
    if (newSpan[0] !== this._intervalDurationSpan[0] || newSpan[1] !== this._intervalDurationSpan[1]) {
      this._intervalDurationSpan = newSpan;
      this.trigger('intervalDurationSpanChanged');
    }
  }

  /**
   * A short string that identifies the selection
   */
  get label () {
    return '';
  }

  /**
   * All the details about this primitive; for now this is displayed
   * verbatim in a <pre> tag so whitespace matters
   */
  get details () {
    let result = `\
Intervals at least as long as ${this.intervalDurationSpan[0]} ns
and at most as long as ${this.intervalDurationSpan[1]} ns`;
    if (this.primitiveName) {
      result += `
that belong to primitive ${this.primitiveName}`;
    }
    return result;
  }
}
export default IntervalDurationSelection;
