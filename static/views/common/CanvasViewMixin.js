/* globals d3 */

const CanvasViewMixin = function (superclass) {
  const CanvasView = class extends superclass {
    setupContentElement () {
      return this.d3el.append('div');
    }
    getAvailableSpace () {
      // Don't rely on non-dynamic canvas width / height for available space; use
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
    setupTab () {
      super.setupTab();
      this.tabElement
        .classed('canvasTab', true)
        .append('div')
        .classed('downloadIcon', true)
        .on('click', () => {
          console.log("download canvas clicked, it will doing nothing now");
        });
    }
  };
  CanvasView.prototype._instanceOfCanvasViewMixin = true;
  return CanvasView;
};
Object.defineProperty(CanvasViewMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfCanvasViewMixin
});
export default CanvasViewMixin;
