/*
  Mixin to help link views that show a timeline
*/
const CursoredViewMixin = function (superclass) {
  const CursoredView = class extends superclass {
    setupCursor (eventCapturer) {
      this.d3el.select('.cursor')
        .attr('stroke-width', '1px')
        .style('stroke', 'var(--background-color-softer)');
      eventCapturer
        .on('mousemove.cursor', event => {
          this.linkedState.cursorPosition = this.getMousedTime(event.offsetX);
          return true;
        }).on('mouseout.cursor', () => {
          this.linkedState.cursorPosition = null;
          return true;
        });
      this.linkedState.on('moveCursor', () => { this.updateCursor(); });
    }

    drawCursor () {
      // Update the line height
      this.d3el.select('.cursor')
        .attr('y1', 0)
        .attr('y2', this.getCursorHeight());
      this.updateCursor();
    }

    updateCursor () {
      const position = this.linkedState.cursorPosition === null
        ? null
        : this.getCursorPosition(this.linkedState.cursorPosition);
      if(this.d3el) {
        this.d3el.select('.cursor')
            .style('display', position === null ? 'none' : null)
            .attr('x1', position)
            .attr('x2', position);
      }
    }

    /**
     * converts an x screen coordinate (relative to eventCapturer's bounding
     * box) to trace time
     * @param  {Number} offsetX Pixel offset
     * @return {Number}         time
     */
    getMousedTime (offsetX) {
      throw new Error('unimplemented');
    }

    /**
     * @abstract
     * @return {Number} Height of the cursor in pixels
     */
    getCursorHeight () {
      throw new Error('unimplemented');
    }

    /**
     * converts a timestamp to the position of the .cursor element
     * (relative to its parents)
     * @abstract
     * @param  {Number} time
     * @return {Number} Pixel offset
     */
    getCursorPosition (time) {
      throw new Error('unimplemented');
    }
  };
  CursoredView.prototype._instanceOfCursoredViewMixin = true;
  return CursoredView;
};
Object.defineProperty(CursoredViewMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfCursoredViewMixin
});
export default CursoredViewMixin;
