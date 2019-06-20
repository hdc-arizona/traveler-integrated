/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class UtilizationView extends SvgViewMixin(SingleDatasetMixin(GoldenLayoutView)) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/UtilizationView/style.less' }
    ];
    super(argObj);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 50
    };
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const bounds = this.getChartBounds();
      this.bins = undefined;
      this.render();
      try {
        this.bins = await d3.json(`/datasets/${encodeURIComponent(this.layoutState.label)}/histogram?bins=${Math.floor(bounds.width)}`);
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

    const mini = this.content.append('g')
      .classed('mini', true)
      .attr('transform', `translate(${this.margin.left}, ${this.margin.top})`);
    mini.append('rect')
      .classed('mini_background', true);
    mini.append('g')
      .classed('axis', true);
    mini.append('g')
      .classed('overviewBar', true);

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

      // Draw the bars
      let bars = this.content.select('.overviewBar')
        .selectAll('rect').data(this.bins);
      bars.exit().remove();
      const barsEnter = bars.enter().append('rect');
      bars = barsEnter.merge(bars);

      bars
        .attr('x', ([begin, end, count]) => this.mini_scale(begin))
        .attr('width', 1)
        .attr('y', ([begin, end, count]) => this.mini_y_scale(count))
        .attr('height', ([begin, end, count]) => this.mini_y_scale(0) - this.mini_y_scale(count));
    }
  }
}
export default UtilizationView;
