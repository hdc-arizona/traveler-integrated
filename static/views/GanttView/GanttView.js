import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class GanttView extends SvgViewMixin(GoldenLayoutView) {
  setup () {
    super.setup();

    this.content.append('text')
      .text('TODO: Gantt View');
  }
  draw () {
    super.draw();
    const bounds = this.getContentBounds();
  }
}
export default GanttView;
