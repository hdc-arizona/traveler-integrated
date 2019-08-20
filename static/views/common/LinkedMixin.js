import LinkedState from '../../models/LinkedState.js';

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
          self._standardMousing = true;
          window.controller.tooltip.show({
            content: `Color by...`,
            targetBounds: this.getBoundingClientRect()
          });
        })
        .on('mouseleave', () => {
          if (this._standardMousing) {
            window.controller.tooltip.hide();
          }
        })
        .on('click', function () {
          self._standardMousing = false;
          const menuEntries = Object.entries(LinkedState.COLOR_SCHEMES).map(([label, colors]) => {
            return {
              drawButton: d3el => {
                const labelWrapper = d3el.select('.label');
                labelWrapper.append('div')
                  .classed('colorSquare', true)
                  .style('background', colors.selectionColor);
                labelWrapper.append('div')
                  .classed('padded', true)
                  .text(label);
                for (const scaleColor of colors.timeScale) {
                  labelWrapper.append('div')
                    .classed('colorSquare', true)
                    .style('background', scaleColor);
                }
              },
              onClick: () => {
                self.linkedState.mode = label;
              }
            };
          });
          window.controller.tooltip.showContextMenu({
            targetBounds: this.getBoundingClientRect(),
            menuEntries
          });
        });
    }
    drawLegend (d3el) {}
  };
  LinkedView.prototype._instanceOfLinkedMixin = true;
  return LinkedView;
};
Object.defineProperty(LinkedMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfLinkedMixin
});
export default LinkedMixin;
