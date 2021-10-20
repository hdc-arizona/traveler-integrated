/* globals d3 */
import ZoomableTimelineView from '../ZoomableTimelineView/ZoomableTimelineView.js';

// Minimum vertical pixels per row
const MIN_LOCATION_HEIGHT = 30;

// Fetch and draw 3x the time data than we're actually showing, for smooth
// scrolling interactions
const VERTICAL_SPILLOVER_FACTOR = 3;

// Don't show trace lines when we're zoomed out beyond this time limit
const TRACE_LINE_TIME_LIMIT = Infinity;

class AggregatedGanttView extends ZoomableTimelineView { // abstracts a lot of common logic for smooth zooming + panning + rendering offscreen + showing scrollbars for timeline-based views
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      // Placeholder resources that don't actually get updated until later
      { type: 'placeholder', value: null, name: 'aggregatedIntervals' }
    ]);
    super(options);

    // yScale maps the full list of locationNames to the full height of the
    // canvas
    this.yScale = d3.scaleBand()
      .paddingInner(0.2)
      .paddingOuter(0.1);
    // scaleBand doesn't come with an invert function...
    this.yScale.invert = function (x) { // think about the padding later
      const domain = this.domain();
      const range = this.range();
      const scale = d3.scaleQuantize().domain(range).range(domain);
      return scale(x);
    };
    // Also add a function to scaleBand to get which locations intersect with
    // a numeric range
    this.yScale.invertRange = function (low, high) {
      const domain = this.domain();
      const result = [];
      let position = low;
      let index = domain.indexOf(this.invert(low));
      while (index < domain.length && position <= high) {
        result.push(domain[index]);
        index += 1;
        position = this(domain[index]);
      }
      return result;
    };
  }

  get isLoading () {
    // Display the spinner + skip most of the draw call if we're still waiting
    // on utilization data
    if (super.isLoading) {
      return true;
    }
    if (this.linkedState.selection?.primitiveName) {
      const trace2 = this.getNamedResource('aggregatedIntervals');
      if (trace2 === null || (trace2 instanceof Error && trace2.status === 503)) {
        return true;
      }
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

  handlePanningStart (event, dragState) {
    dragState.y0 = event.y;
    dragState.dy = 0;
    dragState.initialYScroll = this.d3el.select('foreignObject').node().scrollTop;
  }

  handlePanning (event, dragState, newDomain) {
    dragState.dy = event.y - this._dragState.y0;
    const scrollTop = dragState.initialYScroll - dragState.dy;
    const forceQuickDraw = scrollTop !== this.d3el.select('foreignObject').node().scrollTop;
    this._ignoreYScrollEvents = true;
    this.d3el.select('foreignObject').node().scrollTop = scrollTop;
    if (forceQuickDraw &&
        newDomain[0] === this.linkedState.detailDomain[0] &&
        newDomain[1] === this.linkedState.detailDomain[1]) {
      // TracedLinkedState won't otherwise issue a quickDraw in this case,
      // which can result in some funny effects if there was vertical
      // panning
      this.quickDraw();
    }
  }

  handlePanningEnd (event, dragState) {
    // if (dragState.dx === 0 && dragState.dy === 0) {
    //   const timestamp = Math.round(this.xScale.invert(event.x));
    //   const location = this.yScale.invert(event.y + this.d3el.select('foreignObject').node().scrollTop);
    //   this.linkedState.selectIntervalByTimeAndLoc(timestamp, location);
    // }
  }

  setupInteractions () {
    super.setupInteractions();

    // Make sure the y axis links with scrolling
    this.d3el.select('foreignObject').on('scroll', () => {
      if (this._ignoreYScrollEvents) {
        // suppress false scroll events from setting scrollTop
        this._ignoreYScrollEvents = false;
        return;
      }
      this.quickDraw();
      this.render();
    });
    // Link wheel events on the y axis back to vertical scrolling
    this.d3el.select('.yAxisScrollCapturer').on('wheel', event => {
      this.d3el.select('foreignObject').node().scrollTop += event.deltaY;
    });
  }

  drawCanvas (chartShape) {
    this.drawAggregatedBars(chartShape);
  }

  hasEnoughDataToComputeChartShape () {
    return super.hasEnoughDataToComputeChartShape() &&
      !!this.linkedState.info.locationNames;
  }

  determineIfShapeNeedsRefresh (lastChartShape, chartShape) {
    return lastChartShape.locations.length !== chartShape.locations.length ||
    lastChartShape.locations.some((loc, i) => chartShape.locations[i] !== loc);
  }

  async updateData (chartShape) {
    const domain = chartShape.spilloverXScale.domain();
    // Make the list of locations a URL-friendly comma-separated list
    const selectedNodeId = this.linkedState.selection?.primitiveDetails;
    const aggregatedIntervalsPromise = selectedNodeId
        ? this.updateResource({
          name: 'aggregatedIntervals',
          type: 'json',
          url: `/datasets/${this.datasetId}/primitives/primitiveTraceForward?nodeId=${selectedNodeId}&bins=${chartShape.bins}&begin=${domain[0]}&end=${domain[1]}`
        })
        : this.updateResource({ name: 'aggregatedIntervals', type: 'placeholder', value: null });
    return Promise.all([aggregatedIntervalsPromise]);
  }

  getRequiredChartHeight () {
    return MIN_LOCATION_HEIGHT;
  }

  /**
   * Calculate the visible chart area, whether scrollbars should be showing,
   * update all scales; after accounting for spillover space, figure out how
   * many bins and which locations should be requested from the API
   */
  getChartShape () {
    const chartShape = super.getChartShape();
    const aggregatedIntervals = this.getNamedResource('aggregatedIntervals');
    if(aggregatedIntervals === null || Object.keys(aggregatedIntervals.data).length === 0) {
      this.yScale.range([0, chartShape.fullHeight])
          .domain([0]);
    } else {
      this.yScale.range([0, chartShape.fullHeight])
          .domain(Object.keys(aggregatedIntervals.data));
    }


    // Given the scroll position and size, which locations should be visible?
    const scrollTop = this.d3el.select('foreignObject').node().scrollTop;
    let spilloverYRange = [
      scrollTop,
      scrollTop + chartShape.chartHeight
    ];
    // Add vertical spillover
    spilloverYRange = this.computeSpillover(spilloverYRange, VERTICAL_SPILLOVER_FACTOR);
    chartShape.spilloverYRange = spilloverYRange;
    chartShape.locations = this.yScale.invertRange(...spilloverYRange);

    return chartShape;
  }

  drawAxes (chartShape) {
    super.drawAxes(chartShape);
    // Update the y axis
    let yTicks = this.d3el.select('.yAxis').selectAll('.tick')
      .data(this.yScale.domain());
    yTicks.exit().remove();
    const yTicksEnter = yTicks.enter().append('g')
      .classed('tick', true);
    yTicks = yTicks.merge(yTicksEnter);

    // y tick coordinate system in between each row
    yTicks.attr('transform', d => `translate(0,${this.yScale(d) + this.yScale.bandwidth() / 2})`);

    // y ticks span the full width of the chart
    const lineOffset = -this.yScale.step() / 2;
    yTicksEnter.append('line');
    yTicks.select('line')
      .attr('x1', 0)
      .attr('x2', chartShape.chartWidth)
      .attr('y1', lineOffset)
      .attr('y2', lineOffset);

    // y tick labels
    yTicksEnter.append('text');

    // Set the y label
    this.d3el.select('.yAxisLabel')
      .text('');
  }

  drawUtilLines(primitiveData, chartShape, location, cstart) {
    // console.log("drawing primitive util data");
    const domain = chartShape.spilloverXScale.domain();
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;

    const canvas = this.d3el.select('canvas');
    const ctx = canvas.node().getContext('2d');

    const bandwidth = this.yScale.bandwidth();

    if(cstart < domain[0]) {
      cstart = domain[0];
    }
    const maxUtil = this.linkedState.info.locationNames.length;
    // const maxUtil = Math.ceil(Math.max(...primitiveData));
    const outlinePathGenerator = d3.area()
        .x((d, i) => {
          return chartShape.spilloverXScale(cstart) - chartShape.leftOffset + i;
        }) // bin number corresponds to screen coordinate
        .y1(d => {
          return this.yScale(location) + bandwidth * (1 - d/maxUtil);
        })
        .y0(d => {
          return this.yScale(location) + bandwidth;
        }).context(ctx);
    ctx.fillStyle = theme['--selection-color'];
    ctx.beginPath();
    outlinePathGenerator(primitiveData);
    ctx.fill();
    ctx.closePath();
  }

  drawAggregatedBars (chartShape) {
    const aggregatedIntervals = this.getNamedResource('aggregatedIntervals');
    const domain = chartShape.spilloverXScale.domain();
    const currentTimespan = this.linkedState.detailDomain[1] -
        this.linkedState.detailDomain[0];
    if (aggregatedIntervals === null ||
        Object.keys(aggregatedIntervals.data).length === 0 ||
        currentTimespan > TRACE_LINE_TIME_LIMIT) {
      return;
    }
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;

    const canvas = this.d3el.select('canvas');
    const ctx = canvas.node().getContext('2d');

    const bandwidth = this.yScale.bandwidth();
    ctx.strokeStyle = theme['--selection-border-color'];
    ctx.lineWidth = 2;
    ctx.fillStyle = theme['--inclusive-color-3'];

    const dLen = Object.keys(aggregatedIntervals.data).length;
    for (const [location, aggregatedTimes] of Object.entries(aggregatedIntervals.data)) {
      for (let aggTime of aggregatedTimes) {
        // ctx.fillStyle = theme['--inclusive-color-3'];
        ctx.fillStyle = this.linkedState.getColorShades(location, dLen);
        ctx.fillRect(chartShape.spilloverXScale(aggTime.startTime) - chartShape.leftOffset,
            this.yScale(location),
            chartShape.spilloverXScale(aggTime.endTime) - chartShape.spilloverXScale(aggTime.startTime),
            bandwidth);

        const visibleBins = chartShape.spilloverXScale(aggTime.endTime) - chartShape.spilloverXScale(aggTime.startTime)
        const minBinsForUtilAndText = 20;
        if(visibleBins > minBinsForUtilAndText) { // at least ten bins exist
          this.drawUtilLines(aggTime.util, chartShape, location, aggTime.startTime);
          ctx.fillStyle = "white";
          ctx.font = "10px Arial";
          ctx.fillText(aggTime.name,
              chartShape.spilloverXScale(aggTime.startTime) - chartShape.leftOffset,
              this.yScale(location) + bandwidth/2);
        }
      }
    }

  }
}

export default AggregatedGanttView;
