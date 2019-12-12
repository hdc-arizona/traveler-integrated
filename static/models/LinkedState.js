/* globals d3, oboe */
import { Model } from '/static/node_modules/uki/dist/uki.esm.js';

class LinkedState extends Model {
  constructor (label, metadata) {
    super();

    this.label = label;
    this.metadata = metadata;
    // Sometimes the locations aren't sorted (todo: enable interactive sorting?)
    if (this.metadata.locationNames) {
      this.metadata.locationNames.sort();
    }
    // Don't bother retrieving intervals if there are more than 7000 in this.intervalWindow
    this.intervalCutoff = 7000;
    this.intervalWindow = this.metadata.intervalDomain ? Array.from(this.metadata.intervalDomain) : null;
    this.cursorPosition = null;
    this.selectedPrimitive = null;
    this.selectedGUID = null;
    this.selectedIntervalId = null;
    this.streamCaches = {};
    this._mode = 'Inclusive';
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
      this.startIntervalStream();
      this.startTracebackStream();
    })();
  }
  get begin () {
    return this.intervalWindow[0];
  }
  get end () {
    return this.intervalWindow[1];
  }
  get beginLimit () {
    return this.metadata.intervalDomain[0];
  }
  get endLimit () {
    return this.metadata.intervalDomain[1];
  }
  get mode () {
    return this._mode;
  }
  set mode (newMode) {
    this._mode = newMode;
    this.trigger('changeMode');
  }
  setIntervalWindow ({
    begin = this.begin,
    end = this.end
  } = {}) {
    if (this.intervalDomain === null) {
      throw new Error("Can't set interval window; no interval data");
    }
    const oldBegin = this.begin;
    const oldEnd = this.end;
    // Clamp to where there's actually data
    begin = Math.max(this.beginLimit, begin);
    end = Math.min(this.endLimit, end);
    this.intervalWindow = [begin, end];
    this.startIntervalStream();
    this.startTracebackStream();
    if (oldBegin !== begin || oldEnd !== end) {
      this.stickyTrigger('newIntervalWindow', { begin, end });
    }
  }
  selectPrimitive (primitive) {
    if (primitive !== this.selectedPrimitive) {
      this.selectedPrimitive = primitive;
      this.trigger('primitiveSelected', { primitive });
    }
  }
  selectGUID (guid) {
    if (guid !== this.selectedGUID) {
      this.selectedGUID = guid;
      this.trigger('guidSelected', { guid });
    }
  }
  selectIntervalId (intervalId) {
    if (intervalId !== this.selectedIntervalId) {
      this.selectedIntervalId = intervalId;
      this.startTracebackStream();
      this.trigger('intervalIdSelected', { intervalId });
    }
  }
  moveCursor (position) {
    this.cursorPosition = position;
    this.trigger('moveCursor');
  }
  getPrimitiveDetails (primitiveName = this.selectedPrimitive) {
    return this.primitives ? this.primitives[primitiveName] : null;
  }
  get timeScale () {
    // TODO: identify the color map based on the data, across views...
    return LinkedState.COLOR_SCHEMES[this.mode].timeScale;
  }
  get selectionColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].selectionColor;
  }
  get mouseHoverSelectionColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].mouseHoverSelectionColor;
  }
  get traceBackColor () {
    return LinkedState.COLOR_SCHEMES[this.mode].traceBackColor;
  }
  getPossibleViews () {
    const views = {};
    for (const { fileType } of this.metadata.sourceFiles) {
      if (fileType === 'log' || fileType === 'newick') {
        views['TreeView'] = true;
      } else if (fileType === 'otf2') {
        views['GanttView'] = true;
        views['UtilizationView'] = true;
      } else if (fileType === 'cpp') {
        views['CppView'] = true;
      } else if (fileType === 'python') {
        views['PythonView'] = true;
      } else if (fileType === 'physl') {
        views['PhyslView'] = true;
      }
    }
    return views;
  }
  get isLoadingIntervals () {
    return !!this.streamCaches.intervalStream;
  }
  get loadedIntervalCount () {
    return Object.keys(this.streamCaches.intervals || {}).length +
      Object.keys(this.streamCaches.newIntervals || {}).length;
  }
  get tooManyIntervals () {
    return !!this.streamCaches.intervalOverflow;
  }
  get isLoadingTraceback () {
    return !!this.streamCaches.intervalStream;
  }
  getCurrentIntervals () {
    // Combine old data with any new data that's streaming in for more
    // seamless zooming / panning
    const oldIntervals = this.streamCaches.intervals || {};
    const newIntervals = this.streamCaches.newIntervals || {};
    return Object.assign({}, oldIntervals, newIntervals);
  }
  getCurrentTraceback () {
    // Returns a right-to-left list of intervals
    let traceback = this.streamCaches.traceback ||
      this.streamCaches.newTraceback;

    if (traceback === undefined) {
      return [];
    }

    // Make a copy of the traceback so we don't mutate the cache
    traceback = Object.assign({}, traceback);

    // Derive a list of intervals from the streamed list of IDs
    const intervals = this.getCurrentIntervals();
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
      if (traceback.rightEndpoint) {
        // Construct a fake "interval" for the right endpoint, because we draw
        // lines to the left (linkData is right-to-left)
        const parent = linkData[0];
        linkData.unshift({
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
      if (traceback.leftEndpoint) {
        // Copy the important parts of the leftmost interval object, overriding
        // lastParentInterval (linkData is right-to-left)
        const firstInterval = linkData[linkData.length - 1];
        linkData[linkData.length - 1] = {
          intervalId: firstInterval.intervalId,
          Location: firstInterval.Location,
          enter: { Timestamp: firstInterval.enter.Timestamp },
          lastParentInterval: traceback.leftEndpoint
        };
      } else if (!linkData[linkData.length - 1].lastParentInterval) {
        // In cases where an interval with no parent is at the beginning of the
        // traceback, there's no line to draw to the left; we can just omit it
        linkData.splice(-1);
      }
    }
    return linkData;
  }
  startIntervalStream () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._intervalTimeout);
    this._intervalTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.label);
      // First check whether we're asking for too much data by getting a
      // histogram with a single bin (TODO: draw per-location histograms instead
      // of just saying "Too much data; scroll to zoom in?")
      let bailEarly = this.intervalWindow === null;
      if (!bailEarly) {
        const histogram = await d3.json(`/datasets/${label}/histogram?bins=1&mode=count&begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`);
        const intervalCount = histogram[0][2];
        bailEarly = intervalCount === 0 || intervalCount > this.intervalCutoff;
        this.streamCaches.intervalOverflow = intervalCount > this.intervalCutoff;
      }

      if (bailEarly) {
        // Empty out whatever we were looking at before and bail immediately
        delete this.streamCaches.intervals;
        delete this.streamCaches.newIntervals;
        delete this.streamCaches.intervalStream;
        delete this.streamCaches.intervalError;
        this.trigger('intervalStreamFinished');
        return;
      }

      // Start the interval stream, and collect it in a separate cache to avoid
      // old intervals from disappearing from incremental refreshes
      this.trigger('intervalStreamStarted');
      this.streamCaches.newIntervals = {};
      this.streamCaches.intervalOverflow = false;
      const self = this;
      const intervalStreamUrl = `/datasets/${label}/intervals?begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`;
      const currentIntervalStream = this.streamCaches.intervalStream = oboe(intervalStreamUrl)
        .fail(error => {
          this.streamCaches.intervalError = error;
          console.warn(error);
        })
        .node('!.*', function (interval) {
          delete self.streamCaches.intervalError;
          if (currentIntervalStream !== self.streamCaches.intervalStream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            self.streamCaches.newIntervals[interval.intervalId] = interval;
            self.trigger('intervalsUpdated');
          }
        })
        .done(() => {
          delete this.streamCaches.intervalStream;
          this.streamCaches.intervals = this.streamCaches.newIntervals;
          delete this.streamCaches.newIntervals;
          this.trigger('intervalStreamFinished');
        });
    }, 100);
  }
  startTracebackStream () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._tracebackTimeout);
    this._tracebackTimeout = window.setTimeout(async () => {
      // Is there even anything to stream?
      if (!this.selectedIntervalId || this.intervalWindow === null) {
        delete this.streamCaches.traceback;
        delete this.streamCaches.newTraceback;
        delete this.streamCaches.tracebackStream;
        delete this.streamCaches.tracebackError;
        this.trigger('tracebackStreamFinished');
        return;
      }

      this.trigger('tracebackStreamStarted');
      this.streamCaches.newTraceback = {
        visibleIds: [],
        rightEndpoint: null,
        leftEndpoint: null
      };
      const self = this;
      const label = encodeURIComponent(this.label);
      const tracebackStreamUrl = `/datasets/${label}/intervals/${this.selectedIntervalId}/trace?begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`;
      const currentTracebackStream = this.streamCaches.tracebackStream = oboe(tracebackStreamUrl)
        .fail(error => {
          this.streamCaches.tracebackError = error;
          console.warn(error);
        })
        .node('!.*', function (idOrMetadata) {
          delete self.streamCaches.tracebackError;
          if (currentTracebackStream !== self.streamCaches.tracebackStream) {
            this.abort();
            return;
          } else if (typeof idOrMetadata === 'string') {
            self.streamCaches.newTraceback.visibleIds.push(idOrMetadata);
          } else if (idOrMetadata.beginTimestamp !== undefined) {
            self.streamCaches.newTraceback.rightEndpoint = idOrMetadata;
          } else if (idOrMetadata.endTimestamp !== undefined) {
            self.streamCaches.newTraceback.leftEndpoint = idOrMetadata;
          }
          self.trigger('tracebackUpdated');
        })
        .done(() => {
          delete this.streamCaches.tracebackStream;
          this.streamCaches.traceback = this.streamCaches.newTraceback;
          delete this.streamCaches.newTraceback;
          this.trigger('tracebackStreamFinished');
        });
    }, 100);
  }
}
LinkedState.COLOR_SCHEMES = {
  Inclusive: {
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#e6ab02', // yellow
    traceBackColor: '#000000', // black
    timeScale: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'] // purple
  },
  Exclusive: {
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#7570b3', // purple
    traceBackColor: '#000000', // black
    timeScale: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'] // green
  },
  Difference: {
    mouseHoverSelectionColor: '#a30012', // red
    selectionColor: '#4daf4a', // green
    traceBackColor: '#000000', // black
    timeScale: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'] // diverging red blue
  }
};
export default LinkedState;
