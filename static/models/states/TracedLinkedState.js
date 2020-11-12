import LinkedState from './LinkedState.js';

const VIEW_STATUS = LinkedState.VIEW_STATUS;

class TracedLinkedState extends LinkedState {
  /**
   * Overrides super to add views that can only be shown when trace data is present
   */
  async getAvailableViews () {
    const views = await super.getAvailableViews();
    const otf2Status = this.info.sourceFiles
      .find(d => d.fileType === 'otf2').stillLoading
      ? VIEW_STATUS.LOADING
      : VIEW_STATUS.AVAILABLE;

    views.GanttView = { status: otf2Status };
    views.UtilizationView = { status: otf2Status };
    views.IntervalHistogramView = {
      status: otf2Status,
      variants: Object.keys(this.getNamedResource('primitives'))
    };
    views.LineChartView = { status: otf2Status, variants: [] };
    views.ContourBoxPlotView = { status: otf2Status, variants: [] };
    for (const metric of this.info.procMetricList) {
      if (metric.toUpperCase().startsWith('PAPI')) {
        views.ContourBoxPlotView.variants.push(metric);
      } else {
        views.LineChartView.variants.push(metric);
      }
    }

    return views;
  }

  /**
   * Overrides super to add trace-specific views in a column to the left of
   * the default layout
   */
  async getDefaultLayout () {
    const availableViews = await this.getAvailableViews();

    // Starting views are only GanttView and UtilizationView
    const traceColumnLayout = ['GanttView', 'UtilizationView']
      .filter(componentName => {
        return availableViews?.[componentName]?.status !== VIEW_STATUS.UNAVAILABLE;
      })
      .map(componentName => {
        return {
          type: 'component',
          componentName,
          componentState: { datasetId: this.info.datasetId }
        };
      });

    return {
      type: 'row',
      content: [
        { type: 'column', content: traceColumnLayout },
        await super.getDefaultLayout()
      ]
    };
  }

  /**
   * Overrides super to add trace-specific views to the Open View submenu
   */
  async getViewMenu () {
    const availableViews = await this.getAvailableViews();
    const openViews = this.getOpenViews();

    // First, create submenus...
    // ... for regular metrics
    const metricSubmenu = {
      label: 'Metrics',
      subEntries: this.info.procMetricList
        .filter(metric => {
          const upper = metric.toUpperCase();
          return !upper.startsWith('LM_SENSORS') && !upper.startsWith('PAPI');
        })
        .map(metric => {
          return this.createViewMenuEntry(metric, 'LineChartView', metric, availableViews, openViews);
        })
    };
    // ... for LM_SENSORS
    const lmSensorSubmenu = {
      label: 'LM_SENSORS',
      subEntries: this.info.procMetricList
        .filter(metric => metric.toUpperCase().startsWith('LM_SENSORS'))
        .map(metric => {
          return this.createViewMenuEntry(metric, 'LineChartView', metric, availableViews, openViews);
        })
    };
    // ... for PAPI
    const papiSubmenu = {
      label: 'PAPI',
      subEntries: this.info.procMetricList
        .filter(metric => metric.toUpperCase().startsWith('PAPI'))
        .map(metric => {
          return this.createViewMenuEntry(metric, 'ContourBoxPlotView', metric, availableViews, openViews);
        })
    };
    // ... for per-primitive interval histograms
    const intervalHistogramSubmenu = {
      label: 'Interval Histograms',
      subEntries: Object.keys(this.getNamedResource('primitives'))
        .map(primitiveName => {
          return this.createViewMenuEntry(primitiveName, 'IntervalHistogramView', primitiveName, availableViews, openViews);
        })
    };

    const baseMenu = await super.getViewMenu();
    baseMenu.push(...[
      // Core views
      this.createViewMenuEntry('Gantt Timeline', 'GanttView', null, availableViews, openViews),
      this.createViewMenuEntry('Utilization Overview', 'UtilizationView', null, availableViews, openViews)
    ]);
    // Submenus
    for (const menu of [metricSubmenu, lmSensorSubmenu, papiSubmenu, intervalHistogramSubmenu]) {
      if (menu.subEntries.length > 0) {
        baseMenu.push(menu);
      }
    }
    return baseMenu;
  }
}

export default TracedLinkedState;
