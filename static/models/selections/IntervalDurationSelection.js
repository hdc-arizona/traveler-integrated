import Selection from './Selection.js';

class IntervalDurationSelection extends Selection {
  constructor (options) {
    super(...arguments);

    this._intervalDurationSpan = options.intervalDurationSpan;
    this.durationLimit = options.durationLimit;
    this.primitiveName = options.primitiveName || null;
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
