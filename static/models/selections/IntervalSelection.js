/* globals d3 */

import Selection from './Selection.js';

class IntervalSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this.intervalDetails = options.intervalDetails;
  }

  /**
   * Since we've only selected an interval, we don't need to hit the API; we
   * can just create a fake utilization histogram containing only one interval
   * (if the location is correct; otherwise, just send back zeros)
   * TODO: if we want to show this interval's primitive's utilization instead,
   * copy the function from PrimitiveSelection, and use
   * this.intervalDetails.primitive instead of this.primitiveName
   */
  async getUtilization (urlArgs) {
    // Figure out the begin / end metadata
    const overviewDomain = window.controller.currentDataset.overviewDomain;
    const begin = urlArgs.begin !== undefined ? urlArgs.begin : overviewDomain[0];
    const end = urlArgs.end !== undefined ? urlArgs.end : overviewDomain[1];
    const tempScale = d3.scaleLinear()
      .domain([begin, end])
      .range([0, urlArgs.bins]);
    const result = {
      metadata: {
        bins: urlArgs.bins,
        begin,
        end
      }
    };
    // Generate an empty response
    let myBinList;
    if (urlArgs.locations) {
      result.locations = {};
      for (const location of urlArgs.locations.split(',')) {
        result.locations[location] = new Array(urlArgs.bins).fill(0);
        if (location === this.intervalDetails.Location) {
          myBinList = result.locations[location];
        }
      }
    } else {
      result.data = myBinList = new Array(urlArgs.bins).fill(0);
    }
    // Fill in the bins where our interval lives
    if (myBinList) {
      const leftBorder = Math.floor(tempScale(this.intervalDetails.enter.Timestamp));
      const rightBorder = Math.ceil(tempScale(this.intervalDetails.leave.Timestamp));
      // Slightly less than 1.0 for each border
      if (leftBorder > 0 && leftBorder < myBinList.length) {
        myBinList[leftBorder] = 0.95;
      }
      if (rightBorder > 0 && rightBorder < myBinList.length) {
        myBinList[rightBorder] = 0.95;
      }
      // 1.0 for each bin between
      const left = Math.max(leftBorder + 1, 0);
      const right = Math.min(rightBorder - 1, myBinList.length);
      for (let i = left; i <= right; i++) {
        myBinList[i] = 1;
      }
    }
    return result;
  }

  /**
   * A short string that identifies the selection
   */
  get label () {
    return this.intervalDetails.intervalId;
  }

  /**
   * All the details about this primitive; for now we just dump
   * pretty-printed JSON
   */
  get details () {
    return JSON.stringify(this.intervalDetails, null, 2);
  }

  /**
   * A list of relevant selections to this one to enable easy pivoting
   * to this interval's primitive, ancestor interval, or child intervals
   */
  get links () {
    const links = [{
      label: `Select primitive: ${this.intervalDetails.Primitive}`,
      pivot: () => {
        window.controller.currentDataset
          .selectPrimitive(this.intervalDetails.Primitive);
      }
    }];
    if (this.intervalDetails.parent) {
      links.push({
        label: `Select parent: ${this.intervalDetails.parent}`,
        pivot: () => {
          window.controller.currentDataset
            .selectIntervalById(this.intervalDetails.parent);
        }
      });
    }
    links.push(...this.intervalDetails.children.map(childId => {
      return {
        label: `Select child: ${childId}`,
        pivot: () => {
          window.controller.currentDataset.selectIntervalById(childId);
        }
      };
    }));
    return links;
  }
}
export default IntervalSelection;
