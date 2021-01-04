import LinkedState from './LinkedState.js';

import PrimitiveSelection from '../selections/PrimitiveSelection.js';

const VIEW_STATUS = LinkedState.VIEW_STATUS;

// detailDomain must be at least 1 ns
const MIN_BRUSH_SIZE = 1;

class TracedLinkedState extends LinkedState {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      // Each of these resources are added / updated later; 'deferred'
      // resources don't actually do anything other than serve as
      // documentation / placeholders that we expect these resources to exist.

      // utilization is lazily loaded when UtilizationView asks for it with
      // refreshUtilization() calls
      { type: 'deferred', initialValue: null, name: 'utilization' },

      // intervals are lazily loaded by GanttView when it asks for them with
      // refreshIntervals() calls
      { type: 'deferred', initialValue: null, name: 'intervals' }
    ]);
    super(options);

    // Start the detail domain at the same level as the overview
    this._detailDomain = Array.from(this.overviewDomain);

    // Privately track of how many utilization bins to request from the server;
    // this will be overridden regularly by refreshUtilization() calls
    this._utilizationBins = undefined;
  }

  /**
   * Update our intervals resource based on the current window
   */
  async refreshIntervals () {
    this.trigger('intervalsUnloaded');
    await this.updateResource({
      name: 'intervals',
      type: 'json',
      url: `/datasets/${this.info.datasetId}/intervals?begin=${this.detailDomain[0]}&end=${this.detailDomain[1]}`
    });
    this.trigger('intervalsLoaded');
  }

  /**
   * Add or update view-specific utilization data from the server
   */
  async refreshUtilization (bins) {
    this.trigger('utilizationUnloaded');

    // Update how many bins we should show
    this._utilizationBins = bins;

    // Fetch the total utilization
    const totalPromise = this.updateResource({
      name: 'utilization',
      type: 'json',
      url: `/datasets/${this.info.datasetId}/utilizationHistogram?bins=${bins}`
    });

    // If a primitive is selected, update its utilization
    let selectionPromise = Promise.resolve();
    if (this.selection instanceof PrimitiveSelection) {
      selectionPromise = this.selection.refreshUtilization(bins);
    }

    await Promise.all([totalPromise, selectionPromise]);
    this.trigger('utilizationLoaded');
  }

  /**
   * Detail views should all use the same domain
   */
  get detailDomain () {
    return this._detailDomain;
  }

  /**
   * Constrain that detailDomain makes sense, and notify views when the it changes
   */
  set detailDomain (inputDomain) {
    // Allow views to only set one of the values (e.g. dragging one brush
    // handle)
    const newDomain = [
      inputDomain[0] === undefined ? this._detailDomain[0] : inputDomain[0],
      inputDomain[1] === undefined ? this._detailDomain[1] : inputDomain[1]
    ];
    // Ensure begin < end
    if (newDomain[1] < newDomain[0]) {
      const temp = newDomain[1];
      newDomain[1] = newDomain[0];
      newDomain[0] = temp;
    }
    // Clamp to the lowest / highest possible values
    newDomain[0] = Math.max(newDomain[0], this.overviewDomain[0]);
    newDomain[1] = Math.min(newDomain[1], this.overviewDomain[1]);
    // Ensure the brush is at least MIN_BRUSH_SIZE
    if (newDomain[1] - newDomain[0] < MIN_BRUSH_SIZE) {
      if (inputDomain[0] === undefined || newDomain[1] + MIN_BRUSH_SIZE <= this.overviewDomain[1]) {
        // The left boundary isn't changing, or there's space to the right, so
        // constrain the right boundary
        newDomain[1] = newDomain[0] + MIN_BRUSH_SIZE;
      } else {
        // Constrain the left boundary
        newDomain[0] = newDomain[1] - MIN_BRUSH_SIZE;
      }
    }
    this._detailDomain = newDomain;
    this.trigger('detailDomainChanged');
  }

  /**
   * Overviews should always show the full range of the data
   */
  get overviewDomain () {
    return this.info.intervalDomain;
  }

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

    // Starting views are only UtilizationView and GanttView
    const traceColumnLayout = ['UtilizationView', 'GanttView']
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

  /**
   * When selecting a primitive, tell the selection how to load trace data
   * (by default, the selection won't attempt to load trace data, because, for
   * non-TracedLinkedState contexts, it won't exist)
   */
  selectPrimitive (primitiveName) {
    const primitiveDetails = this.getPrimitiveDetails(primitiveName);
    this.selection = new PrimitiveSelection({
      datasetId: this.info.datasetId,
      primitiveName,
      primitiveDetails,
      utilizationBins: this._utilizationBins
    });
  }
}
TracedLinkedState.MIN_BRUSH_SIZE = MIN_BRUSH_SIZE;

export default TracedLinkedState;
