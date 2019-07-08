/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class UtilizationView extends CursoredViewMixin(SvgViewMixin(SingleDatasetMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/UtilizationView/style.less' },
      { type: 'text', url: 'views/UtilizationView/template.svg' }
    ];
    super(argObj);
    this.xScale = d3.scaleLinear().clamp(true);
    this.yScale = d3.scaleLinear();
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const bounds = this.getChartBounds();
      this.histogram = undefined;
      this.render();
      try {
        const label = encodeURIComponent(this.layoutState.label);
        const numBins = Math.floor(bounds.width);
        this.histogram = await d3.json(`/datasets/${label}/histogram?bins=${numBins}`);
        if (this.linkedState.selectedPrimitive) {
          const primitive = encodeURIComponent(this.linkedState.selectedPrimitive);
          this.primitiveHistogram = await d3.json(`/datasets/${label}/histogram/${primitive}?bins=${numBins}`);
        } else {
          delete this.primitiveHistogram;
        }
      } catch (e) {
        this.histogram = e;
        return;
      }

      let maxCount = 0;
      const domain = [Infinity, -Infinity];
      for (const [begin, end, count] of this.histogram) {
        maxCount = Math.max(maxCount, count);
        domain[0] = Math.min(begin, domain[0]);
        domain[1] = Math.max(end, domain[1]);
      }

      this.xScale.domain(domain);
      this.yScale.domain([0, maxCount]);

      this.render();
    }, 100);
  }
  get isLoading () {
    return super.isLoading || this.histogram === undefined;
  }
  get isEmpty () {
    return this.histogram !== undefined && this.histogram instanceof Error;
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
      left: 20
    };
    this.content.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);
    // Prep interactive callbacks for the brush
    this.setupBrush();

    // Update the brush if something else changes it (e.g. GanttView is zoomed)
    this.linkedState.on('newIntervalWindow', () => { this.drawBrush(); });
    // Grab new histograms when a new primitive is selected
    this.linkedState.on('primitiveSelected', () => { this.getData(); });
    // Grab new histograms whenever the view is resized
    this.container.on('resize', () => { this.getData(); });
    // Initial data
    this.getData();
  }
  draw () {
    super.draw();

    if (this.isHidden || this.isLoading) {
      return; // eslint-disable-line no-useless-return
    } else if (this.histogram instanceof Error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    } else {
      // Update the axis
      this.drawAxis();

      // Update the overview paths
      this.drawPaths(this.content.select('.overview'), this.histogram);

      // Update the currently selected primitive paths
      const selectedPrimitive = this.content.select('.selectedPrimitive');
      selectedPrimitive.style('display', this.primitiveHistogram ? null : 'none');
      if (this.primitiveHistogram) {
        this.drawPaths(selectedPrimitive, this.primitiveHistogram);
      }

      // Update the brush
      this.drawBrush();
    }
  }
  drawAxis () {
    const bounds = this.getChartBounds();
    // Update the axis
    const axis = this.content.select('.axis')
      .attr('transform', `translate(0, ${bounds.height})`)
      .call(d3.axisBottom(this.xScale));

    cleanupAxis(axis);

    // Position the label
    this.content.select('.axisLabel')
      .attr('x', bounds.width / 2)
      .attr('y', bounds.height + this.margin.bottom - this.emSize / 2);
  }
  drawPaths (container, histogram) {
    const outlinePathGenerator = d3.line()
      .x(d => this.xScale((d[0] + d[1]) / 2))
      .y(d => this.yScale(d[2]));
    container.select('.outline')
      .datum(histogram)
      .attr('d', outlinePathGenerator);

    const areaPathGenerator = d3.area()
      .x(d => this.xScale((d[0] + d[1]) / 2))
      .y1(d => this.yScale(d[2]))
      .y0(this.yScale(0));
    container.select('.area')
      .datum(histogram)
      .attr('d', areaPathGenerator);
  }
  setupBrush () {
    let initialState;
    const brush = this.content.select('.brush');
    const brushDrag = d3.drag()
      .on('start', () => {
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
export default UtilizationView;
