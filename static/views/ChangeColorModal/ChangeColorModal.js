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
  
    //setups up color change menu elements
    async setup () {
      await super.setup(...arguments);
  
      this.d3el.classed('ChangeColorModal', true);

      this.modalContentEl.html(this.getNamedResource('content'))
        .select('#datasetLabel')
        .property('value', this.dataset.info.label)
        .on('change keyup', () => { this.render(); });
  
      //sets up color picker
      this.modalContentEl.select('.colorpicker')
        .on('change keyup', () => { this.render(); }) //re-render color if changed  
        .node().value = this.dataset.info.color; //sets color selected to current database color
    }
  
    //Confirms the addition of the color when OK is pressed
    async confirmAction () {
      console.log(this.dataset.info.color);
      //sets new color if new color was selected 
      if(this.modalContentEl.select('.colorpicker').node().value != this.dataset.info.color)
        this.colorToSet = this.modalContentEl.select('.colorpicker').node().value;
      //actually changes color in database
      await this.dataset
        .setColor(this.colorToSet);
    }

    //validates this form
    validateForm () {
      const newLabel = this.modalContentEl.select('#datasetLabel')
        .property('value');
      return newLabel.length === 0 ? ['#datasetLabel'] : null;
    }
  
    //displays any validation errors
    displayValidationErrors () {
      this.modalContentEl.select('#datasetLabel')
        .classed('error', true);
    }

  }
  export default ChangeColorModal;