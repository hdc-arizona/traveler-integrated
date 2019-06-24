/* globals d3, oboe */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import { Map, Set } from '../../node_modules/immutable/dist/immutable.es.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class GanttView extends SvgViewMixin(SingleDatasetMixin(GoldenLayoutView)) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg' }
    ];
    super(argObj);

    this.stream = null;
    this.cache = new Set();
    this.newCache = null;
  }
  getData () {
    // Debounce...
    window.clearTimeout(this._resizeTimeout);
    this._resizeTimeout = window.setTimeout(() => {
      const label = encodeURIComponent(this.layoutState.label);
      const intervalWindow = this.linkedState.intervalWindow;
      const self = this;
      this.newCache = new Set();
      const currentStream = this.stream = oboe(`/datasets/${label}/intervals?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`)
        .node('!.*', function (chunk) {
          if (currentStream !== self.stream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            self.newCache = self.newCache.add(new Map(chunk));
            if (self.newCache.size % 2) {
              // Do an incremental render() every 2 intervals
              self.render();
            }
          }
        })
        .done(() => {
          this.stream = null;
          this.cache = this.newCache;
          this.newCache = null;
          this.render();
        });
      this.render();
    }, 100);
  }
  get isLoading () {
    return super.isLoading || this.stream !== null;
  }
  get isEmpty () {
    return this.cache.size === 0 && (this.newCache === null || this.newCache.size === 0);
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
    this.content.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Start / abort + re-start the stream whenever the brush changes
    this.linkedState.on('newIntervalWindow', () => { this.getData(); });
    this.getData();
  }
  draw () {
    super.draw();

    if (this.isEmpty) {
      this.emptyStateDiv.html('<p>No data to show</p>');
    }
    // Combine old data with any new data that's streaming in
    const data = (this.newCache ? this.newCache.union(this.cache) : this.cache).toArray();
    // Update the axes (also updates scales)
    this.drawAxes();
    // Update the bars
    this.drawBars(data);
    // TODO: Update the links
    this.drawLinks(data);
  }
  drawAxes () {
    const bounds = this.getChartBounds();

    // Initialize / update the scales
    this.xScale = d3.scaleLinear()
      .domain([this.linkedState.begin, this.linkedState.end])
      .range([0, bounds.width])
      .clamp(true);
    this.yScale = d3.scaleBand()
      .domain(this.linkedState.metadata.locationNames)
      .range([0, bounds.height])
      .paddingInner(0.2)
      .paddingOuter(0.1);

    // Update the x axis
    const xAxisGroup = this.content.select('.xAxis')
      .attr('transform', `translate(0, ${bounds.height})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.content.select('.xAxisLabel')
      .attr('x', bounds.width / 2)
      .attr('y', bounds.height + this.margin.bottom - this.emSize / 2);

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
      .attr('x2', bounds.width)
      .attr('y1', lineOffset)
      .attr('y2', lineOffset);

    yTicksEnter.append('text');
    yTicks.select('text')
      .attr('text-anchor', 'end')
      .attr('y', '0.35em')
      .text(d => d);

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize},${bounds.height / 2}) rotate(-90)`);
  }
  drawBars (data) {
    let bars = this.content.select('.bars')
      .selectAll('.bar').data(data, d => d);
    bars.exit().remove();
    const barsEnter = bars.enter().append('g')
      .classed('bar', true);
    bars = bars.merge(barsEnter);

    bars.attr('transform', d => `translate(${this.xScale(d.get('enter').Timestamp)},${this.yScale(d.get('Location'))})`);

    barsEnter.append('rect')
      .classed('area', true);
    barsEnter.append('rect')
      .classed('outline', true);
    bars.selectAll('rect')
      .attr('height', this.yScale.bandwidth())
      .attr('width', d => {
        const startPos = this.xScale(d.get('enter').Timestamp);
        const endPos = this.xScale(d.get('leave').Timestamp);
        return endPos - startPos;
      });
  }
  drawLinks (data) {
    // TODO
  }
}
export default GanttView;
