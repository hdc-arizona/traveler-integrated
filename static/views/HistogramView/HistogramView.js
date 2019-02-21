import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class HistogramView extends SvgViewMixin(GoldenLayoutView) {
  setup () {
    super.setup();

    this.content.append('text')
      .text('TODO: Histogram');
  }
  draw () {
    super.draw();
    const bounds = this.getContentBounds();
  }
}
export default HistogramView;
