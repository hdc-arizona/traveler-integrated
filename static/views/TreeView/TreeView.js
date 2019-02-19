import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class TreeView extends SvgViewMixin(GoldenLayoutView) {
  constructor ({
    container,
    state,
    resources = {
      'text': 'views/TreeView/shapeKey.html'
    }
  }) {
    super({ container, state, resources });
  }
  setup () {
    super.setup();
    this.shapeKey = this.d3el.append('div')
      .attr('id', 'shapekey')
      .html(this.resources.text);
    this.legend = this.d3el.append('div')
      .attr('id', 'legend');
  }
  draw () {
    const bounds = this.getContentBounds();
  }
}
export default TreeView;
