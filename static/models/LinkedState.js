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
    this.intervalWindow = this.metadata.intervalDomain ? Array.from(this.metadata.intervalDomain) : null;
    this.cursorPosition = null;
    this.selectedPrimitive = null;
    this.selectedGUID = null;
    this.selectedIntervalId = null;
    this.intervalCount = null;
    this._intervalCache = {};
    this._tracebackCache = {};
    this._mode = 'Inclusive';
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
      this.startStreamingIntervals();
      this.startStreamingTraceback();
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
    this.startStreamingIntervals();
    this.startStreamingTraceback();
    if (oldBegin !== begin || oldEnd !== end) {
      this.stickyTrigger('newIntervalWindow', { begin, end });
    }
  }
  selectPrimitive (primitive) {
    if (primitive !== this.selectedPrimitive) {
      this.selectedPrimitive = primitive;
      this.stickyTrigger('primitiveSelected', { primitive });
    }
  }
  selectGUID (guid) {
    if (guid !== this.selectedGUID) {
      this.selectedGUID = guid;
      this.stickyTrigger('guidSelected', { guid });
    }
  }
  selectIntervalId (intervalId) {
    if (intervalId !== this.selectedIntervalId) {
      this.selectedIntervalId = intervalId;
      this.startStreamingTraceback();
      this.stickyTrigger('intervalIdSelected', { intervalId });
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
  startStreamingIntervals () {
    // Debounce the start of this expensive process...
    window.clearTimeout(this._intervalTimeout);
    this._intervalTimeout = window.setTimeout(async () => {
      const label = encodeURIComponent(this.label);
      // First check whether we're asking for too much data by getting a
      // histogram with a single bin (TODO: draw per-location histograms instead
      // of just saying "Too much data; scroll to zoom in?")
      const histogram = await d3.json(`/datasets/${label}/histogram?bins=1&mode=count&begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`);
      this.intervalCount = histogram[0][2];
      if (this.isEmpty) {
        // Empty out whatever we were looking at before and bail immediately
        this._intervalStream = null;
        this._intervalCache = {};
        this._newIntervalCache = null;
        this.trigger('intervalsReady', this.intervalCache);
        return;
      }

      // Start the interval stream, and collect it in a separate cache to avoid
      // old intervals from disappearing from incremental refreshes
      this._newIntervalCache = {};
      const self = this;
      const intervalStreamUrl = `/datasets/${label}/intervals?begin=${this.intervalWindow[0]}&end=${this.intervalWindow[1]}`;
      const currentIntervalStream = this._intervalStream = oboe(intervalStreamUrl)
        .fail(error => {
          this._intervalError = error;
          console.warn(error);
        })
        .node('!.*', function (interval) {
          delete this._intervalError;
          if (currentIntervalStream !== self._intervalStream) {
            // A different stream has been started; abort this one
            this.abort();
          } else {
            // Store the interval
            self._newIntervalCache[interval.intervalId] = interval;
            self.renderThrottled();
          }
        })
        .done(() => {
          this._intervalStream = null;
          this._intervalCache = this.newIntervalCache;
          this._newIntervalCache = null;
          this.trigger('intervalsReady', this.intervalCache);
        });
    }, 100);
  }
  startStreamingTraceback () {
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
