import { View } from '../../node_modules/uki/dist/uki.esm.js';
import IntrospectableMixin from '../../utils/IntrospectableMixin.js';

class UploadView extends IntrospectableMixin(View) {
  constructor (d3el) {
    super(d3el, [
      { type: 'text', url: 'views/SummaryView/uploadTemplate.html' }
    ]);
  }
  setup () {
    this.d3el.html(this.resources[0]);
  }
  draw () {}
}
export default UploadView;
