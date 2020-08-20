/* globals uki */

class LinkedState extends uki.Model {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push({
      type: 'json',
      name: 'primitives',
      url: `/datasets/${encodeURIComponent(options.label)}/primitives`
    });
    super(options);

    this.label = options.label;
    this.metadata = options.metadata;
    this._selection = null;
  }

  get selection () {
    return this._selection;
  }

  set selection (selection) {
    this.selection = selection;
    this.trigger('selectionChanged');
  }

  getDefaultViews () {
    const views = {};
    for (const { fileType } of this.metadata.sourceFiles) {
      if (fileType === 'log' || fileType === 'newick') {
        views.TreeView = true;
      } else if (fileType === 'cpp') {
        views.CppView = true;
      } else if (fileType === 'python') {
        views.PythonView = true;
      } else if (fileType === 'physl') {
        views.PhyslView = true;
      }
    }
    return views;
  }

  getPossibleViews () {
    return this.getDefaultViews();
  }
}
export default LinkedState;
