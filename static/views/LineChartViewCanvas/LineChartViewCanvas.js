/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';
import CanvasViewMixin from "../common/CanvasViewMixin.js";
import SvgViewMixin from "../common/SvgViewMixin.js";

// d3 canvas source reference - https://github.com/xoor-io/d3-canvas-example
class LineChartViewCanvas extends CursoredViewMixin(CanvasViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/LineChartViewCanvas/style.less' },
      { type: 'text', url: 'views/LineChartViewCanvas/template.svg' }
    ];
    super(argObj);
    // d3 vars
    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleLinear();

    this.svgElement = null;
    //canvas vars
    this.canvasElement = null;
    this.canvasContext = null;

    this.stream = null;
    this.cache = {};
    this.newCache = null;
    this.metricValueCount = 0;
    this.isMetricLoading = false;
    this.hoverIndex = -1;
    this.curMetric = 'PAPI_TOT_INS';
    if(this.linkedState.selectedProcMetric.startsWith('PAPI')) {
      this.curMetric = this.linkedState.selectedProcMetric;
    }
    this.selectedLocation = '1';
    this.baseOpacity = 0.3;

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `LineChartViewCanvas${LineChartViewCanvas.DOM_COUNT}`;
    LineChartViewCanvas.DOM_COUNT++;
  }
  get isLoading () {
    return super.isLoading || this.linkedState.isLoadingIntervals;
  }
  get isEmpty () {
    return this.error || this.linkedState.loadedIntervalCount === 0;
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
  setYDomain(maxMin) {
    var yOffset = (maxMin['max'] - maxMin['min']) / 10;
    this.yScale.domain([maxMin['max'] + yOffset, maxMin['min'] - yOffset]);
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
    this._bounds = this.getChartBounds();
    this.content.select('.chart')
        .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    console.log("setup called");
    this.svgElement = this.content.select('.svg-plot');
    this.canvasElement = this.content.select('.canvas-plot');
    this.canvasContext = this.canvasElement.node().getContext('2d');

    // // Create a view-specific clipPath id, as there can be more than one
    // // LineChartViewCanvas in the app
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
        .attr('id', clipId);
    this.content.select('.clippedStuff')
        .attr('clip-path', `url(#${clipId})`);
    // this.drawClip();
    this.content.select('.background')
        .on('click', () => {
          this.selectedLocation = -1;
        });

    var __self = this;
    this.setupZoomAndPan();
    // // Update scales whenever something changes the brush
    this.linkedState.on('newIntervalWindow', () => {
      __self.updateTheView();
    });
    this.updateTheView();
  }
  updateTheView() {
    this.getData();
    this.xScale.domain(this.linkedState.intervalWindow);
  }
  getData () {
    // Debounce the start of this expensive process...
    // (but flag that we're loading)
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.layoutState.label);
      // const intervalWindow = this.linkedState.intervalWindow;
      const self = this;
      this.newCache = {};
      this.waitingOnIncrementalRender = false;
      var maxY = Number.MIN_VALUE;
      var minY = Number.MAX_VALUE;
      this.metricValueCount = 0;
      // const currentStream = this.stream = oboe(`/datasets/${label}/procMetrics/${this.curMetric}`)
      var begin = Math.floor(this.linkedState.intervalWindow[0]);
      var end = Math.ceil(this.linkedState.intervalWindow[1]);
      const currentStream = this.stream = oboe(`/datasets/${label}/newMetricData?bins=1000&location=1&metric_type=${this.curMetric}&begin=${begin}&end=${end}`)
          .fail(error => {
            this.metricValueCount = 0;
            this.error = error;
            // console.log(error);
          })
          .node('!.*', function (metricList) {
            if (currentStream !== self.stream) {
              // A different stream has been started; abort this one
              this.abort();
            } else {
              self.isMetricLoading = true;
              var val = metricList[2];
              self.newCache[metricList[1]] = val;
              maxY = Math.max(maxY, val);
              minY = Math.min(minY, val);
              self.metricValueCount++;
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
            this.isMetricLoading = false;
            // console.log("cache for proc metric loaded: " + self.metricValueCount);
            self.setYDomain({'max':maxY, 'min':minY});
            this.render();
          });
      self.setYDomain({'max':maxY, 'min':minY});
      this.render();
    }, 100);
  }
  draw () {
    super.draw();
    console.log("draw called");

    // this.canvasContext.fillStyle = 'green';
    // this.canvasContext.fillRect(0, 0, 80, 80);
    if (this.isHidden) {
      return;
    } else if (this.isEmpty) {
      if (this.error) {
        this.emptyStateDiv.html(`<p>Error communicating with the server</p>`);
        return;
      }
      // else if (this.linkedState.tooManyIntervals) {
      //   this.emptyStateDiv.html('<p>No data in the current view</p>');
      // } else {
      //   this.emptyStateDiv.html('<p>Too much data; scroll to zoom in</p>');
      // }
    }
    // Update the dimensions of the plot in case we were resized (NOT updated by
    // immediately-drawn things like drawAxes that get executed repeatedly by
    // scrolling / panning)
    this._bounds = this.getChartBounds();
    this.canvasElement.attr('width', this._bounds.width)
        .attr('height', this._bounds.height)
        .style('margin-left', this.margin.left + 'px')
        .style('margin-top', this.margin.top + 'px');
    // Update whether we're showing the spinner
    // this.drawSpinner();
    // Update the clip rect
    this.drawClip();


    // Combine old data with any new data that's streaming in
    const data = d3.entries(Object.assign({}, this.cache, this.newCache || {}));
    // Hide the small spinner

    // Update the axes (also updates scales)
    this.drawAxes();
    // Update the lines
    this.canvasContext.clearRect(0, 0, this._bounds.width, this._bounds.height);
    data.forEach((d, i) => {
      var preD = d;
      if(i>0) {
        preD = data[i-1];
      }
      this.drawLines(d, preD);
    });
    // this.drawLines(data);
    // this.drawSpinner();
  }
  drawSpinner () {
    this.content.select('.small.spinner').style('display', this.isMetricLoading ? null : 'none');
  }
  drawClip () {
    this.content.select('clipPath rect')
      .attr('width', this._bounds.width)
      .attr('height', this._bounds.height);
  }
  drawAxes () {
    const bounds = this.getChartBounds();
    // Update the x axis
    const xAxisGroup = this.svgElement.select('.xAxis')
      .attr('transform', `translate(0, ${this._bounds.height})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.svgElement.select('.xAxisLabel')
      .attr('x', this._bounds.width / 2)
      .attr('y', this._bounds.height + this.margin.bottom - this.emSize / 2);

    // Update the y axis
    this.svgElement.select('.yAxis')
      .call(d3.axisLeft(this.yScale));

    // Position the y label
    this.svgElement.select('.yAxisLabel')
      .attr('transform', `translate(${-1.5 * this.emSize},${bounds.height / 2}) rotate(-90)`);
  }
  drawLines (d, preD) {
    // this.canvasContext.beginPath();
    // this.canvasContext.arc(this.xScale(d.key), this.yScale(d.value), 1, 0, 2 * Math.PI, false);
    // this.canvasContext.closePath();
    // this.canvasContext.fillStyle = 'black';
    // this.canvasContext.fill();

    this.canvasContext.beginPath();
    this.canvasContext.strokeStyle = 'black';
    this.canvasContext.moveTo(this.xScale(preD.key), this.yScale(preD.value));
    this.canvasContext.lineTo(this.xScale(d.key), this.yScale(d.value));
    this.canvasContext.stroke();
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

        // // Patch a temporary scale transform to the bars / links layers (this
        // // gets removed by full drawBars() / drawLinks() calls)
        // if (!this.content.select('.dots').attr('transform')) {
        //   latentWidth = originalWidth;
        // }
        // const actualZoomFactor = latentWidth / (actualBounds.end - actualBounds.begin);
        // const zoomCenter = (1 - actualZoomFactor) * mousedScreenPoint;
        // this.content.selectAll('.dots, .lines')
        //   .attr('transform', `translate(${zoomCenter}, 0) scale(${actualZoomFactor}, 1)`);
        // // Show the small spinner to indicate that some of the stuff the user
        // // sees may be inaccurate (will be hidden once the full draw() call
        // // happens)
        // this.content.select('.small.spinner').style('display', null);
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
          // this.content.selectAll('.dots, .lines')
          //   .attr('transform', `translate(${shift}, 0)`);
          //
          // // Show the small spinner to indicate that some of the stuff the user
          // // sees may be inaccurate (will be hidden once the full draw() call
          // // happens)
          // this.content.select('.small.spinner').style('display', null);

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
LineChartViewCanvas.DOM_COUNT = 1;
export default LineChartViewCanvas;
