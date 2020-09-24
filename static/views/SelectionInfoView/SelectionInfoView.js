/* globals uki */

class SelectionInfoView extends uki.ui.InformativeViewMixin(uki.ui.GLView) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'less', url: 'views/CodeView/style.less' },
      { type: 'json', url: `/datasets/${options.datasetId}/${options.variant}`, name: 'code' }
    ]);
    super(options);

    switch (options.variant) {
      case 'cpp': this.mode = 'clike'; break;
      case 'physl': this.mode = 'scheme'; break;
      case 'python': this.mode = 'python'; break;
    }
  }

  get message () {
    return window.controller.currentDataset?.selection === null
      ? '(no current selection)' : null;
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.append('pre');
  }

  async draw () {
    await super.draw(...arguments);

    const selectionDetails = window.controller.currentDataset?.selection?.toString();
    this.d3el.select('pre')
      .text(selectionDetails || null);
  }
}
export default SelectionInfoView;
