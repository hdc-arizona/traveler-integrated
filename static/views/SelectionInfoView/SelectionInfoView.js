/* globals uki */
import LinkedMixin from '../common/LinkedMixin.js';

class SelectionInfoView extends LinkedMixin(uki.ui.GLView) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'text', url: 'views/SelectionInfoView/template.html', name: 'template' },
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

    this.d3el.html(this.getNamedResource('template'))
      .classed('SelectionInfoView', true);
  }

  async draw () {
    await super.draw(...arguments);

    let typeLabel = this.linkedState?.selection?.humanReadableType;
    if (typeLabel) {
      typeLabel += ':';
    } else {
      typeLabel = 'No selection';
    }
    this.d3el.select('.selectionType')
      .text(typeLabel);

    this.d3el.select('.selectionLabel')
      .text(this.linkedState?.selection?.label || null)
      .style('color', this.linkedState?.selectionColor);

    const selectionDetails = this.linkedState?.selection?.details;
    this.d3el.select('pre')
      .text(selectionDetails || null);
  }
}
export default SelectionInfoView;
