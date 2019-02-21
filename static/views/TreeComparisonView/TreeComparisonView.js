import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class TreeComparisonView extends SvgViewMixin(GoldenLayoutView) {
  setup () {
    super.setup();

    this.content.append('text')
      .text('TODO: Tree comparison view');
  }
  draw () {
    super.draw();
    const bounds = this.getContentBounds();
  }
}
export default TreeComparisonView;
