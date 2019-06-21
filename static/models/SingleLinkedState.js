/* globals d3 */
import { Model } from '/static/node_modules/uki/dist/uki.esm.js';

class SingleLinkedState extends Model {
  constructor (label, metadata) {
    super();

    this.label = label;
    this.metadata = metadata;
    // Sometimes the locations aren't sorted (todo: enable interactive sorting?)
    this.metadata.locationNames.sort();
    this.intervalWindow = this.metadata.intervalDomain ? Array.from(this.metadata.intervalDomain) : null;
    this.selectedPrimitive = null;
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
    })();
  }
  get begin () {
    return this.intervalWindow[0];
  }
  get end () {
    return this.intervalWindow[1];
  }
  get beginLimit () {
    return this.metadata.intervalDomain[0];
  }
  get endLimit () {
    return this.metadata.intervalDomain[1];
  }
  setIntervalWindow ({
    begin = this.begin,
    end = this.end
  } = {}) {
    if (this.intervalDomain === null) {
      throw new Error("Can't set interval window; no interval data");
    }
    const oldBegin = this.begin;
    const oldEnd = this.end;
    // Clamp to where there's actually data
    begin = Math.max(this.beginLimit, begin);
    end = Math.min(this.endLimit, end);
    this.intervalWindow = [begin, end];
    if (oldBegin !== begin || oldEnd !== end) {
      this.stickyTrigger('newIntervalWindow', { begin, end });
    }
  }
  selectPrimitive (primitive) {
    if (primitive !== this.selectedPrimitive) {
      this.selectedPrimitive = primitive;
      this.stickyTrigger('primitiveSelected', { primitive });
    }
  }
}

export default SingleLinkedState;
