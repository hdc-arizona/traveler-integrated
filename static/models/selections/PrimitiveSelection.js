import Selection from './Selection.js';

class PrimitiveSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this.primitiveName = options.primitiveName;
    this.primitiveDetails = options.primitiveDetails;
  }

  /**
   * Add selection-specific arguments to /utilizationHistogram API endpoint,
   * and fetch the data
   */
  async getUtilization (urlArgs) {
    var results = {};
    urlArgs.primitive = this.primitiveName;
    const url = `/datasets/${window.controller.currentDatasetId}/utilizationHistogram?` +
        Object.entries(urlArgs).map(([key, value]) => {
          return `${key}=${encodeURIComponent(value)}`;
        }).join('&');
    const response = await window.fetch(url);
    const json = await response.json();
    results = json;
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
