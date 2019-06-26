const SvgViewMixin = function (superclass) {
  const SvgView = class extends superclass {
    setupContentElement () {
      return this.d3el.append('svg');
    }
    getAvailableSpace () {
      // Don't rely on non-dynamic SVG width / height for available space; use
      // this.d3el instead
      return super.getAvailableSpace(this.d3el);
    }
    draw () {
      super.draw();

      const bounds = this.getAvailableSpace();
      this.content
        .attr('width', bounds.width)
        .attr('height', bounds.height);
    }
  };
  SvgView.prototype._instanceOfSvgViewMixin = true;
  return SvgView;
};
Object.defineProperty(SvgViewMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfSvgViewMixin
});
export default SvgViewMixin;
