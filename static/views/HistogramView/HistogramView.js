/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SvgViewMixin from '../common/SvgViewMixin.js';

class HistogramView extends SvgViewMixin(GoldenLayoutView) {
  constructor ({
    container,
    state
  }) {
    super({
      container,
      state,
      resources: [
        { type: 'less', url: 'views/HistogramView/style.less' }
      ]
    });
  }
  setup () {
    super.setup();

    this.margin = {
      top: 20,
      right: 20,
      bottom: 10,
      left: 50
    };

    this.content.append('g')
      .classed('mini', true)
      .attr('transform', `translate(${this.margin.left}, ${this.margin.top})`);

    this.container.on('resize', () => {
      // Grab new data whenever the view is resized
      this.getData();
    });
    this.getData();
    /*
    traveler.mini = traveler.overview.append('g')
      .attr('transform', 'translate(' + traveler.margin.left + ',' + traveler.margin.top + ')')
      .attr('width', traveler.overview_width) //traveler.miniWidth)
      .attr('height', traveler.miniHeight)
      .attr('class', 'mini')
      .on('click', traveler.handle_click);

    traveler.xAxis = d3.axisBottom(traveler.mini_scale);
    */
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(async () => {
      const bounds = this.getContentBounds();
      const width = Math.floor(bounds.width - this.margin.left - this.margin.right);
      this.bins = undefined;
      this.render();
      try {
        this.bins = await d3.json(`/histogram/${encodeURIComponent(this.layoutState.label)}?bins=${width}`);
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
        .range([0, width]);
      this.mini_y_scale = d3.scaleLinear()
        .domain([0, maxCount])
        .range([bounds.height - this.margin.bottom - this.margin.top, this.margin.top]);

      this.render();
    }, 100);
  }
  get isLoading () {
    return this.bins === undefined;
  }
  get isEmpty () {
    return this.bins !== undefined && this.bins instanceof Error;
  }
  draw () {
    super.draw();

    if (this.bins === undefined) {
      // Do nothing beyond super.draw() showing the spinner; we're still loading data
    } else if (this.bins instanceof Error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    } else {
      let bars = this.content.select('.mini')
        .selectAll('.bar').data(this.bins);
      bars.exit().remove();
      const barsEnter = bars.enter().append('rect')
        .classed('bar', true);
      bars = barsEnter.merge(bars);

      bars
        .attr('x', ([begin, end, count]) => this.mini_scale(begin))
        .attr('width', 1)
        .attr('y', ([begin, end, count]) => this.mini_y_scale(count))
        .attr('height', ([begin, end, count]) => this.mini_y_scale(0) - this.mini_y_scale(count));
    }
  }
}
export default HistogramView;
