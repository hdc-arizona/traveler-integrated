/* globals uki */
const LinkedMixin = function (superclass) {
  const LinkedView = class extends uki.ui.InformativeViewMixin(superclass) {
    constructor (options) {
      super(options);
      this.datasetId = options.glState.datasetId;

      this.linkedState.on('selectionChanged', () => { this.render(); });
      this.linkedState.on('colorModeChanged', () => { this.render(); });
    }

    get linkedState () {
      const index = window.controller.datasetLookup[this.datasetId];
      return index === undefined ? null : window.controller.datasetList[index];
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
