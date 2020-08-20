import LinkedState from './LinkedState.js';

class TracedLinkedState extends LinkedState {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push({
      type: 'json',
      name: 'procMetrics',
      url: `/datasets/${options.label}/procMetrics`
    });
    super(options);
  }

  getDefaultViews () {
    const views = super.getPossibleViews();
    views.GanttView = true;
    views.UtilizationView = true;
    views.IntervalHistogramView = true;
  }

  getPossibleViews () {
    const views = this.getDefaultViews();

    views.ProcMetricView = true;
  }
}

export default TracedLinkedState;
