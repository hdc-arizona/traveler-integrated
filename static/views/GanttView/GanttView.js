/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class GanttView extends LinkedMixin(uki.ui.SvgGLView) {
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg', name: 'template' }
    ]);
    super(options);

    this.localXScale = d3.scaleLinear();
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

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `GanttView${GanttView.DOM_COUNT}`;
    GanttView.DOM_COUNT++;

    // Render whenever there's a change to the intervals state
    this.linkedState.on('intervalsUnloaded', () => { this.render(); });
    this.linkedState.on('intervalsLoaded', () => { this.render(); });
  }

// TODO: resume here

  async refreshTrace () {

  }

  getSpilloverWidth (width) {
    return width * 3;
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.html(this.resources[1]);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };
    this.d3el.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Create a view-specific clipPath id, as there can be more than one
    // GanttView in the app
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
      .attr('id', clipId);
    this.content.select('.clippedStuff')
      .attr('clip-path', `url(#${clipId})`);
    this.drawClip();

    // Clear the selection when the user clicks the background
    this.d3el.select('.background')
      .on('click', () => {
        this.linkedState.selection = null;
      });

    // Initialize the scales
    this.localXScale.domain(this.linkedState.detailDomain);
    this.xScale.domain(this.linkedState.detailDomain);
    this.yScale.domain(this.linkedState.info.locationNames);

    // Set up zoom, pan, hover, and click interactions
    this.setupInteractions();

    // Set up listener on the model for domain changes
    this.linkedState.on('detailDomainChanged', () => { this.quickDraw(); });

    // Set up listener on the model for selection changes
    this.linkedState.on('selectionChanged', () => { this.render(); });
  }

  fetchIntervalInfoAndShowTooltip(xx, yy){
      var __self = this;
      var tm = __self.localXScale.invert(xx);
      var loc = __self.yScale.invert(yy);
      //this function will replace the fetching of intervals
      window.clearTimeout(this.intervalFetchTimeout);
      this.intervalFetchTimeout = window.setTimeout(async () => {
          //*****NetworkError on reload is here somewhere******//
          const label = encodeURIComponent(this.linkedState.label);
          var endpt = `/datasets/${label}/getIntervalInfo?timestamp=${Math.floor(tm)}&location=${loc}`;
          fetch(endpt)
              .then((response) => {
                  return response.json();
              })
              .then((data) => {
                  if(data.length > 0) {
                      data[0].enter.metrics = undefined;
                      data[0].leave.metrics = undefined;
                      data[0].intervalId = undefined;
                      data[0].lastParentInterval = undefined;
                      var dr = __self.canvasElement.node().getBoundingClientRect();
                      dr.x = xx - __self._bounds.width + 100;
                      dr.y = yy;

                      window.controller.tooltip.show({
                          content: `<pre>${JSON.stringify(data[0], null, 2)}</pre>`,
                          targetBounds: dr,
                          hideAfterMs: null
                      });
                      __self.currentClickState = __self.ClickState.doubleClick;
                  } else {
                      __self.currentClickState = __self.ClickState.background;
                      window.controller.tooltip.hide();
                  }
              })
              .catch(err => {
                  err.text.then( errorMessage => {
                      console.warn(errorMessage);
                  });
              });
      }, 100);
  }
  fetchIntervalList(xx, yy, mode){
      var __self = this;
      var tm = xx;
      var loc = yy;
      // window.clearTimeout(this.primitiveFetchTimeout); dont clear time out here,
      // we need to call rendering ends in the finally block

      /*
      this.primitiveFetchTimeout = window.setTimeout(async () => {
          const label = encodeURIComponent(this.linkedState.label);
          var begin = this.linkedState.intervalWindow[0];
          var end = this.linkedState.intervalWindow[1];
          var endpt = `/datasets/${label}/getIntervalList?`;
          endpt += `enter=${Math.floor(tm)}&location=${loc}&begin=${Math.floor(begin)}&end=${Math.ceil(end)}&mode=${mode}`;
          endpt += `&primitive=${this.linkedState.selectedPrimitiveHistogram}`;
          if(mode === this.IntervalListMode.duration) {
              endpt += `&leave=${Math.ceil(loc)}`;// loc in location isnt used if mode is duration
          }
          __self.drawHighlightedBars(mode);
        })
        .catch(err => {
          err.text.then(errorMessage => {
            console.warn(errorMessage);
          });
        }).finally(() => {
          __self.intervalRenderingEnds();
        });
    }, 100);
      */
  }
  fetchIntervalTraceList(){
      var __self = this;
      if(__self.selectedTimestamp === null || __self.selectedLocation === null)return;
      var tm = __self.selectedTimestamp;
      var loc = __self.selectedLocation;
      window.clearTimeout(this.intervalTraceListTimeout);
      // we need to call rendering ends in the finally block
      this.intervalTraceListTimeout = window.setTimeout(async () => {
          const label = encodeURIComponent(this.linkedState.label);
          var begin = this.linkedState.intervalWindow[0];
          var end = this.linkedState.intervalWindow[1];
          var endpt = `/datasets/${label}/getIntervalTraceList?`;
          endpt += `enter=${Math.floor(tm)}&location=${loc}&begin=${Math.floor(begin)}&end=${Math.ceil(end)}`;
          fetch(endpt)
              .then((response) => {
                  return response.json();
              })
              .then((data) => {
                  __self.traceBackLines = data;
                  __self.initialDragState = null;
                  __self.render();
                  __self.fetchAndDrawHighlightedBars(__self.selectedTimestamp, __self.selectedLocation, __self.IntervalListMode.primitive);
              })
              .catch(err => {
                  err.text.then( errorMessage => {
                      console.warn(errorMessage);
                  });
              }).finally(() => {
                  // __self.intervalRenderingEnds();
          });
      }, 100);
  }


  /**
   * Function that is called immediately to update GanttView in response to
   * interactions like zooming and panning; only fast drawing operations
   * should happen here
   */
  quickDraw () {
    // Update the x scales
    this.xScale.domain(this.linkedState.detailDomain);
    // Update the axes
    this.drawAxes();
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isHidden) {
      return;
    } else if (this.isEmpty) {
      if (this.error) {
        this.emptyStateDiv.html('<p>Error communicating with the server</p>');
      } else if (this.linkedState.tooManyIntervals) {
        this.emptyStateDiv.html('<p>Too much data; scroll to zoom in</p>');
      } else {
        this.emptyStateDiv.html('<p>No data in the current view</p>');
      }
    }

    // Update the dimensions of the plot in case we were resized
    // (window.getBoundingClientRect() is semi-expensive, so we DON'T update
    // this during incremental / immediate draw calls in setup()'s listeners or
    // zooming / panning that need more responsiveness)
    this._bounds = this.getChartBounds();
    // this.linkedState.setGanttXResolution(this.getSpilloverWidth(this._bounds.width));

    // Update whether we're showing the spinner
    this.drawSpinner();
    // Update the clip rect
    this.drawClip();
    // Update the axes (also updates scales)
    this.drawAxes();

    // Update the bars
    this.drawBarsCanvas(this.linkedState.getCurrentGanttAggregrateBins());
    this.drawTraceLines();
  }

  drawSpinner () {
    this.content.select('.small.spinner').style('display', this.isLoading ? null : 'none');
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
      .text(d => {
          var a = BigInt(d);
          var c = BigInt(32);
          var node = BigInt(a >> c);
          var thread = (d & 0x0FFFFFFFF);
          var aggText = "";
          aggText += node + " - T";
          aggText += thread;
          return aggText;
      });

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize-12},${this._bounds.height / 2}) rotate(-90)`);
  }

  drawBarsCanvas (aggBins) {
    this.highlightedData = null;
    var border = 1;
    this.localXScale.domain(this.xScale.domain());
    this.localXScale.range([this._bounds.width, this.getSpilloverWidth(this._bounds.width) - this._bounds.width]);

    /** *** DONT FORGET TO ADD FLAG FOR IF USING NATIVE OR OVERLOADED VIEW SCALE****/

    // we need a canvas already
    // first we focus on moving canvas to the correct place

    if (!this.initialDragState) {
      this.content.select('.canvas-container')
        .attr('width', this.getSpilloverWidth(this._bounds.width))
        .attr('height', this._bounds.height)
        .attr('transform', `translate(${-this._bounds.width}, 0)`);

      this.canvasElement
        .attr('width', this.getSpilloverWidth(this._bounds.width))
        .attr('height', this._bounds.height);

      var ctx = this.canvasElement.node().getContext('2d');

      ctx.clearRect(0, 0, this.getSpilloverWidth(this._bounds.width), this._bounds.height);

      for (var location in aggBins.data) {
        var loc_offset = this.yScale(parseInt(aggBins.data[location].location));
        for (var bucket in aggBins.data[location].histogram) {
          var bucket_pix_offset = this.localXScale(this.linkedState.getTimeStampFromBin(bucket, aggBins.metadata));
          var pixel = aggBins.data[location].histogram[bucket];
          if (pixel === 1) {
            ctx.fillStyle = this.linkedState.contentBorderColor;
            ctx.fillRect(bucket_pix_offset, loc_offset, 1, border);
            ctx.fillRect(bucket_pix_offset, (loc_offset - border) + this.yScale.bandwidth(), 1, border);
            ctx.fillStyle = this.linkedState.contentFillColor;
            ctx.rect(bucket_pix_offset, loc_offset + border, 1, this.yScale.bandwidth() - (2 * border));
          }
          if (pixel < 1 && pixel > 0) {
            ctx.fillStyle = this.linkedState.contentBorderColor;
            ctx.fillRect(bucket_pix_offset, loc_offset, border, this.yScale.bandwidth());
          }
        }
      }

      ctx.fillStyle = this.linkedState.contentFillColor;
      ctx.fill();
      this.visibleAggBinsMetadata = aggBins.metadata;
    }
    this.ctx = ctx;
    this.wasRerendered = true;
  }
/*
        ctx.clearRect(0, 0,  this.getSpilloverWidth(this._bounds.width), this._bounds.height);
        for (var location in aggBins.data){
          var loc_offset = this.yScale(parseInt(aggBins.data[location].location));
          for (var bucket in aggBins.data[location].histogram){
*/
  drawHighlightedBars (mode) {
    if (this.highlightedData) {
      var border = 1;
      var fillColor = this.linkedState.contentFillColor;
      var borderColor = this.linkedState.contentBorderColor;
      if (mode === this.IntervalListMode.guid) {
        fillColor = this.linkedState.mouseHoverSelectionColor;
      } else if (mode === this.IntervalListMode.primitive) {
        fillColor = this.linkedState.selectionColor;
      } else if (mode === this.IntervalListMode.duration) {
        fillColor = this.linkedState.selectionColor;
      }
      var ctx = this.canvasElement.node().getContext('2d');
      var bins = this.getSpilloverWidth(this._bounds.width);
      var notDrawn = true;
      for (var loc in this.highlightedData) {
        var loc_offset = this.yScale(parseInt(loc));
        if (this.highlightedData[loc].length === 0) continue;
        notDrawn = false;
        for (var i = 0; i < bins; i++) {
          var thisTime = this.linkedState.getTimeStampFromBin(i, this.visibleAggBinsMetadata);
          var bucket_pix_offset = this.localXScale(thisTime);
          for (var elm in this.highlightedData[loc]) {
            if (thisTime >= this.highlightedData[loc][elm].enter && thisTime <= this.highlightedData[loc][elm].leave) {
              ctx.fillStyle = borderColor;
              ctx.fillRect(bucket_pix_offset, loc_offset, 1, border);
              ctx.fillRect(bucket_pix_offset, (loc_offset - border) + this.yScale.bandwidth(), 1, border);

              ctx.fillStyle = fillColor;
              ctx.fillRect(bucket_pix_offset, loc_offset + border, 1, this.yScale.bandwidth() - (2 * border));
              break;
            }
            if (thisTime < this.highlightedData[loc][elm].enter) {
              break;
            }
          }
        }
      }
      if (notDrawn) {
        this.currentClickState = this.ClickState.background;
      }
    }
  }
  fetchAndDrawHighlightedBars(x, y, mode) {
      if((this.linkedState.end - this.linkedState.begin) > 20000000) {
          return;
      }
      if(this.intervalRenderingBegins(x, y, mode) === true) return;
      this.drawHighlightedBars(this.IntervalListMode.all);
      this.fetchIntervalList(x, y, mode);
  }
  drawHighlightedBars(mode) {
      if(this.highlightedData) {
          var border = 1;
          var fillColor = this.linkedState.contentFillColor;
          var borderColor = this.linkedState.contentBorderColor;
          if (mode === this.IntervalListMode.guid) {
              fillColor = this.linkedState.mouseHoverSelectionColor;
          } else if (mode === this.IntervalListMode.primitive) {
              fillColor = this.linkedState.selectionColor;
          } else if (mode === this.IntervalListMode.duration) {
              fillColor = this.linkedState.selectionColor;
          }
          var ctx = this.canvasElement.node().getContext("2d");
          var bins = this.getSpilloverWidth(this._bounds.width);
          var notDrawn = true;
          for (var loc in this.highlightedData) {
              var loc_offset = this.yScale(parseInt(loc));
              if (this.highlightedData[loc].length === 0) continue;
              notDrawn = false;
              for (var i = 0; i < bins; i++) {
                  var thisTime = this.linkedState.getTimeStampFromBin(i, this.visibleAggBinsMetadata);
                  var bucket_pix_offset = this.localXScale(thisTime);
                  for (var elm in this.highlightedData[loc]) {
                      if (thisTime >= this.highlightedData[loc][elm]['enter'] && thisTime <= this.highlightedData[loc][elm]['leave']) {
                          ctx.fillStyle = borderColor;
                          ctx.fillRect(bucket_pix_offset, loc_offset, 1, border);
                          ctx.fillRect(bucket_pix_offset, (loc_offset - border) + this.yScale.bandwidth(), 1, border);

                          ctx.fillStyle = fillColor;
                          ctx.fillRect(bucket_pix_offset, loc_offset + border, 1, this.yScale.bandwidth() - (2 * border));
                          break;
                      }
                      if (thisTime < this.highlightedData[loc][elm]['enter']) {
                          break;
                      }
                  }
              }
          }
          if (notDrawn) {
              this.currentClickState = this.ClickState.background;
          }
          if(mode === this.IntervalListMode.all) {
              this.highlightedData = null;
          }
      }
  }
  getMiddlePointInYScale(point) {
      var p = (this.yScale(point) + this.yScale(point+1)) / 2.0;
      return Math.floor(p);
  }
  drawTraceLines(){
      var ctx = this.canvasElement.node().getContext("2d");
      if(this.traceBackLines === null || !this.traceBackLines.length){
          this.traceBackLines = null;
      } else {
          this.traceBackLines.forEach((line) => {
              if(line.type === "middle") {
                  ctx.beginPath();
                  ctx.moveTo(this.localXScale(line.left_timestamp), this.getMiddlePointInYScale(parseInt(line.left_location)));
                  ctx.lineTo(this.localXScale(line.right_timestamp), this.getMiddlePointInYScale(parseInt(line.right_location)));
                  ctx.lineWidth = 1;
                  // ctx.strokeStyle = '#ff0000';
                  ctx.stroke();
              }
          });
      }
  }

  setupInteractions () {
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
        this.initialDragState = null;
        const zoomFactor = 1.05 ** (normalizeWheel(d3.event).pixelY / 100);
        const originalWidth = this.linkedState.end - this.linkedState.begin;
        // Clamp the width to a min of 10ms, and the largest possible size
        let targetWidth = Math.max(zoomFactor * originalWidth, 10);
        targetWidth = Math.min(targetWidth, this.linkedState.endLimit - this.linkedState.beginLimit);
        // Compute the new begin / end points, centered on where the user is mousing

        /** **** HACK AND FIX ALSO
                I need to tie 1 width to an clear value which is realted to the size of our overflow ******/
        const overflowAdjustedMousedScreenPont = d3.event.clientX - this._bounds.left - this.margin.left + this._bounds.width;
        /** ***** HACK FIX ********/

        const mousedScreenPoint = d3.event.clientX - this._bounds.left - this.margin.left;
        const mousedPosition = this.xScale.invert(mousedScreenPoint);
        const begin = mousedPosition - (targetWidth / originalWidth) * (mousedPosition - this.linkedState.begin);
        const end = mousedPosition + (targetWidth / originalWidth) * (this.linkedState.end - mousedPosition);
        const actualBounds = clampWindow(begin, end);

        // For responsiveness, draw the axes immediately
        this.drawAxes();

        // Patch a temporary scale transform to the bars / links layers (this
        // gets removed by full drawBars() / drawLinks() calls)

        latentWidth = originalWidth;
        const actualZoomFactor = latentWidth / ((actualBounds.end - actualBounds.begin));
        const zoomCenter = (1 - actualZoomFactor) * overflowAdjustedMousedScreenPont;

        // There isn't a begin / end wheel event, so trigger the update across
        // views immediately
        // window.clearTimeout(this._incrementalIntervalTimeout);
        // this._incrementalIntervalTimeout = window.setTimeout(() => {

        var ctx = this.canvasElement.node().getContext('2d');

        var buffer = document.createElement('CANVAS');
        buffer.height = this.canvasElement.attr('height');
        buffer.width = this.canvasElement.attr('width');

        this.buff = buffer.getContext('2d');
        this.buff.drawImage(ctx.canvas, 0, 0);

        ctx.save();
        ctx.clearRect(0, 0, this.getSpilloverWidth(this._bounds.width), this._bounds.height);
        ctx.translate(zoomCenter, 0);
        ctx.scale(actualZoomFactor, 1);
        ctx.drawImage(this.buff.canvas, 0, 0);
        ctx.restore();

        this.linkedState.setIntervalWindow(actualBounds);

        // Show the small spinner to indicate that some of the stuff the user
        // sees may be inaccurate (will be hidden once the full draw() call
        // happens)
        this.content.select('.small.spinner').style('display', null);
        this.currentClickState = this.ClickState.background;
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
          if (this.wasRerendered === true) {
            this.initialDragState = {
              begin: this.linkedState.begin,
              end: this.linkedState.end,
              x: this.xScale.invert(d3.event.x),
              scale: d3.scaleLinear()
                .domain(this.xScale.domain())
                .range(this.xScale.range())
            };

            var ctx = this.canvasElement.node().getContext('2d');

            var buffer = document.createElement('CANVAS');
            buffer.height = this.canvasElement.attr('height');
            buffer.width = this.canvasElement.attr('width');

            this.buff = buffer.getContext('2d');
            this.buff.drawImage(ctx.canvas, 0, 0);

            this.wasRerendered = false;
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

          var ctx = this.canvasElement.node().getContext('2d');

          ctx.save();
          ctx.clearRect(0, 0, this.getSpilloverWidth(this._bounds.width), this._bounds.height);
          ctx.translate(shift, 0);
          ctx.drawImage(this.buff.canvas, 0, 0);
          ctx.restore();

          // Show the small spinner to indicate that some of the stuff the user
          // sees may be inaccurate (will be hidden once the full draw() call
          // happens)
          this.content.select('.small.spinner').style('display', null);

          // d3's drag behavior captures + prevents updating the cursor, so do
          // that manually
          this.linkedState.moveCursor(mousedPosition);
          this.updateCursor();
          this.linkedState.setIntervalWindow(clampWindow(begin, end));
        })
        .on('end', () => {
          const dx = this.initialDragState.x - this.initialDragState.scale.invert(d3.event.x);
          if(dx !== 0) {
              const begin = this.initialDragState.begin + dx;
              const end = this.initialDragState.end + dx;
              this.initialDragState = null;
              this.buff = null;

              this.linkedState.setIntervalWindow(clampWindow(begin, end));
              this.currentClickState = this.ClickState.background;
              this.fetchIntervalTraceList();
          }
        }));
  }
}
GanttView.DOM_COUNT = 1;
export default GanttView;
