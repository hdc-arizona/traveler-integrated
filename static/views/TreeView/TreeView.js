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
    const bounds = this.getContentBounds();
  }
}
export default TreeView;
