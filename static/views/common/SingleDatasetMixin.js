const SingleDatasetMixin = function (superclass) {
  const SingleDatasetView = class extends superclass {
    constructor (argObj) {
      super(argObj);
      // this._instanceOfSingleDatasetMixin = true;
      this.linkedState = argObj.linkedState;
    }
    get isLoading () {
      return this.linkedState.primitives === undefined;
    }
  };
  SingleDatasetView.prototype._instanceOfSingleDatasetMixin = true;
  return SingleDatasetView;
};
Object.defineProperty(SingleDatasetMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfSingleDatasetMixin
});
window.SingleDatasetMixin = SingleDatasetMixin;
export default SingleDatasetMixin;
