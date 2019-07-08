/* globals d3, oboe */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import { Map, Set } from '../../node_modules/immutable/dist/immutable.es.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class GanttView extends CursoredViewMixin(SvgViewMixin(SingleDatasetMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg' }
    ];
    super(argObj);
    this.xScale = d3.scaleLinear().clamp(true);
    this.yScale = d3.scaleBand()
      .paddingInner(0.2)
      .paddingOuter(0.1);

    this.stream = null;
    this.cache = new Set();
    this.newCache = null;
    this.intervalCount = 0;

    // Don't bother drawing bars if there are more than 500 visible intervals
    this.renderCutoff = 500;

    // Override uki's default .1 second debouncing of render() because we want
    // to throttle incremental updates to at most once per second
    this.debounceWait = 1000;
  }
  getData () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.layoutState.label);
      const intervalWindow = this.linkedState.intervalWindow;
      const self = this;
      // First check whether we're asking for too much data by getting a
      // histogram with a single bin (TODO: draw per-location histograms instead
      // of just saying "Scroll or reverse-pinch to zoom in?")
      this.histogram = await d3.json(`/datasets/${label}/histogram?bins=1&begin=${intervalWindow[0]}&end=${intervalWindow[1]}`);
      this.intervalCount = this.histogram[0][2];
      if (this.isEmpty) {
        // Empty out whatever we were looking at before and bail immediately
        this.cache = new Set();
        this.render();
        return;
      }

      // Okay, start the stream, and collect it in a separate cache to avoid
      // old intervals from disappearing from incremental refreshes
      this.newCache = new Set();
      this.waitingOnIncrementalRender = false;
      const currentStream = this.stream = oboe(`/datasets/${label}/intervals?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`)
        .node('!.*', function (chunk) {
          if (currentStream !== self.stream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            self.newCache = self.newCache.add(new Map(chunk));
            if (!self.waitingOnIncrementalRender) {
              // self.render() is debounced; this converts it to throttling,
              // rate-limiting incremental refreshes by this.debounceWait
              self.render();
              self.waitingOnIncrementalRender = true;
            }
          }
        })
        .done(() => {
          this.stream = null;
          this.cache = this.newCache;
          this.newCache = null;
          this.render();
        });
      this.render();
    }, 100);
  }
  get isLoading () {
    return super.isLoading || this.stream !== null;
  }
  get isEmpty () {
    return this.intervalCount === 0 || this.intervalCount > this.renderCutoff;
  }
  getChartBounds () {
    const bounds = this.getAvailableSpace();
    const result = {
      width: bounds.width - this.margin.left - this.margin.right,
      height: bounds.height - this.margin.top - this.margin.bottom,
      left: bounds.left + this.margin.left,
      top: bounds.top + this.margin.top,
      right: bounds.right - this.margin.right,
      bottom: bounds.bottom - this.margin.bottom
    };
    this.xScale.range([0, result.width]);
    this.yScale.range([0, result.height]);
    return result;
  }
  setup () {
    super.setup();

    this.content.html(this.resources[1]);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };
    this.content.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Set up zoom / pan interactions
    this.setupZoom();

    // Update scales whenever something changes the brush
    this.linkedState.on('newIntervalWindow', () => {
      this.xScale.domain(this.linkedState.intervalWindow);
      this.yScale.domain(this.linkedState.metadata.locationNames);
      // Abort + re-start the stream
      this.getData();
    });
    // Initialize the scales / stream
    this.xScale.domain(this.linkedState.intervalWindow);
    this.yScale.domain(this.linkedState.metadata.locationNames);
    this.getData();
  }
  draw () {
    super.draw();

    if (this.isHidden) {
      return;
    } else if (this.isEmpty) {
      if (this.intervalCount === 0) {
        this.emptyStateDiv.html('<p>No data to show</p>');
      } else {
        this.emptyStateDiv.html('<p>Scroll or reverse-pinch to zoom in</p>');
      }
    }
    // Combine old data with any new data that's streaming in
    const data = (this.newCache ? this.newCache.union(this.cache) : this.cache).toArray();
    // Update the axes (also updates scales)
    this.drawAxes();
    // Update the bars
    this.drawBars(data);
    // TODO: Update the links
    this.drawLinks(data);

    // Update the incremental flag so that we can call render again if needed
    this.waitingOnIncrementalRender = false;
  }
  drawAxes () {
    const bounds = this.getChartBounds();

    // Update the x axis
    const xAxisGroup = this.content.select('.xAxis')
      .attr('transform', `translate(0, ${bounds.height})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.content.select('.xAxisLabel')
      .attr('x', bounds.width / 2)
      .attr('y', bounds.height + this.margin.bottom - this.emSize / 2);

    // Update the y axis
    let yTicks = this.content.select('.yAxis').selectAll('.tick')
      .data(this.yScale.domain());
    yTicks.exit().remove();
    const yTicksEnter = yTicks.enter().append('g')
      .classed('tick', true);
    yTicks = yTicks.merge(yTicksEnter);

    yTicks.attr('transform', d => `translate(0,${this.yScale(d) + this.yScale.bandwidth() / 2})`);

    const lineOffset = -this.yScale.step() / 2;
    yTicksEnter.append('line');
    yTicks.select('line')
      .attr('x1', 0)
      .attr('x2', bounds.width)
      .attr('y1', lineOffset)
      .attr('y2', lineOffset);

    yTicksEnter.append('text');
    yTicks.select('text')
      .attr('text-anchor', 'end')
      .attr('y', '0.35em')
      .text(d => d);

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize},${bounds.height / 2}) rotate(-90)`);
  }
  drawBars (data) {
    let bars = this.content.select('.bars')
      .selectAll('.bar').data(data, d => d);
    bars.exit().remove();
    const barsEnter = bars.enter().append('g')
      .classed('bar', true);
    bars = bars.merge(barsEnter);

    bars.attr('transform', d => `translate(${this.xScale(d.get('enter').Timestamp)},${this.yScale(d.get('Location'))})`);

    barsEnter.append('rect')
      .classed('area', true);
    barsEnter.append('rect')
      .classed('outline', true);
    bars.selectAll('rect')
      .attr('height', this.yScale.bandwidth())
      .attr('width', d => this.xScale(d.get('leave').Timestamp) - this.xScale(d.get('enter').Timestamp));
  }
  drawLinks (data) {
    // TODO
  }
  setupZoom () {
    // d3's zoom() implementation is a little clunky for 1D use cases / non-SVG
    // events, so we DIY it:

    const background = this.content.select('.background').node();
    let originalDomain = null;
    let firstPointer = null;
    let secondPointer = null;
    let zoomFactor = 1.0;
    // Some helper functions:
    const updateScale = (updateFactor = false) => {
      // First compute the current zoom factor
      let z = zoomFactor;
      if (secondPointer) {
        // Proportion of the distance between where the second point is to where
        // it was, with the first point's current position acting as the anchor
        const originalDistance = Math.sqrt(
          (secondPointer.x0 - secondPointer.firstPointerState.x) ** 2 +
          (secondPointer.y0 - secondPointer.firstPointerState.y) ** 2);
        const currentDistance = Math.sqrt(
          (secondPointer.x1 - firstPointer.x1) ** 2 +
          (secondPointer.y1 - firstPointer.y1) ** 2
        );
        z = z * currentDistance / originalDistance;
        if (updateFactor) {
          zoomFactor = z;
        }
      }
      // Compute how much we need to pan
      const dx = zoomFactor * (firstPointer.x0 - firstPointer.x1);
      // Derive the new domain
      const originalScale = d3.scaleLinear()
        .domain(originalDomain)
        .range(this.xScale.range());
      const moveEndpoint = position => {
        return originalScale.invert(originalScale(position) + dx);
      };
      this.xScale.domain([
        moveEndpoint(this.linkedState.begin),
        moveEndpoint(this.linkedState.end)
      ]);
    };
    const handlers = {
      'down': event => {
        background.setPointerCapture(event.pointerId);
        const x0 = event.clientX;
        const y0 = event.clientY;
        if (!firstPointer) {
          originalDomain = this.xScale.domain();
          firstPointer = { id: event.pointerId, x0, x1: x0, y0, y1: y0 };
        } else if (!secondPointer) {
          const firstPointerState = { x: firstPointer.x1, y: firstPointer.y1 };
          secondPointer = { id: event.pointerId, x0, x1: x0, y0, y1: y0, firstPointerState };
        }
      },
      'move': event => {
        // Only update the axes while the user is panning / zooming
        if (firstPointer && event.pointerId === firstPointer.id) {
          firstPointer.x1 = event.clientX;
          firstPointer.y1 = event.clientY;
          updateScale();
          this.drawAxes();
        } else if (secondPointer && event.pointerId === secondPointer.id) {
          secondPointer.x1 = event.clientX;
          secondPointer.y1 = event.clientY;
          updateScale();
          this.drawAxes();
        }
      },
      'up': event => {
        try {
          background.releasePointerCapture(event.pointerId);
        } catch (e) { if (e.name !== 'InvalidPointerId') { throw e; } }

        if (firstPointer && event.pointerId === firstPointer.id) {
          firstPointer.x1 = event.clientX;
          firstPointer.y1 = event.clientY;
          updateScale();
          originalDomain = null;
          firstPointer = null;
          secondPointer = null;
          // Update the domain for all views that use it (including this one);
          // this should trigger full render() calls in those views
          const newDomain = this.xScale.domain();
          this.linkedState.setIntervalWindow({
            begin: newDomain[0],
            end: newDomain[1]
          });
        } else if (secondPointer && event.pointerId === secondPointer.id) {
          secondPointer.x1 = event.clientX;
          updateScale(true);
          secondPointer = null;
          this.drawAxes();
        }
      }
    };
    // Attach listeners to helper functions:
    for (const [context, handler] of Object.entries(handlers)) {
      background.addEventListener('pointer' + context, handler);
    }
    background.addEventListener('pointercancel', handlers.up);
  }
}
export default GanttView;
