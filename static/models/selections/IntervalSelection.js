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
}
export default IntervalSelection;
