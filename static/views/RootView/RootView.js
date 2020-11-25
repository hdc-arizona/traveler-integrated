/* globals uki */
import SelectionInfoView from '../SelectionInfoView/SelectionInfoView.js';
import TreeView from '../TreeView/TreeView.js';
import CodeView from '../CodeView/CodeView.js';
import UtilizationView from '../UtilizationView/UtilizationView.js';
/*
import GanttView from '../GanttView/GanttView.js';
import LineChartView from '../LineChartView/LineChartView.js';
import ContourBoxPlotView from '../ContourBoxPlotView/ContourBoxPlotView.js';
import IntervalHistogramView from '../IntervalHistogramView/IntervalHistogramView.js';
*/

const viewClassLookup = {
  SelectionInfoView,
  TreeView,
  CodeView,
  UtilizationView /* ,
  GanttView,
  LineChartView,
  ContourBoxPlotView,
  IntervalHistogramView */
};

class RootView extends uki.ui.GLRootView {
  constructor (options = {}) {
    options.viewClassLookup = viewClassLookup;
    super(options);
  }

  getDefaultGLSettings () {
    const glSettings = super.getDefaultGLSettings();
    glSettings.settings = Object.assign(glSettings.settings || {}, {
      showPopoutIcon: false
    });
    return glSettings;
  }

  async setup () {
    await super.setup(...arguments);

    this.goldenLayout.on('stateChanged', () => {
      if (window.controller.currentDataset) {
        window.controller.currentDataset.viewLayout = this.glLayout;
      }
    });
  }
}

export default RootView;
