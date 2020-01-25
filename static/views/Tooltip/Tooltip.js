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
     * @param  {String | Function} [content='']
     * The message that will be displayed; an empty string hides the tooltip.
     * If, instead of a string, a function is supplied, that function will be
     * called with a d3-selected div as its first argument (useful for more
     * complex, custom tooltip contents)
     * @param  {Object} [targetBounds=null]
     * Specifies a target rectangle that the tooltip should be positioned
     * relative to; usually element.getBoundingClientRect() will do the trick,
     * but you could also specify a similarly-formatted custom rectangle
     * @param  {Object} [anchor=null]
     * Specifies -1 to 1 positioning of the tooltip relative to targetBounds;
     * for example, { x: -1 } would right-align the tooltip to the left edge of
     * targetBounds, { x: 0 } would center the tooltip horizontally, and
     * { x: 1 } would left-align the tooltip to the right edge of targetBounds
     * @param  {Boolean} [interactive = false]
     * Specifies whether pointer-events should register on the tooltip
     * element(s); if false, pointer events will pass through
     * @param  {Boolean} [nestNew = false]
     * If true, adds an additional "tooltip"-classed eleemnt instead of
     * replacing the existing one (useful for things like nested context menus)
     */
  show ({
    content = '',
    targetBounds = null,
    anchor = null,
    hideAfterMs = 1000,
    interactive = false,
    nestNew = false
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

    let tooltip = this.d3el;
    if (nestNew) {
      tooltip = tooltip.append('div')
        .classed('tooltip', true);
    }

    tooltip
      .classed('interactive', interactive)
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
  /**
     * @param  {Array} [menuEntries]
     * A list of objects for each menu item. Each object should have two
     * properties:
     * - A content property that is a string or a function; this works the same
     *   way as show()'s content argument, however a button will already have
     *   been created by default with this structure:
     *   <div class="button">
     *     <a></a>
     *     <div class="label"></div>
     *   </div>
     * - Either an onClick function that will be called when the menu entry is
     *   clicked, or a subEntries list of additional menuEntries
     * @param  {Object} [targetBounds=null]
     * Specifies a target rectangle that the tooltip should be positioned
     * relative to; usually element.getBoundingClientRect() will do the trick,
     * but you could also specify a similarly-formatted custom rectangle
     * @param  {Object} [anchor=null]
     * Specifies -1 to 1 positioning of the tooltip relative to targetBounds;
     * for example, { x: -1 } would right-align the tooltip to the left edge of
     * targetBounds, { x: 0 } would center the tooltip horizontally, and
     * { x: 1 } would left-align the tooltip to the right edge of targetBounds
     * @param  {Boolean} [nestNew = false]
     * This should be false for most use cases; it's used internally for nested
     * context menus
     */
  showContextMenu ({ menuEntries, targetBounds, anchor, nestNew } = {}) {
    const self = this;
    this.show({
      targetBounds,
      anchor,
      hideAfterMs: 0,
      interactive: true,
      nestNew,
      content: d3el => {
        d3el.html('');

        const menuItems = d3el.selectAll('.button')
          .data(menuEntries)
          .enter().append('div')
          .classed('button', true)
          .classed('submenu', d => !!d.subEntries);
        menuItems.append('a');
        menuItems.append('div')
          .classed('label', true);
        menuItems.each(function (d) {
          if (typeof d.content === 'function') {
            d.content(d3.select(this));
          } else {
            d3.select(this).select('.label').text(d.content);
          }
        });
        menuItems
          .on('click', function (d) {
            if (d.onClick) {
              d.onClick();
              self.hide();
            } else if (d.subEntries) {
              let targetBounds = this.getBoundingClientRect();
              targetBounds = {
                left: targetBounds.left,
                right: targetBounds.right + Tooltip.SUBMENU_OFFSET,
                top: targetBounds.top,
                bottom: targetBounds.bottom,
                width: targetBounds.width + Tooltip.SUBMENU_OFFSET,
                height: targetBounds.height
              };
              self.showContextMenu({
                menuEntries: d.subEntries,
                targetBounds,
                anchor,
                nestNew: true
              });
            }
          });
      }
    });
  }
}
Tooltip.SUBMENU_OFFSET = 20;

export default Tooltip;
