/* globals d3 */

import ZoomableTimelineView from '../ZoomableTimelineView/ZoomableTimelineView.js';

class LineChartView extends ZoomableTimelineView { // abstracts a lot of common logic for smooth zooming + panning + rendering offscreen + showing scrollbars for timeline-based views
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
    // TODO: Need to adapt the original drawing code from
    // https://github.com/hdc-arizona/traveler-integrated/blob/eea880b6dfede946e8a82e96e32465135c07b0f0/static/views/ProcMetricView/ProcMetricView.js
    // (yes, that's ProcMetricView, it's really the more standard line chart)
    // to use this.getNamedResource('data') instead (the data should be in the
    // same format)
  }

  async updateData (chartShape) {
    const domain = chartShape.spilloverXScale.domain();
    return this.updateResource({
      name: 'data',
      type: 'json',
      url: `/datasets/${this.datasetId}/metrics/raw?metric=${encodeURIComponent(this.metric)}&begin=${domain[0]}&end=${domain[1]}`
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
    let chartShape = super.getChartShape();
    const fetchedData = this.getNamedResource('data');

    var maxY = 10;
    var minY = 0;
    if(fetchedData !== null) {
      maxY = Number.MIN_VALUE;
      minY = Number.MAX_VALUE;

      for (var i=fetchedData.length-1; i>=0; i--) {
        let tmp = fetchedData[i]['Value'];
        if(i>0) {
          tmp = tmp - fetchedData[i-1]['Value'];
        }
        if (tmp < minY) minY = tmp;
        if (tmp > maxY) maxY = tmp;
      }
    }

    this.yScale.range([chartShape.fullHeight, 0])
      .domain([minY, maxY]);
    chartShape.maxMetricValue = maxY;
    chartShape.minMetricValue = minY;
    return chartShape;
  }

  drawAxes (chartShape) {
    super.drawAxes(chartShape);

    const middle = (chartShape.minMetricValue + chartShape.maxMetricValue) / 4;
    const zeroCutter = Math.pow(10, Math.floor(Math.log10(middle)));
    // Update the y axis
    this.d3el.select('.yAxis')
        .call(d3.axisLeft(this.yScale).tickFormat(x => x / zeroCutter));

    let unit = '';
    if(zeroCutter > 1000000000){
      unit = 'G';
    } else if(zeroCutter > 1000000){
      unit = 'M';
    } else if(zeroCutter > 1000) {
      unit = 'K';
    }
    // Set the y label
    this.d3el.select('.yAxisLabel')
        .text(this.metric.substring(this.metric.lastIndexOf('/')+1) + '(' + unit + ')');
  }

  drawCanvas (chartShape) {
    const canvas = this.d3el.select('canvas');
    const context = canvas.node().getContext('2d');
    const fetchedData = this.getNamedResource('data');
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;

    if(fetchedData !== null) {
      var processedData = [];
      fetchedData.forEach((d, i) => {
        if(i>0){
          var el1 = {};
          el1['Timestamp'] = d['Timestamp'];
          el1['Value'] = fetchedData[i-1]['Value'];
          if(i>1) {
            el1['Value'] = el1['Value'] - fetchedData[i-2]['Value'];
          }
          processedData.push(el1);
        }
        var el = {};
        el['Timestamp'] = d['Timestamp'];
        el['Value'] = d['Value'];
        if(i>0) {
          el['Value'] = el['Value'] - fetchedData[i-1]['Value'];
        }
        processedData.push(el);
      });


      const __self = this;
      var line = d3.line()
          .x(function(d) { return (chartShape.spilloverXScale(d['Timestamp']) - chartShape.leftOffset); })
          .y(function(d, i) { return __self.yScale(d['Value']); })
          .context(context);
      context.beginPath();
      // line(fetchedData);
      line(processedData);
      context.lineWidth = 1.5;
      context.strokeStyle = theme['--text-color-softer'];
      context.stroke();
    }
  }
}

export default LineChartView;
