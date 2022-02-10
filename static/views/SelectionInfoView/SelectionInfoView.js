/* globals uki */
import LinkedMixin from '../common/LinkedMixin.js';

class SelectionInfoView extends LinkedMixin(uki.ui.GLView) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'text', url: 'views/SelectionInfoView/template.html', name: 'template' },
      { type: 'less', url: 'views/SelectionInfoView/style.less' }
    ]);
    super(options);
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.html(this.getNamedResource('template'))
      .classed('SelectionInfoView', true);

    this.linkedState.on('selectionChanged', () => {
      if (this.linkedState.selection?.type === 'IntervalDurationSelection') {
        this.linkedState.selection.on('intervalDurationSpanChanged', () => { this.render(); });
      }
      this.render();
    });
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner. Instead, ensure that another render() call is
      // fired when we're finally ready
      this.ready.then(() => { this.render(); });
      return;
    } else if (this.error) {
      // If there's an upstream error, super.draw will already display an error
      // message. Don't attempt to draw anything (or we'll probably just add to
      // the noise of whatever is really wrong)
      return;
    }

    let selectionHeader, selectionLinks, selectionDetails;
    if (this.linkedState?.selection) {
      let customizedLabel = this.linkedState.selection.label;
      if(Array.isArray(customizedLabel)) {
        customizedLabel = this.linkedState.selection.label.join("<br>");
      }
      selectionHeader = `<h5>${this.linkedState.selection.humanReadableType}:</h5>
        <strong class="selectionLabel">${customizedLabel}</strong>`;
      selectionLinks = this.linkedState.selection.links;
      selectionDetails = this.linkedState.selection.details;
    } else if (this.linkedState) {
      selectionHeader = `<h5>No current selection</h5>
        <strong class="selectionLabel">${this.linkedState.info.label}</strong> metadata:`;
      selectionLinks = [];
      // Include all the info about the dataset, except omit the lengthy
      // intervalHistograms object
      const temp = Object.assign({}, this.linkedState.info);
      if (temp.intervalHistograms) {
        temp.intervalHistograms = [
          '...',
          '(large object omitted;',
          'open the Interval Histogram',
          'view to see this data)',
          '...'
        ];
      }
      selectionDetails = JSON.stringify(temp, null, 2);
    } else {
      selectionHeader = '<h5>No current selection or dataset</h5>';
      selectionLinks = [];
      selectionDetails = null;
    }

    this.d3el.select('.selectionHeader').html(selectionHeader);
    this.d3el.select('pre').text(selectionDetails);

    // Populate a list with relevant selections
    let links = this.d3el.select('.selectionLinks')
      .selectAll('li').data(selectionLinks);
    links.exit().remove();
    const linksEnter = links.enter().append('li');
    links = links.merge(linksEnter);

    linksEnter.append('a');
    links.select('a')
      .text(d => d.label)
      .on('click', (event, d) => { d.pivot(); });
  }
}
export default SelectionInfoView;
