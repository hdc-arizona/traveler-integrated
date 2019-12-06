/* globals d3, oboe */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';
import SvgViewMixin from '../common/SvgViewMixin.js';
import CursoredViewMixin from '../common/CursoredViewMixin.js';
import normalizeWheel from '../../utils/normalize-wheel.js';
import cleanupAxis from '../../utils/cleanupAxis.js';

class GanttView extends CursoredViewMixin(SvgViewMixin(LinkedMixin(GoldenLayoutView))) {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/GanttView/style.less' },
      { type: 'text', url: 'views/GanttView/template.svg' }
    ];
    super(argObj);
    this.xScale = d3.scaleLinear();
    this.yScale = d3.scaleBand()
      .paddingInner(0.2)
      .paddingOuter(0.1);

    this.intervalStream = null;
    this.intervalCache = {};
    this.newIntervalCache = null;
    this.intervalCount = 0;

    this.tracebackStream = null;
    this.tracebackCache = {
      visibleIds: [],
      rightEndpoint: null,
      leftEndpoint: null
    };
    this.newTracebackCache = null;
    this.lastTracebackTarget = null;

    // Don't bother drawing bars if there are more than 7000 visible intervals
    this.renderCutoff = 7000;

    // Some things like SVG clipPaths require ids instead of classes...
    this.uniqueDomId = `GanttView${GanttView.DOM_COUNT}`;
    GanttView.DOM_COUNT++;
  }
  getData () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._getDataTimeout);
    this._getDataTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.layoutState.label);
      const intervalWindow = this.linkedState.intervalWindow;
      const self = this;
      // First check whether we're asking for too much data by getting a
      // histogram with a single bin (TODO: draw per-location histograms instead
      // of just saying "Too much data; scroll to zoom in?")
      this.histogram = await d3.json(`/datasets/${label}/histogram?bins=1&mode=count&begin=${intervalWindow[0]}&end=${intervalWindow[1]}`);
      this.intervalCount = this.histogram[0][2];
      if (this.isEmpty) {
        // Empty out whatever we were looking at before and bail immediately
        this.intervalStream = null;
        this.intervalCache = {};
        this.newIntervalCache = null;
        this.render();
        return;
      }

      // Start the interval stream, and collect it in a separate cache to avoid
      // old intervals from disappearing from incremental refreshes
      this.newIntervalCache = {};
      const intervalStreamUrl = `/datasets/${label}/intervals?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`;
      const currentIntervalStream = this.intervalStream = oboe(intervalStreamUrl)
        .fail(error => {
          this.error = error;
          console.log(error);
        })
        .node('!.*', function (interval) {
          if (currentIntervalStream !== self.intervalStream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            self.newIntervalCache[interval.intervalId] = interval;
            self.renderThrottled();
          }
        })
        .done(() => {
          this.intervalStream = null;
          this.intervalCache = this.newIntervalCache;
          this.newIntervalCache = null;
          this.render();
        });

      // Start the traceback stream (if something is selected), using the same
      // separate cacheing trick. TODO: we're doing this in conjunction with the
      // rest of the data collection, only because panning / zooming could
      // necessitate requesting a longer traceback; ideally changing the selected
      // interval shouldn't trigger a full data request. Maybe the selection
      // interaction could be faster if we did this separately?
      if (!this.linkedState.selectedIntervalId) {
        this.tracebackStream = null;
        this.tracebackCache = {
          visibleIds: [],
          rightEndpoint: null,
          leftEndpoint: null
        };
        this.newTracebackCache = null;
        this.lastTracebackTarget = null;
      } else {
        this.newTracebackCache = {
          visibleIds: [],
          rightEndpoint: null,
          leftEndpoint: null
        };
        const tracebackTarget = this.linkedState.selectedIntervalId;
        const tracebackStreamUrl = `/datasets/${label}/intervals/${tracebackTarget}/trace?begin=${intervalWindow[0]}&end=${intervalWindow[1]}`;
        const currentTracebackStream = this.tracebackStream = oboe(tracebackStreamUrl)
          .fail(error => {
            this.error = error;
            console.log(error);
          })
          .node('!.*', function (idOrMetadata) {
            if (currentTracebackStream !== self.tracebackStream) {
              this.abort();
              return;
            } else if (typeof idOrMetadata === 'string') {
              self.newTracebackCache.visibleIds.push(idOrMetadata);
            } else if (idOrMetadata.beginTimestamp !== undefined) {
              self.newTracebackCache.rightEndpoint = idOrMetadata;
            } else if (idOrMetadata.endTimestamp !== undefined) {
              self.newTracebackCache.leftEndpoint = idOrMetadata;
            }
            self.renderThrottled();
          })
          .done(() => {
            this.tracebackStream = null;
            this.tracebackCache = this.newTracebackCache;
            this.newTracebackCache = null;
            this.lastTracebackTarget = tracebackTarget;
            this.render();
          });
      }

      // We need a render call here as the streams have just started up, mostly
      // to show the spinner
      this.render();
    }, 100);
  }
  renderThrottled () {
    // TODO
  }
  get isLoading () {
    return super.isLoading || this.intervalStream !== null || this.tracebackStream !== null;
  }
  get isEmpty () {
    return this.error || this.intervalCount === 0 || this.intervalCount > this.renderCutoff;
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
    this.yScale.range([0, result.height]);
    return result;
  }
  setup () {
    super.setup();

    this.content.html(this.resources[1]);

    this.margin = {
      top: 20,
      right: 20,
      bottom: 40,
      left: 40
    };
    this.content.select('.chart')
      .attr('transform', `translate(${this.margin.left},${this.margin.top})`);

    // Create a view-specific clipPath id, as there can be more than one
    // GanttView in the app
    const clipId = this.uniqueDomId + 'clip';
    this.content.select('clipPath')
      .attr('id', clipId);
    this.content.select('.clippedStuff')
      .attr('clip-path', `url(#${clipId})`);

    // Set up zoom / pan interactions
    this.setupZoomAndPan();

    // Update scales whenever something changes the brush
    this.linkedState.on('newIntervalWindow', () => {
      this.xScale.domain(this.linkedState.intervalWindow);
      this.yScale.domain(this.linkedState.metadata.locationNames);
      // Abort + re-start the stream
      this.getData();
    });
    // Retrieve new data whenever the selected interval changes
    this.linkedState.on('intervalIdSelected', () => {
      this.getData();
    });
    // Initialize the scales / stream
    this.xScale.domain(this.linkedState.intervalWindow);
    this.yScale.domain(this.linkedState.metadata.locationNames);
    this.getData();

    // Draw the axes right away (because we have a longer debounceWait than
    // normal, there's an initial ugly flash before draw() gets called)
    this._bounds = this.getChartBounds();
    this.drawAxes();

    // Redraw when a new primitive is selected
    // TODO: can probably do this immediately in a more light-weight way?
    this.linkedState.on('primitiveSelected', () => { this.render(); });

    this.content.select('.background')
      .on('click', () => {
        this.linkedState.selectPrimitive(null);
        this.linkedState.selectIntervalId(null);
        this.render();
      });
  }
  draw () {
    super.draw();

    if (this.isHidden) {
      return;
    } else if (this.isEmpty) {
      if (this.error) {
        this.emptyStateDiv.html(`<p>Error communicating with the server</p>`);
      } else if (this.intervalCount === 0) {
        this.emptyStateDiv.html('<p>No data in the current view</p>');
      } else {
        this.emptyStateDiv.html('<p>Too much data; scroll to zoom in</p>');
      }
    }
    // Update the dimensions of the plot in case we were resized (NOT updated by
    // immediately-drawn things like drawAxes that get executed repeatedly by
    // scrolling / panning)
    this._bounds = this.getChartBounds();

    // Combine old intervals with any new ones that are streaming in for more
    // seamless zooming / panning
    const intervals = Object.assign({}, this.intervalCache, this.newIntervalCache || {});
    // Do the same with the traceback, but only if the target is the same as
    // the last time that we fetched data
    let traceback;
    if (this.newTracebackCache !== null &&
        this.linkedState.selectedIntervalId !== null &&
        this.linkedState.selectedIntervalId === this.lastTracebackTarget) {
      // Combine the list of visibleIds, but only include the left / right
      // endpoints of newTracebackCache (in the event that the target interval
      // was just scrolled back into view, don't draw any lines beyond it)
      traceback = {
        visibleIds: this.newTracebackCache.visibleIds.length > this.tracebackCache.visibleIds.length
          ? this.newTracebackCache.visibleIds : this.tracebackCache.visibleIds,
        leftEndpoint: this.newTracebackCache.leftEndpoint,
        rightEndpoint: this.newTracebackCache.rightEndpoint
      };
    } else if (this.newTracebackCache !== null) {
      // Need to make a copy, because otherwise this.drawLinks() could
      // potentially mutate this.newTracebackCache
      traceback = Object.assign({}, this.newTracebackCache);
    } else {
      // Need to make a copy, because otherwise this.drawLinks() could
      // potentially mutate this.tracebackCache
      traceback = Object.assign({}, this.tracebackCache);
    }

    // Update whether we're showing the spinner
    this.content.select('.small.spinner').style('display', this.isLoading ? null : 'none');
    // Update the clip rect
    this.drawClip();
    // Update the axes (also updates scales)
    this.drawAxes();

    // Update the bars
    this.drawBars(intervals);
    // Update the links
    this.drawLinks(intervals, traceback);
  }
  drawClip () {
    this.content.select('clipPath rect')
      .attr('width', this._bounds.width)
      .attr('height', this._bounds.height);
  }
  drawAxes () {
    // Update the x axis
    const xAxisGroup = this.content.select('.xAxis')
      .attr('transform', `translate(0, ${this._bounds.height})`)
      .call(d3.axisBottom(this.xScale));
    cleanupAxis(xAxisGroup);

    // Position the x label
    this.content.select('.xAxisLabel')
      .attr('x', this._bounds.width / 2)
      .attr('y', this._bounds.height + this.margin.bottom - this.emSize / 2);

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
      .attr('x2', this._bounds.width)
      .attr('y1', lineOffset)
      .attr('y2', lineOffset);

    yTicksEnter.append('text');
    yTicks.select('text')
      .attr('text-anchor', 'end')
      .attr('y', '0.35em')
      .text(d => d);

    // Position the y label
    this.content.select('.yAxisLabel')
      .attr('transform', `translate(${-this.emSize},${this._bounds.height / 2}) rotate(-90)`);
  }
  drawBars (intervals) {
    if (!this.initialDragState) {
      // Remove temporarily patched transformations
      this.content.select('.bars').attr('transform', null);
    }

    let bars = this.content.select('.bars')
      .selectAll('.bar').data(d3.entries(intervals), d => d.key);
    bars.exit().remove();
    const barsEnter = bars.enter().append('g')
      .classed('bar', true);
    bars = bars.merge(barsEnter);

    bars.attr('transform', d => `translate(${this.xScale(d.value.enter.Timestamp)},${this.yScale(d.value.Location)})`);

    barsEnter.append('rect')
      .classed('area', true);
    barsEnter.append('rect')
      .classed('outline', true);
    bars.selectAll('rect')
      .attr('height', this.yScale.bandwidth())
      .attr('width', d => this.xScale(d.value.leave.Timestamp) - this.xScale(d.value.enter.Timestamp));

    bars.select('.area')
      .style('fill', d => {
        if (d.value.GUID === this.linkedState.selectedGUID) {
          return this.linkedState.mouseHoverSelectionColor;
        } else if (d.value.Primitive === this.linkedState.selectedPrimitive) {
          return this.linkedState.selectionColor;
        } else {
          return null;
        }
      });

    bars.select('.outline')
    // TODO: make this like the area fill
      .style('stroke', d => {
        if (d.value.hasOwnProperty('inTraceBack') && d.value.inTraceBack) {
          return this.linkedState.traceBackColor;
        } else if (d.value.Primitive === this.linkedState.selectedPrimitive) {
          return this.linkedState.selectionColor;
        } else {
          return null;
        }
      });
    bars
      .classed('selected', d => d.value.Primitive === this.linkedState.selectedPrimitive)
      .on('click', d => {
        if (!d.value.Primitive) {
          console.warn(`No (consistent) primitive for interval: ${JSON.stringify(d.value, null, 2)}`);
          if (d.value.enter.Primitive) {
            if (this.linkedState.selectedPrimitive !== d.value.enter.Primitive) {
              this.linkedState.selectPrimitive(d.value.enter.Primitive);
            } else {
              this.linkedState.selectPrimitive(null);
            }
          }
        } else {
          if (this.linkedState.selectedPrimitive !== d.value.Primitive) {
            this.linkedState.selectPrimitive(d.value.Primitive);
          } else {
            this.linkedState.selectPrimitive(null);
          }
        }

        if (!d.value.intervalId) {
          this.linkedState.selectIntervalId(null);
        } else if (d.value.intervalId === this.linkedState.selectedIntervalId) {
          this.linkedState.selectIntervalId(null);
        } else {
          this.linkedState.selectIntervalId(d.value.intervalId);
        }
        this.render();
      }).on('dblclick', function (d) {
        window.controller.tooltip.show({
          content: `<pre>${JSON.stringify(d.value, null, 2)}</pre>`,
          targetBounds: this.getBoundingClientRect(),
          hideAfterMs: null
        });
      }).on('mouseenter', d => {
        if (!d.value.GUID) {
          console.warn(`No (consistent) GUID for interval: ${JSON.stringify(d.value, null, 2)}`);
          if (d.value.enter.GUID) {
            this.linkedState.selectGUID(d.value.enter.GUID);
          }
        } else {
          this.linkedState.selectGUID(d.value.GUID);
        }
        this.render();
      }).on('mouseleave', () => {
        window.controller.tooltip.hide();
        this.linkedState.selectGUID(null);
        this.render();
      });
  }
  drawLinks (intervals, traceback) {
    if (!this.initialDragState) {
      // Remove temporarily patched transformations
      this.content.select('.links').attr('transform', null);
    }

    // Derive a list of intervals from the streamed list of IDs
    let linkData = [];
    for (const intervalId of traceback.visibleIds) {
      if (intervals[intervalId]) {
        linkData.push(intervals[intervalId]);
      } else {
        // The list of IDs came back faster than the intervals themselves, we
        // should cut off the line at this point (should only happen during
        // incremental rendering)
        delete traceback.leftEndpoint;
        break;
      }
    }

    if (linkData.length > 0) {
      if (traceback.leftEndpoint && linkData.length > 0) {
        // Copy the important parts of the first interval object, overriding
        // lastParentInterval
        linkData[0] = {
          intervalId: linkData[0].intervalId,
          Location: linkData[0].Location,
          enter: { Timestamp: linkData[0].enter.Timestamp },
          lastParentInterval: traceback.leftEndpoint
        };
      } else if (!linkData[linkData.length - 1].lastParentInterval) {
        // In cases where an interval with no parent is at the beginning of the
        // traceback, there's no line to draw to the left; we can just omit it
        linkData.splice(-1);
      }
      if (traceback.rightEndpoint && linkData.length > 0) {
        // Construct a fake "interval" for the right endpoint, because we draw
        // lines to the left
        const parent = linkData[linkData.length - 1];
        linkData.push({
          intervalId: traceback.rightEndpoint.id,
          Location: traceback.rightEndpoint.location,
          enter: { Timestamp: traceback.rightEndpoint.beginTimestamp },
          lastParentInterval: {
            id: parent.intervalId,
            endTimestamp: parent.leave.Timestamp,
            location: parent.Location
          }
        });
      }
    }

    let links = this.content.select('.links')
      .selectAll('.link').data(linkData, d => d.intervalId);
    links.exit().remove();
    const linksEnter = links.enter().append('g')
      .classed('link', true);
    links = links.merge(linksEnter);

    // links.attr('transform', d => `translate(${this.xScale(d.value.lastGuidEndTimestamp)},${this.yScale(d.value.lastGuidLocation)})`);
    let halfwayOffset = this.yScale.bandwidth() / 2;

    linksEnter.append('line')
      .classed('line', true);
    links.selectAll('line')
      .attr('x1', d => this.xScale(d.lastParentInterval.endTimestamp))
      .attr('x2', d => this.xScale(d.enter.Timestamp))
      .attr('y1', d => this.yScale(d.lastParentInterval.location) + halfwayOffset)
      .attr('y2', d => this.yScale(d.Location) + halfwayOffset);
  }
  setupZoomAndPan () {
    this.initialDragState = null;
    let latentWidth = null;
    const clampWindow = (begin, end) => {
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
      return { begin, end };
    };
    this.content
      .on('wheel', () => {
        const zoomFactor = 1.05 ** (normalizeWheel(d3.event).pixelY / 100);
        const originalWidth = this.linkedState.end - this.linkedState.begin;
        // Clamp the width to a min of 10ms, and the largest possible size
        let targetWidth = Math.max(zoomFactor * originalWidth, 10);
        targetWidth = Math.min(targetWidth, this.linkedState.endLimit - this.linkedState.beginLimit);
        // Compute the new begin / end points, centered on where the user is mousing
        const mousedScreenPoint = d3.event.clientX - this._bounds.left - this.margin.left;
        const mousedPosition = this.xScale.invert(mousedScreenPoint);
        const begin = mousedPosition - (targetWidth / originalWidth) * (mousedPosition - this.linkedState.begin);
        const end = mousedPosition + (targetWidth / originalWidth) * (this.linkedState.end - mousedPosition);
        const actualBounds = clampWindow(begin, end);

        // There isn't a begin / end wheel event, so trigger the update across
        // views immediately
        this.linkedState.setIntervalWindow(actualBounds);

        // For responsiveness, draw the axes immediately (the debounced, full
        // render() triggered by changing linkedState may take a while)
        this.drawAxes();

        // Patch a temporary scale transform to the bars / links layers (this
        // gets removed by full drawBars() / drawLinks() calls)
        if (!this.content.select('.bars').attr('transform')) {
          latentWidth = originalWidth;
        }
        const actualZoomFactor = latentWidth / (actualBounds.end - actualBounds.begin);
        const zoomCenter = (1 - actualZoomFactor) * mousedScreenPoint;
        this.content.selectAll('.bars, .links')
          .attr('transform', `translate(${zoomCenter}, 0) scale(${actualZoomFactor}, 1)`);
        // Show the small spinner to indicate that some of the stuff the user
        // sees may be inaccurate (will be hidden once the full draw() call
        // happens)
        this.content.select('.small.spinner').style('display', null);
      }).call(d3.drag()
        .on('start', () => {
          this.initialDragState = {
            begin: this.linkedState.begin,
            end: this.linkedState.end,
            x: this.xScale.invert(d3.event.x),
            scale: d3.scaleLinear()
              .domain(this.xScale.domain())
              .range(this.xScale.range())
          };
        })
        .on('drag', () => {
          const mousedPosition = this.initialDragState.scale.invert(d3.event.x);
          const dx = this.initialDragState.x - mousedPosition;
          const begin = this.initialDragState.begin + dx;
          const end = this.initialDragState.end + dx;
          const actualBounds = clampWindow(begin, end);
          // Don't bother triggering a full update mid-drag...
          // this.linkedState.setIntervalWindow(actualBounds)

          // For responsiveness, draw the axes immediately (the debounced, full
          // render() triggered by changing linkedState may take a while)
          this.drawAxes();

          // Patch a temporary translation to the bars / links layers (this gets
          // removed by full drawBars() / drawLinks() calls)
          const shift = this.initialDragState.scale(this.initialDragState.begin) -
            this.initialDragState.scale(actualBounds.begin);
          this.content.selectAll('.bars, .links')
            .attr('transform', `translate(${shift}, 0)`);

          // Show the small spinner to indicate that some of the stuff the user
          // sees may be inaccurate (will be hidden once the full draw() call
          // happens)
          this.content.select('.small.spinner').style('display', null);

          // d3's drag behavior captures + prevents updating the cursor, so do
          // that manually
          this.linkedState.moveCursor(mousedPosition);
          this.updateCursor();
        })
        .on('end', () => {
          const dx = this.initialDragState.x - this.initialDragState.scale.invert(d3.event.x);
          const begin = this.initialDragState.begin + dx;
          const end = this.initialDragState.end + dx;
          this.initialDragState = null;

          this.linkedState.setIntervalWindow(clampWindow(begin, end));
        }));
  }
}
GanttView.DOM_COUNT = 1;
export default GanttView;
