import Selection from './Selection.js';

// Convenience functions that have to be defined outside of the class because
// they're used before the constructor's super() call
function createOverviewUtilizationSpec (primitiveName, linkedState) {
  const urlFriendlyPrimitive = encodeURIComponent(primitiveName);
  return {
    type: 'json',
    name: 'overviewUtilization',
    url: `/datasets/${linkedState.info.datasetId}/utilizationHistogram?bins=${linkedState.overviewResolution}&primitive=${urlFriendlyPrimitive}`
  };
}

function createDetailUtilizationSpec (primitiveName, linkedState) {
  const urlFriendlyPrimitive = encodeURIComponent(primitiveName);
  const [begin, end] = linkedState.detailSpilloverDomain;
  const locationList = encodeURIComponent(linkedState.info.locationNames.join(','));
  return {
    name: 'detailUtilization',
    type: 'json',
    url: `/datasets/${linkedState.info.datasetId}/utilizationHistogram?primitive=${urlFriendlyPrimitive}&bins=${linkedState.detailSpilloverResolution}&begin=${begin}&end=${end}&locations=${locationList}`
  };
}

class PrimitiveSelection extends Selection {
  constructor (options) {
    options.resources = options.resources || [];

    if (options.linkedState.type === 'TracedLinkedState') {
      // If trace data is available, we want the selected primitive's
      // utilization to show up in both overview and detail views (but don't
      // request it if trace data isn't even available)
      options.resources.push(...[
        createOverviewUtilizationSpec(options.primitiveName, options.linkedState),
        createDetailUtilizationSpec(options.primitiveName, options.linkedState)
      ]);
    }

    super(options);

    this.primitiveName = options.primitiveName;
    this.primitiveDetails = options.primitiveDetails;
  }

  async refreshOverviewUtilization (linkedState) {
    return this.updateResource(createOverviewUtilizationSpec(this.primitiveName, linkedState));
  }

  async refreshDetailUtilization (linkedState) {
    return this.updateResource(createDetailUtilizationSpec(this.primtiveName, linkedState));
  }

  get label () {
    return this.primitiveName;
  }

  get details () {
    return JSON.stringify(this.primitiveDetails, null, 2);
  }
}
export default PrimitiveSelection;
