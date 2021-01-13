/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

// Minimum vertical pixels per row
const MIN_LOCATION_HEIGHT = 300;

class GanttView extends LinkedMixin(uki.ui.ParentSizeViewMixin(uki.ui.SvgGLView)) {
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg', name: 'template' }
    ]);
    super(options);

    this.overviewScale = d3.scaleLinear();
    this.spilloverScale = d3.scaleLinear();
    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleBand()
      .paddingInner(0.2)
      .paddingOuter(0.1);
    this.yScale.invert = function (x) { // think about the padding later
      const domain = this.domain();
      const range = this.range();
      const scale = d3.scaleQuantize().domain(range).range(domain);
      return scale(x);
    };

    // Render whenever there's a change to the detailUtilization, or when the
    // selection changes
    this.linkedState.on('detailUnloaded', () => { this.render(); });
    this.linkedState.on('detailLoaded', () => { this.render(); });
    this.linkedState.on('selectionChanged', () => { this.render(); });
  }

  get isLoading () {
    // Display the spinner + skip most of the draw call if we're still waiting
    // on utilization data
    return super.isLoading ||
      this.linkedState.getNamedResource('detailUtilization') === null ||
      (this.linkedState.selection?.hasNamedResource('detailUtilization') &&
       this.linkedState.selection.getNamedResource('detailUtilization') === null);
  }

  async setup () {
    await super.setup(...arguments);

    // setup() is only called once this.d3el is ready; only at this point do we
    // know how many bins to ask for
    this.updateResolution();
    // Update the resolution whenever the view is resized
    this.on('resize', () => { this.updateResolution(); });

    // Set up the SVG element and position its .chart group
    this.d3el.html(this.resources[1])
      .classed('GanttView', true);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };
    this.d3el.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Insert two divs inside the goldenlayout wrapper to put a scrollbar
    // *below* the x-axis, and to ensure that the loading spinner doesn't
    // interfere with zoom / panning interactions
    this.scrollEl = this.glEl.append('div')
      .classed('GanttViewHorizontalScroller', true)
      .style('top', this.margin.top + 'px')
      .style('left', this.margin.left + 'px');
    this.scrollEl.append('div')
      .classed('scrollContent', true);

    // Initialize the scales
    this.xScale.domain(this.linkedState.detailDomain);
    this.yScale.domain(this.linkedState.info.locationNames);

    // Set up zoom, pan, hover, and click interactions
    this.setupInteractions();

    // Set up listeners on the model for domain changes
    this.linkedState.on('detailDomainChangedSync', () => { this.quickDraw(); });
    this.linkedState.on('detailDomainChanged', () => { this.render(); });
  }

  setupInteractions () {
    // Select / deselect intervals when the user clicks; note that we use
    // this.scrollEl to capture the event because it's the top layer (and we
    // can't just apply pointer-events: none to it, because it needs to capture
    // the wheel for zooming)... but that's okay, because we look up intervals
    // by mouse position anyway. If we went back to SVG bars + element-based
    // selections, we might need to do this differently.
    this.scrollEl
      .on('click', () => {
        // TODO: just deselect for now
        this.linkedState.selection = null;
      });

    // Update y axis in response to vertical scrolling
    this.d3el.select('.verticalScroller').on('scroll', () => { this.quickDraw(); });

    this.scrollEl.on('scroll', event => {
      // Update detailDomain in response to horizontal scrolling (will indirectly
      // result in quickDraw() + render() calls because of the detailDomainChanged
      // listeners)
      this.linkedState.detailDomain = this.getScrolledDomain();
    });

    // Zoom in / out with the mouse wheel (prevent default scrolling)
    this.scrollEl.on('wheel', event => {
      const zoomFactor = 1.05 ** (normalizeWheel(event).pixelY / 100);
      // Where was the mouse, relative to the chart (not its actual target;
      // this.scrollEl wouldn't work)
      const chartBounds = this.d3el.select('.chart').node().getBoundingClientRect();
      const mousedPosition = this.xScale.invert(event.clientX - chartBounds.left);
      this.linkedState.detailDomain = [
        mousedPosition - zoomFactor * (mousedPosition - this.linkedState.detailDomain[0]),
        mousedPosition + zoomFactor * (this.linkedState.detailDomain[1] - mousedPosition)
      ];
      event.preventDefault();
      return false;
    });
  }

  /**
   * This is called immediately for rapid updates during things like zooming or
   * scrolling (so this should never include expensive drawing commands), and
   * queues a final render() call that is internally debounced
   */
  quickDraw () {
    this.updateCanvasShape(true);
    this.drawAxes();
    this.render();
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading || this.error) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner. Or if there's an upstream error, super.draw will
      // already display an error message. Don't attempt to draw anything (or
      // we'll probably just add to the noise of whatever is really wrong)
      return;
    }

    // Update the scales + the canvas, GanttViewFakeScroller elements
    // (uki.ui.ParentSizeViewMixin already makes sure the SVG element matches
    // the GoldenLayout size)
    this.updateCanvasShape(false);
    // Update the axes
    this.drawAxes();
    // Update the bars
    this.drawBars();
    // Update the trace lines (or clear them if there aren't any)
    // this.drawTraceLines();
  }

  updateResolution () {
    // Update our scale ranges (and bin count) based on how much space is available
    const bounds = this.getBounds();
    this.chartBounds = {
      width: bounds.width - this.margin.left - this.margin.right,
      height: bounds.height - this.margin.top - this.margin.bottom
    };
    this.xScale.range([0, this.chartBounds.width]);
    this.yScale.range([this.chartBounds.height, 0]);
    const bins = Math.max(Math.ceil(this.chartBounds.width), 1); // we want one bin per pixel, and clamp to 1 to prevent zero-bin / negative queries
    this.linkedState.detailResolution = bins; // this will result in overviewLoaded / overviewUnloaded events

    // TODO: continue here; need to move some of the updateCanvasShape stuff here
  }

  /**
   * Update the scales, the size of the background, the canvas, and its
   * foreignObject wrapper so that the latter's scrollbars auto-update
   * themselves; ideally this shouldn't do any drawing
   */
  updateCanvasShape (quick) {
    // Figure out how much space we have, including whether or not to show the
    // scrollbars
    const bounds = this.getBounds();
    let chartWidth = bounds.width - this.margin.left - this.margin.right;
    let chartHeight = bounds.height - this.margin.top - this.margin.bottom;
    const requiredHeight = MIN_LOCATION_HEIGHT * this.linkedState.info.locationNames.length;
    const rightScrollbarIsShowing = requiredHeight > chartHeight;
    const bottomScrollbarIsShowing =
      this.linkedState.detailDomain[0] > this.linkedState.overviewDomain[0] ||
      this.linkedState.detailDomain[1] < this.linkedState.overviewDomain[1];
    if (rightScrollbarIsShowing) {
      chartWidth -= this.scrollBarSize;
    }
    if (bottomScrollbarIsShowing) {
      chartHeight -= this.scrollBarSize;
    }
    const fullHeight = Math.max(requiredHeight, chartHeight);

    // Update the scales
    this.yScale
      .domain(this.linkedState.info.locationNames) // Note: if we ever enable alternate sorting, that should probably be implemented in linkedState, not here?
      .range([0, fullHeight]);
    this.xScale
      .domain(this.linkedState.detailDomain)
      .range([0, chartWidth]);
    this.spilloverScale
      .range([-chartWidth, 2 * chartWidth]) // (3x spillover width for smooth scrolling between quickDraw and draw calls)
      .domain([this.xScale.invert(-chartWidth), this.xScale.invert(2 * chartWidth)]);

    // How many pixels would the full data span at this zoom level?
    const fullWidth =
      this.xScale(this.linkedState.overviewDomain[1]) -
      this.xScale(this.linkedState.overviewDomain[0]);
    this.overviewScale
      .domain(this.linkedState.overviewDomain)
      .range([0, fullWidth]);

    // Update the canvas size...
    this.d3el.select('.gantt-canvas')
      .attr('width', this.spilloverScale.range()[1] - this.spilloverScale.range()[0])
      .attr('height', fullHeight)
      .style('left', -chartWidth + 'px');
    // ... and the size of the wrapper
    this.d3el.select('.verticalScroller')
      .attr('width', chartWidth + (rightScrollbarIsShowing ? this.scrollBarSize : 0))
      .attr('height', chartHeight)
      .style('overflow-y', rightScrollbarIsShowing ? 'scroll' : 'hidden');

    // Update the wrapper size / overflow based on whether the scrollbars should
    // be visible
    this.scrollEl
      .style('width', chartWidth + 'px')
      .style('bottom', '0px')
      .style('overflow-x', bottomScrollbarIsShowing ? 'scroll' : 'hidden');
    // Update the empty div inside
    this.scrollEl.select('.scrollContent')
      .style('width', fullWidth + 'px')
      .style('height', fullHeight + 'px');

    // Scroll to the current position
    let quickOffset = 0;
    const targetPosition = this.overviewScale(this.linkedState.detailDomain[0]);
    if (quick) {
      // During quick drawing calls, slide the canvas left/right instead of
      // redrawing it
      quickOffset = targetPosition - this.scrollEl.node().scrollLeft;
    }
    this.scrollEl.node().scrollLeft = targetPosition;
    this.d3el.select('.verticalScroller').node().scrollLeft = quickOffset;
  }

  /**
   * Derive the domain that we'd expect to see given the current horizontal
   * scroll position
   */
  getScrolledDomain () {
    const leftOffset = this.scrollEl.node().scrollLeft;
    const localWidth = this.xScale.range()[1];
    return [leftOffset, leftOffset + localWidth].map(this.overviewScale.invert);
  }

  drawAxes () {
    const chartWidth = parseFloat(this.d3el.select('.verticalScroller').attr('width'));
    const chartHeight = parseFloat(this.d3el.select('.verticalScroller').attr('height'));

    // Update the x axis
    const xAxisGroup = this.d3el.select('.xAxis')
      .attr('transform', `translate(0, ${chartHeight})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.d3el.select('.xAxisLabel')
      .attr('x', chartWidth / 2)
      .attr('y', chartHeight + 2 * this.emSize);

    // Update the y axis
    let yTicks = this.d3el.select('.yAxis').selectAll('.tick')
      .data(this.yScale.domain());
    yTicks.exit().remove();
    const yTicksEnter = yTicks.enter().append('g')
      .classed('tick', true);
    yTicks = yTicks.merge(yTicksEnter);

    // Link the y axis position to .verticalScroller
    const yOffset = this.d3el.select('.verticalScroller').node().scrollTop;
    this.d3el.select('.yAxis').attr('transform', `translate(0,${-yOffset})`);

    // y tick coordinate system in between each row
    yTicks.attr('transform', d => `translate(0,${this.yScale(d) + this.yScale.bandwidth() / 2})`);

    // y ticks span the width of the chart
    const lineOffset = -this.yScale.step() / 2;
    yTicksEnter.append('line');
    yTicks.select('line')
      .attr('x1', 0)
      .attr('x2', chartWidth)
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

    // Position the y label
    this.d3el.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize - 12},${chartHeight / 2}) rotate(-90)`);
  }

  drawBars () {
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;
    const intervals = this.linkedState.getNamedResource('intervals');

    const ctx = this.d3el.select('.gantt-canvas').node().getContext('2d');
    const canvasWidth = this.spilloverScale.range()[1] - this.spilloverScale.range()[0];
    const canvasHeight = this.yScale.range()[1] - this.yScale.range()[0];
    // TODO: we could also probably get away with only drawing the visible subset of locations...
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const primitiveSelected = this.linkedState.selection?.type === 'PrimitiveSelection';
    const intervalSelected = this.linkedState.selection?.type === 'IntervalSelection';
    const height = this.yScale.bandwidth();

    for (const interval of intervals) {
      const selected =
        (primitiveSelected && this.linkedState.selection.primitiveName === interval.primitiveName) ||
        (intervalSelected && this.linkedState.selection.intervalId === interval.intervalId);
      const left = this.spilloverScale(interval.enter);
      const right = this.spilloverScale(interval.leave);
      const top = this.yScale(interval.location);
      // Draw the fill
      ctx.fillStyle = selected ? theme['--selection-color'] : theme['--text-color-softer'];
      ctx.fillRect()
    }
  }
}

export default GanttView;
