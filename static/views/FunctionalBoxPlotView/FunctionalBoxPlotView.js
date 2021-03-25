/* globals d3 */

import ZoomableTimelineView from '../ZoomableTimelineView/ZoomableTimelineView.js';

class FunctionalBoxPlotView extends ZoomableTimelineView { // abstracts a lot of common logic for smooth zooming + panning + rendering offscreen + showing scrollbars for timeline-based views
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      // Placeholder resources that don't actually get updated until later
      { type: 'placeholder', value: null, name: 'data' }
    ]);
    super(options);

    this.metric = options.glState.variant;

    this.yScale = d3.scaleLinear();
  }

  get isLoading () {
    // Display the spinner + skip most of the draw call if we're still waiting
    // on data
    if (super.isLoading) {
      return true;
    }
    const data = this.getNamedResource('data');
    if (data === null || (data instanceof Error && data.status === 503)) {
      return true;
    }
    return false;
  }

  get error () {
    const err = super.error;
    if (err?.status === 503) {
      // We don't want to count 503 errors (still loading data) as actual errors
      return null;
    } else {
      return err;
    }
  }

  drawCanvas (chartShape) {
    // TODO
  }

  async updateData (chartShape) {
    const domain = chartShape.spilloverXScale.domain();
    return this.updateResource({
      name: 'data',
      type: 'json',
      url: `/datasets/${this.datasetId}/metric/${encodeURIComponent(this.metric)}?bins=${chartShape.bins}&begin=${domain[0]}&end=${domain[1]}`
    });
  }

  /**
   * Calculate the visible chart area, whether scrollbars should be showing,
   * update all scales; after accounting for spillover space, figure out how
   * many bins and which locations should be requested from the API
   * @return {boolean} True if the viewport is inconsistent with the data that
   * is currently loaded (i.e. it has been resized, scrolled, or zoomed since
   * the last updateShapeAndDataIfNeeded call)
   */
  getChartShape () {
    const chartShape = super.getChartShape();

    this.yScale.range([0, chartShape.fullHeight])
      .domain([]); // TODO

    return chartShape;
  }

  drawAxes (chartShape) {
    super.drawAxes(chartShape);

    // TODO: Update the y axis

    // Set the y label
    this.d3el.select('.yAxisLabel')
      .text(this.metric);
  }
}

export default FunctionalBoxPlotView;
