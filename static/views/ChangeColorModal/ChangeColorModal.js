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
      var colorToSet = null;
    }
  
    async setup () {
      await super.setup(...arguments);
  
      this.d3el.classed('ChangeColorModal', true);
  
      this.modalContentEl.html(this.getNamedResource('content'))
        .select('#datasetLabel')
        .property('value', this.dataset.info.label)
        .on('change keyup', () => { this.render(); });
  
      const colorNameInput = this.modalContentEl.select('.colorpicker')
        .on('change keyup', () => { this.render(); }); //re-render color if changed  
    }
  
    //Confirms the addition of the color
    async confirmAction () {
      if(this.modalContentEl.select('.colorpicker').node().value != "#e6ab02") //TODO: replace e6 with real current color
        this.colorToSet = this.modalContentEl.select('.colorpicker').node().value;
      await this.dataset
        .setColor(this.colorToSet);
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