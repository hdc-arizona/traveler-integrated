const LinkedMixin = function (superclass) {
  const LinkedView = class extends superclass {
    constructor (argObj) {
      super(argObj);
      this.linkedState = argObj.linkedState;
    }
    get isLoading () {
      return this.linkedState.primitives === undefined;
    }
    setupLegend (d3el) {
      const self = this;
      const assembleButton = d3el.append('div')
        .classed('button', true)
        .classed('assemble', true);
      assembleButton.append('a');
      assembleButton.append('img')
        .attr('src', '/static/img/assemble.svg');
      assembleButton
        .on('mouseenter', function () {
          window.controller.tooltip.show({
            content: `Show all views for ${self.linkedState.label}`,
            targetBounds: this.getBoundingClientRect()
          });
        })
        .on('mouseleave', () => { window.controller.tooltip.hide(); })
        .on('click', () => { window.controller.assembleViews(this.linkedState, this); });

      const colorButton = d3el.append('div')
        .classed('button', true)
        .classed('color', true);
      colorButton.append('a');
      colorButton.append('img')
        .attr('src', '/static/img/colors.svg');
      colorButton
        .on('mouseenter', function () {
          window.controller.tooltip.show({
            content: `Color by...`,
            targetBounds: this.getBoundingClientRect()
          });
        })
        .on('mouseleave', () => { window.controller.tooltip.hide(); });
    }
    drawLegend (d3el) {
      console.warn('unimplemented');
    }
  };
  LinkedView.prototype._instanceOfLinkedMixin = true;
  return LinkedView;
};
Object.defineProperty(LinkedMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfLinkedMixin
});
export default LinkedMixin;
