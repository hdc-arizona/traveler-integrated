import GoldenLayoutView from '../common/GoldenLayoutView.js';

class GanttView extends GoldenLayoutView {
  setupContentElement () {
    const content = this.d3el.append('div')
      .classed('content', true);
    this.overview = this.d3el.append('div')
      .classed('overview', true);
    return content;
  }
  draw () {
    this.content.text('TODO: Main Gantt View');
    this.overview.text('TODO: Overview');
  }
}
export default GanttView;
