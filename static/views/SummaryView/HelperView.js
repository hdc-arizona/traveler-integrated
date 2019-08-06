import { View } from '../../node_modules/uki/dist/uki.esm.js';
import LinkedMixin from '../common/LinkedMixin.js';

/**
 * HelperView represents / linkes with a single dataset inside SummaryView
 */

class HelperView extends LinkedMixin(View) {
  constructor ({ linkedState, datasetTemplate }) {
    super({ linkedState });
    this.datasetTemplate = datasetTemplate;
  }
  setup () {
    this.d3el.html(this.datasetTemplate);
    this.d3el.select('.label').text(this.linkedState.label);
    this.d3el.select('.delete.button').on('click', d => {
      if (window.confirm(`Are you sure you want to delete ${this.linkedState.label}?`)) {
        console.log('todo: delete');
      }
    });
    this.setupLegend(this.d3el.select('.legend'));
  }
  draw () {
    this.drawLegend(this.d3el.select('.legend'));
  }
}

export default HelperView;
