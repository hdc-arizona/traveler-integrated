/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class TreeView extends SvgViewMixin(GoldenLayoutView) {
  constructor ({
    container,
    state
  }) {
    super({
      container,
      state,
      resources: [
        { type: 'less', url: 'views/TreeView/style.less' },
        { type: 'text', url: 'views/TreeView/shapeKey.html' }
      ]
    });

    (async () => {
      try {
        [this.tree, this.regions] = await Promise.all([
          d3.json(`/tree/${state.label}`),
          d3.json(`/regions/${state.label}`)
        ]);
      } catch (err) {
        this.tree = this.regions = err;
      }
      this.render();
    })();
  }
  setup () {
    super.setup();
    this.shapeKey = this.d3el.append('div')
      .classed('shapeKey', true)
      .html(this.resources[1]);
    this.legend = this.d3el.append('div')
      .attr('id', 'legend');
  }
  draw () {
    super.draw();

    if (this.tree === undefined || this.regions === undefined) {
      return;
    } else if (this.tree instanceof Error || this.regions instanceof Error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    }
    console.log(this.tree, this.regions);
  }
}
export default TreeView;
