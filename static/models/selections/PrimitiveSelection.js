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
    let allJson = undefined;
    if(Array.isArray(this.primitiveName)) {
      for (const eachPrimitiveName of this.primitiveName) {
        urlArgs.primitive = eachPrimitiveName;
        const url = `/datasets/${window.controller.currentDatasetId}/utilizationHistogram?` +
            Object.entries(urlArgs).map(([key, value]) => {
              return `${key}=${encodeURIComponent(value)}`;
            }).join('&');
        const response = await window.fetch(url);
        const json = await response.json();
        if(allJson === undefined) {
          allJson = json;
        } else {
          if(json.locations !== undefined) {
            Object.keys(json.locations).forEach(function (key) {
              for (let ind in json.locations[key]) {
                allJson.locations[key][ind] = Math.max(json.locations[key][ind], allJson.locations[key][ind]);
              }
            });
          } else if(json.data !== undefined) {
            for (let ind in json.data) {
              allJson.data[ind] = allJson.data[ind] + json.data[ind];
            }
          }
        }
      }
    } else {
      urlArgs.primitive = this.primitiveName;
      const url = `/datasets/${window.controller.currentDatasetId}/utilizationHistogram?` +
          Object.entries(urlArgs).map(([key, value]) => {
            return `${key}=${encodeURIComponent(value)}`;
          }).join('&');
      const response = await window.fetch(url);
      const json = await response.json();
      allJson = json;
    }
    return allJson;
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
