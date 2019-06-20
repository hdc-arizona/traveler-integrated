/* globals oboe */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class GanttView extends SvgViewMixin(SingleDatasetMixin(GoldenLayoutView)) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/GanttView/style.less' }
    ];
    super(argObj);

    this.oldData = {};
    this.newData = {};
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(() => {
      const label = encodeURIComponent(this.layoutState.label);
      const intervalWindow = this.linkedState.intervalWindow;
      oboe(`/datasets/${label}/intervals?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`)
        .node('!', chunk => { console.log(chunk); });
      this.render();
    }, 100);
  }
  get isLoading () {
    return super.isLoading;
  }
  get isEmpty () {
    return false;
  }
  setup () {
    super.setup();

    this.linkedState.on('newInterval', () => { this.getData(); });
    this.getData();
  }
  draw () {
    super.draw();

    // TODO
  }
}
export default GanttView;
