/* globals d3, less */
class Model {
  constructor(resources = []) {
    this._eventHandlers = {};
    this._stickyTriggers = {};
    this.ready = new Promise(async (resolve, reject) => {
      await this._loadResources(resources);
      this.trigger('load');
      resolve();
    });
  }

  _loadJS(url, extraAttrs = {}) {
    if (document.querySelector(`script[src="${url}"]`)) {
      // We've already added this script
      return;
    }

    const script = document.createElement('script');
    script.type = 'application/javascript';

    for (const [key, value] of Object.entries(extraAttrs)) {
      script.setAttribute(key, value);
    }

    const loadPromise = new Promise((resolve, reject) => {
      script.onload = () => {
        resolve(script);
      };
    });
    script.src = url;
    document.getElementsByTagName('head')[0].appendChild(script);
    return loadPromise;
  }

  _loadCSS(url, extraAttrs = {}) {
    if (document.querySelector(`link[href="${url}"]`)) {
      // We've already added this stylesheet
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.media = 'screen';

    for (const [key, value] of Object.keys(extraAttrs)) {
      link.setAttribute(key, value);
    }

    const loadPromise = new Promise((resolve, reject) => {
      link.onload = () => {
        resolve(link);
      };
    });
    link.href = url;
    document.getElementsByTagName('head')[0].appendChild(link);
    return loadPromise;
  }

  async _loadLESS(url, extraAttrs = {}) {
    if (Model.LOADED_LESS[url] || document.querySelector(`link[href="${url}"]`)) {
      // We've already added this stylesheet
      return;
    } // TODO: maybe do magic to make LESS variables accessible under this.resources?


    const result = await less.render(`@import '${url}';`);
    const style = document.createElement('style');
    style.type = 'text/css';

    for (const [key, value] of Object.keys(extraAttrs)) {
      style.setAttribute(key, value);
    }

    style.innerHTML = result.css;
    Model.LOADED_LESS[url] = true;
    document.getElementsByTagName('head')[0].appendChild(style);
    return Promise.resolve(style);
  }

  async _loadResources(specs = []) {
    // Get d3.js if needed
    if (!window.d3) {
      await this._loadJS('https://cdnjs.cloudflare.com/ajax/libs/d3/5.15.1/d3.min.js', {
        'data-log-level': '1'
      });
    } // Add and await LESS script if relevant


    const hasLESSresources = specs.find(spec => spec.type === 'less') || document.querySelector(`link[rel="stylesheet/less"]`);

    if (hasLESSresources && !window.less) {
      if (!window.less) {
        await this._loadJS('https://cdnjs.cloudflare.com/ajax/libs/less.js/3.11.1/less.min.js');
      }
    }

    this._resourceLookup = {};
    const resourcePromises = specs.map((spec, i) => {
      if (spec.name) {
        this._resourceLookup[spec.name] = i;
      }

      let p;

      if (spec instanceof Promise) {
        // An arbitrary promise
        return spec;
      } else if (spec.type === 'css') {
        // Load pure css directly
        p = this._loadCSS(spec.url, spec.extraAttributes || {});
      } else if (spec.type === 'less') {
        // Convert LESS to CSS
        p = this._loadLESS(spec.url, spec.extraAttributes || {});
      } else if (spec.type === 'fetch') {
        // Raw fetch request
        p = window.fetch(spec.url, spec.init || {});
      } else if (spec.type === 'js') {
        // Load a legacy JS script (i.e. something that can't be ES6-imported)
        p = this._loadJS(spec.url, spec.extraAttributes || {});
      } else if (d3[spec.type]) {
        // One of D3's native types
        const args = [];

        if (spec.init) {
          args.push(spec.init);
        }

        if (spec.row) {
          args.push(spec.row);
        }

        if (spec.type === 'dsv') {
          p = d3[spec.type](spec.delimiter, spec.url, ...args);
        } else {
          p = d3[spec.type](spec.url, ...args);
        }
      } else {
        throw new Error(`Can't load resource ${spec.url} of type ${spec.type}`);
      }

      if (spec.then) {
        p.then(spec.then);
      }

      return p;
    });
    this.resources = await Promise.all(resourcePromises);

    if (hasLESSresources) {
      // Some views / other libraries (e.g. goldenLayout) require LESS styles
      // to already be loaded before they attempt to render; this ensures that
      // LESS styles NOT requested by uki are still loaded
      await less.pageLoadFinished;
    }
  }

  getNamedResource(name) {
    return this._resourceLookup[name] === undefined ? null : this.resources[this._resourceLookup[name]];
  }

  on(eventName, callback) {
    let [event, namespace] = eventName.split('.');
    this._eventHandlers[event] = this._eventHandlers[event] || {
      '': []
    };

    if (!namespace) {
      this._eventHandlers[event][''].push(callback);
    } else {
      this._eventHandlers[event][namespace] = callback;
    }
  }

  off(eventName, callback) {
    let [event, namespace] = eventName.split('.');

    if (this._eventHandlers[event]) {
      if (!namespace) {
        if (!callback) {
          this._eventHandlers[event][''] = [];
        } else {
          let index = this._eventHandlers[event][''].indexOf(callback);

          if (index >= 0) {
            this._eventHandlers[event][''].splice(index, 1);
          }
        }
      } else {
        delete this._eventHandlers[event][namespace];
      }
    }
  }

  trigger(event, ...args) {
    // TODO: maybe promise-ify this, so that anyone triggering an event has a
    // way of knowing that everyone has finished responding to it?
    const handleCallback = callback => {
      window.setTimeout(() => {
        // Timeout to prevent blocking
        callback.apply(this, args);
      }, 0);
    };

    if (this._eventHandlers[event]) {
      for (const namespace of Object.keys(this._eventHandlers[event])) {
        if (namespace === '') {
          this._eventHandlers[event][''].forEach(handleCallback);
        } else {
          handleCallback(this._eventHandlers[event][namespace]);
        }
      }
    }
  }

  stickyTrigger(eventName, argObj, delay = 10) {
    this._stickyTriggers[eventName] = this._stickyTriggers[eventName] || {
      argObj: {}
    };
    Object.assign(this._stickyTriggers[eventName].argObj, argObj);
    clearTimeout(this._stickyTriggers.timeout);
    this._stickyTriggers.timeout = setTimeout(() => {
      let argObj = this._stickyTriggers[eventName].argObj;
      delete this._stickyTriggers[eventName];
      this.trigger(eventName, argObj);
    }, delay);
  }

}

Model.LOADED_LESS = {};

/**
 * View classes
 */

class View extends Model {
  constructor(d3el = null, resources) {
    super(resources);
    this.d3el = this.checkForEmptySelection(d3el);
    this.dirty = true;
    this._drawTimeout = null;
    this._renderResolves = [];
    this.debounceWait = 100;
    this.render();
  }

