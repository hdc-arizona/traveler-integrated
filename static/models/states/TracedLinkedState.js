import LinkedState from './LinkedState.js';

const VIEW_STATUS = LinkedState.VIEW_STATUS;

// detailDomain must be at least 1 ns
const MIN_BRUSH_SIZE = 1;

// how much data we should request beyond each end of detailDomain
const SPILLOVER_WIDTH = 3;

class TracedLinkedState extends LinkedState {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      // 'deferred' resources don't actually do anything other than serve as
      // documentation / placeholders that we expect these resources to exist

      // overviewUtilization is loaded later when _overviewResolution is set to
      // a non-null value (e.g. when UtilizationView knows how many pixels it
      // has to work with)
      { type: 'deferred', initialValue: null, name: 'overviewUtilization' },

      // detailUtilization is loaded later when _detailResolution is set to
      // a non-null value (e.g. when GanttView knows how many pixels it has to
      // work with)
      { type: 'deferred', initialValue: null, name: 'detailUtilization' }
    ]);
    super(options);

    // Start the detail domain at the same level as the overview
    this._detailDomain = Array.from(this.overviewDomain);

    // Both resolutions start as null because we don't know how many bins to
    // ask for
    this._overviewResolution = null;
    this._detailResolution = null;
  }

  get overviewResolution () {
    return this._overviewResolution;
  }

  /**
   * @param  {integer|null} value The number of bins that the overview should
   * contain, or null if we should revert to a loading state
   */
  set overviewResolution (value) {
    if (this._overviewResolution !== value) {
      this._overviewResolution = value;
    }
    this.refreshOverviewUtilization();
  }

  /**
   * Update our overviewUtilization resource, as well as any selection's
   * overviewUtilization
   */
  async refreshOverviewUtilization () {
    this.trigger('overviewUnloaded');

    // Fetch the total utilization
    const totalPromise = this.updateResource({
      name: 'overviewUtilization',
      type: 'json',
      url: `/datasets/${this.info.datasetId}/utilizationHistogram?bins=${this.overviewResolution}`
    });

    // If the current selection also needs to collect overview utilization data,
    // update it as well
    let selectionPromise = Promise.resolve();
    if (this.selection?.refreshOverviewUtilization) {
      selectionPromise = this.selection.refreshOverviewUtilization(this);
    }

    // Wait for both requests to finish before notifying views that we're ready
    await Promise.all([totalPromise, selectionPromise]);
    this.trigger('overviewLoaded');
  }

  get detailResolution () {
    return this._detailResolution;
  }

  /**
   * @param  {integer|null} value The number of bins that the details should
   * contain, or null if we should revert to a loading state
   */
  set detailResolution (value) {
    if (this._detailResolution !== value) {
      this._detailResolution = value;
    }
    this.refreshDetailUtilization();
  }

  /**
   * Some views (e.g. GanttView) need data beyond detailDomain; this computes
   * the actual bins that we should request
   */
  get detailSpilloverResolution () {
    return SPILLOVER_WIDTH * this.detailResolution;
  }

  /**
   * Update our detailUtilization resource, as well as any selection's
   * detailUtilization
   */
  async refreshDetailUtilization () {
    this.trigger('detailUnloaded');

    const [begin, end] = this.detailSpilloverDomain;
    const locationList = encodeURIComponent(this.info.locationNames.join(','));

    // Fetch the total utilization
    const totalPromise = this.updateResource({
      name: 'detailUtilization',
      type: 'json',
      url: `/datasets/${this.info.datasetId}/utilizationHistogram?bins=${this.detailSpilloverResolution}&begin=${begin}&end=${end}&locations=${locationList}`
    });

    // If the current selection also needs to collect detail utilization data,
    // update it as well
    let selectionPromise = Promise.resolve();
    if (this.selection?.refreshDetailUtilization) {
      selectionPromise = this.selection.refreshDetailUtilization(this);
    }

    // Wait for both requests to finish before notifying views that we're ready
    await Promise.all([totalPromise, selectionPromise]);
    this.trigger('detailLoaded');
  }

  /**
   * Detail views should all use the same domain
   */
  get detailDomain () {
    return this._detailDomain;
  }

  /**
   * Extrapolate which begin / end to actually request from the server
   */
  get detailSpilloverDomain () {
    const halfOriginalWidth = (this.detailDomain[1] - this.detailDomain[0]) / 2;
    const center = this.detailDomain[0] + halfOriginalWidth;
    const halfSpilloverWidth = SPILLOVER_WIDTH * halfOriginalWidth;
    return [Math.floor(center - halfSpilloverWidth), Math.ceil(center + halfSpilloverWidth)];
  }

  /**
   * Constrain that detailDomain makes sense, and notify views when the it changes
   */
  set detailDomain (inputDomain) {
    // Allow views to set just one of the values (e.g. dragging one brush
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
    // Ensure integer queries
    newDomain[0] = Math.floor(newDomain[0]);
    newDomain[1] = Math.ceil(newDomain[1]);
    // Only update if something is different
    if (newDomain[0] !== this._detailDomain[0] || newDomain[1] !== this._detailDomain[1]) {
      this._detailDomain = newDomain;
      this.syncTrigger('detailDomainChangedSync'); // For cheap responses like scrolling axes / adjusting brush sizes
      this.stickyTrigger('detailDomainChanged'); // For more expensive responses like full re-renders of views
    }
  }

  /**
   * Overviews should always show the full range of the data (no setter)
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
      variants: Object.keys(this.getNamedResource('primitives') || {})
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
   * Select an interval based on a timestamp + location (will set
   * this.selection to null / deselect if no interval exists at the queried
   * time + location)
   */
  selectInterval (timestamp, location) {
    // TODO
  }
}
TracedLinkedState.MIN_BRUSH_SIZE = MIN_BRUSH_SIZE;

export default TracedLinkedState;
