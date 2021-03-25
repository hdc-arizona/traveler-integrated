import Selection from './Selection.js';

class IntervalSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this.intervalDetails = options.intervalDetails;
  }

  /**
   * Parameters to add to any /utilizationHistogram API calls
   */
  get utilizationParameters () {
    // TODO: show the utilization for this interval's ancestors? That would be
    // expensive... alternative: create fake "utilization" results from just
    // this selected interval
    // For now, showing the utilization for the associated primitive
    return `&primitive=${encodeURIComponent(this.intervalDetails.Primitive)}`;
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
