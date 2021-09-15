/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

// Fetch and draw 3x the time data than we're actually showing, for smooth
// scrolling, zooming interactions
const HORIZONTAL_SPILLOVER_FACTOR = 3;

class ZoomableTimelineView extends LinkedMixin( // Ensures that this.linkedState is updated through app-wide things like Controller.refreshDatasets()
  CursoredViewMixin( // Adds and updates a line in the background wherever the user is mousing
    uki.ui.ParentSizeViewMixin( // Keeps the SVG element sized based on how much space GoldenLayout gives us
      uki.ui.SvgGLView))) { // Ensures this.d3el is an SVG element; adds the download icon to the tab
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/ZoomableTimelineView/style.less' },
      { type: 'text', url: 'views/ZoomableTimelineView/template.svg', name: 'template' }
    ]);
    super(options);

    // Ensure unique clip path IDs for each instantiation (can create
    // problems if there's more than one)
    this.clipPathId = (ZoomableTimelineView.NEXT_CLIP_ID || 1);
    ZoomableTimelineView.NEXT_CLIP_ID += 1;
    this.clipPathId = 'clip' + this.clipPathId;

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };

    // xScale refers to the data that's visible; converts from timestamps to
    // the width of the visible chart
    this.xScale = d3.scaleLinear();
    // xFakeScrollerScale refers to the full range of the data; converts from
    // timestamps to how wide the canvas *would* be if we could fit it all
    // onscreen (used only for the horizontal scrollbar)
    this.xFakeScrollerScale = d3.scaleLinear();
  }

  async setup () {
    await super.setup(...arguments);

    // Set up the SVG element and position its .chart group
    this.d3el.html(this.getNamedResource('template'))
      .classed('ZoomableTimelineView', true);
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

    // Set up local zoom and pan interactions
    this.setupInteractions();

    // Set up the cursor
    this.setupCursor(this.d3el.select('.chart'));

    // setup() is only called once this.d3el is ready; as most timeline-based
    // views need to know how many pixels we have to work with, only at this
    // point do we know how many bins to ask for
    this.updateDataIfNeeded();
  }

  handlePanningStart (event, dragState) {
    // optional function for subclasses to track / respond to extra state
  }

  handlePanning (event, dragState) {
    // optional function for subclasses to track / respond to extra state
  }

  handlePanningEnd (event, dragState) {
    // optional function for subclasses to track / respond to extra state
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
      }, { passive: true }).call(d3.drag()
        .on('start', event => {
          const initialDomain = this.linkedState.detailDomain;
          const initialTimespan = initialDomain[1] - initialDomain[0];
          this._dragState = {
            initialDomain,
            initialTimespan,
            x0: event.x,
            dx: 0
          };
          this.handlePanningStart(event, this._dragState);
        }).on('drag', event => {
          // Horizontal dragging
          this._dragState.dx = event.x - this._dragState.x0;
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
              this._dragState.initialTimespan;
          } else if (newDomain[1] >= this.linkedState.overviewDomain[1]) {
            newDomain[1] = this.linkedState.overviewDomain[1];
            newDomain[0] = this.linkedState.overviewDomain[1] -
              this._dragState.initialTimespan;
          }
          this.handlePanning(event, this._dragState, newDomain);
          this.linkedState.detailDomain = newDomain;
        }).on('end', event => {
          this.handlePanningEnd(event, this._dragState);
          delete this._dragState;
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

    this.drawCursor();
    this.moveCanvas(this._renderedChartShape);
    this.drawAxes(this._renderedChartShape);
    // More expensive rendering that should only happen here, not quickDraw
    this.prepCanvas(this._renderedChartShape);
    this.drawCanvas(this._renderedChartShape);

    // As part of the full render (that could have been triggered from anywhere,
    // start the process of requesting fresh data if the viewport is out of date)
    this.updateDataIfNeeded(this._renderedChartShape);
  }

  drawCanvas (chartShape) {
    throw new Error('unimplemented');
  }

  hasEnoughDataToComputeChartShape () {
    return !!this.linkedState.detailDomain;
  }

  determineIfShapeNeedsRefresh (lastChartShape, chartShape) {
    // To be overridden by subclasses when other considerations could indicate a
    // need to refresh (e.g. has the GanttView been vertically scrolled?)
    return false;
  }

  async updateData (chartShape) {
    throw new Error('unimplemented');
  }

  /**
   * Checks to see if we need to request new data
   */
  async updateDataIfNeeded (chartShape) {
    if (!this.hasEnoughDataToComputeChartShape()) {
      // We don't have enough information to know what data to ask for (e.g. the
      // server might still be bundling a large dataset); wait for Controller.js
      // to refreshDatasets(), which will result in another call here
      return;
    }
    if (!chartShape) {
      chartShape = this.getChartShape();
    }
    const domain = chartShape.spilloverXScale.domain();

    // We consider chartShape to be out of date if:
    // 1. the spillover domain is different,
    const needsRefresh = !this._lastChartShape ||
      this._lastChartShape.spilloverXScale.domain()
        .some((timestamp, i) => domain[i] !== timestamp) ||
    // 2. a subclass says we need to update,
      this.determineIfShapeNeedsRefresh(this._lastChartShape, chartShape) ||
    // 3. the selection has changed
      this._lastSelectionId !== this.linkedState.selection?.id;

    if (needsRefresh) {
      // Cache the shape and selection ids that are currently relevant, so we
      // know if something changed since last time

      this._lastSelectionId = this.linkedState.selection?.id;

      // Initial render call to show the spinner if waiting for data takes a while
      // (because render() is debounced, the spinner won't show if the request
      // is fast)
      this.render();
      await this.updateData(chartShape);
      this._lastChartShape = this.getChartShape();
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

  getRequiredChartHeight () {
    return 0;
  }

  /**
   * Calculate the visible chart area, whether scrollbars should be showing,
   * update all scales; after accounting for spillover space, figure out how
   * many bins and which locations should be requested from the API
   */
  getChartShape () {
    // Figure out how much space we have, including whether or not to show the
    // scrollbars
    const bounds = this.getBounds();
    const chartShape = {
      chartWidth: bounds.width - this.margin.left - this.margin.right,
      chartHeight: bounds.height - this.margin.top - this.margin.bottom,
      requiredHeight: this.getRequiredChartHeight()
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

    // Update the scale
    this.xScale.range([0, chartShape.chartWidth])
      .domain(this.linkedState.detailDomain);

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

    // What is the (integer) resolution that we should we ask for (1 per pixel)?
    chartShape.bins = Math.ceil(spilloverXRange[1] - spilloverXRange[0]);

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

  getMousedTime (offsetX) {
    return this.xScale.invert(offsetX - this.margin.left);
  }

  getCursorHeight () {
    return this._renderedChartShape?.chartHeight || 0;
  }

  getCursorPosition (time) {
    return time < this.xScale.domain()[0] || time > this.xScale.domain()[1]
      ? null
      : this.xScale(time);
  }

  moveCanvas (chartShape) {
    // Note that we resize the canvas using CSS transforms instead of width /
    // height attributes to get a scaling effect while we're zooming / panning.
    // CSS transforms already take advantage of the GPU; see also:
    // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas#scaling_canvas_using_css_transforms
    this.d3el.select('canvas')
      .style('transform-origin', '0px 0px')
      .style('transform', `scale(${chartShape.zoomFactor}, 1)`)
      .style('left', `${chartShape.leftOffset}px`);

    // Update the eventCapturer rect
    this.d3el.select('.eventCapturer')
      .attr('width', chartShape.chartWidth)
      .attr('height', chartShape.chartHeight);

    // Update the size of the foreignObject
    this.d3el.select('foreignObject')
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

    // Link the y axis position to the foreignObject
    // (should do nothing for subclasses that don't scroll vertically)
    const yOffset = this.d3el.select('foreignObject').node().scrollTop;
    this.d3el.select('.yAxis').attr('transform', `translate(0,${-yOffset})`);

    // Update the clipPath position and dimensions
    this.d3el.select('clipPath rect')
      .attr('x', -this.margin.left)
      .attr('y', yOffset)
      .attr('width', chartShape.chartWidth + this.margin.left)
      .attr('height', chartShape.chartHeight);

    // Update .yAxisScrollCapturer
    // (also irrelevant for subclasses that don't scroll vertically)
    this.d3el.select('.yAxisScrollCapturer')
      .attr('x', -this.margin.left)
      .attr('width', this.margin.left)
      .attr('height', chartShape.chartHeight);

    // Position the y label
    this.d3el.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize - 12},${chartShape.chartHeight / 2}) rotate(-90)`);
  }

  prepCanvas (chartShape) {
    // We only want to set canvas width / height ATTRIBUTES here, because doing
    // so clears the canvas. In another context (e.g. zooming / panning), we
    // only want to set transform STYLES to scale what we previously drew here)
    this.d3el.select('canvas')
      .attr('width', chartShape.bins)
      .attr('height', chartShape.fullHeight)
      .style('transform-origin', null)
      .style('transform', null);
  }
}

export default ZoomableTimelineView;