  checkForEmptySelection(d3el) {
    if (d3el && d3el.node() === null) {
      // Only trigger a warning if an empty selection gets passed in; undefined
      // is still just fine because render() doesn't always require an argument
      console.warn('Empty d3 selection passed to uki.js View');
      return null;
    } else {
      return d3el;
    }
  }

  async render(d3el = this.d3el) {
    d3el = this.checkForEmptySelection(d3el);

    if (!this.d3el || d3el && d3el.node() !== this.d3el.node()) {
      this.d3el = d3el;
      this.dirty = true;
    }

    if (!this.d3el) {
      // Don't execute any render calls until all resources are loaded,
      // and we've actually been given a d3 element to work with
      return new Promise((resolve, reject) => {
        this._renderResolves.push(resolve);
      });
    }

    await this.ready;

    if (this.dirty && this._setupPromise === undefined) {
      // Need a fresh render; call setup immediately
      this.d3el = d3el;
      this.updateContainerCharacteristics(d3el);
      this._setupPromise = this.setup(d3el);
      this.dirty = false;
      await this._setupPromise;
      delete this._setupPromise;
      this.trigger('setupFinished');
    } // Debounce the actual draw call, and return a promise that will resolve
    // when draw() actually finishes


    return new Promise((resolve, reject) => {
      this._renderResolves.push(resolve);

      clearTimeout(this._drawTimeout);
      this._drawTimeout = setTimeout(async () => {
        this._drawTimeout = null;

        if (this._setupPromise) {
          await this._setupPromise;
        }

        await this.draw(d3el);

        for (const r of this._renderResolves) {
          r();
        }

        this._renderResolves = [];
      }, this.debounceWait);
    });
  }

