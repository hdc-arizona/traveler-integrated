/* globals d3, oboe */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class LineChartView extends CursoredViewMixin(SvgViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/LineChartView/style.less' },
      { type: 'text', url: 'views/LineChartView/template.svg' }
    ];
    super(argObj);
    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleLinear();

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
    this.uniqueDomId = `LineChartView${LineChartView.DOM_COUNT}`;
    LineChartView.DOM_COUNT++;
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
      const curMetric = 'PAPI_TOT_CYC';
      const curLocation = 1;
      var binSize = 100;
      binSize = parseInt(binSize, 10);
      this.histogram = await d3.json(`/datasets/${label}/metrichistogram?bins=1&metric=${curMetric}&location=${curLocation}&mode=count&begin=${intervalWindow[0]}&end=${intervalWindow[1]}`);
      this.intervalCount = this.histogram[0][2];
      console.log("metric histogram count: " + this.intervalCount);
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
      var maxY = 4;
      const currentStream = this.stream = oboe(`/datasets/${label}/metrices?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`)
      // const currentStream = this.stream = oboe(`/datasets/${label}/metrichistogram?bins=${binSize}&metric=${curMetric}&location=${curLocation}&mode=count&begin=${intervalWindow[0]}&end=${intervalWindow[1]}`)
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
              const inv = d3.entries(interval);
              // console.log(interval);
              // console.log(inv);
              // console.log(inv[0].key + " " + inv[0].value);
              // self.newCache.push(inv[0].key + " " + inv[0].value);
              self.newCache[inv[0].key] = inv[0].value;
              // maxY = Math.max(maxY, inv[0].value);
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
            this.yScale.domain([maxY+1, 0]);
            this.render();
          });
      this.yScale.domain([maxY+1, 0]);
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
    // LineChartView in the app
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
      // this.yScale.domain([200, 100]);
      // Abort + re-start the stream
      this.getData();
    });
    // Initialize the scales / stream
    this.xScale.domain(this.linkedState.intervalWindow);
    // this.yScale.domain([200, 100]);
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

    // if (this.linkedState.selectedIntervalId) {
    //   // This is partial clone code from drawLinks
    //   // Collect only the links in the back-path of the selected IntervalId
    //   // TODO Make me more efficient, this has a lot of passes
    //   let workingId = this.linkedState.selectedIntervalId;
    //   let inView = true;
    //   while (inView) {
    //     let interval = data.find(d => d.value.intervalId === workingId);
    //
    //     // Only continue if interval is found and has a link backwards
    //     if (interval && interval.value.hasOwnProperty('lastParentInterval')) {
    //       interval.value.inTraceBack = true;
    //     } else {
    //       inView = false;
    //       continue;
    //     }
    //
    //     workingId = interval.value.lastParentInterval.id;
    //     // Only continue if previous interval is drawn
    //     if (interval.value.lastParentInterval.endTimestamp < this.xScale.range()[0]) {
    //       inView = false;
    //     }
    //   }
    // } else {
    //   data.map(d => { d.value.inTraceBack = false; return d; });
    // }

    // Update the bars
    this.drawLines(data);
    // Update the links
    // this.drawLinks(data);

    // Update the incremental flag so that we can call render again if needed
    this.waitingOnIncrementalRender = false;
  }
  drawClip () {
    this.content.select('clipPath rect')
        .attr('width', this._bounds.width)
        .attr('height', this._bounds.height);
  }
  drawAxes () {
    const bounds = this.getChartBounds();
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
    this.content.select('.yAxis')
        .call(d3.axisLeft(this.yScale));

    // Position the y label
    this.content.select('.yAxisLabel')
        .attr('transform', `translate(${-1.5 * this.emSize},${bounds.height / 2}) rotate(-90)`);
  }
  drawLines (data) {
    if (!this.initialDragState) {
      // Remove temporarily patched transformations
      this.content.select('.dots').attr('transform', null);
    }

    let cirlces = this.content.select('.dots')
        .selectAll('.dot').data(data, d => d.key);
    cirlces.exit().remove();
    const cirlcesEnter = cirlces.enter().append('circle')
        .classed('dot', true);
    cirlces = cirlces.merge(cirlcesEnter);

    var calcRate = function (d, i) {
      var Xi = 0;
      var Ti  = 0;
      if(i>0) {
        var dd = cirlces.data()[i-1];
        Xi = dd.value;
        Ti = dd.key;
      }
      var Xj = d.value;
      var Tj = d.key;
      var ret = Math.abs(Xj - Xi) / Math.abs(Tj - Ti);

      var Xh = 0;
      var Th = 0;
      if(i>2) {
        var pred = cirlces.data()[i-2];
        Xh = pred.value;
        Th = pred.key;
      }
      ret += Math.abs(Xi - Xh) / Math.abs(Ti - Th);
      return ret;
    };

    var _self = this;
    cirlces.attr('class','dot')
        .attr('cx', d => this.xScale(d.key))
        // .attr('cy', d => this.yScale(d.value))
        .attr('cy', function (d, i) {
          return _self.yScale(calcRate(d, i));
        })
        .attr('r', 2);



    // let lines = this.content.select('.lines')
    //     .selectAll('.line').data(data, d => d.key);
    // lines.exit().remove();
    // const linesEnter = lines.enter().append('line')
    //     .classed('line', true);
    // lines = lines.merge(linesEnter);

    // links.attr('transform', d => `translate(${this.xScale(d.value.lastGuidEndTimestamp)},${this.yScale(d.value.lastGuidLocation)})`);
    // let halfwayOffset = this.yScale.bandwidth() / 2;

    // var _self = this;
    // lines.attr('class','line')
    //     .attr('x1', function(d,i){
    //       if(i>0) {
    //         var prevData = lines.data()[i-1];
    //         return _self.xScale(prevData.key);
    //       }
    //       return _self.xScale(0);
    //     })
    //     .attr('x2', function(d,i){
    //       if(i>0) {
    //         return _self.xScale(d.key);
    //       }
    //       return _self.xScale(0);
    //     })
    //     .attr('y1', function(d,i){
    //       var prevData;
    //       if(i>0) {
    //         prevData = lines.data()[i-1];
    //         return _self.yScale(_self.yScale(calcRate(prevData, i-1)));
    //       }
    //       return _self.yScale(0);
    //     })
    //     .attr('y2', function(d,i){
    //       return _self.yScale(_self.yScale(calcRate(d, i)));
    //     });
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
          if (!this.content.select('.dots').attr('transform')) {
            latentWidth = originalWidth;
          }
          const actualZoomFactor = latentWidth / (actualBounds.end - actualBounds.begin);
          const zoomCenter = (1 - actualZoomFactor) * mousedScreenPoint;
          this.content.selectAll('.dots')
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
          this.content.selectAll('.dots')
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
LineChartView.DOM_COUNT = 1;
export default LineChartView;
