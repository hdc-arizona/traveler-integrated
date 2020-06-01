/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class UtilizationViewNew extends CursoredViewMixin(SvgViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/UtilizationViewNew/style.less' },
      { type: 'text', url: 'views/UtilizationViewNew/template.svg' }
    ];
    super(argObj);
    this.xScale = d3.scaleLinear().clamp(true);
    this.yScale = d3.scaleLinear();
  }
  get isLoading () {
    return super.isLoading || this.linkedState.isLoadingHistogram;
  }
  get isEmpty () {
    return !!this.linkedState.histogramError;
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
    this.yScale.range([result.height, 0]);
    return result;
  }
  setup () {
    super.setup();

    // Apply the template
    this.content.html(this.resources[1]);
    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };
    this.content.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    // Prep interactive callbacks for the brush
    this.setupBrush();

    // Set up listeners
    this.linkedState.on('newIntervalWindow', () => {
      // Update the brush immediately if something else changes it (e.g.
      // GanttView is zoomed)
      this.drawBrush();
    });
    this.linkedState.on('histogramsUpdated', () => {
      // Full render whenever we have new histograms
      this.render();
    });
    // Grab new histograms whenever the view is resized
    this.container.on('resize', () => {
      const nPixels = Math.floor(this.getChartBounds().width);
      this.linkedState.setHistogramResolution(nPixels);
    });
  }
  draw () {
    super.draw();

    const data = this.linkedState.getCurrentHistogramData();

    if (this.isHidden || this.isLoading) {
      return; // eslint-disable-line no-useless-return
    } else if (data.error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    } else {
      // console.log(data);
      // Set / update the scales
      this.xScale.domain(data.domain);
      this.yScale.domain([0, data.maxCount]);

      // Update the axis
      this.drawAxes();

      // Update the overview paths
      this.drawPaths(this.content.select('.overview'), data.histogram);

      // // Update the currently selected primitive paths
      // const selectedPrimitive = this.content.select('.selectedPrimitive');
      // selectedPrimitive.style('display', data.primitiveHistogram ? null : 'none');
      // if (data.primitiveHistogram) {
      //   selectedPrimitive.select('.area')
      //     .style('fill', this.linkedState.selectionColor);
      //   selectedPrimitive.select('.outline')
      //     .style('stroke', this.linkedState.selectionColor);
      //   this.drawPaths(selectedPrimitive, data.primitiveHistogram);
      // }

      // Update the brush
      this.drawBrush();
    }
  }
  drawAxes () {
    const bounds = this.getChartBounds();
    // Update the x axis
    const xAxis = this.content.select('.xAxis')
      .attr('transform', `translate(0, ${bounds.height})`)
      .call(d3.axisBottom(this.xScale));

    cleanupAxis(xAxis);

    // Position the x label
    this.content.select('.xAxisLabel')
      .attr('x', bounds.width / 2)
      .attr('y', bounds.height + this.margin.bottom - this.emSize / 2);

    // Update the y axis
    this.content.select('.yAxis')
      .call(d3.axisLeft(this.yScale));

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-1.5 * this.emSize},${bounds.height / 2}) rotate(-90)`);
  }
  drawPaths (container, histogram) {
    const outlinePathGenerator = d3.line()
      .x((d, i) => this.xScale(this.linkedState.getTimeStampFromBin(i, histogram.metadata)))
      .y(d => this.yScale(d));
    container.select('.outline')
      .datum(histogram.data)
      .attr('d', outlinePathGenerator);

    const areaPathGenerator = d3.area()
      .x((d, i) => this.xScale(this.linkedState.getTimeStampFromBin(i, histogram.metadata)))
      .y1(d => this.yScale(d))
      .y0(this.yScale(0));
    container.select('.area')
      .datum(histogram.data)
      .attr('d', areaPathGenerator);
  }
  setupBrush () {
    let initialState;
    const brush = this.content.select('.brush');
    const brushDrag = d3.drag()
      .on('start', () => {
        d3.event.sourceEvent.stopPropagation();
        initialState = {
          begin: this.linkedState.begin,
          end: this.linkedState.end,
          x: this.xScale.invert(d3.event.x)
        };
      })
      .on('drag', () => {
        let dx = this.xScale.invert(d3.event.x) - initialState.x;
        let begin = initialState.begin + dx;
        let end = initialState.end + dx;
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
        this.linkedState.setIntervalWindow({ begin, end });
        // For responsiveness, draw the brush immediately
        // (instead of waiting around for debounced events / server calls)
        this.drawBrush({ begin, end });
      });
    const leftDrag = d3.drag().on('drag', () => {
      d3.event.sourceEvent.stopPropagation();
      let begin = this.xScale.invert(d3.event.x);
      // clamp to the lowest possible value
      begin = Math.max(begin, this.linkedState.beginLimit);
      // clamp to the current upper value minus one
      begin = Math.min(begin, this.linkedState.end - 1);
      this.linkedState.setIntervalWindow({ begin });
      // For responsiveness, draw the brush immediately
      // (instead of waiting around for debounced events / server calls)
      this.drawBrush({ begin });
    });
    const rightDrag = d3.drag().on('drag', () => {
      d3.event.sourceEvent.stopPropagation();
      let end = this.xScale.invert(d3.event.x);
      // clamp to the highest possible value
      end = Math.min(end, this.linkedState.endLimit);
      // clamp to the current lower value plus one
      end = Math.max(end, this.linkedState.begin + 1);
      this.linkedState.setIntervalWindow({ end });
      // For responsiveness, draw the brush immediately
      // (instead of waiting around for debounced events / server calls)
      this.drawBrush({ end });
    });
    brush.call(brushDrag);
    brush.select('.leftHandle .hoverTarget').call(leftDrag);
    brush.select('.rightHandle .hoverTarget').call(rightDrag);

    const directDrag = d3.drag()
      .on('start', () => {
        d3.event.sourceEvent.stopPropagation();
        initialState = {
          x0: this.xScale.invert(d3.event.x - this.margin.left)
        };
      })
      .on('drag', () => {
        let begin = initialState.x0;
        let end = this.xScale.invert(d3.event.x - this.margin.left);
        // In case we're dragging to the left...
        if (end < begin) {
          const temp = begin;
          begin = end;
          end = temp;
        }
        // clamp to the lowest / highest possible values
        begin = Math.max(begin, this.linkedState.beginLimit);
        end = Math.min(end, this.linkedState.endLimit);
        this.linkedState.setIntervalWindow({ begin, end });
        // For responsiveness, draw the brush immediately
        // (instead of waiting around for debounced events / server calls)
        this.drawBrush({ begin, end });
      });
    this.content.select('.chart').call(directDrag);
  }
  drawBrush ({
    begin = this.linkedState.begin,
    end = this.linkedState.end
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

    const brush = this.content.select('.brush');
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
export default UtilizationViewNew;
