/* globals uki */

import PrimitiveSelection from '../selections/PrimitiveSelection.js';

import RenameModal from '../../views/RenameModal/RenameModal.js';
import ChangeColorModal from '../../views/ChangeColorModal/ChangeColorModal.js';
import TreeView from "../../views/TreeView/TreeView.js";
import DependencyTreeView from "../../views/DependencyTreeView/DependencyTreeView.js";
import TaskDependencySelection from "../selections/TaskDependencySelection.js";

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

class LinkedState extends uki.utils.IntrospectableMixin(uki.Model) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push({
      type: 'json',
      name: 'primitives',
      url: `/datasets/${encodeURIComponent(options.info.datasetId)}/primitives`
    });
    super(options);

    this.visibleAggGanttLocations = null;
    this.info = options.info;
    this._selection = options.priorLinkedState?.selection || null;
    this._colorMode = COLOR_MODES.INCLUSIVE;
    this._viewLayout = options.priorLinkedState?._viewLayout || null;
    this.cachedUtilizationData = {};
    this._viewLayoutPromise = this._viewLayout
      ? Promise.resolve(this._viewLayout)
      : this.ready.then(() => this.getDefaultLayout());
    if (options.priorLinkedState) {
      this.takeOverEvents(options.priorLinkedState);
    }
  }

  get selection () {
    return this._selection;
  }

  set selection (selection) {
    this._selection = selection;
    this.visibleAggGanttLocations = null;
    this.trigger('selectionChanged');
  }

  get colorMode () {
    return this._colorMode;
  }

  set colorMode (value) {
    this._colorMode = value;
    this.trigger('colorModeChanged');
  }

  get isBundling () {
    return this.info.sourceFiles.some(f => f.stillLoading);
  }

  get isLoading () {
    return super.isLoading || this.isBundling;
  }

  async getViewLayout () {
    return this._viewLayoutPromise;
  }

  updateViewLayout (newLayout) {
    this._viewLayout = newLayout;
    // We use _viewLayoutPromise promise because, at least initially, the layout
    // depends on data from the server about which views are available. To
    // change the layout (e.g. when a user closes or moves a view), we just
    // override the value that that promise resolves
    this._viewLayoutPromise = this._viewLayoutPromise.then(() => newLayout);
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
    const views = {
      SelectionInfoView: { status: VIEW_STATUS.AVAILABLE },
      DependencyTreeView: { status: VIEW_STATUS.AVAILABLE },
      TreeView: { status: VIEW_STATUS.UNAVAILABLE },
      CodeView: { status: VIEW_STATUS.UNAVAILABLE, variants: [] }
    };
    for (const { fileType, stillLoading } of this.info.sourceFiles) {
      if (fileType === 'log' || fileType === 'newick') {
        views.TreeView.status = stillLoading ? VIEW_STATUS.LOADING : VIEW_STATUS.AVAILABLE;
        views.DependencyTreeView.status = stillLoading ? VIEW_STATUS.LOADING : VIEW_STATUS.AVAILABLE;
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
    // if (availableViews.TreeView?.status !== VIEW_STATUS.UNAVAILABLE) {
    //   layout.content.push({
    //     type: 'component',
    //     componentName: 'TreeView',
    //     componentState: { datasetId: this.info.datasetId }
    //   });
    // }
    // if (availableViews.DependencyTreeView?.status !== VIEW_STATUS.UNAVAILABLE) {
    //   layout.content.push({
    //     type: 'component',
    //     componentName: 'DependencyTreeView',
    //     componentState: { datasetId: this.info.datasetId }
    //   });
    // }
    return layout;
  }

  /**
   * Return a dict that indicates whether specific views (and which variants,
   * e.g. metric type or physl vs cpp code views) are currently open
   */
  async getOpenViews () {
    const openViews = {};
    function helper (glItem) {
      if (glItem.type === 'component') {
        if (!openViews[glItem.componentName]) {
          openViews[glItem.componentName] = { open: true };
        }
        if (glItem.componentState.variant) {
          openViews[glItem.componentName].variants = openViews[glItem.componentName].variants || [];
          openViews[glItem.componentName].variants.push(glItem.componentState.variant);
        }
      } else {
        for (const nestedLayer of glItem.content || []) {
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
      }, // Changes the dataset color according to user's choice
      {
        label: 'Change Dataset Color', 
        onclick: () => {
          uki.ui.showModal(new ChangeColorModal({ dataset: this }));
        }
      },
      {
        label: 'Delete',
        onclick: () => {
          if (this.isLoading) {
            uki.ui.alert(`<img src="img/ex.svg" style="
              width:2em;
              margin:0 0.5em;
              vertical-align:middle;
              filter:url(#recolorImageTo--error-color)"/>
              Can't delete ${this.info.label} while it is still loading.`);
          } else {
            uki.ui.confirm(`<img src="img/ex.svg" style="
              width:2em;
              margin:0 0.5em;
              vertical-align:middle;
              filter:url(#recolorImageTo--text-color-softer)"/>
              Permanently delete ${this.info.label}?`,
            {
              confirmAction: async () => {
                if (window.controller.currentDatasetId === this.info.datasetId) {
                  window.controller.currentDatasetId = null;
                }
                const response = await window.fetch(`/datasets/${this.info.datasetId}`, { method: 'DELETE' });
                if (!response.ok) {
                  uki.ui.alert(`Error attempting to delete ${this.info.datasetId}:<br/>
                    <details><summary>Details</summary>
                    ${response.status}: ${response.statusText}</details>`);
                }
                await window.controller.refreshDatasets();
              }
            });
          }
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
    let disabled = viewStatus === VIEW_STATUS.UNAVAILABLE;
    if (variant && !disabled) {
      disabled = availableViews[viewName].variants.indexOf(variant) === -1;
    }
    let ret = {
      label,
      img: viewStatus === VIEW_STATUS.LOADING ? 'img/spinner.png' : null,
      disabled,
      checked: alreadyOpen,
      onclick: () => {
        window.controller.rootView.openView(this.info.datasetId, viewName, variant);
      }
    };
    if(viewName === 'DependencyTreeView') {
      ret = {
        label,
        img: viewStatus === VIEW_STATUS.LOADING ? 'img/spinner.png' : null,
        disabled,
        checked: alreadyOpen,
        onclick: () => {
          window.controller.rootView.openView(this.info.datasetId, viewName, variant);
          window.controller.rootView.openView(this.info.datasetId, 'AggregatedGanttView', variant);
        }
      };
    }
    return ret;
  }

  /**
   * Create the Open View submenu for a dataset
   */
  async getViewMenu () {
    const availableViews = await this.getAvailableViews();
    const openViews = await this.getOpenViews();

    return [
      this.createViewMenuEntry('Selection Info', 'SelectionInfoView', null, availableViews, openViews),
      // this.createViewMenuEntry('Dependency Tree', 'DependencyTreeView', null, availableViews, openViews),
      // this.createViewMenuEntry('Tree', 'TreeView', null, availableViews, openViews),
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
        }),
        disabled: availableViews.CodeView.status === VIEW_STATUS.UNAVAILABLE
      }
    ];
  }

  /**
   * Construct a URL for renaming a dataset's label and/or changing its tags
   */
  getUpdateUrl (newLabel = null, tagsToAdd = {}, tagsToRemove = {}) {
    newLabel = newLabel?.replace(/^\/*|\/*$/g, ''); // remove any leading or trailing slashes
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
  async setLabelAndTags (newLabel = null, tagsToAdd = {}, tagsToRemove = {}) {
    const url = this.getUpdateUrl(newLabel, tagsToAdd, tagsToRemove);
    await window.fetch(url, {
      method: 'PUT'
    });
    await window.controller.refreshDatasets();
  }

  /**
  * Construct a URL for updating a dataset's color
  */
  getUpdateColorUrl (newColor = null) {
    newColor = newColor?.replace(/^\/*|\/*$/g, ''); // remove any leading or trailing slashes
    newColor = encodeURIComponent(newColor || this.info.color);
    return `/datasets/${this.info.datasetId}/info?color=${newColor}`; //returns the URL for the put command
  }
  
  /**
  * Update a dataset's color in the database
  */
  async setColor (newColor = null) {
    console.log("new color:" + newColor);
    const url = this.getUpdateColorUrl(newColor);
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
      primitiveDetails
    });
  }

  /**
   * Change the current selection to the set of named primitives
   */
  selectPrimitives (primitiveName, primitiveDetails) {
    //online the first primitive details will be shown
    this.selection = new TaskDependencySelection({
      primitiveName,
      primitiveDetails
    });
  }
  getColorShades(sn, totalShades=4) {
    const minShade = 5;
    const maxShade = 15;
    sn = sn % totalShades;
    const scaledSN = (sn * (maxShade - minShade) / totalShades) + minShade;

    // r,g,b value for theme['--inclusive-color-3']
    const r = 117;
    const g = 107;
    const b = 177;
    var max = Math.max(Math.max(r, Math.max(g,b)), 1);
    var step = 255 / (max * 10);
    // from https://stackoverflow.com/questions/40619476/javascript-generate-different-shades-of-the-same-color
    return `rgb(${r * step * scaledSN}, ${g * step * scaledSN}, ${b * step * scaledSN})`;
  }
}
LinkedState.VIEW_STATUS = VIEW_STATUS;
LinkedState.COLOR_MODES = COLOR_MODES;

export default LinkedState;
