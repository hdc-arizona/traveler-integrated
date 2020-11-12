/* globals uki */
const LinkedMixin = function (superclass) {
  const LinkedView = class extends uki.ui.InformativeViewMixin(superclass) {
    constructor (options) {
      super(options);
      this.datasetId = options.glState.datasetId;
    }

    get linkedState () {
      const index = globalThis.controller.datasetLookup[this.datasetId];
      return index === undefined ? null : globalThis.controller.datasetList[index];
    }

    get isLoading () {
      return super.isLoading || !this.linkedState._resourcesLoaded;
    }
  };
  LinkedView.prototype._instanceOfLinkedMixin = true;
  return LinkedView;
};
Object.defineProperty(LinkedMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfLinkedMixin
});
export default LinkedMixin;
