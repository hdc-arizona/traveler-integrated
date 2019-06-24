/* globals d3, less, GoldenLayout */
import Tooltip from './views/Tooltip/Tooltip.js';
import SummaryView from './views/SummaryView/SummaryView.js';
import SingleLinkedState from './models/SingleLinkedState.js';
import TreeView from './views/TreeView/TreeView.js';
import TreeComparisonView from './views/TreeComparisonView/TreeComparisonView.js';
import CodeView from './views/CodeView/CodeView.js';
import GanttView from './views/GanttView/GanttView.js';
import UtilizationView from './views/UtilizationView/UtilizationView.js';
import defaultLayout from './config/defaultLayout.js';

const viewClassLookup = {
  SummaryView,
  TreeView,
  TreeComparisonView,
  CodeView,
  GanttView,
  UtilizationView
};

class Controller {
  constructor () {
    this.tooltip = window.tooltip = new Tooltip();
    (async () => {
      this.datasets = await d3.json('/datasets?includeMeta=true');
    })();
    this.setupLayout();
  }
  setupLayout () {
    this.goldenLayout = new GoldenLayout(defaultLayout, d3.select('#layoutRoot').node());
    this.views = {};
    for (const [className, ViewClass] of Object.entries(viewClassLookup)) {
      const self = this;
      this.goldenLayout.registerComponent(className, function (container, state) {
        if (className === 'SummaryView') {
          // There's no dataset / linked state associated with the SummaryView
          const view = new ViewClass({ container, state });
          self.summaryView = view;
          return view;
        }

        // Get a linkedState object from an existing view that this new one
        // should communicate, or create it if it doesn't exist
        let linkedState = (self.views[state.label] && self.views[state.label][0].linkedState) ||
            new SingleLinkedState(state.label, self.datasets[state.label]);
        // Create the view
        const view = new ViewClass({ container, state, linkedState });
        // Store the view
        self.views[state.label] = self.views[state.label] || [];
        self.views[state.label].push(view);
        return view;
      });
    }
    this.goldenLayout.on('windowOpened', () => {
      // TODO: deal with popouts
    });
    this.goldenLayout.on('itemDestroyed', component => {
      const recurse = (component) => {
        if (component.instance) {
          this.handleViewDestruction(component.instance);
        } else if (component.contentItems) {
          for (const childComponent of component.contentItems) {
            recurse(childComponent);
          }
        }
      };
      recurse(component);
      this.renderAllViews();
    });
    window.addEventListener('resize', () => {
      this.goldenLayout.updateSize();
      this.renderAllViews();
    });
    window.addEventListener('load', async () => {
      // Don't actually initialize GoldenLayout until LESS has finished
      // (otherwise we can get panes of size zero, especially in firefox)
      await less.pageLoadFinished;
      this.goldenLayout.init();
      this.renderAllViews();
    });
  }
  handleViewDestruction (view) {
    // Free up stuff in our lookups for garbage collection when views are closed
    const label = view.layoutState.label;
    if (this.views[label]) {
      this.views[label].splice(this.views[label].indexOf(view), 1);
      if (this.views[label].length === 0) {
        delete this.views[label];
      }
    }
  }
  renderAllViews () {
    if (this.summaryView) {
      this.summaryView.render();
    }
    for (const viewList of Object.values(this.views)) {
      for (const view of viewList) {
        view.render();
      }
    }
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
  getView (className, label) {
    if (className === 'SummaryView') {
      return this.summaryView;
    } else {
      return this.views[label] &&
        this.views[label].find(view => view.constructor.name === className);
    }
  }
  openViews (viewNames, stateObj) {
    for (const viewName of viewNames) {
      const view = this.getView(viewName, stateObj.label);
      if (view) {
        this.raiseView(view);
      } else {
        // TODO: try to position new views intelligently
        this.goldenLayout.root.contentItems[0].addChild({
          type: 'component',
          componentName: viewName,
          componentState: stateObj
        });
      }
    }
  }
}

window.controller = new Controller();
