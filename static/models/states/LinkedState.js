/* globals uki */

import PrimitiveSelection from '../selections/PrimitiveSelection.js';

import RenameModal from '../../views/RenameModal/RenameModal.js';

const VIEW_STATUS = {
  UNAVAILABLE: 'UNAVAILABLE',
  LOADING: 'LOADING',
  AVAILABLE: 'AVAILABLE'
};

const COLOR_MODES = {
  INCLUSIVE: 'inclusive',
  EXCLUSIVE: 'exclusive',
  DIVERGING: 'diverging'
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
    this._colorMode = COLOR_MODES.INCLUSIVE;
    this._viewLayoutPromise = options.priorLinkedState?._viewLayoutPromise ||
      this.ready.then(() => this.getDefaultLayout());
    if (options.priorLinkedState) {
      this.takeOverEvents(options.priorLinkedState);
    }
  }

  get selection () {
    return this._selection;
  }

  set selection (selection) {
    this._selection = selection;
    this.trigger('selectionChanged');
  }

  get colorMode () {
    return this._colorMode;
  }

  set colorMode (value) {
    this._colorMode = value;
    this.trigger('colorModeChanged');
  }

  async getViewLayout () {
    return this._viewLayoutPromise;
  }

  /**
   * Based on the current color mode, get the five colors to use for
   * inclusive / exclusive / diverging time encodings; you can change these in
   * style/theme.css
   */
  get timeScaleColors () {
    return window.controller.themeColors[this._colorMode];
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
  async getOpenViews () {
    const openViews = {};
    function helper (glLayer) {
      if (glLayer.type === 'component') {
        openViews[glLayer.componentName] = { open: true };
        if (glLayer.componentState.variant) {
          openViews[glLayer.componentName].variants = openViews[glLayer.componentName].variants || [];
          openViews[glLayer.componentName].variants.push(glLayer.componentState.variant);
        }
      } else {
        for (const nestedLayer of glLayer.content || []) {
          helper(nestedLayer);
        }
      }
    }
    if (window.controller.currentDatasetId === this.info.datasetId) {
      // If this isn't the currently open dataset, then none of the views are
      // actually open
      helper(await this.getViewLayout());
    }
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
    const openViews = await this.getOpenViews();

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

  /**
   * Construct a URL for renaming a dataset's label and/or changing its tags
   */
  getUpdateUrl (newLabel, tagsToAdd = {}, tagsToRemove = {}) {
    newLabel = newLabel.replace(/^\/*|\/*$/g, ''); // remove any leading or trailing slashes
    newLabel = encodeURIComponent(newLabel || this.info.label);
    const tagList = encodeURIComponent(
      Object.keys(this.info.tags)
        .filter(d => !tagsToRemove[d])
        .concat(Object.keys(tagsToAdd))
        .join(','));
    return `/datasets/${this.info.datasetId}/info?label=${newLabel}&tags=${tagList}`;
  }

  /**
   * Update a dataset's label and/or tags
   */
  async setLabelAndTags (newLabel, tagsToAdd = {}, tagsToRemove = {}) {
    const url = this.getUpdateUrl(newLabel, tagsToAdd, tagsToRemove);
    await window.fetch(url, {
      method: 'PUT'
    });
    await window.controller.refreshDatasets();
  }

  /**
   * Look up a primitive by name
   */
  getPrimitiveDetails (primitiveName) {
    return this.getNamedResource('primitives')?.[primitiveName] || null;
  }

  /**
   * Change the current selection to the named primitive
   */
  selectPrimitive (primitiveName) {
    const primitiveDetails = this.getPrimitiveDetails(primitiveName);
    this.selection = new PrimitiveSelection({
      primitiveName,
      primitiveDetails,
      fetchUtilization: false // overridden in TracedLinkedState
    });
  }
}
LinkedState.VIEW_STATUS = VIEW_STATUS;
LinkedState.COLOR_MODES = COLOR_MODES;

export default LinkedState;
