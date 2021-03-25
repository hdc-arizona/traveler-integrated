/* globals uki, d3 */
import LinkedMixin from '../common/LinkedMixin.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class IntervalHistogramView extends
  LinkedMixin( // Ensures that this.linkedState is updated through app-wide things like Controller.refreshDatasets()
    uki.ui.ParentSizeViewMixin( // Keeps the SVG element sized based on how much space GoldenLayout gives us
      uki.ui.SvgGLView)) { // Ensures this.d3el is an SVG element; adds the download icon to the tab
  constructor (options) {
    options.resources = (options.resources || []).concat(...[
      { type: 'less', url: 'views/IntervalHistogramView/style.less' },
      { type: 'text', url: 'views/IntervalHistogramView/template.svg', name: 'template' }
    ]);
    super(options);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 100,
      left: 40
    };

    this.xScale = d3.scaleLog();
    this.yScale = d3.scaleSymlog();

    this.currentPrimitive = null;
  }

  get informativeMessage () {
    // If we've picked a primitive that has no interval data, show a message to
    // reduce confusion
    if (this.currentPrimitive) {
      const nBins = Object.keys(this.linkedState?.info?.intervalHistograms?.[this.currentPrimitive] || {}).length;
      return nBins === 0 ? `No interval data for primitive:<br/>${this.currentPrimitive}` : null;
    } else {
      return null;
    }
  }

  async setup () {
    await super.setup(...arguments);

    // Apply our css namespace, our template, and our margin
    this.glEl.classed('IntervalHistogramView', true);
    this.d3el.html(this.getNamedResource('template'));
    this.d3el.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Set up the primitive menu
    this.setupPrimitiveMenu();

    // Prep local interactive callbacks for updating the brush
    this.setupBrush();

    // Redraw when the selection changes
    this.linkedState.on('selectionChanged', () => { this.render(); });
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

    // How much space do we have to work with?
    const chartBounds = this.getChartBounds();
    this.xScale.range([0, chartBounds.width]);
    this.yScale.range([chartBounds.height, 0]);

    // Get the list of bars to draw, and update our scale domains before drawing
    // anything
    const allBars = this.combineHistograms();

    // Update the (transparent) background rect that captures drag events
    this.d3el.select('.background rect')
      .attr('width', this.xScale.range()[1] - this.xScale.range()[0])
      .attr('height', this.yScale.range()[0] - this.yScale.range()[1]);

    this.drawAxes(chartBounds);
    this.drawBars(chartBounds, allBars);
    this.drawBrush(chartBounds);
    this.drawPrimitiveMenu();
  }

  getChartBounds () {
    const bounds = this.getBounds();
    return {
      width: bounds.width - this.margin.left - this.margin.right,
      height: bounds.height - this.margin.top - this.margin.bottom
    };
  }

  combineHistograms () {
    const selectedPrimitive = this.linkedState.selection?.primitiveName;
    const intervalDurationSpan = this.linkedState.selection?.intervalDurationSpan || null;
    const allBars = [];
    let maxCount = 0;
    let minDuration = Infinity;
    let maxDuration = 0;

    // Add a dict of counts to our list:
    const helper = (primitive, durationCounts) => {
      for (let [duration, count] of Object.entries(durationCounts)) {
        duration = parseInt(duration);
        count = parseInt(count);
        minDuration = Math.min(minDuration, duration);
        maxDuration = Math.max(maxDuration, duration);
        maxCount = Math.max(maxCount, count);
        let selected = true;
        if (selectedPrimitive) {
          selected = selected && selectedPrimitive === primitive;
        }
        if (intervalDurationSpan) {
          selected = selected && duration >= intervalDurationSpan[0] && duration <= intervalDurationSpan[1];
        }
        // Standard bars for when there's an IntervalDurationSelection or
        // PrimitiveSelection
        allBars.push({
          primitive,
          duration,
          count,
          selected
        });
      }
    };

    if (this.currentPrimitive) {
      // Just show the current primitive's intervals
      helper(this.currentPrimitive, this.linkedState.info.intervalHistograms[this.currentPrimitive]);
    } else {
      // Show all intervals
      for (const [primitive, durationCounts] of Object.entries(this.linkedState.info.intervalHistograms)) {
        helper(primitive, durationCounts);
      }
    }

    // Add an extra small bar when there's an IntervalSelection
    const selectedInterval = this.linkedState.selection?.intervalDetails;
    if (selectedInterval) {
      allBars.push({
        primitive: selectedInterval.Primitive,
        duration: selectedInterval.leave.Timestamp - selectedInterval.enter.Timestamp,
        count: 1,
        selected: true
      });
    }

    // Update our scale domains
    this.xScale.domain([minDuration, maxDuration]).nice();
    this.yScale.domain([0, maxCount]);
    return allBars;
  }

  setupPrimitiveMenu () {
    // Add a select menu after the SVG element for picking / switching primitives
    this.primitiveMenu = this.glEl.insert('select', 'svg + *');

    this.primitiveMenu.on('change', event => {
      this.currentPrimitive = event.target.value;
      this.render();
    });
    this.linkedState.on('selectionChanged', () => {
      const newPrimitive = this.linkedState.selection?.primitiveName;
      if (newPrimitive && newPrimitive !== this.currentPrimitive) {
        this.currentPrimitive = newPrimitive;
      }
      this.render();
    });
  }

  drawPrimitiveMenu () {
    let primitiveList = this.linkedState.getNamedResource('primitives');
    if (!primitiveList) {
      // Still loading...
      return;
    }
    primitiveList = ['', null].concat(Object.keys(primitiveList));
    let options = this.primitiveMenu.selectAll('option')
      .data(primitiveList, d => d);
    options.exit().remove();
    const optionsEnter = options.enter().append('option');
    options = options.merge(optionsEnter);

    options.text(d => d === '' ? 'All primitives' : d === null ? '----' : d)
      .attr('value', d => d)
      .property('disabled', d => d === null);

    this.primitiveMenu.node().value = this.currentPrimitive || '';
  }

  drawAxes (chartBounds) {
    // Update the x axis
    this.d3el.select('.xAxis')
      .attr('transform', `translate(0, ${chartBounds.height})`)
      .call(d3.axisBottom(this.xScale));

    // Position the x label
    this.d3el.select('.xAxisLabel')
      .attr('x', chartBounds.width / 2)
      .attr('y', chartBounds.height + 2 * this.emSize);

    // Update the y axis
    const axisGenerator = d3.axisLeft(this.yScale);
    // Fractional ticks don't make sense if we're showing integer counts;
    // prevent showing extra ticks when the number is small
    const maxCount = this.yScale.domain()[1];
    if (maxCount <= 10) {
      axisGenerator.ticks(maxCount);
    }
    const yAxis = this.d3el.select('.yAxis')
      .call(axisGenerator);
    // Prevent overlapping tick labels
    cleanupAxis(yAxis);

    // Position the y label
    this.d3el.select('.yAxisLabel')
      .attr('transform', `translate(${-1.5 * this.emSize},${chartBounds.height / 2}) rotate(-90)`);
  }

  drawBars (chartBounds, allBars) {
    let bars = this.d3el.select('.bars')
      .selectAll('.bar').data(allBars);
    bars.exit().remove();
    const barsEnter = bars.enter().append('g')
      .classed('bar', true);
    bars = bars.merge(barsEnter);
    bars.sort((a, b) => {
      // Make sure selected bars appear on top
      if (b.selected && !a.selected) {
        return -1;
      } else if (a.selected && !b.selected) {
        return 1;
      } else {
        return 0;
      }
    });

    barsEnter.append('line');
    bars.classed('selected', d => d.selected)
      .select('line')
      .attr('x1', d => this.xScale(d.duration))
      .attr('x2', d => this.xScale(d.duration))
      .attr('y1', d => this.yScale(d.count))
      .attr('y2', d => this.yScale(0));

    bars.on('mouseenter', function (event, d) {
      uki.showTooltip({
        content: `Primitive: ${d.primitive}`,
        target: d3.select(this),
        anchor: { x: 1, y: -1 }
      });
    }).on('mouseleave', () => {
      uki.hideTooltip();
    }).on('click', (event, d) => {
      this.linkedState.selectPrimitive(d.primitive);
    });
  }

  setupBrush () {
    // Behaviors for manipulating the existing brush
    const brush = this.d3el.select('.brush');
    const brushDrag = d3.drag()
      .on('start', event => {
        event.sourceEvent.stopPropagation();
        const intervalDurationSpan = this.linkedState.selection.intervalDurationSpan;
        this._dragState = {
          begin: intervalDurationSpan[0],
          end: intervalDurationSpan[1],
          x: this.xScale.invert(event.x)
        };
      })
      .on('drag', event => {
        const dx = this.xScale.invert(event.x) - this._dragState.x;
        let begin = this._dragState.begin + dx;
        let end = this._dragState.end + dx;
        // clamp to the lowest / highest possible values
        const fullDomain = this.xScale.domain();
        if (begin <= fullDomain[0]) {
          const offset = fullDomain[0] - begin;
          begin += offset;
          end += offset;
        }
        if (end >= fullDomain[1]) {
          const offset = end - fullDomain[1];
          begin -= offset;
          end -= offset;
        }
        this.linkedState.selection.intervalDurationSpan = [begin, end];
        // Do an immediate update of the brush while dragging,
        // without waiting for the debounced render() + draw() cycle
        this.drawBrush();
      });
    const leftDrag = d3.drag().on('drag', event => {
      event.sourceEvent.stopPropagation();
      this.linkedState.selection.intervalDurationSpan = [this.xScale.invert(event.x), undefined];
      // setting intervalDurationSpan will eventually result in a render() call,
      // but draw the brush immediately for responsiveness
      this.drawBrush();
    });
    const rightDrag = d3.drag().on('drag', event => {
      event.sourceEvent.stopPropagation();
      this.linkedState.selection.intervalDurationSpan = [undefined, this.xScale.invert(event.x)];
      // setting intervalDurationSpan will eventually result in a render() call,
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
        this._dragState = {
          start: this.xScale.invert(event.x - this.margin.left)
        };
      })
      .on('drag', event => {
        if (!this.linkedState.selection?.intervalDurationSpan ||
            this.linkedState.selection?.primitiveName !== this.currentPrimitive) {
          // With the user starting to drag, create the selection and update this
          // view when the brushed domain changes
          this.linkedState.selectIntervalDuration(
            [this._dragState.start, this._dragState.start + 1],
            this.xScale.domain(),
            this.currentPrimitive);
          this.linkedState.selection.on('intervalDurationSpanChanged', () => { this.render(); });
        }
        this.linkedState.selection.intervalDurationSpan = [
          this._dragState.start,
          this.xScale.invert(event.x - this.margin.left)
        ];
        // setting intervalDurationSpan will automatically result in a render() call,
        // but draw the brush immediately for responsiveness
        this.drawBrush();
      })
      .on('end', event => {
        if (this.xScale.invert(event.x - this.margin.left) - this._dragState.start === 0) {
          // Zero-size selection; clear it
          this.linkedState.selection = null;
        }
      });
    this.d3el.select('.chart').call(directDrag);
  }

  drawBrush (chartBounds) {
    if (!chartBounds) {
      chartBounds = this.getChartBounds();
    }
    const intervalDurationSpan = this.linkedState.selection?.intervalDurationSpan;

    const brush = this.d3el.select('.brush')
      .style('display', intervalDurationSpan ? null : 'none');

    if (!intervalDurationSpan) {
      return;
    }

    let x1 = this.xScale(intervalDurationSpan[0]);
    const showLeftHandle = x1 >= 0 && x1 <= chartBounds.width;
    x1 = Math.max(0, x1);
    let x2 = this.xScale(intervalDurationSpan[1]);
    const showRightHandle = x2 >= 0 && x2 <= chartBounds.width;
    x2 = Math.min(chartBounds.width, x2);

    // Ensure at least 1em interactable space for each hoverTarget and the
    // space between them
    const handleWidth = this.emSize;
    let x1Offset = 0;
    let x2Offset = 0;
    if (x2 - x1 < handleWidth) {
      x1Offset = -handleWidth / 2;
      x2Offset = handleWidth / 2;
    }

    brush.select('.area')
      .attr('x', x1)
      .attr('y', 0)
      .attr('width', x2 - x1)
      .attr('height', chartBounds.height);
    brush.select('.top.outline')
      .attr('y1', 0)
      .attr('y2', 0);
    brush.select('.bottom.outline')
      .attr('y1', chartBounds.height)
      .attr('y2', chartBounds.height);
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
        .attr('y2', chartBounds.height);
      brush.select('.leftHandle .hoverTarget')
        .attr('x', x1 - handleWidth / 2 + x1Offset)
        .attr('width', handleWidth)
        .attr('y', 0)
        .attr('height', chartBounds.height);
    }

    if (showRightHandle) {
      brush.select('.rightHandle .outline')
        .attr('x1', x2)
        .attr('x2', x2)
        .attr('y1', 0)
        .attr('y2', chartBounds.height);
      brush.select('.rightHandle .hoverTarget')
        .attr('x', x2 - handleWidth / 2 + x2Offset)
        .attr('width', handleWidth)
        .attr('y', 0)
        .attr('height', chartBounds.height);
    }
  }
}
export default IntervalHistogramView;
