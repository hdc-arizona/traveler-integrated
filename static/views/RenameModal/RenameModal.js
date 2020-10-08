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
    this._tagsToAdd = {};
    this._tagsToRemove = {};
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.classed('RenameModal', true);

    this.modalContentEl.html(this.getNamedResource('content'))
      .select('#datasetLabel')
      .property('value', this.dataset.info.label)
      .on('change keyup', () => { this.render(); });

    const tagNameInput = this.modalContentEl.select('.tagName')
      .on('change keyup', () => { this.render(); });

    this.addTagButton = new uki.ui.ButtonView({
      d3el: this.modalContentEl.select('.addTag.button'),
      onclick: () => {
        const newTag = tagNameInput.node().value;
        this._tagsToAdd[newTag] = true;
        this.render();
      }
    });
  }

  async draw () {
    await super.draw(...arguments);

    const newTag = this.modalContentEl.select('.tagName').node().value;
    this.addTagButton.disabled = this.drawWaitingState ||
      !newTag ||
      this.dataset.info.tags[newTag] ||
      this._tagsToAdd[newTag];

    this.modalContentEl.selectAll('input, button')
      .attr('disabled', this.drawWaitingState ? true : null);

    this.drawTags();
  }

  drawTags () {
    const tagList = Object.keys(this.dataset.info.tags)
      .concat(Object.keys(this._tagsToAdd));

    let tags = this.modalContentEl.select('.tagList')
      .selectAll('.tag').data(tagList, d => d);
    tags.exit().remove();
    const tagsEnter = tags.enter().append('div')
      .classed('tag', true);
    tags = tags.merge(tagsEnter);

    tags.text(d => d)
      .classed('adding', d => this._tagsToAdd[d])
      .classed('removing', d => this._tagsToRemove[d]);

    tags.on('click', (event, d) => {
      if (!this.drawWaitingState) {
        if (this.dataset.info.tags[d]) {
          if (this._tagsToRemove[d]) {
            delete this._tagsToRemove[d];
          } else {
            this._tagsToRemove[d] = true;
          }
        } else {
          delete this._tagsToAdd[d];
        }
        this.render();
      }
    });
  }

  async confirmAction () {
    const newLabel = this.modalContentEl
      .select('#datasetLabel').property('value');
    await this.dataset
      .updateDatasetInfo(newLabel, this._tagsToAdd, this._tagsToRemove);
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
