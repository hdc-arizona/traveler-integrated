import LinkedState from './LinkedState.js';

import IntervalSelection from '../selections/IntervalSelection.js';
import IntervalDurationSelection from '../selections/IntervalDurationSelection.js';

const VIEW_STATUS = LinkedState.VIEW_STATUS;

// detailDomain must be at least 30 ns
const MIN_BRUSH_SIZE = 1000;

class TracedLinkedState extends LinkedState {
  constructor () {
    super(...arguments);

    // Start the detail domain at the same level as the overview
    this._detailDomain = this.overviewDomain && Array.from(this.overviewDomain);
    this._cursorPosition = null;
  }

  /**
   * Detail views should all use the same domain
   */
  get detailDomain () {
    return this._detailDomain;
  }

  /**
   * Constrain that detailDomain makes sense, and notify views when it changes
   */
  set detailDomain (inputDomain) {
    // Allow views to set just one of the values (e.g. dragging one brush
    // handle in UtilizationView)
    const newDomain = [
      inputDomain[0] === undefined ? this._detailDomain[0] : inputDomain[0],
      inputDomain[1] === undefined ? this._detailDomain[1] : inputDomain[1]
    ];
    // Clamp to the lowest / highest possible values
    newDomain[0] = Math.max(newDomain[0], this.overviewDomain[0]);
    newDomain[1] = Math.max(newDomain[1], this.overviewDomain[0]);
    newDomain[1] = Math.min(newDomain[1], this.overviewDomain[1]);
    newDomain[0] = Math.min(newDomain[0], this.overviewDomain[1]);
    // Ensure begin < end
    if (newDomain[1] < newDomain[0]) {
      const temp = newDomain[1];
      newDomain[1] = newDomain[0];
      newDomain[0] = temp;
    }
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
      this.stickyTrigger('detailDomainChanged', null, 100); // For more expensive responses like full re-renders of views
    }
  }

  /**
   * Overviews should always show the full range of the data (no setter)
   */
  get overviewDomain () {
    return this.info.intervalDomain;
  }

  /**
   * Views that show any timeline should have a common cursor where the user
   * is mousing
   */
  get cursorPosition () {
    return this._cursorPosition;
  }

  /**
   * Notify any listening views whenever the cursor is updated
   */
  set cursorPosition (value) {
    this._cursorPosition = value;
    this.trigger('moveCursor');
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
    views.AggregatedGanttView = { status: otf2Status };
    views.UtilizationView = { status: otf2Status };
    views.IntervalHistogramView = {
      status: otf2Status,
      variants: Object.keys(this.getNamedResource('primitives') || {})
    };
    views.LineChartView = { status: otf2Status, variants: [] };
    views.FunctionalBoxPlotView = { status: otf2Status, variants: [] };
    for (const metric of this.info.procMetricList) {
      if (metric.toUpperCase().startsWith('PAPI')) {
        views.FunctionalBoxPlotView.variants.push(metric);
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
    const openViews = await this.getOpenViews();

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
          return this.createViewMenuEntry(metric, 'FunctionalBoxPlotView', metric, availableViews, openViews);
        })
    };

    const baseMenu = await super.getViewMenu();
    baseMenu.push(...[
      // Singular views
      this.createViewMenuEntry('Gantt Timeline', 'GanttView', null, availableViews, openViews),
      this.createViewMenuEntry('Utilization Overview', 'UtilizationView', null, availableViews, openViews),
      this.createViewMenuEntry('Interval Histogram', 'IntervalHistogramView', null, availableViews, openViews),
      this.createViewMenuEntry('Aggregated Gantt', 'AggregatedGanttView', null, availableViews, openViews),
      this.createViewMenuEntry('Dependency Tree', 'DependencyTreeView', null, availableViews, openViews)
    ]);
    // Submenus
    for (const menu of [metricSubmenu, lmSensorSubmenu, papiSubmenu]) {
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
  async selectIntervalByTimeAndLoc (timestamp, location) {
    const url = `/datasets/${this.info.datasetId}/intervals?begin=${timestamp}&end=${timestamp + 1}&location=${location}`;
    const response = await window.fetch(url);
    const intervalList = await response.json();
    if (intervalList.length === 0) {
      this.selection = null;
    } else {
      this.selection = new IntervalSelection({
        intervalDetails: intervalList[0]
      });
    }
  }

  /**
   * Select an interval based on a timestamp + location (will set
   * this.selection to null / deselect if no interval exists at the queried
   * time + location)
   */
  async selectIntervalById (intervalId) {
    const url = `/datasets/${this.info.datasetId}/intervals/${intervalId}`;
    const response = await window.fetch(url);
    const intervalDetails = await response.json();
    if (!intervalDetails) {
      this.selection = null;
    } else {
      this.selection = new IntervalSelection({
        intervalDetails
      });
    }
  }

  /**
   * Select an interval duration (i.e. a brush in IntervalHistogramView)
   */
  async selectIntervalDuration (intervalDurationSpan, durationLimit, primitiveName) {
    this.selection = new IntervalDurationSelection({
      intervalDurationSpan,
      durationLimit,
      primitiveName
    });
  }
}
TracedLinkedState.MIN_BRUSH_SIZE = MIN_BRUSH_SIZE;

export default TracedLinkedState;
