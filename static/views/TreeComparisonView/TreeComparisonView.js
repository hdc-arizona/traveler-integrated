import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class TreeComparisonView extends SvgViewMixin(GoldenLayoutView) {
  setup () {
    super.setup();

    this.content.append('text')
      .attr('x', 20)
      .attr('y', 20)
      .text('TODO: Tree comparison view');
  }
  draw () {
    const bounds = this.getContentBounds();
  }
}
export default TreeComparisonView;
