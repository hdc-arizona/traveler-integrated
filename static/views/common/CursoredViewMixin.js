/* globals d3 */

/*
  Convenience mixin for GanttView and UtilizationView; this expects a
  .background group with a .cursor line to exist, as well as xScale
*/
const CursoredViewMixin = function (superclass) {
  const CursoredView = class extends superclass {
    setup () {
      super.setup();
      // For responsiveness, move the cursor immediately
      // (instead of waiting around for debounced events / server calls)
      this.linkedState.on('moveCursor', () => { this.updateCursor(); });
      this.d3el
        .on('mousemove', () => {
          if (this.xScale) {
            const bounds = this.getAvailableSpace();
            this.linkedState.moveCursor(this.xScale.invert(d3.event.clientX - bounds.left - this.margin.left));
          }
        }).on('mouseout', () => {
          this.linkedState.moveCursor(null);
        });
    }
    draw () {
      super.draw();
      // This will be called less frequently than updateCursor(), for things
      // like resized windows
      const bounds = this.getChartBounds();
      this.xScale.range([0, bounds.width]);
      this.content.select('.cursor')
        .attr('y1', 0)
        .attr('y2', bounds.height + this.emSize);
      // Need a background rect to ensure events are captured
      this.content.select('.background rect')
        .attr('width', bounds.width)
        .attr('height', bounds.height);
      this.updateCursor();
    }
    updateCursor () {
      let position = this.linkedState.cursorPosition;
      if (position !== null) {
        const [low, high] = this.xScale.domain();
        if (position > low && position < high) {
          // Hide the cursor unless it's strictly within this view's domain
          position = this.xScale(position);
        }
      }
      this.content.select('.cursor')
        .style('display', position === null ? 'none' : null)
        .attr('x1', position)
        .attr('x2', position);
    }
  };
  CursoredView.prototype._instanceOfCursoredViewMixin = true;
  return CursoredView;
};
Object.defineProperty(CursoredViewMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfCursoredViewMixin
});
export default CursoredViewMixin;
