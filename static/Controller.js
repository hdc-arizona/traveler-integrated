/* globals uki, d3 */
import MenuView from './views/MenuView/MenuView.js';
import RootView from './views/RootView/RootView.js';
import LinkedState from './models/states/LinkedState.js';
import TracedLinkedState from './models/states/TracedLinkedState.js';

class Controller extends uki.Model {
  constructor () {
    super(...arguments);
    this.menuView = new MenuView({ d3el: d3.select('.MenuView') });
    this.rootView = new RootView({ d3el: d3.select('.RootView') });
    this.datasetList = [];
    this.datasetLookup = {};
    this._currentDatasetId = null;
    this.refreshDatasets();
  }

  renderAllViews () {
    this.menuView.render();
    this.rootView.render();
  }

  async refreshDatasets () {
    const newDatasetLookup = {};
    this.datasetList = (await d3.json('/datasets')).map((info, index) => {
      let linkedState;
      const priorLinkedState = this.datasetLookup[info.datasetId];
      if (info.sourceFiles.some(d => d.fileType === 'otf2')) {
        linkedState = new TracedLinkedState({ info, priorLinkedState });
      } else {
        linkedState = new LinkedState({ info, priorLinkedState });
      }
      newDatasetLookup[linkedState.datasetId] = index;

      if (Object.values(linkedState.getAvailableViews()).some(d => d === 'LOADING')) {
        // If any of the datasets are still loading something, call this
        // function again in 1 second
        window.clearTimeout(this._refreshDatasetPollTimeout);
        this._refreshDatasetPollTimeout = window.setTimeout(() => {
          this.refreshDatasets();
        }, 1000);
      }
      return linkedState;
    });
    if (!this.attemptedAutoHashOpen) {
      // The first time we load the page, do a check to see if the URL is
      // telling us to navigate to a specific one, or if there's only one
      // dataset that exists
      this.attemptedAutoHashOpen = true;
      const hash = window.decodeURIComponent(window.location.hash).substring(1);
      if (this.datasetLookup[hash] !== undefined) {
        this.currentDatasetId = hash;
      } else if (this.datasetList.length === 1) {
        this.currentDatasetId = this.datasetList[0].info.datasetId;
      } else {
        // Auto-expand the menu if we aren't starting with a dataset open
        this.menuView.expanded = true;
      }
    }
  }

  get currentDataset () {
    const index = this.datasetLookup[this.currentDatasetId];
    return index === undefined ? null : this.datasetList[index];
  }

  get currentDatasetId () {
    return this._currentDatasetId;
  }

  set currentDatasetId (datasetId) {
    const index = this.datasetLookup[datasetId];
    if (index !== undefined) {
      this.rootView.setLayout(this.datasetList[index].viewLayout);
    } else {
      this._currentDatasetId = null;
      this.rootView.clearViews();
    }
    this.trigger('currentDatasetChanged');
  }

  openView (datasetId, viewName) {
    if (datasetId !== this.currentDatasetId) {
      this.currentDatasetId = datasetId;
    }
    // TODO: tell rootView to open the new view (somewhere), and
    // update the linkedState's viewLayout if the stateChanged callback
    // doesn't already handle it
  }
}

window.controller = new Controller();
