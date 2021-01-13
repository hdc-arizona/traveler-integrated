/* globals uki */

/**
 * LinkedMixin ensures that this.linkedState is updated correctly through
 * app-wide things like Controller.refreshDatasets(), that appropriate
 * loading spinners and error screens show up when the view or linkedState are
 * communicating with the server, and that this.render() gets called when
 * common state changes occur in this.linkedState
 */
const LinkedMixin = function (superclass) {
  // InformativeViewMixin adds a layer to display a loading spinner, as well as
  // any errors that happen during render()
  const LinkedView = class extends uki.ui.InformativeViewMixin(superclass) {
    constructor (options) {
      super(options);
      this.datasetId = options.glState.datasetId;

      this.linkedState.on('load', () => { this.render(); });
      this.linkedState.on('selectionChanged', () => { this.render(); });
    }

    get linkedState () {
      const index = window.controller.datasetLookup[this.datasetId];
      return index === undefined ? null : window.controller.datasetList[index];
    }
  };
  LinkedView.prototype._instanceOfLinkedMixin = true;
  return LinkedView;
};
Object.defineProperty(LinkedMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfLinkedMixin
});
export default LinkedMixin;
