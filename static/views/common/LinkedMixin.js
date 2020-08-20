const LinkedMixin = function (superclass) {
  const LinkedView = class extends superclass {
    constructor (argObj) {
      super(argObj);
      this.linkedState = argObj.linkedState;
      this.linkedState.on('changeMode', () => { this.render(); });
    }

    get isLoading () {
      return this.linkedState.primitives === undefined;
    }
  };
  LinkedView.prototype._instanceOfLinkedMixin = true;
  return LinkedView;
};
Object.defineProperty(LinkedMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfLinkedMixin
});
export default LinkedMixin;