  setup(d3el) {}

  draw(d3el) {}

  updateContainerCharacteristics(d3el) {
    this.bounds = d3el.node().getBoundingClientRect();
    this.emSize = parseFloat(d3el.style('font-size'));
    this.scrollBarSize = this.computeScrollBarSize(d3el);
  }

  computeScrollBarSize(d3el) {
    // blatantly adapted from SO thread:
    // http://stackoverflow.com/questions/13382516/getting-scroll-bar-width-using-javascript
    var outer = document.createElement('div');
    outer.style.visibility = 'hidden';
    outer.style.width = '100px';
    outer.style.msOverflowStyle = 'scrollbar'; // needed for WinJS apps

    d3el.node().appendChild(outer);
    var widthNoScroll = outer.offsetWidth; // force scrollbars

    outer.style.overflow = 'scroll'; // add innerdiv

    var inner = document.createElement('div');
    inner.style.width = '100%';
    outer.appendChild(inner);
    var widthWithScroll = inner.offsetWidth; // remove divs

    outer.parentNode.removeChild(outer);
    return widthNoScroll - widthWithScroll;
  }

}

/* globals gapi */

class GoogleSheetModel extends Model {
  constructor(resources = [], options) {
    if (!window.gapi) {
      resources.push({
        type: 'js',
        url: 'https://apis.google.com/js/api.js'
      });
    }

    super(resources);
    this.spreadsheetId = options.spreadsheetId;
    this.mode = options.mode || GoogleSheetModel.MODE.AUTH_READ_ONLY;

    if (!GoogleSheetModel.MODE[this.mode]) {
      throw new Error(`Mode ${this.mode} not supported yet`);
    }

    this.sheet = options.sheet || 'Sheet1';
    this._cache = null;
    this._status = GoogleSheetModel.STATUS.PENDING;
  }

  async _initWorkaroundPromise(apiKey, clientId) {
    // Really annoying google bug: https://github.com/google/google-api-javascript-client/issues/399
    // means that we have to wait 10ms before actually trying to call init() or it fails silently
    // :rage_emoji: ... can I please have the last week of my life back?
    if (!GoogleSheetModel._initPromise) {
      GoogleSheetModel._initPromise = new Promise((resolve, reject) => {
        window.setTimeout(() => {
          gapi.client.init({
            apiKey: apiKey,
            clientId: clientId,
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
            scope: this.mode === GoogleSheetModel.MODE.AUTH_READ_ONLY ? 'https://www.googleapis.com/auth/spreadsheets.readonly' : 'https://www.googleapis.com/auth/spreadsheets'
          }).then(resolve, reject);
        }, 10);
      });
    }

    return GoogleSheetModel._initPromise;
  }

  async setupAuth(apiKey, clientId) {
    await this.ready;

    if (this.mode === GoogleSheetModel.MODE.AUTH_READ_ONLY || this.mode === GoogleSheetModel.MODE.AUTH_READ_WRITE) {
      gapi.load('client:auth2', async () => {
        try {
          await this._initWorkaroundPromise(apiKey, clientId);
        } catch (error) {
          this.status = GoogleSheetModel.STATUS.ERROR;
          throw error;
        }

        const auth = gapi.auth2.getAuthInstance().isSignedIn; // Listen for status changes

        auth.listen(signedIn => {
          this.status = signedIn ? GoogleSheetModel.STATUS.SIGNED_IN : GoogleSheetModel.STATUS.SIGNED_OUT;
        }); // Figure out our initial status

        this.status = auth.get() ? GoogleSheetModel.STATUS.SIGNED_IN : GoogleSheetModel.STATUS.SIGNED_OUT;
      });
    } else {
      this.status = GoogleSheetModel.STATUS.NO_AUTH;
    }
  }

  get status() {
    return this._status;
  }

  set status(status) {
    this._status = status;

    if (this._status === GoogleSheetModel.STATUS.SIGNED_IN) {
      this.updateCache();
    } else {
      this._cache = null;
      this.trigger('dataUpdated');
    }

    this.trigger('statusChanged', status);
  }

