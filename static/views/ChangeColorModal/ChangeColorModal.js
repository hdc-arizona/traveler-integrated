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
      this._colorsToAdd= {};
      this._colorsToRemove = {};
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
  
      
      //Connect the "Change Dataset Color" frontend to backend
      this.addColorButton = new uki.ui.ButtonView({
        d3el: this.modalContentEl.select('.addColor.button'),
        onclick: () => {
          const newColor = colorNameInput.node().value;
          console.log(newColor); //this is working
          this.changeCss(newColor);
          this._colorsToAdd[newColor] = true; //change this to not be an array, just 1 value
          this.render();
        }
      });
  
    }
  
    //Confirms the addition of the color
    async confirmAction () {
      //this.changeCss(this._colorsToAdd.length);
      const newLabel = this.modalContentEl
        .select('#datasetLabel').property('value');
      await this.dataset
        .setColors(newLabel, this._colorsToAdd, this._colorsToRemove);
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

    //makes a css file using the given color as the selection color
    changeCss(color){
      var page = document.body.style;
      page.cssText = 
      "--selection-color: " + color + ";" + "\n"
      + "--selection-border-color: " + color + ";";
      //page.setAttribute("style", "--selection-color: " + color); <- previous way of settings color
      console.log("NEW COLOR:" + color);
    }
  }
  export default ChangeColorModal;