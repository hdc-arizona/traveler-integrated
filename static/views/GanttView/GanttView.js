/* globals d3 */
import ZoomableTimelineView from '../ZoomableTimelineView/ZoomableTimelineView.js';

// Minimum vertical pixels per row
const MIN_LOCATION_HEIGHT = 30;

// Fetch and draw 3x the time data than we're actually showing, for smooth
// scrolling interactions
const VERTICAL_SPILLOVER_FACTOR = 3;

// Don't show trace lines when we're zoomed out beyond this time limit
const TRACE_LINE_TIME_LIMIT = Infinity;

class GanttView extends ZoomableTimelineView { // abstracts a lot of common logic for smooth zooming + panning + rendering offscreen + showing scrollbars for timeline-based views
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      // Placeholder resources that don't actually get updated until later
      { type: 'placeholder', value: null, name: 'totalUtilization' },
      { type: 'placeholder', value: null, name: 'selectionUtilization' },
      { type: 'placeholder', value: null, name: 'selectedIntervalTrace' }
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
    const total = this.getNamedResource('totalUtilization');
    if (total === null || (total instanceof Error && total.status === 503)) {
      return true;
    }
    if (this.linkedState.selection?.utilizationParameters) {
      const selection = this.getNamedResource('selectionUtilization');
      if (selection === null || (selection instanceof Error && selection.status === 503)) {
        return true;
      }
    }
    if (this.linkedState.selection?.intervalTraceParameters) {
      const trace = this.getNamedResource('selectedIntervalTrace');
      if (trace === null || (trace instanceof Error && trace.status === 503)) {
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
    if (dragState.dx === 0 && dragState.dy === 0) {
      const timestamp = Math.round(this.xScale.invert(event.x));
      const location = this.yScale.invert(event.y + this.d3el.select('foreignObject').node().scrollTop);
      this.linkedState.selectInterval(timestamp, location);
    }
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
    this.drawTraceLines(chartShape);
    this.drawBars(chartShape);
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
    const locations = globalThis.encodeURIComponent(chartShape.locations.join(','));

    // Basic URL that both totalUtilization and selectionUtilization will use
    const baseUrl = `/datasets/${this.datasetId}/utilizationHistogram?bins=${chartShape.bins}&begin=${domain[0]}&end=${domain[1]}&locations=${locations}`;

    // Add any additional per-selection parameters
    const selectionParams = this.linkedState.selection?.utilizationParameters;

    // Send the utilization API requests
    const totalPromise = this.updateResource({ name: 'totalUtilization', type: 'json', url: baseUrl });
    const selectionPromise = selectionParams
      ? this.updateResource({ name: 'selectionUtilization', type: 'json', url: baseUrl + selectionParams })
      : this.updateResource({ name: 'selectionUtilization', type: 'placeholder', value: null }); // no current selection; replace data with null

    // Update the traceback data for the selected interval (if there is one)
    const selectedIntervalId = this.linkedState.selection?.intervalDetails?.intervalId;
    const tracebackPromise = selectedIntervalId
      ? this.updateResource({
          name: 'selectedIntervalTrace',
          type: 'json',
          url: `/datasets/${this.datasetId}/intervals/${selectedIntervalId}/trace?begin=${domain[0]}&end=${domain[1]}`
        })
      : this.updateResource({ name: 'selectedIntervalTrace', type: 'placeholder', value: null });

    return Promise.all([totalPromise, selectionPromise, tracebackPromise]);
  }

  getRequiredChartHeight () {
    return MIN_LOCATION_HEIGHT * this.linkedState.info.locationNames.length;
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
      .domain(this.linkedState.info.locationNames);

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
    yTicks.select('text')
      .attr('text-anchor', 'end')
      .attr('y', '0.35em')
      .text(d => {
        const a = BigInt(d);
        const c = BigInt(32);
        const node = BigInt(a >> c);
        const thread = (d & 0x0FFFFFFFF);
        let aggText = '';
        aggText += node + ' - T';
        aggText += thread;
        return aggText;
      });

    // Set the y label
    this.d3el.select('.yAxisLabel')
      .text('Location');
  }

  drawBars (chartShape) {
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;
    const totalUtilization = this.getNamedResource('totalUtilization');
    const selectionUtilization = this.getNamedResource('selectionUtilization');

    const canvas = this.d3el.select('canvas');
    const ctx = canvas.node().getContext('2d');

    const bandwidth = this.yScale.bandwidth();
    for (const [location, data] of Object.entries(totalUtilization.locations)) {
      const y0 = this.yScale(location);
      for (const [binNo, tUtil] of data.entries()) {
        const sUtil = selectionUtilization?.locations?.[location]?.[binNo];
        // Which border to draw (if any)?
        if (sUtil > 0) {
          ctx.fillStyle = theme['--selection-border-color'];
          ctx.fillRect(binNo, y0, 1, bandwidth);
        } else if (tUtil > 0) {
          ctx.fillStyle = theme['--text-color-softer'];
          ctx.fillRect(binNo, y0, 1, bandwidth);
        }

        // Which fill to draw (if any)?
        if (sUtil >= 1) {
          ctx.fillStyle = theme['--selection-color'];
          ctx.fillRect(binNo, y0 + 1, 1, bandwidth - 2);
        } else if (tUtil >= 1) {
          ctx.fillStyle = theme['--disabled-color'];
          ctx.fillRect(binNo, y0 + 1, 1, bandwidth - 2);
        }
      }
    }
  }

  drawTraceLines (chartShape) {
    const trace = this.getNamedResource('selectedIntervalTrace');
    const currentTimespan = this.linkedState.detailDomain[1] -
      this.linkedState.detailDomain[0];
    if (trace === null || currentTimespan > TRACE_LINE_TIME_LIMIT) {
      return;
    }
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;

    const canvas = this.d3el.select('canvas');
    const ctx = canvas.node().getContext('2d');

    const bandwidth = this.yScale.bandwidth();
    ctx.strokeStyle = theme['--selection-border-color'];
    ctx.lineWidth = 1;

    const drawPath = (parent, child) => {
      ctx.beginPath();
      ctx.moveTo(
        chartShape.spilloverXScale(parent.leave) - chartShape.leftOffset,
        this.yScale(parent.location) + bandwidth / 2
      );
      ctx.lineTo(
        chartShape.spilloverXScale(child.enter) - chartShape.leftOffset,
        this.yScale(child.location) + bandwidth / 2
      );
      ctx.stroke();
    };

    for (const parent of Object.values(trace.ancestors)) {
      const child = trace.ancestors[parent.child];
      if (child) {
        drawPath(parent, child);
      }
    }

    for (const child of Object.values(trace.descendants)) {
      const parent = trace.descendants[child.parent];
      if (parent) {
        drawPath(parent, child);
      }
    }
  }
}

export default GanttView;
