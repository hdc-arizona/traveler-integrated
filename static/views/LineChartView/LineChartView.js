/* globals d3 */
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
    this.curMetric = 'PAPI_TOT_INS';
    this.selectedLocation = '-1';
    this.baseOpacity = 0.3;

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `LineChartView${LineChartView.DOM_COUNT}`;
    LineChartView.DOM_COUNT++;
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

    var __self = this;
    // Set up zoom / pan interactions
    this.setupZoomAndPan();
    this.linkedState.getMaxMinOfMetric(this.curMetric);
    // // Update scales whenever something changes the brush
    this.linkedState.on('newIntervalWindow', () => {
      this.xScale.domain(this.linkedState.intervalWindow);
      // // this.yScale.domain([200, 100]);
      // // Abort + re-start the stream
      // this.getData();
      var maxY = this.linkedState.getMaxMinOfMetric(this.curMetric);
      // console.log('got maxY : ' + maxY);
      this.yScale.domain([maxY + 3, 0]);
      __self.render();
    });
    // // Initialize the scales / stream
    // this.xScale.domain(this.linkedState.intervalWindow);
    // // this.yScale.domain([200, 100]);
    // this.getData();
    //
    // // Draw the axes right away (because we have a longer debounceWait than
    // // normal, there's an initial ugly flash before draw() gets called)
    // this._bounds = this.getChartBounds();
    // this.drawAxes();
    //
    // // Redraw when a new primitive is selected
    // // TODO: can probably do this immediately in a more light-weight way?
    // this.linkedState.on('primitiveSelected', () => { this.render(); });
    //
    // this.content.select('.background')
    //     .on('click', () => {
    //       this.selectedLocation = '-1';
    //       this.render();
    //     });
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
    const data = d3.entries(this.linkedState.getCurrentIntervals());

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
    // console.log('drawing again');
    var _self = this;
    var locationPosition = {};
    var timePosition = {};
    var ratePosition = {};
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
      if (d.value['Location'] in locationPosition) {
        // do nothing
      } else {
        locationPosition[d.value['Location']] = [-1, -1];
      }
      var Xi = 0;
      var Ti = 0;
      if (locationPosition[d.value['Location']][0] > -1) {
        var dd = cirlces.data()[locationPosition[d.value['Location']][0]];
        Xi = dd.value['enter']['metrics'][_self.curMetric];
        Ti = dd.value['enter']['Timestamp'];
      }
      var Xj = d.value['enter']['metrics'][_self.curMetric];
      var Tj = d.value['enter']['Timestamp'];
      if (locationPosition[d.value['Location']][1] === -1 && Xi === Xj) {
        Xi = 0; Ti = 0;
      }
      var ret = Math.abs(Xj - Xi) / Math.abs(Tj - Ti);

      var Xh = 0;
      var Th = 0;
      if (locationPosition[d.value['Location']][1] > -1) {
        var pred = cirlces.data()[locationPosition[d.value['Location']][1]];
        Xh = pred.value['enter']['metrics'][_self.curMetric];
        Th = pred.value['enter']['Timestamp'];
        ret += Math.abs(Xi - Xh) / Math.abs(Ti - Th);
      }
      locationPosition[d.value['Location']][1] = locationPosition[d.value['Location']][0];
      locationPosition[d.value['Location']][0] = i;
      return ret;
    };

    cirlces.attr('class', 'dot')
      .attr('cx', d => this.xScale(d.value['enter']['Timestamp']))
      .attr('cy', function (d, i) {
        return _self.yScale(calcRate(d, i));
      })
      .attr('r', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 5.0;
        }
        return 3.0;
      })
      .style('opacity', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 1.0;
        }
        return _self.baseOpacity;
      });

    locationPosition = {};

    let lines = this.content.select('.lines')
      .selectAll('.line').data(data, d => d.key);
    lines.exit().remove();
    const linesEnter = lines.enter().append('line')
      .classed('line', true);
    lines = lines.merge(linesEnter);

    lines.attr('class', 'line')
      .attr('x1', function (d, i) {
        if (d.value['Location'] in timePosition) {
          var prevData = lines.data()[timePosition[d.value['Location']]];
          timePosition[d.value['Location']] = i;
          return _self.xScale(prevData.value['enter']['Timestamp']);
        } else {
          timePosition[d.value['Location']] = i;
        }
        return _self.xScale(0);
      })
      .attr('y1', function (d, i) {
        if (d.value['Location'] in ratePosition) {
          var prevData = lines.data()[ratePosition[d.value['Location']]];
          var retVal = _self.yScale(calcRate(prevData, ratePosition[d.value['Location']]));
          ratePosition[d.value['Location']] = i;
          return retVal;
        } else {
          ratePosition[d.value['Location']] = i;
        }
        return _self.yScale(0);
      })
      .attr('x2', function (d, i) {
        return _self.xScale(d.value['enter']['Timestamp']);
      })
      .attr('y2', function (d, i) {
        if (i === 0) {
          locationPosition = {};
        }
        return _self.yScale(calcRate(d, i));
      })
      .style('stroke', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 'blue';
        }
        return 'black';
      })
      .style('stroke-width', 3)
      .style('opacity', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 1.0;
        }
        return _self.baseOpacity;
      })
      .on('mouseenter', function (d) {
        window.controller.tooltip.show({
          content: `<pre>${JSON.stringify(d.value, null, 2)}</pre>`,
          targetBounds: this.getBoundingClientRect(),
          hideAfterMs: null
        });
      })
      .on('mouseout', () => {
        window.controller.tooltip.hide();
      })
      .on('click', (d) => {
        this.selectedLocation = d.value['Location'];
        // console.log('clicked ' + this.selectedLocation);
        this.render();
      });
    // .on('mousedown', function(d) {
    //   console.log('mousedown');
    // })
    // .on('mouseup', function(d) {
    //   console.log('mouseup');
    // })
    // lines.select('.line')
    //     .style('opacity', d => {
    //       if (_self.selectedLocation !== '-1' && d.value.location === _self.selectedLocation) {
    //         return 1.0;
    //       }
    //       return 0.1;
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
