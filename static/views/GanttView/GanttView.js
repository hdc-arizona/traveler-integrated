/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

// Minimum vertical pixels per row
const MIN_LOCATION_HEIGHT = 30;

// Fetch and draw 3x the time data than we're actually showing, for smooth
// scrolling, zooming interactions
const HORIZONTAL_SPILLOVER_FACTOR = 3;
// Fetch and draw 3x the time data than we're actually showing, for smooth
// scrolling interactions
const VERTICAL_SPILLOVER_FACTOR = 1;

class GanttView extends LinkedMixin( // Ensures that this.linkedState is updated through app-wide things like Controller.refreshDatasets()
  uki.ui.ParentSizeViewMixin( // Keeps the SVG element sized based on how much space GoldenLayout gives us
    uki.ui.SvgGLView)) { // Ensures this.d3el is an SVG element; adds the download icon to the tab
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg', name: 'template' },
      // Placeholder resources that don't actually get updated until later
      { type: 'placeholder', value: null, name: 'totalUtilization' },
      { type: 'placeholder', value: null, name: 'selectionUtilization' },
      { type: 'placeholder', value: null, name: 'selectedIntervalTrace' }
    ]);
    super(options);

    // Ensure unique clip path IDs for each GanttView instantiation (can create
    // problems if there's more than one GanttView)
    this.clipPathId = (GanttView.NEXT_CLIP_ID || 1);
    GanttView.NEXT_CLIP_ID += 1;
    this.clipPathId = 'clip' + this.clipPathId;

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };

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

    // xScale refers to the data that's visible; converts from timestamps to
    // the width of .yScroller
    this.xScale = d3.scaleLinear();
    // xFakeScrollerScale refers to the full range of the data; converts from
    // timestamps to how wide the canvas *would* be if we could fit it all
    // onscreen (used only for the horizontal scrollbar)
    this.xFakeScrollerScale = d3.scaleLinear();
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

  async setup () {
    await super.setup(...arguments);

    // Set up the SVG element and position its .chart group
    this.d3el.html(this.getNamedResource('template'))
      .classed('GanttView', true);
    this.d3el.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Link our y axis and the clip region
    this.d3el.select('clipPath').attr('id', this.clipPathId);
    this.d3el.select('.yAxis').attr('clip-path', `url(#${this.clipPathId})`);

    // Insert a div inside the goldenlayout wrapper to put a scrollbar
    // *below* the x-axis
    this.xFakeScroller = this.glEl.append('div')
      .classed('xFakeScroller', true)
      .style('left', this.margin.left + 'px');
    // Empty div inside to make CSS overflow-x work
    this.xFakeScroller.append('div')
      .classed('scrollContent', true);

    // Convenience pointer to .yScroller
    this.yScroller = this.d3el.select('.yScroller');

    // Do a quickDraw immediately for horizontal brush / scroll / zoom
    // interactions...
    this.linkedState.on('detailDomainChangedSync', () => { this.quickDraw(); });
    // ... and ask for new data when we're confident that rapid interactions
    // have finished
    this.linkedState.on('detailDomainChanged', () => {
      this.updateDataIfNeeded();
    });
    // Also ask for new data when the selection changes
    this.linkedState.on('selectionChanged', () => {
      this.updateDataIfNeeded();
    });

    // Set up local zoom, pan, hover, and click interactions
    this.setupInteractions();

    // setup() is only called once this.d3el is ready; only at this point do we
    // know how many bins to ask for
    this.updateDataIfNeeded();
  }

  setupInteractions () {
    // Update whenever GoldenLayout resizes us
    this.on('resize', () => { this.render(); });

    this.d3el.select('.eventCapturer')
      .on('wheel', event => {
        // Zoom when using the wheel over the main chart area
        const zoomFactor = 1.05 ** (normalizeWheel(event).pixelY / 100);
        // Where was the mouse, relative to the chart (not its actual target;
        // .eventCapturer wouldn't work)
        const chartBounds = this.d3el.select('.chart').node().getBoundingClientRect();
        const mousedPosition = this.xScale.invert(event.clientX - chartBounds.left);
        this.linkedState.detailDomain = [
          mousedPosition - zoomFactor * (mousedPosition - this.linkedState.detailDomain[0]),
          mousedPosition + zoomFactor * (this.linkedState.detailDomain[1] - mousedPosition)
        ];
        event.preventDefault();
        return false;
      }).call(d3.drag()
        .on('start', event => {
          const initialDomain = this.linkedState.detailDomain;
          const originalWidth = initialDomain[1] - initialDomain[0];
          this._dragState = {
            initialDomain,
            originalWidth,
            x0: event.x,
            y0: event.y,
            dx: 0,
            dy: 0
          };
        }).on('drag', event => {
          this._dragState.dx = event.x - this._dragState.x0;
          this._dragState.dy = event.y - this._dragState.y0;
          const mouseDelta = this.xScale.invert(event.x) -
            this.xScale.invert(event.x + this._dragState.dx);
          const newDomain = [
            this._dragState.initialDomain[0] + mouseDelta,
            this._dragState.initialDomain[1] + mouseDelta
          ];
          // Prevent zooming when dragging to the end of the screen
          if (newDomain[0] <= this.linkedState.overviewDomain[0]) {
            newDomain[0] = this.linkedState.overviewDomain[0];
            newDomain[1] = this.linkedState.overviewDomain[0] +
              this._dragState.originalWidth;
          } else if (newDomain[1] >= this.linkedState.overviewDomain[1]) {
            newDomain[1] = this.linkedState.overviewDomain[1];
            newDomain[0] = this.linkedState.overviewDomain[1] -
              this._dragState.originalWidth;
          }
          this.linkedState.detailDomain = newDomain;
        }).on('end', () => {
          // TODO: if dx and dy are zero, select the clicked interval
          this.render();
        }));

    // Pan the detailDomain in response to scrolling the x axis
    this.xFakeScroller.on('scroll', () => {
      if (this._ignoreXScrollEvents) {
        // This was an artificial scroll event from setting element.scrollLeft;
        // ignore it
        this._ignoreXScrollEvents = false;
        return;
      }
      const scrollLeft = this.xFakeScroller.node().scrollLeft;
      // Update the domain based on where we've scrolled to
      const oldDomain = this.linkedState.detailDomain;
      const left = this.xFakeScrollerScale.invert(scrollLeft);
      this.linkedState.detailDomain = [left, left + (oldDomain[1] - oldDomain[0])];
    });

    // Make sure the y axis links with scrolling
    this.yScroller.on('scroll', () => {
      this.quickDraw();
      this.render();
      // render() is debounced, so it will only be called once when scrolling
      // stops (and call its updateDataIfNeeded function if we need to load
      // more vertical data)
    });
    // Link wheel events on the y axis back to vertical scrolling
    this.d3el.select('.yAxisScrollCapturer').on('wheel', event => {
      this.yScroller.node().scrollTop += event.deltaY;
    });
  }

  /**
   * This is called immediately for rapid updates during things like zooming or
   * scrolling (so this should never include expensive drawing commands)
   */
  quickDraw () {
    const chartShape = this.getChartShape();
    this.moveCanvas(chartShape);
    this.drawAxes(chartShape);
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

    // Store the shape that was last fully rendered (note that this is different
    // from _lastChartShape, which indicates which shape was last queried)
    delete this._renderedChartShape;
    this._renderedChartShape = this.getChartShape();

    this.moveCanvas(this._renderedChartShape);
    this.drawAxes(this._renderedChartShape);
    this.drawBars(this._renderedChartShape);

    // Update the trace lines (or clear them if there aren't any)
    // this.drawTraceLines(chartShape);

    // As part of the full render (that could have been triggered from anywhere,
    // start the process of requesting fresh data if the viewport is out of date)
    this.updateDataIfNeeded(this._renderedChartShape);
  }

  /**
   * Checks to see if we need to request new data
   */
  async updateDataIfNeeded (chartShape) {
    if (!this.linkedState.detailDomain || !this.linkedState.info.locationNames) {
      // We don't have enough information to know what data to ask for (e.g. the
      // server might still be bundling a large dataset); wait for Controller.js
      // to refreshDatasets()
      return;
    }
    if (!chartShape) {
      chartShape = this.getChartShape();
    }
    const domain = chartShape.spilloverXScale.domain();
    let locations = chartShape.locations;

    // We consider chartShape to be out of date if:
    // 1. the spillover domain is different,
    const needsRefresh = !this._lastChartShape ||
      this._lastChartShape.spilloverXScale.domain()
        .some((timestamp, i) => domain[i] !== timestamp) ||
    // 2. the expected locations are different,
      this._lastChartShape.locations.length !== locations.length ||
      this._lastChartShape.locations.some((loc, i) => locations[i] !== loc) ||
    // 3. the selection has changed
      this._lastSelectionId !== this.linkedState.selection?.id;

    if (needsRefresh) {
      // Cache the shape and selection ids that are currently relevant, so we
      // know if something changed since last time
      this._lastChartShape = chartShape;
      this._lastSelectionId = this.linkedState.selection?.id;

      // Make the list of locations a URL-friendly comma-separated list
      locations = globalThis.encodeURIComponent(locations.join(','));

      // Basic URL that both totalUtilization and selectionUtilization will use
      const baseUrl = `/datasets/${this.datasetId}/utilizationHistogram?bins=${chartShape.bins}&begin=${domain[0]}&end=${domain[1]}&locations=${locations}`;

      // Add any additional per-selection parameters
      const selectionParams = this.linkedState.selection?.utilizationParameters;

      // Send the API requests
      const totalPromise = this.updateResource({ name: 'totalUtilization', type: 'json', url: baseUrl });
      const selectionPromise = selectionParams
        ? this.updateResource({ name: 'selectionUtilization', type: 'json', url: baseUrl + selectionParams })
        : this.updateResource({ name: 'selectionUtilization', type: 'placeholder', value: null }); // no current selection; replace data with null

      // Initial render call to show the spinner if waiting for data takes a while
      // (because render() is debounced, the spinner won't show if the request
      // is fast)
      this.render();
      await Promise.all([totalPromise, selectionPromise]);
      // Ensure that everything is updated with the new data
      this.render();
    }
    return chartShape;
  }

  computeSpillover ([low, high], factor) {
    const halfOriginalWidth = (high - low) / 2;
    const center = low + halfOriginalWidth;
    const halfSpilloverWidth = factor * halfOriginalWidth;
    return [Math.floor(center - halfSpilloverWidth), Math.ceil(center + halfSpilloverWidth)];
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
    // Figure out how much space we have, including whether or not to show the
    // scrollbars
    const bounds = this.getBounds();
    const chartShape = {
      chartWidth: bounds.width - this.margin.left - this.margin.right,
      chartHeight: bounds.height - this.margin.top - this.margin.bottom,
      requiredHeight: MIN_LOCATION_HEIGHT * this.linkedState.info.locationNames.length
    };
    chartShape.rightScrollbarIsShowing = chartShape.requiredHeight > chartShape.chartHeight;
    chartShape.bottomScrollbarIsShowing =
      this.linkedState.detailDomain[0] > this.linkedState.overviewDomain[0] ||
      this.linkedState.detailDomain[1] < this.linkedState.overviewDomain[1];
    if (chartShape.rightScrollbarIsShowing) {
      chartShape.chartWidth -= this.scrollBarSize;
    }
    if (chartShape.bottomScrollbarIsShowing) {
      chartShape.chartHeight -= this.scrollBarSize;
    }
    // Force at least 1 px width, height
    chartShape.chartWidth = Math.max(1, chartShape.chartWidth);
    chartShape.chartHeight = Math.max(1, chartShape.chartHeight);
    // Use either the required space or expand to use the space we have
    chartShape.fullHeight = Math.max(chartShape.requiredHeight, chartShape.chartHeight);

    // Update the scales
    this.xScale.range([0, chartShape.chartWidth])
      .domain(this.linkedState.detailDomain);
    this.yScale.range([0, chartShape.fullHeight])
      .domain(this.linkedState.info.locationNames);

    // How many pixels would the full data span at this zoom level?
    const overviewRange = this.linkedState.overviewDomain.map(this.xScale);
    chartShape.fullWidth = overviewRange[1] - overviewRange[0];
    chartShape.overviewScale = d3.scaleLinear()
      .domain(this.linkedState.overviewDomain)
      .range(overviewRange);
    // Update this.xFakeScrollerScale while we're at it
    this.xFakeScrollerScale
      .domain(this.linkedState.overviewDomain)
      .range([0, chartShape.fullWidth]);

    // Figure out the data / pixel bounds that we should query
    const spilloverXDomain = this.computeSpillover(this.linkedState.detailDomain, HORIZONTAL_SPILLOVER_FACTOR);
    // Ensure integer endpoints
    spilloverXDomain[0] = Math.floor(spilloverXDomain[0]);
    spilloverXDomain[1] = Math.ceil(spilloverXDomain[1]);
    const spilloverXRange = spilloverXDomain.map(chartShape.overviewScale);
    chartShape.spilloverXScale = d3.scaleLinear()
      .domain(spilloverXDomain)
      .range(spilloverXRange);

    // How many (integer) bins should we ask for (1 per pixel)?
    chartShape.bins = Math.ceil(spilloverXRange[1] - spilloverXRange[0]);

    // Given the scroll position and size, which locations should be visible?
    let spilloverYRange = [
      this.yScroller.node().scrollTop,
      this.yScroller.node().scrollTop + chartShape.chartHeight
    ];
    // Add vertical spillover
    spilloverYRange = this.computeSpillover(spilloverYRange, VERTICAL_SPILLOVER_FACTOR);
    chartShape.spilloverYRange = spilloverYRange;
    chartShape.locations = this.yScale.invertRange(...spilloverYRange);

    // Figure out what transformations we need relateive to the last time a
    // full render happened
    if (this._renderedChartShape) {
      const originalDomain = this._renderedChartShape.spilloverXScale.domain();
      chartShape.zoomFactor = (originalDomain[1] - originalDomain[0]) / (spilloverXDomain[1] - spilloverXDomain[0]);
      chartShape.leftOffset = chartShape.spilloverXScale(this._renderedChartShape.spilloverXScale.domain()[0]);
    } else {
      chartShape.zoomFactor = 1.0;
      chartShape.leftOffset = spilloverXRange[0];
    }

    return chartShape;
  }

  moveCanvas (chartShape) {
    // Note that we resize the canvas using CSS transforms instead of width /
    // height attributes to get a scaling effect while we're zooming / panning.
    // CSS transforms already take advantage of the GPU; see also:
    // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas#scaling_canvas_using_css_transforms
    this.d3el.select('.gantt-canvas')
      .style('transform-origin', '0px 0px')
      .style('transform', `scale(${chartShape.zoomFactor}, 1)`)
      .style('left', `${chartShape.leftOffset}px`);

    // Update the eventCapturer rect
    this.d3el.select('.eventCapturer')
      .attr('width', chartShape.chartWidth)
      .attr('height', chartShape.chartHeight);

    // Update the size of the foreignObject
    this.yScroller
      .attr('width', chartShape.chartWidth +
        (chartShape.rightScrollbarIsShowing ? this.scrollBarSize : 0))
      .attr('height', chartShape.chartHeight)
      .style('overflow-y', chartShape.rightScrollbarIsShowing ? 'scroll' : 'hidden');
    // Update the fake scroller position, size
    this.xFakeScroller
      .style('width', chartShape.chartWidth + 'px')
      .style('top', (this.margin.top + chartShape.chartHeight) + 'px')
      .style('bottom', '0px')
      .style('overflow-x', chartShape.bottomScrollbarIsShowing ? 'scroll' : 'hidden');
    // Update the empty div inside to simulate the correct scrollbar position
    this.xFakeScroller.select('.scrollContent')
      .style('width', chartShape.fullWidth + 'px')
      .style('height', chartShape.fullHeight + 'px');
    // Scroll the empty div to the current position
    const scrollLeft = this.xFakeScrollerScale(this.linkedState.detailDomain[0]);
    this._ignoreXScrollEvents = true;
    this.xFakeScroller.node().scrollLeft = scrollLeft;
  }

  drawAxes (chartShape) {
    // Update the x axis
    const xAxisGroup = this.d3el.select('.xAxis')
      .attr('transform', `translate(0, ${chartShape.chartHeight})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.d3el.select('.xAxisLabel')
      .attr('x', chartShape.chartWidth / 2)
      .attr('y', chartShape.chartHeight + 2 * this.emSize);

    // Update the y axis
    let yTicks = this.d3el.select('.yAxis').selectAll('.tick')
      .data(this.yScale.domain());
    yTicks.exit().remove();
    const yTicksEnter = yTicks.enter().append('g')
      .classed('tick', true);
    yTicks = yTicks.merge(yTicksEnter);

    // Link the y axis position to yScroller
    const yOffset = this.yScroller.node().scrollTop;
    this.d3el.select('.yAxis').attr('transform', `translate(0,${-yOffset})`);

    // Update the clipPath position and dimensions
    this.d3el.select('clipPath rect')
      .attr('x', -this.margin.left)
      .attr('y', yOffset)
      .attr('width', chartShape.chartWidth + this.margin.left)
      .attr('height', chartShape.chartHeight);

    // Update .yAxisScrollCapturer
    this.d3el.select('.yAxisScrollCapturer')
      .attr('x', -this.margin.left)
      .attr('width', this.margin.left)
      .attr('height', chartShape.chartHeight);

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

    // Position the y label
    this.d3el.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize - 12},${chartShape.chartHeight / 2}) rotate(-90)`);
  }

  drawBars (chartShape) {
    const theme = globalThis.controller.getNamedResource('theme').cssVariables;
    const totalUtilization = this.getNamedResource('totalUtilization');
    const selectionUtilization = this.getNamedResource('selectionUtilization');

    // We only want to set canvas width / height ATTRIBUTES here, because doing
    // so in another context (e.g. zooming / panning) would clear the canvas
    // (in that context, we only want to set transform STYLES to scale
    // what we previously drew here)
    const canvas = this.d3el.select('.gantt-canvas')
      .attr('width', chartShape.bins)
      .attr('height', chartShape.fullHeight)
      .style('transform-origin', null)
      .style('transform', null);

    const ctx = canvas.node().getContext('2d');
    ctx.clearRect(0, 0, chartShape.bins, chartShape.fullHeight);

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
          ctx.fillStyle = theme['--text-color-richer'];
          ctx.fillRect(binNo, y0, 1, bandwidth);
        }

        // Which fill to draw (if any)?
        if (sUtil >= 1) {
          ctx.fillStyle = theme['--selection-color'];
          ctx.fillRect(binNo, y0 + 1, 1, bandwidth - 2);
        } else if (tUtil >= 1) {
          ctx.fillStyle = theme['--text-color-softer'];
          ctx.fillRect(binNo, y0 + 1, 1, bandwidth - 2);
        }
      }
    }
  }
}

export default GanttView;
