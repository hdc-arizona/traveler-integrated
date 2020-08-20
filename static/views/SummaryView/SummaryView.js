/* globals d3 */
import { View } from '../../node_modules/uki/dist/uki.esm.js';
import HelperView from './HelperView.js';
import UploadView from './UploadView.js';

class SummaryView extends View {
  constructor (d3el) {
    super(d3el, [
      { type: 'less', url: 'views/SummaryView/style.less' },
      { type: 'text', url: 'views/SummaryView/template.html' },
      { type: 'text', url: 'views/SummaryView/helperTemplate.html' }
    ]);

    this.helperViews = {};
    this.isCollapsed = false;
  }

  get isLoading () {
    return window.controller.datasets === undefined;
  }

  setup () {
    this.d3el.html(this.resources[1]);
    this.d3el.select('.new.button').on('click', () => {
      window.controller.showModal(UploadView);
    });
    var _self = this;
    this.d3el.style('left', '0em');
    this.d3el.select('.collapses')
      .on('click', () => {
        _self.d3el.transition()
          .duration(1000)
          .style('left', _self.isCollapsed ? '0em' : '-20em');
        _self.isCollapsed = !_self.isCollapsed;
        if (_self.isCollapsed) {
          _self.d3el.select('.c_right')
            .attr('src', '/static/img/collapse_right.png');
        } else {
          _self.d3el.select('.c_right')
            .attr('src', '/static/img/collapse_left.png');
        }
      });
  }

  draw () {
    this.d3el.select('.spinner')
      .style('display', this.isLoading ? null : 'none');

    if (this.isLoading) {
      return;
    } else if (window.controller.datasets instanceof Error) {
      this.d3el.select('.datasets').html('<li>Error communicating with the server</li>');
      return;
    }

    this.drawHelperViews();
  }

  drawHelperViews () {
    let datasets = this.d3el.select('.datasets').selectAll('.dataset')
      .data(d3.keys(window.controller.datasets), d => d);
    datasets.exit()
      .each(d => { delete this.helperViews[d]; })
      .remove();
    const datasetsEnter = datasets.enter().append('li')
      .classed('dataset', true)
      .each(d => {
        this.helperViews[d] = new HelperView({
          linkedState: window.controller.getLinkedState(d),
          datasetTemplate: this.resources[2]
        });
      });
    datasets = datasets.merge(datasetsEnter);

    const self = this;
    datasets.each(function (d) {
      self.helperViews[d].render(d3.select(this));
    });
  }
}
export default SummaryView;
