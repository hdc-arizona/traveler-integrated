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
    this.d3el.select('.delete.button').on('click', async d => {
      if (window.confirm(`Are you sure you want to delete ${this.linkedState.label}?`)) {
        await window.fetch(`/datasets/${encodeURIComponent(d)}`, {
          method: 'delete'
        });
        window.controller.closeAllViews(this.linkedState);
        await window.controller.getDatasets();
      }
    });
    this.setupLegend(this.d3el.select('.legend'));
  }
  draw () {
    this.drawLegend(this.d3el.select('.legend'));
  }
}

export default HelperView;
