import Selection from './Selection.js';

class PrimitiveSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this.primitiveName = options.primitiveName;
    this.primitiveDetails = options.primitiveDetails;
  }

  getBinNumber(cTime, metadata) {
    const binSize = (metadata.end - metadata.begin) / metadata.bins;
    return Math.floor((cTime - metadata.begin) / binSize);
  }

  async getUtilizationResultsForLocation(primitive, locations, urlArgs) {
    urlArgs.primitive = primitive;
    urlArgs.locations = locations.join();
    const url = `/datasets/${window.controller.currentDatasetId}/utilizationHistogram?` +
        Object.entries(urlArgs).map(([key, value]) => {
          return `${key}=${encodeURIComponent(value)}`;
        }).join('&');
    const response = await window.fetch(url);
    const json = await response.json();
    return json;
  }

  /**
   * Add selection-specific arguments to /utilizationHistogram API endpoint,
   * and fetch the data
   */
  async getUtilization (urlArgs) {
    var allJson = {};
    var utilization = new Array(urlArgs.bins).fill(0);
    var results = {};
    var flag = {};
    var aggregatedIntervals = undefined;

    if(Array.isArray(this.primitiveName)) {
      urlArgs.primitive = undefined;
      urlArgs.primitives = this.primitiveName.join();
      urlArgs.nodeId = this.primitiveDetails;
      const url = `/datasets/${window.controller.currentDatasetId}/primitives/primitiveTraceForward?` +
          Object.entries(urlArgs).map(([key, value]) => {
            return `${key}=${encodeURIComponent(value)}`;
          }).join('&');
      const response = await window.fetch(url);
      const json = await response.json();
      results = json;
    } else if(!Array.isArray(this.primitiveName)) {
      urlArgs.primitive = this.primitiveName;
      const url = `/datasets/${window.controller.currentDatasetId}/utilizationHistogram?` +
          Object.entries(urlArgs).map(([key, value]) => {
            return `${key}=${encodeURIComponent(value)}`;
          }).join('&');
      const response = await window.fetch(url);
      const json = await response.json();
      results = json;
    } else {
      results['data'] = utilization;
    }
    return results;
  }

  /**
   * A short string that identifies the selection
   */
  get label () {
    return this.primitiveName;
  }

  /**
   * All the details about this primitive; for now we just dump
   * pretty-printed JSON
   */
  get details () {
    return JSON.stringify(this.primitiveDetails, null, 2);
  }
}
export default PrimitiveSelection;
