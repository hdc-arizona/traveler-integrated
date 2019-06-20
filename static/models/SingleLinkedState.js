/* globals d3 */
import { Model } from '/static/node_modules/uki/dist/uki.esm.js';

class SingleLinkedState extends Model {
  constructor (label, metadata) {
    super();

    this.label = label;
    this.metadata = metadata;
    this.intervalWindow = this.metadata.intervalDomain ? Array.from(this.metadata.intervalDomain) : null;
    this.selectedPrimitive = null;
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
    })();
  }
  setIntervalWindow (begin, end) {
    if (this.intervalDomain === null) {
      throw new Error("Can't set interval window; no interval data");
    }
    const oldBegin = this.intervalWindow[0];
    const oldEnd = this.intervalWindow[1];
    // Clamp to where there's actually data
    begin = Math.max(this.metadata.intervalDomain[0], begin);
    end = Math.min(this.metadata.intervalDomain[1], end);
    this.intervalWindow = [begin, end];
    if (oldBegin !== begin || oldEnd !== end) {
      this.trigger('newInterval');
    }
  }
}

export default SingleLinkedState;
