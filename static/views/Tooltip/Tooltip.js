/* globals d3 */
import { View } from '../../node_modules/uki/dist/uki.esm.js';

class Tooltip extends View {
  constructor () {
    super(d3.select('#tooltip'), [
      { type: 'less', url: 'views/Tooltip/style.less' }
    ]);
  }
  setup () {
    this.hide();
  }
  draw () {
    // TODO: migrate a lot of the show() stuff here
  }
  hide () {
    this.show({ content: null });
  }
  /**
     * @param  {String} [content='']
     * The message that will be displayed; the empty string hides the tooltip
     * @param  {[type]} [targetBounds=null]
     * Specifies a target element that the tooltip should be positioned relative to
     * @param  {[type]} [anchor=null]
     * Specifies -1 to 1 positioning of the tooltip relative to targetBounds; for
     * example, x = -1 would right-align the tooltip to the left edge of
     * targetBounds, x = 0 would center the tooltip horizontally, and x = 1 would
     * left-align the tooltip to the right edge of targetBounds
     */
  show ({
    content = '',
    targetBounds = null,
    anchor = null,
    hideAfterMs = 1000
  } = {}) {
    window.clearTimeout(this._tooltipTimeout);
    const showEvent = d3.event;
    d3.select('body').on('click.tooltip', () => {
      if (showEvent !== d3.event) {
        this.hide();
      } else {
        d3.event.stopPropagation();
      }
    });

    let tooltip = this.d3el
      .style('left', null)
      .style('top', null)
      .style('display', content ? null : 'none');

    if (content) {
      if (typeof content === 'function') {
        content(tooltip);
      } else {
        tooltip.html(content);
      }
      let tooltipBounds = tooltip.node().getBoundingClientRect();

      let left;
      let top;

      if (targetBounds === null) {
        // todo: position the tooltip WITHIN the window, based on anchor,
        // instead of outside the targetBounds
        throw new Error('tooltips without targets are not yet supported');
      } else {
        anchor = anchor || {};
        if (anchor.x === undefined) {
          if (anchor.y !== undefined) {
            // with y defined, default is to center x
            anchor.x = 0;
          } else {
            if (targetBounds.left > window.innerWidth - targetBounds.right) {
              // there's more space on the left; try to put it there
              anchor.x = -1;
            } else {
              // more space on the right; try to put it there
              anchor.x = 1;
            }
          }
        }
        if (anchor.y === undefined) {
          if (anchor.x !== undefined) {
            // with x defined, default is to center y
            anchor.y = 0;
          } else {
            if (targetBounds.top > window.innerHeight - targetBounds.bottom) {
              // more space above; try to put it there
              anchor.y = -1;
            } else {
              // more space below; try to put it there
              anchor.y = 1;
            }
          }
        }
        left = (targetBounds.left + targetBounds.right) / 2 +
               anchor.x * targetBounds.width / 2 -
               tooltipBounds.width / 2 +
               anchor.x * tooltipBounds.width / 2;
        top = (targetBounds.top + targetBounds.bottom) / 2 +
              anchor.y * targetBounds.height / 2 -
              tooltipBounds.height / 2 +
              anchor.y * tooltipBounds.height / 2;
      }

      // Clamp the tooltip so that it stays on screen
      if (left + tooltipBounds.width > window.innerWidth) {
        left = window.innerWidth - tooltipBounds.width;
      }
      if (left < 0) {
        left = 0;
      }
      if (top + tooltipBounds.height > window.innerHeight) {
        top = window.innerHeight - tooltipBounds.height;
      }
      if (top < 0) {
        top = 0;
      }
      tooltip.style('left', left + 'px')
        .style('top', top + 'px');

      if (hideAfterMs > 0) {
        this._tooltipTimeout = window.setTimeout(() => {
          this.hide();
        }, hideAfterMs);
      }
    }
  }
}

export default Tooltip;
