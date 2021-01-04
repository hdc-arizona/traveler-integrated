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
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.html(this.getNamedResource('template'))
      .classed('SelectionInfoView', true);
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner. Instead, ensure that another render() call is
      // fired when we're finally ready
      this.ready.then(() => { this.render(); });
      return;
    } else if (this.error) {
      // If there's an upstream error, super.draw will already display an error
      // message. Don't attempt to draw anything (or we'll probably just add to
      // the noise of whatever is really wrong)
      return;
    }

    let typeLabel = this.linkedState?.selection?.humanReadableType;
    if (typeLabel) {
      typeLabel += ':';
    } else {
      typeLabel = 'No current selection';
    }
    this.d3el.select('.selectionType')
      .text(typeLabel);

    this.d3el.select('.selectionLabel')
      .text(this.linkedState?.selection?.label || null);

    const selectionDetails = this.linkedState?.selection?.details;
    this.d3el.select('pre')
      .text(selectionDetails || null);
  }
}
export default SelectionInfoView;
