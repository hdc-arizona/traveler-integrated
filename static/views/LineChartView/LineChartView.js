/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';
import SvgViewMixin from "../common/SvgViewMixin.js";

// d3 canvas source reference - https://github.com/xoor-io/d3-canvas-example
class LineChartView extends CursoredViewMixin(SvgViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/LineChartView/style.less' },
      { type: 'text', url: 'views/LineChartView/template.svg' }
    ];
    super(argObj);
    // d3 vars
    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleLinear();

    this.svgElement = null;
    //canvas vars
    this.canvasElement = null;
    this.canvasContext = null;

    this.curMetric = 'PAPI_TOT_CYC';
    if(this.linkedState.selectedProcMetric.startsWith('PAPI')) {
      this.curMetric = this.linkedState.selectedProcMetric;
    }
    this.selectedLocation = '1';
    this.baseOpacity = 0.3;
    this.isMouseInside = false;
    this.wasRendered = false;
    this.initialDragState = null;

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `LineChartView${LineChartView.DOM_COUNT}`;
    LineChartView.DOM_COUNT++;
  }
  get isLoading () {
    return super.isLoading || this.linkedState.isLoadingIntervals;
  }
  get isEmpty () {
    return this.error || !this.linkedState.isMetricBinsLoaded(this.curMetric);
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
  getSpilloverWidth(width){
    return width*3;
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
    this.linkedState.setMetricXResolution(this.getSpilloverWidth(this._bounds.width));

    this.svgElement = this.content.select('.svg-plot');
    this.canvasElement = this.content.select('.canvas-plot');
    this.canvasContext = this.canvasElement.node().getContext('2d');

    this.yScale.domain([10,0]);//remove this later

    // Create a view-specific clipPath id, as there can be more than one
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
        .attr('id', clipId);
    this.content.select('.clippedStuff')
        .attr('clip-path', `url(#${clipId})`);
    // this.drawClip();
    // this.content.select('.canvas-plot')
    //     .on('click', () => {
    //       console.log("background clicked");
    //     });

    var __self = this;
    this.xScale.domain(this.linkedState.intervalWindow);
    this.drawAxes();
    this.setupZoomAndPan();
    // Update scales whenever something changes the brush
    const justFullRender = () => { __self.updateTheView(); };
    // this.linkedState.on('newIntervalWindow', justFullRender);
    this.linkedState.on('metricsUpdated', justFullRender);
    // this.linkedState.on('primitiveSelected', justFullRender);
    // this.linkedState.on('intervalStreamFinished', justFullRender);
    // this.linkedState.on('tracebackStreamFinished', justFullRender);


    this.canvasElement = this.content.select('.canvas-plot')
        .on('mouseleave', function () {
          __self.isMouseInside = false;
          window.controller.tooltip.hide();
          __self.clearAllTimer();
        })
        .on('mouseenter',function () {
          __self.isMouseInside = true;
        })
        .on('mousemove', function() {
          __self.clearAllTimer();
          var dm = d3.mouse(__self.content.select('.canvas-container').node());
          this._mouseHoverTimeout = window.setTimeout(async () => {
            if(__self.isMouseInside === true) {
              // console.log(dm[0], dm[1]);
              __self.showAggretedInfoTooltip(dm[0], dm[1]);
            }
          }, 100);
        });
  }
  clearAllTimer() {
    if(this._mouseHoverTimeout) {
      window.clearTimeout(this._mouseHoverTimeout);
      this._mouseHoverTimeout = null;
    }
  }
  findBinNumber(t){
    const data = this.linkedState.getCurrentMetricBins(this.curMetric);
    var offset = (data.metadata.end - data.metadata.begin) / data.metadata.bins;
    var bin = (t - data.metadata.begin) / offset;
    var fBin = Math.floor(bin);
    return {max: data.data.max[fBin].toFixed(3),
      avg: data.data.average[fBin].toFixed(3),
      std: data.data.std[fBin].toFixed(3),
      min: data.data.min[fBin].toFixed(3)};
  }

  showAggretedInfoTooltip(xx, yy){
    var __self = this;
    var tm = __self.localXScale.invert(xx);
    var yValue = __self.yScale.invert(yy);
    var dr = __self.canvasElement.node().getBoundingClientRect();
    dr.x = xx - __self._bounds.width + 100;
    var tValue = __self.findBinNumber(tm);
    // console.log(tValue);

    // dr.y = 0;//yy + vBounds.top;
    window.controller.tooltip.hide();
    window.controller.tooltip.show({
      content: `<pre>${JSON.stringify(tValue, null, 2)}</pre>`,
      targetBounds: dr,
      hideAfterMs: null
    });
  }
  updateTheView() {
    // this.getData();
    this.xScale.domain(this.linkedState.intervalWindow);
    this.drawAxes();
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
    // this.linkedState.setMetricXResolution(this.getSpilloverWidth(this._bounds.width));

    this.content.select('.canvas-container')
        .attr('width', this.getSpilloverWidth(this._bounds.width))
        .attr('height', this._bounds.height)
        .attr('transform', `translate(${-this._bounds.width}, 0)`);
    this.canvasElement.attr('width', this.getSpilloverWidth(this._bounds.width))
        .attr('height', this._bounds.height);

    // Update whether we're showing the spinner
    this.drawSpinner();
    // Update the clip rect
    this.drawClip();
    // Hide the small spinner

    // Update the axes (also updates scales)
    this.drawAxes();
    this.drawWrapper();
  }
  drawWrapper() {
    if(this.initialDragState)return;
    this.localXScale = d3.scaleLinear();
    this.localXScale.domain(this.xScale.domain());
    this.localXScale.range([this._bounds.width, this.getSpilloverWidth(this._bounds.width)-this._bounds.width]);

    this._bounds = this.getChartBounds();
    const data = this.linkedState.getCurrentMetricBins(this.curMetric);
    if(data.data === undefined)return;
    var maxY = Number.MIN_VALUE;
    var minY = Number.MAX_VALUE;

    for (var i = 0; i < data.metadata.bins; i++) {
      var t = this.localXScale(this.linkedState.getTimeStampFromBin(i, data.metadata));
      if(t < this._bounds.width) continue;
      if(t > (2*this._bounds.width)) break;
      maxY = Math.max(maxY, data.data.max[i]);
      minY = Math.min(minY, data.data.min[i]);
    }
    this.setYDomain({'max':maxY, 'min':minY});
    this.drawAxes();

    // Update the lines
    this.canvasContext.clearRect(0, 0, this._bounds.width, this._bounds.height);
    for (var i = 0; i < data.metadata.bins; i++) {
      var x = this.localXScale(this.linkedState.getTimeStampFromBin(i, data.metadata));

      var d = data.data.average[i];
      var avgD = {'x': x, 'y': d};
      d = data.data.max[i];
      var dd = {'x': x, 'y': d};
      var preD = dd;
      if(i>0) {
        var xx = this.localXScale(this.linkedState.getTimeStampFromBin(i-1, data.metadata));
        preD = {'x': xx, 'y':data.data.max[i-1]};
      }
      this.drawLines(dd, preD, true);

      d = data.data.min[i];
      dd = {'x': x, 'y': d};
      preD = dd;
      if(i>0) {
        var xx = this.localXScale(this.linkedState.getTimeStampFromBin(i-1, data.metadata));
        preD = {'x': xx, 'y':data.data.min[i-1]};
      }
      this.drawLines(dd, preD, true);

      d = data.data.std[i];
      dd = {'x': x, 'y': avgD.y + d};
      preD = {'x': x, 'y': avgD.y - d};
      this.drawLines(dd, preD, true);


      preD = avgD;
      if(i>0) {
        var xx = this.localXScale(this.linkedState.getTimeStampFromBin(i-1, data.metadata));
        preD = {'x': xx, 'y':data.data.average[i-1]};
      }
      this.drawLines(avgD, preD, false);
    }
    this.wasRendered = true;
  }
  drawLines (d, preD, isGray) {
    this.canvasContext.beginPath();
    this.canvasContext.strokeStyle = 'black';
    if(isGray) {
      this.canvasContext.strokeStyle = 'grey';
    }
    this.canvasContext.moveTo(preD.x, this.yScale(preD.y));
    this.canvasContext.lineTo(d.x, this.yScale(d.y));
    this.canvasContext.stroke();
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

    this.canvasElement
        .on('wheel', () => {

          const zoomFactor = 1.05 ** (normalizeWheel(d3.event).pixelY / 100);
          const originalWidth = this.linkedState.end - this.linkedState.begin;
          // Clamp the width to a min of 10ms, and the largest possible size
          let targetWidth = Math.max(zoomFactor * originalWidth, 10);
          targetWidth = Math.min(targetWidth, this.linkedState.endLimit - this.linkedState.beginLimit);

          const overflowAdjustedMousedScreenPoint = d3.event.clientX - this._bounds.left - this.margin.left + this._bounds.width; //connors hack fix

          // Compute the new begin / end points, centered on where the user is mousing
          const mousedScreenPoint = d3.event.clientX - this._bounds.left - this.margin.left;
          const mousedPosition = this.xScale.invert(mousedScreenPoint);
          const begin = mousedPosition - (targetWidth / originalWidth) * (mousedPosition - this.linkedState.begin);
          const end = mousedPosition + (targetWidth / originalWidth) * (this.linkedState.end - mousedPosition);
          const actualBounds = clampWindow(begin, end);

          // For responsiveness, draw the axes immediately (the debounced, full
          // render() triggered by changing linkedState may take a while)
          this.drawAxes();
          // Patch a temporary scale transform to the bars / links layers (this
          // gets removed by full drawBars() / drawLinks() calls)
          latentWidth = originalWidth;
          const actualZoomFactor = latentWidth / (actualBounds.end - actualBounds.begin);
          const zoomCenter = (1 - actualZoomFactor) * overflowAdjustedMousedScreenPoint;

          var buffer = document.createElement("CANVAS");
          buffer.height = this.canvasElement.attr('height');
          buffer.width = this.canvasElement.attr('width');

          this.buff = buffer.getContext("2d");
          this.buff.drawImage(this.canvasContext.canvas, 0, 0);

          this.canvasContext.save();
          this.canvasContext.clearRect(0, 0,  this.getSpilloverWidth(this._bounds.width), this._bounds.height);
          this.canvasContext.translate(zoomCenter, 0);
          this.canvasContext.scale(actualZoomFactor, 1);
          this.canvasContext.drawImage(this.buff.canvas, 0, 0);
          this.canvasContext.restore();

          this.linkedState.setIntervalWindow(actualBounds);

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
          var buffer = document.createElement("CANVAS");
          buffer.height = this.canvasElement.attr('height');
          buffer.width = this.canvasElement.attr('width');

          this.buff = buffer.getContext("2d");
          this.buff.drawImage(this.canvasContext.canvas, 0, 0);
        })
        .on('drag', () => {
          if(this.wasRendered === true) {
            this.initialDragState = {
              begin: this.linkedState.begin,
              end: this.linkedState.end,
              x: this.xScale.invert(d3.event.x),
              scale: d3.scaleLinear()
                  .domain(this.xScale.domain())
                  .range(this.xScale.range())
            };
            var buffer = document.createElement("CANVAS");
            buffer.height = this.canvasElement.attr('height');
            buffer.width = this.canvasElement.attr('width');

            this.buff = buffer.getContext("2d");
            this.buff.drawImage(this.canvasContext.canvas, 0, 0);
            this.wasRendered = false;
          }

          const mousedPosition = this.initialDragState.scale.invert(d3.event.x);
          const dx = this.initialDragState.x - mousedPosition;
          const begin = this.initialDragState.begin + dx;
          const end = this.initialDragState.end + dx;
          const actualBounds = clampWindow(begin, end);

          // Don't bother triggering a full update mid-drag...
          // For responsiveness, draw the axes immediately (the debounced, full
          // render() triggered by changing linkedState may take a while)
          this.drawAxes();

          // Patch a temporary translation to the bars / links layers (this gets
          // removed by full drawBars() / drawLinks() calls)
          const shift = this.initialDragState.scale(this.initialDragState.begin) -
              this.initialDragState.scale(actualBounds.begin);

          this.canvasContext.save();
          this.canvasContext.clearRect(0, 0,  this.getSpilloverWidth(this._bounds.width), this._bounds.height);
          this.canvasContext.translate(shift, 0);
          this.canvasContext.drawImage(this.buff.canvas, 0, 0);
          this.canvasContext.restore();

          // d3's drag behavior captures + prevents updating the cursor, so do
          // that manually
          this.linkedState.moveCursor(mousedPosition);
          this.updateCursor();
          this.linkedState.setIntervalWindow(clampWindow(begin, end));
        })
        .on('end', () => {
          const dx = this.initialDragState.x - this.initialDragState.scale.invert(d3.event.x);
          const begin = this.initialDragState.begin + dx;
          const end = this.initialDragState.end + dx;
          this.initialDragState = null;
          this.buff = null;

          this.linkedState.setIntervalWindow(clampWindow(begin, end));
        }));
  }
}
LineChartView.DOM_COUNT = 1;
export default LineChartView;
