/* globals uki */
import LinkedMixin from '../common/LinkedMixin.js';

class SelectionInfoView extends LinkedMixin(uki.ui.GLView) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'less', url: 'views/SelectionInfoView/style.less' }
    ]);
    super(options);

    this.linkedState.on('selectionChanged', () => { this.render(); });
  }

  get informativeMessage () {
    return this.linkedState?.selection ? null : '(no current selection)';
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.append('pre');
  }

  async draw () {
    await super.draw(...arguments);

    const selectionDetails = this.linkedState?.selection?.toString();
    this.d3el.select('pre')
      .text(selectionDetails || null);
  }
}
export default SelectionInfoView;
