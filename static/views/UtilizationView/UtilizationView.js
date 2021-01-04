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
    ]);
    super(options);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };

    this.xBinScale = d3.scaleLinear().clamp(true);
    this.xScale = d3.scaleLinear().clamp(true);
    this.yScale = d3.scaleLinear();

    // Render whenever there's a change to utilization state
    this.linkedState.on('utilizationUnloaded', () => { this.render(); });
    this.linkedState.on('utilizationLoaded', () => { this.render(); });
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
    const bins = Math.max(Math.ceil(this.chartBounds.width), 1); // we want one bin per pixel, and clamp to one to prevent zero-bin / negative queries
    this.xBinScale.range([0, bins]);

    await this.linkedState.refreshUtilization(bins);

    this.render();
  }

  async setup () {
    await super.setup(...arguments);

    // setup() is only called once this.d3el is ready; only at this point do we
    // know how many bins to ask for
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

  get isLoading () {
    // Display the spinner + skip most of the draw call if we're still waiting
    // on utilization data
    return super.isLoading ||
      this.linkedState.getNamedResource('utilization') === null ||
      (this.linkedState.selection?.type === 'PrimitiveSelection' &&
       this.linkedState.selection.getNamedResource('utilization') === null);
  }

  get error () {
    if (super.error) {
      return super.error;
    }
    // In addition to any errors that happen during setup() or draw calls(),
    // display any errors that occurred trying to retrieve utilization data
    if (this.linkedState.getNamedResource('utilization') instanceof Error) {
      return this.linkedState.getNamedResource('utilization');
    }
    if (this.linkedState.selection?.type === 'PrimitiveSelection' &&
        this.linkedState.selection.getNamedResource('utilization') instanceof Error) {
      return this.linkedState.selection.getNamedResource('utilization');
    }
    return null;
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner. Instead, ensure that another render() call is
      // fired when we're finally ready
      this.ready.then(() => { this.render(); });
      return;
    } else if (this.error) {
      // If there's an upstream error, super.draw will already display an error
      // message. Don't attempt to draw anything (or we'll probably just add to
      // the noise of whatever is really wrong)
      return;
    }

    const totalUtilization = this.linkedState.getNamedResource('utilization');
    const primitiveUtilization = this.linkedState.selection?.getNamedResource('utilization') || null;

    // Set / update the scale domains based on the data we last saw from refreshData()

    // Since we have 1 bin per pixel, xBinScale is always an identity mapping
    // from array index to screen coordinates. If we someday decide to support
    // zooming in the utilization view, then we might want to change this to
    // animate the zoom while we're waiting for new data
    this.xBinScale.domain([0, totalUtilization.metadata.bins]);
    // this.xScale is responsible for mapping timestamps to screen coordinates
    this.xScale.domain([totalUtilization.metadata.begin, totalUtilization.metadata.end]);
    // totalUtilization will always be more than primitiveUtilization, so use
    // its max for the y axis
    this.yScale.domain([0, d3.max(totalUtilization.data)]);

    // Update the (transparent) background rect that captures drag events
    this.d3el.select('.background rect')
      .attr('x', this.margin.left)
      .attr('y', this.margin.top)
      .attr('width', this.xScale.range()[1] - this.xScale.range()[0])
      .attr('height', this.yScale.range()[0] - this.yScale.range()[1]);
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
    const xAxis = this.d3el.select('.xAxis')
      .attr('transform', `translate(0, ${this.chartBounds.height})`)
      .call(d3.axisBottom(this.xScale));

    cleanupAxis(xAxis);

    // Position the x label
    this.d3el.select('.xAxisLabel')
      .attr('x', this.chartBounds.width / 2)
      .attr('y', this.chartBounds.height + this.margin.bottom - this.emSize / 2);

    // Update the y axis
    this.d3el.select('.yAxis')
      .call(d3.axisLeft(this.yScale));

    // Position the y label
    this.d3el.select('.yAxisLabel')
      .attr('transform', `translate(${-1.5 * this.emSize},${this.chartBounds.height / 2}) rotate(-90)`);
  }

  drawPaths (container, histogram) {
    const outlinePathGenerator = d3.line()
      .x((d, i) => this.xBinScale(i))
      .y(d => this.yScale(d));
    container.select('.outline')
      .datum(histogram.data)
      .attr('d', outlinePathGenerator);

    const areaPathGenerator = d3.area()
      .x((d, i) => this.xBinScale(i))
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

    const brush = this.d3el.select('.brush');
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
