/* globals uki */

class RenameModal extends uki.ui.ModalView {
  constructor (options = {}) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'text', url: 'views/RenameModal/content.html', name: 'content' },
      { type: 'less', url: 'views/RenameModal/style.less' }
    ]);

    options.content = null;
    super(options);

    this.dataset = options.dataset;
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.classed('RenameModal', true);

    this.modalContentEl.html(this.getNamedResource('content'))
      .select('#datasetLabel')
      .property('value', this.dataset.info.label)
      .on('change', () => { this.render(); })
      .on('keyup', () => { this.render(); });
  }

  async draw () {
    await super.draw(...arguments);

    this.modalContentEl.selectAll('input, button')
      .attr('disabled', this.drawWaitingState ? true : null);
  }

  async confirmAction () {
    const newLabel = this.modalContentEl.select('#datasetLabel')
      .property('value');
    // await d3.json('')
    return new Promise((resolve, reject) => {});
  }

  validateForm () {
    const newLabel = this.modalContentEl.select('#datasetLabel')
      .property('value');
    return newLabel.length === 0 ? ['#datasetLabel'] : null;
  }

  displayValidationErrors () {
    this.modalContentEl.select('#datasetLabel')
      .classed('error', true);
  }
}
export default RenameModal;
