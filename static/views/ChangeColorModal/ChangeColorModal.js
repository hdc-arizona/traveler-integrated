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
      this.changeCss(this.colorToSet);
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

    //updates the css file to update the view using the given color as the base
    changeCss(color){
      if(color != null && color.length == 7)
      {
        //converts hex to rgb
        var red = parseInt(color.substring(1,3), 16);
        var green = parseInt(color.substring(3,5), 16);
        var blue = parseInt(color.substring(5,7), 16);

        var diff = 55;

        //decreases from max value if maxed out so colors can be darkened for border
        if(red>=(255 - diff))
          red-= diff;
        if(green>=(255 - diff))
          green-= diff;
        if(blue>=(255 - diff))
          blue-= diff;
        
        console.log("red: " + red + ",green: " + green + ",blue: " + blue);
        var color = "rgb(" + red + "," + green + "," + blue + ")";
        red+=diff, green+=diff, blue+=diff;
        console.log("red: " + red + ",green: " + green + ",blue: " + blue);
        var border_color = "rgb(" + red + "," + green + "," + blue + ")";

        //changes the color of the slection and border via html
        var page = document.body.style;
        page.cssText = 
        "--selection-color: " + color + ";" + "\n"
        + "--selection-border-color: " + border_color + ";";
        //+ "--disabled-color: " + color + ";" + "\n";

        //changes the color of the selection and border directly
        var theme = globalThis.controller.getNamedResource('theme').cssVariables;
        theme["--selection-color"] = color;
        theme["--slection-border-color"] = border_color;
      }  
    }
  }
  export default ChangeColorModal;