/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';
import SvgViewMixin from "../common/SvgViewMixin.js";

// d3 canvas source reference - https://github.com/xoor-io/d3-canvas-example
class IntervalHistogramView extends CursoredViewMixin(SvgViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/IntervalHistogramView/style.less' },
      { type: 'text', url: 'views/IntervalHistogramView/template.svg' }
    ];
    super(argObj);
    // d3 vars
    this.xScale = d3.scaleLog();// d3.scaleLinear();
    this.yScale = d3.scaleLog();//d3.scaleLinear();

    this.svgElement = null;
    //canvas vars
    this.canvasElement = null;
    this.canvasContext = null;

    this.selectedLocation = '1';
    this.baseOpacity = 0.3;
    this.wasRendered = false;
    this.initialDragState = null;
    this.ClickState = {"background":0, "hover":1, "singleClick":2, "doubleClick":3};
    this.isMouseInside = false;

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `IntervalHistogramView${IntervalHistogramView.DOM_COUNT}`;
    IntervalHistogramView.DOM_COUNT++;
  }
  get isLoading () {
    return super.isLoading || this.linkedState.isLoadingIntervals;
  }
  get isEmpty () {
    return this.error;
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
    this.yScale.domain([maxMin['max'], maxMin['min']+1]).nice();
  }
  getSpilloverWidth(width){
    return width*1;
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

    this.svgElement = this.content.select('.svg-plot');
    this.yScale.domain([10,0]).nice();//remove this later

    // Create a view-specific clipPath id, as there can be more than one
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
        .attr('id', clipId);
    this.content.select('.clippedStuff')
        .attr('clip-path', `url(#${clipId})`);

    this.currentClickState = this.ClickState.background;
    var __self = this;
    // mouse events
    this.canvasElement = this.content.select('.histogram-plot');
        // .on('click', function() {
        //   console.log("clicked");
        // })
        // .on('mouseleave', function () {
        //   __self.isMouseInside = false;
        //   __self.clearAllTimer();
        // })
        // .on('mouseenter',function () {
        //   __self.isMouseInside = true;
        // })
        // .on('mousemove', function() {
        //   __self.clearAllTimer();
        //   if(__self.currentClickState === __self.ClickState.background || __self.currentClickState === __self.ClickState.hover) {
        //     var dm = d3.mouse(__self.content.select('.histogram-container').node());
        //     this._mouseHoverTimeout = window.setTimeout(async () => {
        //       if(__self.isMouseInside === true) {
        //         __self.showDetailsTooltip(dm[0], dm[1]);
        //       }
        //     }, 100);
        //   }
        // })
        // .on('dblclick', function() {
        //   __self.clearAllTimer();
        //   console.log("dbl clicked");
        // });
    this.canvasContext = this.canvasElement.node().getContext('2d');
    var xWindow = [this.linkedState.intervalHistogramBeginLimit, this.linkedState.intervalHistogramEndLimit];
    this.xScale.domain(xWindow).nice();
    this.setupBrush();
    // this.linkedState.on('intervalHistogramUpdated', () => {
    //   // Full render whenever we have new histograms
    //   this.updateTheView();
    // });
  }
  clearAllTimer() {
    if(this._mouseHoverTimeout) {
      window.clearTimeout(this._mouseHoverTimeout);
      this._mouseHoverTimeout = null;
    }
    if(this._mouseClickTimeout) {
      window.clearTimeout(this._mouseClickTimeout);
      this._mouseClickTimeout = null;
    }
  }
  showDetailsTooltip(xx, yy){
    var __self = this;
    var tm = __self.xScale.invert(xx);
    var loc = __self.yScale.invert(yy);
    var dr = __self.canvasElement.node().getBoundingClientRect();
    dr.x = xx + dr.left;
    dr.y = yy + dr.top;

    let intervalDomains = this.linkedState.intervalHistogram;
    var offset = (intervalDomains.metadata.end - intervalDomains.metadata.begin)/ intervalDomains.metadata.bins;
    var ll = (tm - intervalDomains.metadata.begin) / offset;
    var bin = Math.trunc(ll);
    var convertedTime = this.linkedState.getTimeStampFromBin(bin, intervalDomains.metadata);
    var rightBoundary = __self.xScale(convertedTime) + (this.barWidth/2);
    var leftBoundary = __self.xScale(convertedTime) - (this.barWidth/2);
    var val = intervalDomains.data[bin];
    if(bin>0){
      val = val - intervalDomains.data[bin-1];
    }
    if(xx <= rightBoundary && xx >= leftBoundary && val>0){
      var dd = {'Duration': convertedTime, 'Count': val};
      window.controller.tooltip.show({
        content: `<pre>${JSON.stringify(dd, null, 2)}</pre>`,
        targetBounds: dr,
        hideAfterMs: null
      });
      __self.currentClickState = __self.ClickState.hover
    } else {
      window.controller.tooltip.hide();
      __self.currentClickState = __self.ClickState.background;
    }
  }
  updateTheView() {
    var xWindow = [this.linkedState.intervalHistogramBeginLimit, this.linkedState.intervalHistogramEndLimit];
    this.xScale.domain(xWindow).nice();
    this.render();
  }
  draw () {
    super.draw();
    // console.log('draw called ' + this.curMetric);
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

    this.content.select('.histogram-container')
        .attr('width', this.getSpilloverWidth(this._bounds.width))
        .attr('height', this._bounds.height);
        // .attr('transform', `translate(${-this._bounds.width}, 0)`);
    this.canvasElement.attr('width', this.getSpilloverWidth(this._bounds.width))
        .attr('height', this._bounds.height);

    // Update whether we're showing the spinner
    this.drawSpinner();
    // Update the clip rect
    this.drawClip();
    // Hide the small spinner
    this.drawBrush();

    // Update the axes (also updates scales)
    this.drawWrapper();
  }
  drawWrapper() {
    if(this.initialDragState)return;
    var localXScale = this.xScale;

    this._bounds = this.getChartBounds();
    if(this.linkedState.intervalHistogram === null)return;
    const data = this.linkedState.intervalHistogram;

    var maxY = Number.MIN_VALUE;
    var minY = Number.MAX_VALUE;

    for (var i = 0; i < data.data.length; i++) {
      var d = data.data[i];
      if(i>0) {
        d = d - data.data[i-1];
      }
      maxY = Math.max(maxY, d);
      minY = Math.min(minY, d);
    }
    this.setYDomain({'max':maxY, 'min':minY});
    this.drawAxes();

    // Update the lines
    this.canvasContext.clearRect(0, 0, this._bounds.width, this._bounds.height);
    data.data.forEach((d, i) => {
      var x = localXScale(this.linkedState.getTimeStampFromBin(i, data.metadata));
      var ss = 0;
      if(i>0) {
        ss = data.data[i-1];
      }
      var dd = {'x': x, 'y': ((d - ss) + 1)};
      this.drawLines(dd);
    });
    this.wasRendered = true;
  }
  drawLines (d) {
    this.barWidth = 10;
    this.canvasContext.fillStyle = "#D9D9D9";// this.linkedState.selectionColor;
    this.canvasContext.fillRect(d.x - (this.barWidth / 2), this.yScale(d.y), this.barWidth, this._bounds.height - this.yScale(d.y));
    this.canvasContext.strokeRect(d.x - (this.barWidth / 2), this.yScale(d.y), this.barWidth, this._bounds.height - this.yScale(d.y));
  }
  drawSpinner () {
    this.content.select('.small.spinner').style('display', 'none');
  }
  drawClip () {
    this.content.select('clipPath rect')
        .attr('width', this._bounds.width)
        .attr('height', this._bounds.height);
  }
  drawAxes () {
    const bounds = this.getChartBounds();

    var xaxes = d3.axisBottom(this.xScale).ticks(50,",.1s");//number of ticks, tick format
    // Update the x axis
    const xAxisGroup = this.svgElement.select('.xAxis')
        .attr('transform', `translate(0, ${this._bounds.height})`)
        .call(xaxes);
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.svgElement.select('.xAxisLabel')
        .attr('x', this._bounds.width / 2)
        .attr('y', this._bounds.height + this.margin.bottom - this.emSize / 2);

    var yaxes = d3.axisLeft(this.yScale)
        .ticks(10,",.1s");
        // .tickFormat(d3.format(",.0f"))
        // .tickArguments([d3.every(15)]);
    // Update the y axis
    this.svgElement.select('.yAxis')
        .call(yaxes);

    // Position the y label
    this.svgElement.select('.yAxisLabel')
        .attr('transform', `translate(${-1.5 * this.emSize},${bounds.height / 2}) rotate(-90)`);
  }
  setupBrush () {
    let initialState = null;
    const brush = this.content.select('.histogram_brush');
    const brushDrag = d3.drag()
        .on('start', () => {
          // d3.event.sourceEvent.stopPropagation();
          initialState = {
            begin: this.linkedState.intervalHistogramBegin,
            end: this.linkedState.intervalHistogramEnd,
            x: this.xScale.invert(d3.event.x)
          };
        })
        .on('drag', () => {
          let dx = this.xScale.invert(d3.event.x) - initialState.x;
          let begin = initialState.begin + dx;
          let end = initialState.end + dx;
          // clamp to the lowest / highest possible values
          if (begin <= this.linkedState.intervalHistogramBeginLimit) {
            const offset = this.linkedState.intervalHistogramBeginLimit - begin;
            begin += offset;
            end += offset;
          }
          if (end >= this.linkedState.intervalHistogramEndLimit) {
            const offset = end - this.linkedState.intervalHistogramEndLimit;
            begin -= offset;
            end -= offset;
          }
          this.linkedState.setIntervalHistogramWindow({ begin, end });
          // For responsiveness, draw the brush immediately
          // (instead of waiting around for debounced events / server calls)
          this.drawBrush({ begin, end });
        });
    const leftDrag = d3.drag().on('drag', () => {
      // d3.event.sourceEvent.stopPropagation();
      let begin = this.xScale.invert(d3.event.x);
      // clamp to the lowest possible value
      begin = Math.max(begin, this.linkedState.intervalHistogramBeginLimit);
      // clamp to the current upper value minus one
      begin = Math.min(begin, this.linkedState.intervalHistogramEnd - 1);
      this.linkedState.setIntervalHistogramWindow({ begin });
      // For responsiveness, draw the brush immediately
      // (instead of waiting around for debounced events / server calls)
      this.drawBrush({ begin });
    });
    const rightDrag = d3.drag().on('drag', () => {
      // d3.event.sourceEvent.stopPropagation();
      let end = this.xScale.invert(d3.event.x);
      // clamp to the highest possible value
      end = Math.min(end, this.linkedState.intervalHistogramEndLimit);
      // clamp to the current lower value plus one
      end = Math.max(end, this.linkedState.intervalHistogramBegin + 1);
      this.linkedState.setIntervalHistogramWindow({ end });
      // For responsiveness, draw the brush immediately
      // (instead of waiting around for debounced events / server calls)
      this.drawBrush({ end });
    });
    brush.call(brushDrag);
    brush.select('.leftHandle .hoverTarget').call(leftDrag);
    brush.select('.rightHandle .hoverTarget').call(rightDrag);

    // const directDrag = d3.drag()
    //     .on('start', () => {
    //       d3.event.sourceEvent.stopPropagation();
    //       initialState = {
    //         x0: this.xScale.invert(d3.event.x - this.margin.left)
    //       };
    //     })
    //     .on('drag', () => {
    //       let begin = initialState.x0;
    //       let end = this.xScale.invert(d3.event.x - this.margin.left);
    //       // In case we're dragging to the left...
    //       if (end < begin) {
    //         const temp = begin;
    //         begin = end;
    //         end = temp;
    //       }
    //       // clamp to the lowest / highest possible values
    //       begin = Math.max(begin, this.linkedState.intervalHistogramBeginLimit);
    //       end = Math.min(end, this.linkedState.intervalHistogramEndLimit);
    //       this.linkedState.setIntervalHistogramWindow({ begin, end });
    //       // For responsiveness, draw the brush immediately
    //       // (instead of waiting around for debounced events / server calls)
    //       this.drawBrush({ begin, end });
    //     });
    // this.content.select('.chart').call(directDrag);
  }
  drawBrush ({
               begin = this.linkedState.intervalHistogramBegin,
               end = this.linkedState.intervalHistogramEnd
             } = {}) {
    const bounds = this.getChartBounds();
    let x1 = this.xScale(begin);
    const showLeftHandle = x1 >= 0 && x1 <= bounds.width;
    x1 = Math.max(0, x1);
    let x2 = this.xScale(end);
    const showRightHandle = x2 >= 0 && x2 <= bounds.width;
    x2 = Math.min(bounds.width, x2);

    // Ensure at least 1em interactable space for each hoverTarget and the
    // space between them
    const handleWidth = this.emSize;
    let x1Offset = 0;
    let x2Offset = 0;
    if (x2 - x1 < handleWidth) {
      x1Offset = -handleWidth / 2;
      x2Offset = handleWidth / 2;
    }

    const brush = this.content.select('.histogram_brush');
    brush.select('.area')
        .attr('x', x1)
        .attr('y', 0)
        .attr('width', x2 - x1)
        .attr('height', bounds.height);
    brush.select('.top.outline')
        .attr('y1', 0)
        .attr('y2', 0);
    brush.select('.bottom.outline')
        .attr('y1', bounds.height)
        .attr('y2', bounds.height);
    brush.selectAll('.top.outline, .bottom.outline')
        .attr('x1', x1)
        .attr('x2', x2);
    brush.select('.leftHandle')
        .style('display', showLeftHandle);
    brush.select('.rightHandle')
        .style('display', showRightHandle);

    if (showLeftHandle) {
      brush.select('.leftHandle .outline')
          .attr('x1', x1)
          .attr('x2', x1)
          .attr('y1', 0)
          .attr('y2', bounds.height);
      brush.select('.leftHandle .hoverTarget')
          .attr('x', x1 - handleWidth / 2 + x1Offset)
          .attr('width', handleWidth)
          .attr('y', 0)
          .attr('height', bounds.height);
    }

    if (showRightHandle) {
      brush.select('.rightHandle .outline')
          .attr('x1', x2)
          .attr('x2', x2)
          .attr('y1', 0)
          .attr('y2', bounds.height);
      brush.select('.rightHandle .hoverTarget')
          .attr('x', x2 - handleWidth / 2 + x2Offset)
          .attr('width', handleWidth)
          .attr('y', 0)
          .attr('height', bounds.height);
    }
  }
}
IntervalHistogramView.DOM_COUNT = 1;
export default IntervalHistogramView;
