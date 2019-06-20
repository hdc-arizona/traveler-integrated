const SvgViewMixin = function (superclass) {
  const SvgView = class extends superclass {
    setupContentElement () {
      return this.d3el.append('svg');
    }
    getContentBounds (content = this.content) {
      const bounds = content.node().parentNode.getBoundingClientRect();
      content.attr('width', bounds.width)
        .attr('height', bounds.height);
      return bounds;
    }
  };
  SvgView.prototype._instanceOfSvgViewMixin = true;
  return SvgView;
};
Object.defineProperty(SvgViewMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfSvgViewMixin
});
export default SvgViewMixin;
