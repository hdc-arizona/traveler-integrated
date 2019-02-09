/* globals GoldenLayout */
import MainModel from './models/MainModel.js';
import TreeView from './views/TreeView/TreeView.js';
import CodeView from './views/CodeView/CodeView.js';
import GanttView from './views/GanttView/GanttView.js';
import defaultLayout from './config/defaultLayout.js';

class Controller {
  constructor () {
    this.model = window.model = new MainModel();
    this.goldenLayout = new GoldenLayout(defaultLayout);
    const viewClassLookup = {
      TreeView,
      CodeView,
      GanttView
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
  }
}

window.controller = new Controller();
