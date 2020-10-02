/* globals uki */

import RenameModal from '../../views/RenameModal/RenameModal.js';

const VIEW_STATUS = {
  UNAVAILABLE: 'UNAVAILABLE',
  LOADING: 'LOADING',
  AVAILABLE: 'AVAILABLE'
};

class LinkedState extends uki.Model {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push({
      type: 'json',
      name: 'primitives',
      url: `/datasets/${encodeURIComponent(options.info.datasetId)}/primitives`
    });
    super(options);

    this.info = options.info;
    this._selection = options.priorLinkedState?.selection || null;
    this.viewLayout = options.priorLinkedState?.viewLayout || null;
    if (!this.viewLayout) {
      this.ready.then(async () => {
        this.viewLayout = await this.getDefaultLayout();
      });
    }
  }

  get selection () {
    return this._selection;
  }

  set selection (selection) {
    this.selection = selection;
    this.trigger('selectionChanged');
  }

  /**
   * Return a dict that indicates whether or not this particular dataset can
   * show a specific view, and what variants of a view can be shown (i.e. what
   * metric types or code file types exist in the dataset)
   */
  async getAvailableViews () {
    await this.ready;
    const views = {
      SelectionInfoView: { status: VIEW_STATUS.AVAILABLE },
      TreeView: { status: VIEW_STATUS.UNAVAILABLE },
      CodeView: { status: VIEW_STATUS.UNAVAILABLE, variants: [] }
    };
    for (const { fileType, stillLoading } of this.info.sourceFiles) {
      if (fileType === 'log' || fileType === 'newick') {
        views.TreeView.status = stillLoading ? VIEW_STATUS.LOADING : VIEW_STATUS.AVAILABLE;
      } else if (fileType === 'cpp' || fileType === 'python' || fileType === 'physl') {
        if (views.CodeView.status !== VIEW_STATUS.LOADING) {
          views.CodeView.status = stillLoading ? VIEW_STATUS.LOADING : VIEW_STATUS.AVAILABLE;
        }
        views.CodeView.variants.push(fileType);
      }
    }
    return views;
  }

  /**
   * Get the default layout of views to show when a user clicks the "Open"
   * menu item
   */
  async getDefaultLayout () {
    // Determine which of our default views are actually available in the dataset
    const availableViews = await this.getAvailableViews();

    const layout = {
      type: 'column',
      content: []
    };

    // Start with the info view
    if (availableViews.SelectionInfoView?.status !== VIEW_STATUS.UNAVAILABLE) {
      layout.content.push({
        type: 'component',
        componentName: 'SelectionInfoView',
        componentState: { datasetId: this.info.datasetId }
      });
    }

    // Put all the code views into a stack
    if (availableViews.CodeView?.status !== VIEW_STATUS.UNAVAILABLE) {
      const codeStack = {
        type: 'stack',
        content: availableViews.CodeView.variants.map(codeType => {
          return {
            type: 'component',
            componentName: 'CodeView',
            componentState: { datasetId: this.info.datasetId, variant: codeType }
          };
        })
      };
      layout.content.push(codeStack);
    }

    // Put the tree view at the bottom
    if (availableViews.TreeView?.status !== VIEW_STATUS.UNAVAILABLE) {
      layout.content.push({
        type: 'component',
        componentName: 'TreeView',
        componentState: { datasetId: this.info.datasetId }
      });
    }

    return layout;
  }

  /**
   * Return a dict that indicates whether specific views (and which variants)
   * are currently open
   */
  getOpenViews () {
    const openViews = {};
    function helper (layout) {
      if (layout.type === 'component') {
        openViews[layout.componentName] = { open: true };
        if (layout.componentState.variant) {
          openViews[layout.componentName].variants = openViews[layout.componentName].variants || [];
          openViews[layout.componentName].variants.push(layout.componentState.variant);
        }
      } else {
        for (const nestedLayout of layout.content || []) {
          helper(nestedLayout);
        }
      }
    }
    helper(this.viewLayout);
    return openViews;
  }

  /**
   * Get the full context menu for a dataset
   */
  async getMenu () {
    return [
      {
        label: 'Open',
        disabled: window.controller.currentDatasetId === this.info.datasetId,
        checked: window.controller.currentDatasetId === this.info.datasetId,
        onclick: () => {
          window.controller.currentDatasetId = this.info.datasetId;
        }
      },
      {
        label: 'Open View',
        subEntries: await this.getViewMenu()
      },
      null, // Separator
      {
        label: 'Rename / Manage Tags...',
        onclick: () => {
          uki.ui.showModal(new RenameModal({ dataset: this }));
        }
      },
      {
        label: 'Delete',
        onclick: () => {
          throw new Error('Unimplemented: delete after confirmation');
        }
      }
    ];
  }

  /**
   * Create a context menu item for opening a view
   */
  createViewMenuEntry (label, viewName, variant, availableViews, openViews) {
    const viewStatus = availableViews[viewName].status;
    const alreadyOpen = variant
      ? openViews[viewName] && openViews[viewName].variants.indexOf(variant) !== -1
      : openViews[viewName];
    return {
      label,
      img: viewStatus === VIEW_STATUS.LOADING ? 'img/spinner.gif' : null,
      disabled: viewStatus === VIEW_STATUS.UNAVAILABLE,
      checked: alreadyOpen,
      onclick: () => {
        window.controller.openView(this.info.datasetId, viewName, variant);
      }
    };
  }

  /**
   * Create the Open View submenu for a dataset
   */
  async getViewMenu () {
    const availableViews = await this.getAvailableViews();
    const openViews = this.getOpenViews();

    return [
      this.createViewMenuEntry('Selection Info', 'SelectionInfoView', null, availableViews, openViews),
      this.createViewMenuEntry('Tree', 'TreeView', null, availableViews, openViews),
      // Submenu for code views
      {
        label: 'Code',
        subEntries: ['python', 'physl', 'cpp'].map(variant => {
          let label;
          switch (variant) {
            case 'python': label = 'Python'; break;
            case 'physl': label = 'PhySL'; break;
            case 'cpp': label = 'C++'; break;
          }
          return this.createViewMenuEntry(label, 'CodeView', variant, availableViews, openViews);
        })
      }
    ];
  }
}
LinkedState.VIEW_STATUS = VIEW_STATUS;

export default LinkedState;