  getHeaders() {
    const rawTable = this.getRawTable();
    return rawTable.length > 0 ? rawTable[0] : [];
  }

  getValues() {
    if (!this._valueCache) {
      const headers = this.getHeaders();
      this._valueCache = this.getRawTable().slice(1).map(row => {
        const obj = {};

        for (let i = 0; i < headers.length || i < row.length; i++) {
          let header = headers[i] || 'Blank Header';

          if (obj[header] !== undefined) {
            let extraHeader = 1;

            while (obj[header + extraHeader] !== undefined) {
              extraHeader += 1;
            }

            header = header + extraHeader;
          }

          obj[header] = row[i] || '';
        }

        return obj;
      });
    }

    return this._valueCache;
  }

  getRawTable() {
    return this._cache && this._cache.values || [];
  }

  async addRows(rows) {
    const headers = this.getHeaders();
    const initialHeaderLength = headers.length;
    await this.addRawRows(rows.map(row => {
      const list = [];
      const temp = Object.assign({}, row);

      for (const header of headers) {
        list.push(temp[header]);
        delete temp[header];
      }

      for (const [header, value] of Object.entries(temp)) {
        headers.push(header);
        list.push(value);
      }

      return list;
    }), true);

    if (initialHeaderLength < headers.length) {
      try {
        await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: this.sheet + '!1:1',
          valueInputOption: 'RAW'
        }, {
          majorDimension: 'ROWS',
          values: [headers]
        });
      } catch (err) {
        this.status = GoogleSheetModel.STATUS.ERROR;
        throw err;
      }
    }

    await this.updateCache();
  }

  async removeRows(startIndex, endIndex) {
    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'ROWS',
                startIndex,
                endIndex
              }
            }
          }]
        }
      });
    } catch (err) {
      this.status = GoogleSheetModel.STATUS.ERROR;
      throw err;
    }

    await this.updateCache();
  }

  async removeColumn(colName) {
    const headers = this.getHeaders();
    const index = headers.indexOf(colName);

    if (index === -1) {
      throw new Error(`Can't remove non-existent column ${colName}`);
    }

    try {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: index,
                endIndex: index + 1
              }
            }
          }]
        }
      });
    } catch (err) {
      this.status = GoogleSheetModel.STATUS.ERROR;
      throw err;
    }

    await this.updateCache();
  }

  async addRawRows(rows, skipCacheUpdate = false) {
    try {
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: this.sheet,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS'
      }, {
        majorDimension: 'ROWS',
        values: rows
      });
    } catch (err) {
      this.status = GoogleSheetModel.STATUS.ERROR;
      throw err;
    }

    if (!skipCacheUpdate) {
      await this.updateCache();
    }
  }

  async updateCache() {
    try {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: this.sheet
      });
      this._cache = response.result;
      delete this._valueCache;
      this.trigger('dataUpdated');
    } catch (err) {
      this.status = GoogleSheetModel.STATUS.ERROR;
      throw err;
    }
  }

  signIn() {
    if (!this.mode.startsWith('AUTH')) {
      throw new Error(`Can't sign in to model with mode ${this.mode}`);
    }

    gapi.auth2.getAuthInstance().signIn();
  }

  signOut() {
    if (!this.mode.startsWith('AUTH')) {
      throw new Error(`Can't sign out of model with mode ${this.mode}`);
    }

    gapi.auth2.getAuthInstance().signOut();
  }

}

GoogleSheetModel.STATUS = {
  'SIGNED_IN': 'SIGNED_IN',
  'SIGNED_OUT': 'SIGNED_OUT',
  'ERROR': 'ERROR',
  'PENDING': 'PENDING',
  'NO_AUTH': 'NO_AUTH'
};
GoogleSheetModel.MODE = {
  // 'FORM_CURATED_WRITE': 'FORM_CURATED_WRITE',
  // 'FORM_DANGEROUS_READ_WRITE': 'FORM_DANGEROUS_READ_WRITE',
  'AUTH_READ_ONLY': 'AUTH_READ_ONLY',
  'AUTH_READ_WRITE': 'AUTH_READ_WRITE'
};

export { GoogleSheetModel, Model, View };
