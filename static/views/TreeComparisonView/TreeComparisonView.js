import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class TreeComparisonView extends SvgViewMixin(GoldenLayoutView) {
  setup () {
    super.setup();

    this.content.append('text')
      .text('TODO: Tree comparison view');
  }

  get isEmpty () {
    return true;
  }

  draw () {
    super.draw();

    this.emptyStateDiv.html('<p>View under construction</p>');
  }
}
export default TreeComparisonView;
