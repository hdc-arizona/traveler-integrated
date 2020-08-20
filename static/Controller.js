/* globals uki, d3 */
import MenuView from './views/MenuView/MenuView.js';
import RootView from './views/RootView/RootView.js';
import LinkedState from './models/LinkedState.js';
import TracedLinkedState from './models/TracedLinkedState.js';

class Controller extends uki.Model {
  constructor () {
    super(...arguments);
    this.menuView = new MenuView({ d3el: d3.select('.MenuView') });
    this.rootView = new RootView({ d3el: d3.select('.RootView') });
    this.datasets = {};
    this._currentDataset = null;
    this.refreshDatasets();
  }

  async refreshDatasets () {
    const datasetList = await d3.json('/datasets');
    const datasetDetails = await Promise.all(datasetList
      .map(d => d3.json(`/datasets/${encodeURIComponent(d)}`)));
    this.datasets = {};
    for (const [index, label] of datasetList.entries()) {
      const metadata = datasetDetails[index];
      if (metadata.hasTraceData) {
        this.datasets[label] = new TracedLinkedState({ label, metadata });
      } else {
        this.datasets[label] = new LinkedState({ label, metadata });
      }
    }
    if (!this.attemptedAutoHashOpen) {
      // The first time we load the page, do a check to see if the URL is
      // telling us to navigate to a specific one, or if there's only one
      // dataset that exists
      this.attemptedAutoHashOpen = true;
      this.currentDataset = window.decodeURIComponent(window.location.hash)
        .substring(1) || datasetList.length === 1 ? datasetList[0] : null;
    }
  }

  get currentDataset () {
    return this._currentDataset;
  }

  set currentDataset (label) {
    const state = this.datasets[label];
    if (state) {
      this.rootView.assembleViews(state);
    } else if (!state) {
      this._currentDataset = null;
      this.rootView.clearViews();
    } else {
      throw new Error(`Can't open nonexistent dataset: ${label}`);
    }
    this.trigger('currentDatasetChanged');
  }
}

window.controller = new Controller();
