/* globals d3 */
import { Model } from '/static/node_modules/uki/dist/uki.esm.js';

class SingleLinkedState extends Model {
  constructor (label, metadata) {
    super();

    this.label = label;
    this.metadata = metadata;
    this.selectedPrimitive = null;
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
    })();
  }
}

export default SingleLinkedState;
