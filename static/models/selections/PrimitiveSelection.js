import Selection from './Selection.js';

class PrimitiveSelection extends Selection {
  constructor (options) {
    options.resources = options.resources || [];
    if (options.utilizationBins !== undefined) {
      const urlFriendlyPrimitive = encodeURIComponent(options.primitiveName);
      options.resources.push({
        type: 'json',
        name: 'utilization',
        url: `/datasets/${options.datasetId}/utilizationHistogram?bins=${options.utilizationBins}&primitive=${urlFriendlyPrimitive}`
      });
    }

    super(options);

    this.datasetId = options.datasetId;
    this.primitiveName = options.primitiveName;
    this.primitiveDetails = options.primitiveDetails;
  }

  refreshUtilization (bins) {
    const urlFriendlyPrimitive = encodeURIComponent(this.primitiveName);
    this.updateResource({
      type: 'json',
      name: 'utilization',
      url: `/datasets/${this.datasetId}/utilizationHistogram?bins=${bins}&primitive=${urlFriendlyPrimitive}`
    });
  }

  get label () {
    return this.primitiveName;
  }

  get details () {
    return JSON.stringify(this.primitiveDetails, null, 2);
  }
}
export default PrimitiveSelection;
