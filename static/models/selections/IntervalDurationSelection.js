import Selection from './Selection.js';

class IntervalDurationSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this._intervalDurationSpan = options.intervalDurationSpan;
    this.durationLimit = options.durationLimit;
    this.primitiveName = options.primitiveName || null;
  }

  /**
   * TODO: implement the getUtilization function here to show utilization in
   * both UtilizationView and highligheted bars in GanttView for a brushed
   * region in IntervalHistogramView. This will probably require adding
   * arguments to api/metrics.py's get_utilization_histogram endpoint to accept
   * this.intervalDurationSpan. I *think* sparseUtilizationList had something
   * that could do this, but I never quite figured out how it worked; I think
   * the durationBegin / durationEnd parameters here could be relevant:
   * https://github.com/hdc-arizona/traveler-integrated/blob/eea880b6dfede946e8a82e96e32465135c07b0f0/serve.py#L736
   */

  /**
   * Add selection-specific arguments to /getUtilizationForPrimitive API endpoint,
   * and fetch the data
   * TODO: this implementation may run slower for larger datasets. Find
   */
  async getUtilization (urlArgs) {
    var results = {};

    urlArgs.primitive = undefined;
    if(Array.isArray(this.primitiveName)) {
      urlArgs.primitives = this.primitiveName.join();
    } else {
      urlArgs.primitives = this.primitiveName;
    }
    urlArgs.nodeId = this.primitiveDetails;
    const url = `/datasets/${window.controller.currentDatasetId}/getUtilizationForPrimitive?` +
        Object.entries(urlArgs).map(([key, value]) => {
          return `${key}=${encodeURIComponent(value)}`;
        }).join('&');
    const response = await window.fetch(url);
    const json = await response.json();

    if(urlArgs.isCombine === true) {
      var binSize = (urlArgs.end - urlArgs.begin) / urlArgs.bins;
      results['data'] = new Array(urlArgs.bins).fill(0);
      for (const [location, aggregatedTimes] of Object.entries(json.data)) {
        for (let aggTime of aggregatedTimes) {
          let snappedStartBin = Math.floor(( aggTime.startTime - urlArgs.begin) / binSize) - 1;
          aggTime.util.forEach((d,j)=>{
            results['data'][j + snappedStartBin] = results['data'][j + snappedStartBin] + d;
          });
        }
      }
    } else {
      results = json;
    }
    return results;
  }

  fetchPrimitiveHistogramData(){
    if(!this.selectedPrimitiveHistogram) {
      return;
    }
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
      this.primitiveHistogram[currentPrimitive].aux = new Array(this.histogramResolution);
      for(let i=0; i<this.histogramResolution; i++){
        this.primitiveHistogram[currentPrimitive].aux[i] = new Array(durationBins);
      }
      for(let i=0; i<this.histogramResolution; i++){
        for(let j=0; j<durationBins; j++){
          var preValue = 0;
          if(j>0) {
            preValue = this.primitiveHistogram[currentPrimitive].aux[i][j-1];
          }
          this.primitiveHistogram[currentPrimitive].aux[i][j] =
              this.primitiveHistogram[currentPrimitive].data[i][j] + preValue;
        }
      }

      this.trigger('primitiveHistogramUpdated');
    }, 100);
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
    newSpan[0] = Math.max(newSpan[0], this.durationLimit[0]);
    newSpan[1] = Math.max(newSpan[1], this.durationLimit[0]);
    newSpan[1] = Math.min(newSpan[1], this.durationLimit[1]);
    newSpan[0] = Math.min(newSpan[0], this.durationLimit[1]);
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
