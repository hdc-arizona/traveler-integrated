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
  async getUtilization (urlArgs, aggregatedIntervals) {
    var allJson = {};
    var utilization = new Array(urlArgs.bins).fill(0);
    var results = {};
    var flag = {};

    if(aggregatedIntervals !== undefined && 'data' in aggregatedIntervals) {
      for (const [location, aggregatedTimes] of Object.entries(aggregatedIntervals.data)) {
        for (let aggTime of aggregatedTimes) {
          for (const eachChild of aggTime.childList) {
            if(!(eachChild.name in allJson)) {
              allJson[eachChild.name] = await this.getUtilizationResultsForLocation(eachChild.name, aggTime.locationList, urlArgs);
              flag[eachChild.name] = {}
              for (const [loc, utils] of Object.entries(allJson[eachChild.name].locations)) {
                flag[eachChild.name][loc] = new Array(urlArgs.bins).fill(0);
              }
            } else {
              var newLocations = [];
              for(let loc of aggTime.locationList) {
                if(!(loc in allJson[eachChild.name].locations)) {
                  newLocations.push(loc);
                }
              }
              if(newLocations.length > 0){
                const json = await this.getUtilizationResultsForLocation(eachChild.name, newLocations, urlArgs);
                for (const [loc, utils] of Object.entries(json.locations)) {
                  flag[eachChild.name][loc] = new Array(urlArgs.bins).fill(0);
                }
                Object.assign(allJson[eachChild.name].locations, json.locations);
              }
            }
            let startingBin = this.getBinNumber(eachChild.enter, allJson[eachChild.name].metadata);
            let endingBin = this.getBinNumber(eachChild.leave, allJson[eachChild.name].metadata);
            for(var i = startingBin; i <= Math.min(endingBin, allJson[eachChild.name].metadata.bins-1); i++) {
              if(flag[eachChild.name][eachChild.location][i] > 0) {
                continue;
              }
              utilization[i] = utilization[i] + allJson[eachChild.name].locations[eachChild.location][i];
              flag[eachChild.name][eachChild.location][i] = 1;
            }
          }
        }
      }
      results = {}
      results['data'] = utilization;
      console.log("max util: ", Math.max(...utilization));
    } else if(!Array.isArray(this.primitiveName)) {
    //   console.log("Primitive List should be an array");
    // }
    //
    // let allJson = undefined;
    // if(Array.isArray(this.primitiveName)) {
    //   for (const eachPrimitiveName of this.primitiveName) {
    //     urlArgs.primitive = eachPrimitiveName;
    //     const url = `/datasets/${window.controller.currentDatasetId}/utilizationHistogram?` +
    //         Object.entries(urlArgs).map(([key, value]) => {
    //           return `${key}=${encodeURIComponent(value)}`;
    //         }).join('&');
    //     const response = await window.fetch(url);
    //     const json = await response.json();
    //     if(allJson === undefined) {
    //       allJson = json;
    //     } else {
    //       if(json.locations !== undefined) {
    //         Object.keys(json.locations).forEach(function (key) {
    //           for (let ind in json.locations[key]) {
    //             allJson.locations[key][ind] = Math.max(json.locations[key][ind], allJson.locations[key][ind]);
    //           }
    //         });
    //       } else if(json.data !== undefined) {
    //         for (let ind in json.data) {
    //           allJson.data[ind] = allJson.data[ind] + json.data[ind];
    //         }
    //       }
    //     }
    //   }
    // } else {
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
