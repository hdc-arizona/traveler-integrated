import Selection from './Selection.js';

class PrimitiveSelection extends Selection {
  constructor (options) {
    options.resources = options.resources || [];
    if (options.fetchTraceData) {
      // TODO: add primitive-specific API calls to options.resources
      // that are needed for trace data visualizations, and add mechanisms
      // for views to update resources based on zooming, panning, etc
    }
    super(options);

    this.primitiveName = options.primitiveName;
    this.primitiveDetails = options.primitiveDetails;
  }

  toString () {
    return JSON.stringify(this.primitiveDetails, null, 2);
  }
}
export default PrimitiveSelection;
