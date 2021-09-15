/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class UtilizationView extends
  LinkedMixin( // Ensures that this.linkedState is updated through app-wide things like Controller.refreshDatasets()
    CursoredViewMixin( // Adds and updates a line in the background wherever the user is mousing
      uki.ui.ParentSizeViewMixin( // Keeps the SVG element sized based on how much space GoldenLayout gives us
        uki.ui.SvgGLView))) { // Ensures this.d3el is an SVG element; adds the download icon to the tab
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/UtilizationView/style.less' },
      { type: 'text', url: 'views/UtilizationView/template.svg', name: 'template' },
      // Placeholder resources that don't actually get updated until updateResolution()
      { type: 'placeholder', value: null, name: 'total' },
      { type: 'placeholder', value: null, name: 'selection' }
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

  async updateResolution () {
    // Update our scale ranges (and bin count) based on how much space is available
    const bounds = this.getBounds();
    this.chartBounds = {
      width: bounds.width - this.margin.left - this.margin.right,
      height: bounds.height - this.margin.top - this.margin.bottom
    };
    this.xScale.range([0, this.chartBounds.width]);
    this.yScale.range([this.chartBounds.height, 0]);
    const bins = Math.max(Math.ceil(this.chartBounds.width), 1); // we want one bin per pixel, and clamp to 1 to prevent zero-bin / negative queries

    const totalPromise = this.updateResource({
      name: 'total',
      type: 'json',
      url: `/datasets/${this.datasetId}/utilizationHistogram?bins=${bins}`
    });
    const selectionPromise = this.updateResource({
      name: 'selection',
      type: 'derivation',
      derive: async () => {
        // Does the current selection have a way of getting selection-specific
        // utilization data?
        return this.linkedState.selection?.getUtilization?.({ bins }, this.linkedState.aggregatedIntervalsSelection) || null;
        // if not, don't show any selection-specific utilization
      }
    });
    // Initial render call to show the spinner if waiting for data takes a while
    this.render();
    await Promise.all([totalPromise, selectionPromise]);
    this.render();
  }

  getMousedTime (offsetX) {
    return this.xScale.invert(offsetX - this.margin.left);
  }

  getCursorHeight () {
    return this.yScale.range()[0] - this.yScale.range()[1];
  }

  getCursorPosition (time) {
    return time < this.xScale.domain()[0] || time > this.xScale.domain()[1]
      ? null
      : this.xScale(time);
  }

  async setup () {
    await super.setup(...arguments);

    // setup() is only called once this.d3el is ready; only at this point do we
    // know how many bins to ask for
    this.updateResolution();
    // Update the resolution whenever the view is resized
    this.on('resize', () => { this.updateResolution(); });

    // Apply the template + our margin
    this.d3el.html(this.getNamedResource('template'))
      .classed('UtilizationView', true);
    this.d3el.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    this.linkedState.on('aggregatedIntervalsSelectionChanged', () => { this.updateResolution(); });
    // Ask for new data whenever the selection changes
    this.linkedState.on('selectionChanged', () => { this.updateResolution(); });
    // Update the brush immediately whenever any view changes it
    this.linkedState.on('detailDomainChangedSync', () => { this.drawBrush(); });
    // Prep local interactive callbacks for updating the brush
    this.setupBrush();
    // Set up the cursor
    this.setupCursor(this.d3el.select('.chart'));
  }

  get isLoading () {
    // Display the spinner + skip most of the draw call if we're still waiting
    // on utilization data
    if (super.isLoading) {
      return true;
    }
    const total = this.getNamedResource('total');
    if (total === null || (total instanceof Error && total.status === 503)) {
      return true;
    }
    if (this.linkedState.selection?.utilizationParameters) {
      const selection = this.getNamedResource('selection');
      if (selection === null || (selection instanceof Error && selection.status === 503)) {
        return true;
      }
    }
    return false;
  }

  get error () {
    const err = super.error;
    if (err?.status === 503) {
      // We don't want to count 503 errors (still loading data) as actual errors
      return null;
    } else {
      return err;
    }
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading || this.error) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner. Or if there's an upstream error, super.draw will
      // already display an error message. Don't attempt to draw anything (or
      // we'll probably just add to the noise of whatever is really wrong)
      return;
    }

    const totalUtilization = this.getNamedResource('total');
    const selectionUtilization = this.getNamedResource('selection');

    // We finally can compute the y domain; totalUtilization will always be
    // greater than selectionUtilization, so use its max for the y axis
    this.yScale.domain([0, d3.max(totalUtilization.data)]);
    // Also set xScale's domain while we're at it (should never change in
    // practice)
    this.xScale.domain(this.linkedState.overviewDomain);

    // Update the (transparent) background rect that captures drag events
    this.d3el.select('.background rect')
      .attr('width', this.xScale.range()[1] - this.xScale.range()[0])
      .attr('height', this.yScale.range()[0] - this.yScale.range()[1]);
    // Update the cursor
    this.drawCursor();
    // Update the axis
    this.drawAxes();
    // Update the totalUtilization paths
    this.drawPaths(this.d3el.select('.totalUtilization'), totalUtilization);
    // Update the selectionUtilization paths (if a selection exists and has
    // overviewUtilization data, otherwise hide them)
    this.d3el.select('.selectionUtilization')
      .style('display', selectionUtilization === null ? 'none' : null);
    if (selectionUtilization !== null) {
      this.drawPaths(this.d3el.select('.selectionUtilization'), selectionUtilization);
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
      .attr('y', this.chartBounds.height + 2 * this.emSize);

    // Update the y axis
    this.d3el.select('.yAxis')
      .call(d3.axisLeft(this.yScale));

    // Position the y label
    this.d3el.select('.yAxisLabel')
      .attr('transform', `translate(${-1.5 * this.emSize},${this.chartBounds.height / 2}) rotate(-90)`);
  }

  drawPaths (container, histogram) {
    const outlinePathGenerator = d3.line()
      .x((d, i) => i) // bin number corresponds to screen coordinate
      .y(d => this.yScale(d));
    container.select('.outline')
      .datum(histogram.data)
      .attr('d', outlinePathGenerator);

    const areaPathGenerator = d3.area()
      .x((d, i) => i) // bin number corresponds to screen coordinate
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
      // setting detailDomain will eventually result in a render() call,
      // but draw the brush immediately for responsiveness
      this.drawBrush();
    });
    const rightDrag = d3.drag().on('drag', event => {
      event.sourceEvent.stopPropagation();
      this.linkedState.detailDomain = [undefined, this.xScale.invert(event.x)];
      // setting detailDomain will eventually result in a render() call,
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
