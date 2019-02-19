/* globals GoldenLayout */
import StateModel from './models/StateModel.js';
import SummaryView from './views/SummaryView/SummaryView.js';
import TreeView from './views/TreeView/TreeView.js';
import TreeComparisonView from './views/TreeComparisonView/TreeComparisonView.js';
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
      TreeComparisonView,
      CodeView,
      GanttView,
      HistogramView
    };
    window.views = this.views = {};
    this.visibleViewTypes = {};
    for (const [className, ViewClass] of Object.entries(viewClassLookup)) {
      const self = this;
      this.goldenLayout.registerComponent(className, function (container, state) {
        let viewLabel = className;
        if (state.label) {
          viewLabel += '_' + state.label;
          self.visibleViewTypes[viewLabel] = (self.visibleViewTypes[viewLabel] || 0) + 1;
          if (state.comparisonLabel) {
            viewLabel += '_' + state.comparisonLabel;
            const temp = className + '_' + state.comparisonLabel;
            self.visibleViewTypes[temp] = (self.visibleViewTypes[temp] || 0) + 1;
          }
        }
        self.views[viewLabel] = new ViewClass({ container, state });
        return self.views[viewLabel];
      });
    }
    this.goldenLayout.on('windowOpened', () => {
      // TODO: deal with popouts
    });
    this.goldenLayout.on('itemDestroyed', component => {
      // TODO: iterate over component and/or its children for .instance to not be undefined,
      // and call this.handleViewDestruction(component.instance) on each of them
      this.renderAllViews();
    });
    this.goldenLayout.init();
    window.setTimeout(() => {
      this.renderAllViews();
    }, 500);
  }
  handleViewDestruction (view) {
    let viewLabel = view.constructor.name;
    if (view.layoutState.label) {
      viewLabel += '_' + view.layoutState.label;
      this.visibleViewTypes[viewLabel] -= 1;
      if (this.visibleViewTypes[viewLabel] === 0) {
        delete this.visibleViewTypes[viewLabel];
      }
      if (view.layoutState.comparisonLabel) {
        viewLabel += '_' + view.layoutState.comparisonLabel;
        delete this.views[viewLabel];
        const temp = view.constructor.name + '_' + view.layoutState.comparisonLabel;
        this.visibleViewTypes[temp] -= 1;
        if (this.visibleViewTypes[temp] === 0) {
          delete this.visibleViewTypes[temp];
        }
      }
    }
  }
  renderAllViews () {
    for (const view of Object.values(this.views)) {
      view.render();
    }
  }
  computeViewLabel (className, stateObj) {
    let viewLabel = className;
    if (stateObj.label) {
      viewLabel += '_' + stateObj.label;
    }
    if (stateObj.comparisonLabel) {
      viewLabel += '_' + stateObj.comparisonLabel;
    }
    return viewLabel;
  }
  raiseView (view) {
    let child = view.container;
    let parent = child.parent;
    while (!parent !== null && !parent.setActiveContentItem) {
      child = child.parent;
      parent = parent.parent;
    }
    if (parent.setActiveContentItem) {
      parent.setActiveContentItem(child);
    }
  }
  viewTypeIsVisible (viewName, stateObj = {}) {
    if (stateObj.label) {
      return !!this.visibleViewTypes[viewName + '_' + stateObj.label];
    } else {
      return !!this.views[viewName];
    }
  }
  openView (viewName, stateObj = {}) {
    const viewLabel = this.computeViewLabel(viewName, stateObj);
    const view = this.views[viewLabel];
    if (view) {
      this.raiseView(view);
    } else {
      this.goldenLayout.root.contentItems[0].addChild({
        type: 'component',
        componentName: viewName,
        componentState: stateObj
      });
    }
  }
}

window.controller = new Controller();
