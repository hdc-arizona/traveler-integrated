/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class GanttView extends SvgViewMixin(SingleDatasetMixin(GoldenLayoutView)) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/GanttView/style.less' }
    ];
    super(argObj);

    this.cache = [];
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      // TODO: get streamed results

      this.render();
    }, 100);
  }
  get isLoading () {
    return true;
  }
  get isEmpty () {
    // TODO
  }
  setup () {
    super.setup();

    // TODO
  }
  draw () {
    super.draw();

    // TODO
  }
}
export default GanttView;
