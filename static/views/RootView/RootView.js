/* globals uki */
import SelectionInfoView from '../SelectionInfoView/SelectionInfoView.js';
import TreeView from '../TreeView/TreeView.js';
import CodeView from '../CodeView/CodeView.js';
/*
import GanttView from '../GanttView/GanttView.js';
import UtilizationView from '../UtilizationView/UtilizationView.js';
import LineChartView from '../LineChartView/LineChartView.js';
import ContourBoxPlotView from '../ContourBoxPlotView/ContourBoxPlotView.js';
import IntervalHistogramView from '../IntervalHistogramView/IntervalHistogramView.js';
*/

const viewClassLookup = {
  SelectionInfoView,
  TreeView,
  CodeView /* ,
  GanttView,
  UtilizationView,
  LineChartView,
  ContourBoxPlotView,
  IntervalHistogramView */
};

class RootView extends uki.ui.GLRootView {
  constructor (options = {}) {
    options.viewClassLookup = viewClassLookup;
    options.glSettings = {
      isClosable: false,
      content: [{ type: 'stack', content: [] }]
    };
    super(options);
  }

  setLayout (layout) {
    layout.isClosable = false;
    super.setLayout(layout);
  }

  async setup () {
    await super.setup(...arguments);

    this.goldenLayout.on('stateChanged', () => {
      if (window.controller.currentDataset) {
        window.controller.currentDataset.viewLayout = this.getLayout();
      }
    });
  }
}

export default RootView;
