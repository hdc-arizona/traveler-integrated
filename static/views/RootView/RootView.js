/* globals uki */
import SelectionInfoView from '../SelectionInfoView/SelectionInfoView.js';
import TreeView from '../TreeView/TreeView.js';
import CodeView from '../CodeView/CodeView.js';
import UtilizationView from '../UtilizationView/UtilizationView.js';
import GanttView from '../GanttView/GanttView.js';
import FunctionalBoxPlotView from '../FunctionalBoxPlotView/FunctionalBoxPlotView.js';
import LineChartView from '../LineChartView/LineChartView.js';
import IntervalHistogramView from '../IntervalHistogramView/IntervalHistogramView.js';
import AggregatedGanttView from "../AggregatedGanttView/AggregatedGanttView.js";

const viewClassLookup = {
  SelectionInfoView,
  TreeView,
  CodeView,
  UtilizationView,
  GanttView,
  AggregatedGanttView,
  FunctionalBoxPlotView,
  LineChartView,
  IntervalHistogramView
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

    // Notify LinkedState that its layout has changed when GoldenLayout
    // rearranges / closes / opens something
    this.on('stateChanged', updateLayout);
    this.on('itemDestroyed', updateLayout);
    this.on('itemCreated', updateLayout);
  }

  openView (datasetId, viewClassName, variant) {
    const helper = () => {
      // Check if the view is already open
      for (const view of Object.values(this.views)) {
        if (view.constructor.name === viewClassName &&
          (variant === null || view.glState.variant === variant)) {
          // View exists, just make sure it's on top of a stack if it had been
          // buried
          this.raiseView(view);
          return;
        }
      }

      const config = {
        type: 'component',
        componentName: viewClassName,
        componentState: {
          datasetId: window.controller.currentDataset.info.datasetId,
          variant
        }
      };

      // TODO: in theory this should work instead of string checking:
      // this.viewClassLookup[viewClassName].prototype instanceof ZoomableTimelineView
      // however, uki currently gives false positives:
      // https://github.com/ukijs/uki/pull/1
      const timelineBasedView =
        viewClassName === 'UtilizationView' ||
        viewClassName === 'GanttView' ||
        viewClassName === 'AggregatedGanttView' ||
        viewClassName === 'FunctionalBoxPlotView' ||
        viewClassName === 'LineChartView';

      this.addView(config, glItem => {
        // uki-ui iterates through GoldenLayout's structure to ask us which item
        // to add this view to; for traveler, we want to add timeline-based views
        // to the left column, and anything else to the right column if they
        // exist (columns might not exist if the user has moved things around)

        // TODO: this could probably be more sophisticated (e.g. try to put
        // timeline views below the GanttView wherever it is)... but that also
        // likely will involve wrapping GanttView in a GoldenLayout column

        if (glItem.type !== 'column' ||
            glItem.parent?.type !== 'row' ||
            glItem.parent.parent?.type !== 'root') {
          return null;
        }
        const columnIndex = glItem.parent.contentItems.indexOf(glItem);
        if (timelineBasedView && columnIndex === 0) {
          return glItem;
        } else if (!timelineBasedView && columnIndex === 1) {
          return glItem;
        } else {
          return null;
        }
      }, glItem => {
        // Once we've picked which column to add to, which index should we insert
        // the new view? For now, we default to the bottom of the column
        return glItem.contentItems.length;
      });
    };

    if (datasetId !== window.controller.currentDatasetId) {
      // Because changing the current dataset will load a totally different
      // layout, wait until GoldenLayout is ready to add the new view
      this.on('initialised.tempAddViewListener', () => {
        this.off('initialised.tempAddViewListener');
        helper();
      });
      window.controller.currentDatasetId = datasetId;
    } else {
      // Add the new view immediately
      helper();
    }
  }
}

export default RootView;
