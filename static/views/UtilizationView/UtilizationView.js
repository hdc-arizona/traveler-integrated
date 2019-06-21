/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class UtilizationView extends SvgViewMixin(SingleDatasetMixin(GoldenLayoutView)) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/UtilizationView/style.less' },
      { type: 'text', url: 'views/UtilizationView/template.svg' }
    ];
    super(argObj);
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const bounds = this.getChartBounds();
      this.bins = undefined;
      this.render();
      try {
        const label = encodeURIComponent(this.layoutState.label);
        const numBins = Math.floor(bounds.width);
        this.bins = await d3.json(`/datasets/${label}/histogram?bins=${numBins}`);
        if (this.linkedState.selectedPrimitive) {
          const primitive = encodeURIComponent(this.linkedState.selectedPrimitive);
          this.primitiveBins = await d3.json(`/datasets/${label}/histogram/${primitive}?bins=${numBins}`);
        } else {
          delete this.primitiveBins;
        }
      } catch (e) {
        this.bins = e;
        return;
      }

      let maxCount = 0;
      const domain = [Infinity, -Infinity];
      for (const [begin, end, count] of this.bins) {
        maxCount = Math.max(maxCount, count);
        domain[0] = Math.min(begin, domain[0]);
        domain[1] = Math.max(end, domain[1]);
      }

      this.mini_scale = d3.scaleLinear()
        .domain(domain)
        .range([0, bounds.width]);
      this.mini_y_scale = d3.scaleLinear()
        .domain([0, maxCount])
        .range([bounds.height, 0]);

      this.render();
    }, 100);
  }
  get isLoading () {
    return super.isLoading || this.bins === undefined;
  }
  get isEmpty () {
    return this.bins !== undefined && this.bins instanceof Error;
  }
  getChartBounds () {
    const bounds = this.getContentBounds();
    return {
      width: bounds.width - this.margin.left - this.margin.right,
      height: bounds.height - this.margin.top - this.margin.bottom,
      left: bounds.left + this.margin.left,
      top: bounds.top + this.margin.top,
      right: bounds.right - this.margin.right,
      bottom: bounds.bottom - this.margin.bottom
    };
  }
  setup () {
    super.setup();

    this.content.html(this.resources[1]);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 50
    };
    this.content.select('.mini')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    this.setupBrush();

    this.linkedState.on('newIntervalWindow', () => {
      // Just need to update the brush
      this.drawBrush();
    });

    this.linkedState.on('primitiveSelected', () => {
      // Grab the histogram when a new primitive is selected
      this.getData();
    });

    this.container.on('resize', () => {
      // Grab new data whenever the view is resized
      this.getData();
    });
    this.getData();
  }
  draw () {
    super.draw();

    if (this.bins === undefined) {
      // Do nothing beyond super.draw() showing the spinner; we're still loading data
    } else if (this.bins instanceof Error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    } else {
      const bounds = this.getChartBounds();

      // Update the background size
      this.content.select('.mini_background')
        .attr('width', bounds.width)
        .attr('height', bounds.height);

      // Update the axis
      this.content.select('.mini .axis')
        .attr('transform', `translate(0, ${bounds.height})`)
        .call(d3.axisBottom(this.mini_scale));

      // Update the overview paths
      this.drawPaths(this.content.select('.overview'), this.bins);

      // Update the currently selected primitive paths
      const currentPrimitive = this.content.select('.currentPrimitive');
      currentPrimitive.style('display', this.primitiveBins ? null : 'none');
      if (this.primitiveBins) {
        this.drawPaths(currentPrimitive, this.primitiveBins);
      }

      // Update the brush
      this.drawBrush();
    }
  }
  drawPaths (container, histogram) {
    const outlinePathGenerator = d3.line()
      .x(d => this.mini_scale((d[0] + d[1]) / 2))
      .y(d => this.mini_y_scale(d[2]));
    container.select('.outline')
      .datum(histogram)
      .attr('d', outlinePathGenerator);

    const areaPathGenerator = d3.area()
      .x(d => this.mini_scale((d[0] + d[1]) / 2))
      .y1(d => this.mini_y_scale(d[2]))
      .y0(this.mini_y_scale(0));
    container.select('.area')
      .datum(histogram)
      .attr('d', areaPathGenerator);
  }
  setupBrush () {
    const leftDrag = d3.drag().on('drag', () => {
      let begin = this.mini_scale.invert(d3.event.x);
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
      let end = this.mini_scale.invert(d3.event.x);
      // clamp to the highest possible value
      end = Math.min(end, this.linkedState.endLimit);
      // clamp to the current lower value plus one
      end = Math.max(end, this.linkedState.begin + 1);
      this.linkedState.setIntervalWindow({ end });
      // For responsiveness, draw the brush immediately
      // (instead of waiting around for debounced events / server calls)
      this.drawBrush({ end });
    });
    let initialState;
    const brushDrag = d3.drag()
      .on('start', () => {
        initialState = {
          begin: this.linkedState.begin,
          end: this.linkedState.end,
          x: this.mini_scale.invert(d3.event.x)
        };
      })
      .on('drag', () => {
        let dx = this.mini_scale.invert(d3.event.x) - initialState.x;
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
    const brush = this.content.select('.brush');
    brush.call(brushDrag);
    brush.select('.leftHandle .hoverTarget').call(leftDrag);
    brush.select('.rightHandle .hoverTarget').call(rightDrag);
  }
  drawBrush ({
    begin = this.linkedState.begin,
    end = this.linkedState.end
  } = {}) {
    const bounds = this.getChartBounds();
    let x1 = this.mini_scale(begin);
    const showLeftHandle = x1 >= 0 && x1 <= bounds.width;
    x1 = Math.max(0, x1);
    let x2 = this.mini_scale(end);
    const showRightHandle = x2 >= 0 && x2 <= bounds.width;
    x2 = Math.min(bounds.width, x2);

    // Ensure at least 1em interactable space for each hoverTarget and the
    // space between them
    const handleWidth = this.emSize;
    let x1Offset = 0;
    let x2Offset = 0;
    if (x2 - x1 < handleWidth) {
      const offset = (handleWidth - (x2 - x1)) / 2;
      x1Offset -= offset;
      x2Offset += offset;
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
    brush.select('.top.outline, .bottom.outline')
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
