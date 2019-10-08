/* globals d3, oboe */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class GanttView extends CursoredViewMixin(SvgViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg' }
    ];
    super(argObj);
    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleBand()
      .paddingInner(0.2)
      .paddingOuter(0.1);

    this.stream = null;
    this.cache = {};
    this.newCache = null;
    this.intervalCount = 0;

    // Don't bother drawing bars if there are more than 10000 visible intervals
    this.renderCutoff = 10000;

    // Override uki's default .1 second debouncing of render() because we want
    // to throttle incremental updates to at most once per second
    this.debounceWait = 1000;

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `GanttView${GanttView.DOM_COUNT}`;
    GanttView.DOM_COUNT++;
  }
  getData () {
    // Debounce the start of this expensive process...
    // (but flag that we're loading)
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.layoutState.label);
      const intervalWindow = this.linkedState.intervalWindow;
      const self = this;
      // First check whether we're asking for too much data by getting a
      // histogram with a single bin (TODO: draw per-location histograms instead
      // of just saying "Too much data; scroll to zoom in?")
      this.histogram = await d3.json(`/datasets/${label}/histogram?bins=1&mode=count&begin=${intervalWindow[0]}&end=${intervalWindow[1]}`);
      this.intervalCount = this.histogram[0][2];
      if (this.isEmpty) {
        // Empty out whatever we were looking at before and bail immediately
        this.stream = null;
        this.cache = {};
        this.newCache = null;
        this.render();
        return;
      }

      // Okay, start the stream, and collect it in a separate cache to avoid
      // old intervals from disappearing from incremental refreshes
      this.newCache = {};
      this.waitingOnIncrementalRender = false;
      const currentStream = this.stream = oboe(`/datasets/${label}/intervals?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`)
        .fail(error => {
          this.error = error;
          console.log(error);
        })
        .node('!.*', function (interval) {
          if (currentStream !== self.stream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            const key = interval.enter.Timestamp + '_' + interval.leave.Timestamp + '_' + interval.Location;
            self.newCache[key] = interval;
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
    return this.error || this.intervalCount === 0 || this.intervalCount > this.renderCutoff;
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

    // Create a view-specific clipPath id, as there can be more than one
    // GanttView in the app
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
      .attr('id', clipId);
    this.content.select('.clippedStuff')
      .attr('clip-path', `url(#${clipId})`);

    // Set up zoom / pan interactions
    this.setupZoomAndPan();

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

    // Draw the axes right away (because we have a longer debounceWait than
    // normal, there's an initial ugly flash before draw() gets called)
    this._bounds = this.getChartBounds();
    this.drawAxes();

    // Redraw when a new primitive is selected
    // TODO: can probably do this immediately in a more light-weight way?
    this.linkedState.on('primitiveSelected', () => { this.render(); });

    this.content.select('.background')
      .on('click', () => {
        this.linkedState.selectPrimitive(null);
	this.linkedState.selectIntervalId(null);
        this.render();
      });
  }
  draw () {
    super.draw();

    if (this.isHidden) {
      return;
    } else if (this.isEmpty) {
      if (this.error) {
        this.emptyStateDiv.html(`<p>Error communicating with the server</p>`);
      } else if (this.intervalCount === 0) {
        this.emptyStateDiv.html('<p>No data in the current view</p>');
      } else {
        this.emptyStateDiv.html('<p>Too much data; scroll to zoom in</p>');
      }
    }
    // Update the dimensions of the plot in case we were resized (NOT updated by
    // immediately-drawn things like drawAxes that get executed repeatedly by
    // scrolling / panning)
    this._bounds = this.getChartBounds();

    // Combine old data with any new data that's streaming in
    const data = d3.entries(Object.assign({}, this.cache, this.newCache || {}));

    // Hide the small spinner
    this.content.select('.small.spinner').style('display', 'none');
    // Update the clip rect
    this.drawClip();
    // Update the axes (also updates scales)
    this.drawAxes();
    // Update the bars
    this.drawBars(data);
    // TODO: Update the links
    this.drawLinks(data);

    // Update the incremental flag so that we can call render again if needed
    this.waitingOnIncrementalRender = false;
  }
  drawClip () {
    this.content.select('clipPath rect')
      .attr('width', this._bounds.width)
      .attr('height', this._bounds.height);
  }
  drawAxes () {
    // Update the x axis
    const xAxisGroup = this.content.select('.xAxis')
      .attr('transform', `translate(0, ${this._bounds.height})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.content.select('.xAxisLabel')
      .attr('x', this._bounds.width / 2)
      .attr('y', this._bounds.height + this.margin.bottom - this.emSize / 2);

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
      .attr('x2', this._bounds.width)
      .attr('y1', lineOffset)
      .attr('y2', lineOffset);

    yTicksEnter.append('text');
    yTicks.select('text')
      .attr('text-anchor', 'end')
      .attr('y', '0.35em')
      .text(d => d);

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize},${this._bounds.height / 2}) rotate(-90)`);
  }
  drawBars (data) {
    if (!this.initialDragState) {
      // Remove temporarily patched transformations
      this.content.select('.bars').attr('transform', null);
    }
    let bars = this.content.select('.bars')
      .selectAll('.bar').data(data, d => d.key);
    bars.exit().remove();
    const barsEnter = bars.enter().append('g')
      .classed('bar', true);
    bars = bars.merge(barsEnter);

    bars.attr('transform', d => `translate(${this.xScale(d.value.enter.Timestamp)},${this.yScale(d.value.Location)})`);

    barsEnter.append('rect')
      .classed('area', true);
    barsEnter.append('rect')
      .classed('outline', true);
    bars.selectAll('rect')
      .attr('height', this.yScale.bandwidth())
      .attr('width', d => this.xScale(d.value.leave.Timestamp) - this.xScale(d.value.enter.Timestamp));

    bars.select('.area')
      .style('fill', d => {
        if (d.value.GUID === this.linkedState.selectedGUID) {
          return this.linkedState.mouseHoverSelectionColor;
        } else if (d.value.Primitive === this.linkedState.selectedPrimitive) {
          return this.linkedState.selectionColor;
        } else {
          return null;
        }
      });

    var _self = this;
    bars.select('.outline')
    // TODO: make this like the area fill
      .style('stroke', d => d.value.Primitive === this.linkedState.selectedPrimitive ? this.linkedState.selectionColor : null);
    bars
      .classed('selected', d => d.value.Primitive === this.linkedState.selectedPrimitive)
      .on('click', d => {
        if (!d.value.Primitive) {
          console.warn(`No (consistent) primitive for interval: ${JSON.stringify(d.value, null, 2)}`);
          if (d.value.enter.Primitive) {
            this.linkedState.selectPrimitive(d.value.enter.Primitive); // Does this ever work? - Kate
          }
        } else {
          this.linkedState.selectPrimitive(d.value.Primitive);
        }
        
	if (!d.value.intervalId) {
          console.warn(`No (consistent) intervalId for interval: ${JSON.stringify(d.value, null, 2)}`);
	  this.linkedState.selectIntervalId(null);
        } else {
          this.linkedState.selectIntervalId(d.value.intervalId);
        }

        this.render();
      }).on('mouseenter', function (d) {
        if (!d.value.GUID) {
          console.warn(`No (consistent) GUID for interval: ${JSON.stringify(d.value, null, 2)}`);
          if (d.value.enter.GUID) {
            _self.linkedState.selectGUID(d.value.enter.GUID);
          }
        } else {
          _self.linkedState.selectGUID(d.value.GUID);
        }
        _self.render();

        window.controller.tooltip.show({
          content: `<pre>${JSON.stringify(d.value, null, 2)}</pre>`,
          targetBounds: this.getBoundingClientRect(),
          hideAfterMs: null
        });
      }).on('mouseleave', () => {
        window.controller.tooltip.hide();
        this.linkedState.selectGUID(null);
        this.render();
      });
  }
  drawLinks (data) {

    if (!this.initialDragState) {
      // Remove temporarily patched transformations
      this.content.select('.links').attr('transform', null);
    }
    let linkData = [];
    if (!this.linkedState.selectedIntervalId) {
      linkData = data.filter(d => d.value.hasOwnProperty('lastParentInterval'));
    } else {
      // Collect only the links in the back-path of the selected IntervalId
      // TODO Make me more efficient, this has a lot of passes
      let workingId = this.linkedState.selectedIntervalId;
      let inView = true;
      while (inView) {
	let interval = data.find( d => d.value.intervalId === workingId );
	
	// Only continue if interval is found and has a link backwards
	if (interval && interval.value.hasOwnProperty('lastParentInterval')) {
	  linkData.push(interval);
	} else {
	  inView = false;
	  continue;
	}

	workingId = interval.value.lastParentInterval.id;
	// Only continue if previous interval is drawn
	if (interval.value.lastParentInterval.endTimestamp < this.xScale.range()[0]) {
          inView = false;
	}
      }      
    }

    let links = this.content.select('.links')
      .selectAll('.link').data(linkData, d => d.key);
    links.exit().remove();
    const linksEnter = links.enter().append('g')
      .classed('link', true);
    links = links.merge(linksEnter);

    // links.attr('transform', d => `translate(${this.xScale(d.value.lastGuidEndTimestamp)},${this.yScale(d.value.lastGuidLocation)})`);
    let halfwayOffset = this.yScale.bandwidth() / 2;

    linksEnter.append('line')
      .classed('line', true);
    links.selectAll('line')
      .attr('x1', d => this.xScale(d.value.lastParentInterval.endTimestamp))
      .attr('x2', d => this.xScale(d.value.enter.Timestamp))
      .attr('y1', d => this.yScale(d.value.lastParentInterval.location) + halfwayOffset)
      .attr('y2', d => this.yScale(d.value.Location) + halfwayOffset);
  }
  setupZoomAndPan () {
    this.initialDragState = null;
    let latentWidth = null;
    const clampWindow = (begin, end) => {
      // clamp to the lowest / highest possible values
      if (begin <= this.linkedState.beginLimit) {
        const offset = this.linkedState.beginLimit - begin;
        begin += offset;
        end += offset;
      }
      if (end >= this.linkedState.endLimit) {
        const offset = end - this.linkedState.endLimit;
        begin -= offset;
        end -= offset;
      }
      return { begin, end };
    };
    this.content
      .on('wheel', () => {
        const zoomFactor = 1.05 ** (normalizeWheel(d3.event).pixelY / 100);
        const originalWidth = this.linkedState.end - this.linkedState.begin;
        // Clamp the width to a min of 10ms, and the largest possible size
        let targetWidth = Math.max(zoomFactor * originalWidth, 10);
        targetWidth = Math.min(targetWidth, this.linkedState.endLimit - this.linkedState.beginLimit);
        // Compute the new begin / end points, centered on where the user is mousing
        const mousedScreenPoint = d3.event.clientX - this._bounds.left - this.margin.left;
        const mousedPosition = this.xScale.invert(mousedScreenPoint);
        const begin = mousedPosition - (targetWidth / originalWidth) * (mousedPosition - this.linkedState.begin);
        const end = mousedPosition + (targetWidth / originalWidth) * (this.linkedState.end - mousedPosition);
        const actualBounds = clampWindow(begin, end);

        // There isn't a begin / end wheel event, so trigger the update across
        // views immediately
        this.linkedState.setIntervalWindow(actualBounds);

        // For responsiveness, draw the axes immediately (the debounced, full
        // render() triggered by changing linkedState may take a while)
        this.drawAxes();

        // Patch a temporary scale transform to the bars / links layers (this
        // gets removed by full drawBars() / drawLinks() calls)
        if (!this.content.select('.bars').attr('transform')) {
          latentWidth = originalWidth;
        }
        const actualZoomFactor = latentWidth / (actualBounds.end - actualBounds.begin);
        const zoomCenter = (1 - actualZoomFactor) * mousedScreenPoint;
        this.content.selectAll('.bars, .links')
          .attr('transform', `translate(${zoomCenter}, 0) scale(${actualZoomFactor}, 1)`);
        // Show the small spinner to indicate that some of the stuff the user
        // sees may be inaccurate (will be hidden once the full draw() call
        // happens)
        this.content.select('.small.spinner').style('display', null);
      }).call(d3.drag()
        .on('start', () => {
          this.initialDragState = {
            begin: this.linkedState.begin,
            end: this.linkedState.end,
            x: this.xScale.invert(d3.event.x),
            scale: d3.scaleLinear()
              .domain(this.xScale.domain())
              .range(this.xScale.range())
          };
        })
        .on('drag', () => {
          const mousedPosition = this.initialDragState.scale.invert(d3.event.x);
          const dx = this.initialDragState.x - mousedPosition;
          const begin = this.initialDragState.begin + dx;
          const end = this.initialDragState.end + dx;
          const actualBounds = clampWindow(begin, end);
          // Don't bother triggering a full update mid-drag...
          // this.linkedState.setIntervalWindow(actualBounds)

          // For responsiveness, draw the axes immediately (the debounced, full
          // render() triggered by changing linkedState may take a while)
          this.drawAxes();

          // Patch a temporary translation to the bars / links layers (this gets
          // removed by full drawBars() / drawLinks() calls)
          const shift = this.initialDragState.scale(this.initialDragState.begin) -
            this.initialDragState.scale(actualBounds.begin);
          this.content.selectAll('.bars, .links')
            .attr('transform', `translate(${shift}, 0)`);

          // Show the small spinner to indicate that some of the stuff the user
          // sees may be inaccurate (will be hidden once the full draw() call
          // happens)
          this.content.select('.small.spinner').style('display', null);

          // d3's drag behavior captures + prevents updating the cursor, so do
          // that manually
          this.linkedState.moveCursor(mousedPosition);
          this.updateCursor();
        })
        .on('end', () => {
          const dx = this.initialDragState.x - this.initialDragState.scale.invert(d3.event.x);
          const begin = this.initialDragState.begin + dx;
          const end = this.initialDragState.end + dx;
          this.initialDragState = null;

          this.linkedState.setIntervalWindow(clampWindow(begin, end));
        }));
  }
}
GanttView.DOM_COUNT = 1;
export default GanttView;
