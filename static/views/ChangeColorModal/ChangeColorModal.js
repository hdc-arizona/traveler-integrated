/* globals uki */
/* Change Color Modal will prompt the user to select the selection color for the selected dataset. */
class ChangeColorModal extends uki.ui.ModalView {
  constructor (options = {}) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'text', url: 'views/ChangeColorModal/content.html', name: 'content' },
      { type: 'less', url: 'views/ChangeColorModal/style.less' }
    ]);

    options.content = null;
    super(options);

    this.dataset = options.dataset;
    this._colorsToAdd= " ";
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.classed('ChangeColorModal', true);

    this.modalContentEl.html(this.getNamedResource('content'))
      .select('#datasetLabel')
      .property('value', this.dataset.info.label)
      .on('change keyup', () => { this.render(); });

    const colorNameInput = this.modalContentEl.select('.colorpicker')
      .on('change keyup', () => { this.render(); });

    //Connect the "Change Dataset Color" frontend to backend
    this.addColorButton = new uki.ui.ButtonView({
      d3el: this.modalContentEl.select('.addColor.button'),
      onclick: () => {
        const newColor = colorNameInput.node().value;
        console.log(newColor)
        this._colorsToAdd.concat(newColor);
        this.render();
      }
    });

  }

  async confirmAction () {
    const newLabel = this.modalContentEl
      .select('#datasetLabel').property('value');
    await this.dataset
      .setLabelAndTags(newLabel, this._tagsToAdd, this._tagsToRemove);
  }
  get color(){
    return newTag;
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
export default ChangeColorModal;
