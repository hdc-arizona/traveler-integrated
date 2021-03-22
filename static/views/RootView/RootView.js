/* globals uki */
import SelectionInfoView from '../SelectionInfoView/SelectionInfoView.js';
import TreeView from '../TreeView/TreeView.js';
import CodeView from '../CodeView/CodeView.js';
import UtilizationView from '../UtilizationView/UtilizationView.js';
import GanttView from '../GanttView/GanttView.js';
/*
import LineChartView from '../LineChartView/LineChartView.js';
import ContourBoxPlotView from '../ContourBoxPlotView/ContourBoxPlotView.js';
import IntervalHistogramView from '../IntervalHistogramView/IntervalHistogramView.js';
*/

const viewClassLookup = {
  SelectionInfoView,
  TreeView,
  CodeView,
  UtilizationView,
  GanttView /* ,
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

    const updateLayout = () => {
      if (window.controller.currentDataset) {
        window.controller.currentDataset.updateViewLayout(this.glLayout);
      }
    };

    // Notify each LinkedState that its layout has changed when GoldenLayout
    // rearranges / closes / opens something
    this.on('stateChanged', updateLayout);
    this.on('itemDestroyed', updateLayout);
    this.on('itemCreated', updateLayout);
  }
}

export default RootView;
