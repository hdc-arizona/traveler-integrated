/* globals GoldenLayout */
import StateModel from './models/StateModel.js';
import SummaryView from './views/SummaryView/SummaryView.js';
import TreeView from './views/TreeView/TreeView.js';
import CodeView from './views/CodeView/CodeView.js';
import GanttView from './views/GanttView/GanttView.js';
import HistogramView from './views/HistogramView/HistogramView.js';
import defaultLayout from './config/defaultLayout.js';

class Controller {
  constructor () {
    this.state = window.state = new StateModel();
    this.setupLayout();
  }
  setupLayout () {
    this.goldenLayout = new GoldenLayout(defaultLayout);
    const viewClassLookup = {
      SummaryView,
      TreeView,
      CodeView,
      GanttView,
      HistogramView
    };
    window.views = this.views = {};
    for (const [className, ViewClass] of Object.entries(viewClassLookup)) {
      const self = this;
      this.goldenLayout.registerComponent(className, function (container, state) {
        self.views[className] = new ViewClass({ container, state });
        return self.views[className];
      });
    }
    this.goldenLayout.on('windowOpened', () => {
      // TODO
    });
    this.goldenLayout.init();
    window.setTimeout(() => {
      this.renderAllViews();
    }, 500);
  }
  renderAllViews () {
    for (const view of Object.values(this.views)) {
      view.render();
    }
  }
}

window.controller = new Controller();
