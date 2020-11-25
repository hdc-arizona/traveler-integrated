/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class UtilizationView extends
  LinkedMixin( // Ensures that this.linkedState is updated through app-wide things like Controller.refreshDatasets()
    uki.ui.ParentSizeViewMixin( // Keeps the SVG element sized based on how much space GoldenLayout gives us
      uki.ui.SvgGLView)) { // Ensures this.d3el is an SVG element; adds the download icon to the tab
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/UtilizationView/style.less' },
      { type: 'text', url: 'views/UtilizationView/template.svg', name: 'template' }
      // Two resources (totalUtilization and primitiveUtilization) are also
      // added later in refreshData()
    ]);
    super(options);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };

    this.xScale = d3.scaleLinear().clamp(true);
    this.yScale = d3.scaleLinear();
  }

  /**
   * Add or update view-specific utilization data from the server
   */
  async refreshData () {
    // Update our scale ranges (and bin count) based on how much space is available
    const bounds = this.getBounds();
    this.chartBounds = {
      width: bounds.width - this.margin.left - this.margin.right,
      height: bounds.height - this.margin.top - this.margin.bottom
    };
    this.xScale.range([0, this.chartBounds.width]);
    this.yScale.range([this.chartBounds.height, 0]);
    const bins = Math.max(this.chartBounds.width, 1); // we want one bin per pixel, and clamp to one to prevent zero-bin / negative queries

    // Fetch the total utilization
    const totalPromise = this.updateResource({
      name: 'totalUtilization',
      type: 'json',
      url: `/datasets/${this.datasetId}/utilizationHistogram?bins=${bins}`
    });

    // If a primitive is selected, fetch its utilization
    const primitiveResourceSpec = {
      name: 'primitiveUtilization'
    };
    let selectedPrimitive = this.linkedState?.selection?.primitiveName;
    if (selectedPrimitive) {
      selectedPrimitive = encodeURIComponent(selectedPrimitive);
      primitiveResourceSpec.type = 'json';
      primitiveResourceSpec.url = `/datasets/${this.datasetId}/utilizationHistogram?bins=${bins}&primitive=${selectedPrimitive}`;
    } else {
      // Store null in the resource and skip the server call when
      // there isn't a selected primitive
      primitiveResourceSpec.type = 'derivation';
      primitiveResourceSpec.derive = () => null;
    }
    const primitivePromise = this.updateResource(primitiveResourceSpec);

    return Promise.all([totalPromise, primitivePromise]);
  }

  async setup () {
    await super.setup(...arguments);

    // setup() is only called once this.d3el is ready; at this point, we know
    // how many bins to ask for
    this.refreshData();

    // Apply the template + our margin
    this.d3el.html(this.getNamedResource('template'))
      .classed('UtilizationView', true);
    this.d3el.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Prep interactive callbacks for the brush
    this.setupBrush();
    this.linkedState.on('detailDomainChanged', () => {
      // Update the brush immediately if something else changes it (e.g.
      // GanttView is zoomed)
      this.drawBrush();
    });

    // Update our data whenever the view is resized or whenever the selection is
    // changed
    this.on('resize', () => { this.refreshData(); });
    this.linkedState.on('selectionChanged', () => { this.refreshData(); });
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner
      return;
    }

    const totalUtilization = this.getNamedResource('totalUtilization');
    const primitiveUtilization = this.getNamedResource('primitiveUtilization');

    // Set / update the scales
    // since we have 1 bin per pixel, technically xScale is always an identity
    // mapping from array index to screen coordinates. If we someday decide to
    // support zooming in the utilization view, then we'll want to change this
    this.xScale.domain([0, totalUtilization.metadata.bins]);
    // totalUtilization will always be more than primitiveUtilization, so use
    // total for the y axis
    this.yScale.domain([0, d3.max(totalUtilization.data)]);

    // Update the axis
    this.drawAxes();
    // Update the overview paths
    this.drawPaths(this.d3el.select('.overview'), totalUtilization);
    // Update the selected primitive path (if one exists, otherwise hide it)
    this.d3el.select('.selectedPrimitive')
      .style('display', primitiveUtilization === null ? 'none' : null);
    if (primitiveUtilization !== null) {
      this.drawPaths(this.d3el.select('.selectedPrimitive'), primitiveUtilization);
    }
    // Update the brush
    this.drawBrush();
  }

  drawAxes () {
    // Update the x axis
    const xAxis = this.content.select('.xAxis')
      .attr('transform', `translate(0, ${this.chartBounds.height})`)
      .call(d3.axisBottom(this.xScale));

    cleanupAxis(xAxis);

    // Position the x label
    this.content.select('.xAxisLabel')
      .attr('x', this.chartBounds.width / 2)
      .attr('y', this.chartBounds.height + this.margin.bottom - this.emSize / 2);

    // Update the y axis
    this.content.select('.yAxis')
      .call(d3.axisLeft(this.yScale));

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-1.5 * this.emSize},${this.chartBounds.height / 2}) rotate(-90)`);
  }

  drawPaths (container, histogram) {
    const outlinePathGenerator = d3.line()
      .x((d, i) => this.xScale(i))
      .y(d => this.yScale(d));
    container.select('.outline')
      .datum(histogram.data)
      .attr('d', outlinePathGenerator);

    const areaPathGenerator = d3.area()
      .x((d, i) => this.xScale(i))
      .y1(d => this.yScale(d))
      .y0(this.yScale(0));
    container.select('.area')
      .datum(histogram.data)
      .attr('d', areaPathGenerator);
  }

  setupBrush () {
    let initialState;

    // Behaviors for manipulating the existing brush
    const brush = this.d3el.select('.brush');
    const brushDrag = d3.drag()
      .on('start', event => {
        event.sourceEvent.stopPropagation();
        initialState = {
          begin: this.linkedState.detailDomain[0],
          end: this.linkedState.detailDomain[1],
          x: this.xScale.invert(event.x)
        };
      })
      .on('drag', event => {
        const dx = this.xScale.invert(event.x) - initialState.x;
        let begin = initialState.begin + dx;
        let end = initialState.end + dx;
        // clamp to the lowest / highest possible values
        if (begin <= this.linkedState.overviewDomain[0]) {
          const offset = this.linkedState.overviewDomain[0] - begin;
          begin += offset;
          end += offset;
        }
        if (end >= this.linkedState.overviewDomain[1]) {
          const offset = end - this.linkedState.overviewDomain[1];
          begin -= offset;
          end -= offset;
        }
        this.linkedState.detailDomain = [begin, end];
        // setting detailDomain will automatically result in a render() call,
        // but draw the brush immediately for responsiveness
        this.drawBrush();
      });
    const leftDrag = d3.drag().on('drag', event => {
      event.sourceEvent.stopPropagation();
      this.linkedState.detailDomain = [this.xScale.invert(event.x), undefined];
      // setting detailDomain will automatically result in a render() call,
      // but draw the brush immediately for responsiveness
      this.drawBrush();
    });
    const rightDrag = d3.drag().on('drag', event => {
      event.sourceEvent.stopPropagation();
      this.linkedState.detailDomain = [undefined, this.xScale.invert(event.x)];
      // setting detailDomain will automatically result in a render() call,
      // but draw the brush immediately for responsiveness
      this.drawBrush();
    });
    brush.call(brushDrag);
    brush.select('.leftHandle .hoverTarget').call(leftDrag);
    brush.select('.rightHandle .hoverTarget').call(rightDrag);

    // Behaviors for drawing a new brushed area (note that, unlike the above
    // interactions, this is attached to the whole un-transformed chart area so
    // we need to account for the margins)
    const directDrag = d3.drag()
      .on('start', event => {
        event.sourceEvent.stopPropagation();
        initialState = this.xScale.invert(event.x - this.margin.left);
      })
      .on('drag', event => {
        this.linkedState.detailDomain = [
          initialState,
          this.xScale.invert(event.x - this.margin.left)
        ];
        // setting detailDomain will automatically result in a render() call,
        // but draw the brush immediately for responsiveness
        this.drawBrush();
      });
    this.d3el.select('.chart').call(directDrag);
  }

  drawBrush () {
    let x1 = this.xScale(this.linkedState.detailDomain[0]);
    const showLeftHandle = x1 >= 0 && x1 <= this.chartBounds.width;
    x1 = Math.max(0, x1);
    let x2 = this.xScale(this.linkedState.detailDomain[1]);
    const showRightHandle = x2 >= 0 && x2 <= this.chartBounds.width;
    x2 = Math.min(this.chartBounds.width, x2);

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
      .attr('height', this.chartBounds.height);
    brush.select('.top.outline')
      .attr('y1', 0)
      .attr('y2', 0);
    brush.select('.bottom.outline')
      .attr('y1', this.chartBounds.height)
      .attr('y2', this.chartBounds.height);
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
        .attr('y2', this.chartBounds.height);
      brush.select('.leftHandle .hoverTarget')
        .attr('x', x1 - handleWidth / 2 + x1Offset)
        .attr('width', handleWidth)
        .attr('y', 0)
        .attr('height', this.chartBounds.height);
    }

    if (showRightHandle) {
      brush.select('.rightHandle .outline')
        .attr('x1', x2)
        .attr('x2', x2)
        .attr('y1', 0)
        .attr('y2', this.chartBounds.height);
      brush.select('.rightHandle .hoverTarget')
        .attr('x', x2 - handleWidth / 2 + x2Offset)
        .attr('width', handleWidth)
        .attr('y', 0)
        .attr('height', this.chartBounds.height);
    }
  }
}
export default UtilizationView;
