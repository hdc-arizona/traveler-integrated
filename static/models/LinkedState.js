/* globals d3 */
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
    this._mode = 'Inclusive';
    (async () => {
      this.primitives = await d3.json(`/datasets/${encodeURIComponent(this.label)}/primitives`);
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
}
LinkedState.COLOR_SCHEMES = {
  Inclusive: {
    mouseHoverSelectionColor : '#a30012', // red
    selectionColor: '#e6ab02', // yellow
    traceBackColor: '#000000', // black
    timeScale: ['#f2f0f7', '#cbc9e2', '#9e9ac8', '#756bb1', '#54278f'] // purple
  },
  Exclusive: {
    mouseHoverSelectionColor : '#a30012', // red
    selectionColor: '#7570b3', // purple
    traceBackColor: '#000000', // black
    timeScale: ['#edf8fb', '#b2e2e2', '#66c2a4', '#2ca25f', '#006d2c'] // green
  },
  Difference: {
    mouseHoverSelectionColor : '#a30012', // red
    selectionColor: '#4daf4a', // green
    traceBackColor: '#000000', // black
    timeScale: ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'] // diverging red blue
  }
};
export default LinkedState;
