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

    this.curMetric = 'PAPI_TOT_INS';
    if(this.linkedState.selectedProcMetric.startsWith('PAPI')) {
      this.curMetric = this.linkedState.selectedProcMetric;
    }
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

    // Create a view-specific clipPath id, as there can be more than one
    // LineChartView in the app
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
        .attr('id', clipId);
    this.content.select('.clippedStuff')
        .attr('clip-path', `url(#${clipId})`);
    this.drawClip();
    this.content.select('.background')
        .on('click', () => {
          this.selectedLocation = -1;
        });
    this.xScale.domain(this.linkedState.intervalWindow);
    // this.setYDomain(this.linkedState.getMaxMinOfMetric(this.curMetric));

    var __self = this;
    this.setupZoomAndPan();
    // // Update scales whenever something changes the brush
    this.linkedState.on('newIntervalWindow', () => {
      this.xScale.domain(this.linkedState.intervalWindow);
      this.drawAxes();
      __self.render();
    });
    this.linkedState.on('intervalStreamFinished', () => { __self.render(); });
  }
  draw () {
    super.draw();

    if (this.isHidden) {
      return;
    } else if (this.isEmpty) {
      if (this.error) {
        this.emptyStateDiv.html(`<p>Error communicating with the server</p>`);
      } else if (this.linkedState.tooManyIntervals) {
        this.emptyStateDiv.html('<p>No data in the current view</p>');
      } else {
        this.emptyStateDiv.html('<p>Too much data; scroll to zoom in</p>');
      }
    }
    // Update the dimensions of the plot in case we were resized (NOT updated by
    // immediately-drawn things like drawAxes that get executed repeatedly by
    // scrolling / panning)
    this._bounds = this.getChartBounds();
    // Update whether we're showing the spinner
    this.drawSpinner();
    // Update the clip rect
    this.drawClip();


    // Combine old data with any new data that's streaming in
    const intervalData = this.linkedState.getCurrentMetricData(this.curMetric);
    if(intervalData.maxY === Number.MIN_VALUE)return; // presumed no data

    this.setYDomain({max: intervalData.maxY, min: intervalData.minY});
    // Update the axes (also updates scales)
    this.drawAxes();

    const data = d3.entries(intervalData.metricData);
    // Update the bars
    this.drawLines(data);
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
    if (!this.initialDragState) {
      // Remove temporarily patched transformations
      this.content.select('.dots').attr('transform', null);
      this.content.select('.lines').attr('transform', null);
    }

    let cirlces = this.content.select('.dots')
      .selectAll('.dot').data(data, d => d.key);
    cirlces.exit().remove();
    const cirlcesEnter = cirlces.enter().append('circle')
      .classed('dot', true);
    cirlces = cirlces.merge(cirlcesEnter);

    cirlces.attr('class', 'dot')
      .attr('cx', d => this.xScale(d.value['Timestamp']))
      .attr('cy', d => this.yScale(d.value['Rate']))
      .attr('r', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 5.0;
        }
        return 1.0;
      })
      .style('opacity', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 1.0;
        }
        return _self.baseOpacity;
      })
      .style('fill', d => {
        if (d.value['Location'] === _self.selectedLocation) {
          return 'blue';
        }
        return 'black';
      });

    var prevDataKey = {};

    let lines = this.content.select('.lines')
        .selectAll('.line').data(data, d => d.key);
    lines.exit().remove();
    const linesEnter = lines.enter().append('line')
        .classed('line', true);
    lines = lines.merge(linesEnter);

    lines.attr('class', 'line')
        .attr('x1', function (d, i) {
          var retScale = _self.xScale(0);
          if (d.value['Location'] in prevDataKey) {
            var prevData = lines.data()[prevDataKey[d.value['Location']]];
            retScale = _self.xScale(prevData.value['Timestamp']);
          }
          prevDataKey[d.value['Location']] = i;
          return retScale;
        })
        .attr('y1', function (d, i) {
          var retScale = _self.yScale(0);
          if (d.value['Location'] in prevDataKey) {
            var prevData = lines.data()[prevDataKey[d.value['Location']]];
            retScale = _self.yScale(prevData.value['Rate']);
          }
          prevDataKey[d.value['Location']] = i;
          return retScale;
        })
        .attr('x2', function (d, i) {
          return _self.xScale(d.value['Timestamp']);
        })
        .attr('y2', function (d, i) {
          return _self.yScale(d.value['Rate']);
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
          this.render();
        });
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
        this.content.selectAll('.dots, .lines')
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
          this.content.selectAll('.dots, .lines')
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
