/* globals d3 */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import prettyPrintTime from '../../utils/prettyPrintTime.js';

class SummaryView extends GoldenLayoutView {
  constructor (argObj) {
    argObj.resources = [
      { type: 'less', url: 'views/SummaryView/style.less' }
    ];
    super(argObj);
    this.pairwiseMode = null;
    this.viewButtons = [
      {
        'views': ['TreeView'],
        'icon': 'img/tree.svg',
        'enabled': meta => meta.hasTree && this.pairwiseMode === null,
        'tooltip': meta => meta.hasTree ? 'Show Tree View' : 'No bundled tree data'
      },
      {
        'views': ['TreeComparisonView'],
        'icon': 'img/compareTrees.svg',
        'enabled': meta => meta.hasTree && (this.pairwiseMode === null ||
          (this.pairwiseMode.type === 'TreeComparisonView' && this.pairwiseMode.metadata !== meta)),
        'pairwise': true,
        'tooltip': meta => meta.hasTree ? 'Compare Trees' : 'No bundled tree data'
      },
      {
        'views': ['CodeView'],
        'icon': 'img/code.svg',
        'enabled': meta => meta.hasCode && this.pairwiseMode === null,
        'tooltip': meta => meta.hasCode ? 'Show Code View' : 'No bundled code file'
      },
      {
        'views': ['GanttView', 'UtilizationView'],
        'icon': 'img/gantt.svg',
        'enabled': meta => meta.hasIntervals && this.pairwiseMode === null,
        'tooltip': meta => meta.hasIntervals ? 'Show Gantt + Utilization Views' : 'No bundled OTF2 traces'
      }
    ];
  }
  get isLoading () {
    return super.isLoading || window.controller.datasets === undefined;
  }
  get isEmpty () {
    return window.controller.datasets !== undefined &&
      (window.controller.datasets instanceof Error ||
       Object.keys(window.controller.datasets).length === 0);
  }
  draw () {
    super.draw();

    if (this.isHidden || this.isLoading) {
      return;
    } else if (window.controller.datasets instanceof Error) {
      this.emptyStateDiv.html('<p>Error communicating with the server</p>');
    } else if (Object.keys(window.controller.datasets).length === 0) {
      this.emptyStateDiv.html('<p>No bundled data exists; try:</p><pre>./serve.py --help</pre>');
    }

    this.drawDatasets();
  }
  drawDatasets () {
    const datasetList = Object.entries(window.controller.datasets);

    let datasets = this.content.selectAll('.dataset')
      .data(datasetList, d => d.key);
    datasets.exit().remove();
    const datasetsEnter = datasets.enter().append('div')
      .classed('dataset', true);
    datasets = datasets.merge(datasetsEnter);

    // Use the space to the right of all the labels / buttons for the bar,
    // minus 2em of space for padding between each section
    let labelSpace = 0;

    datasetsEnter.append('h3').classed('name', true);
    datasets.select('.name').text(d => d.key)
      .each(function () {
        labelSpace = Math.max(labelSpace, this.getBoundingClientRect().width);
      });

    datasetsEnter.append('div').classed('timestamp', true);
    datasets.select('.timestamp').text(d => d.key)
      .each(function () {
        labelSpace = Math.max(labelSpace, this.getBoundingClientRect().width);
      });

    datasetsEnter.append('div').classed('viewContainer', true);
    this.drawViewButtons(datasets);
    datasets.select('.viewContainer')
      .style('left', (labelSpace + this.emSize) + 'px');
  }
  drawViewButtons (datasets) {
    let viewButtons = datasets.select('.viewContainer').selectAll('.button')
      .data(metadata => this.viewButtons.map(button => { return { button, metadata }; }), d => d.button.view);
    viewButtons.exit().remove();
    const viewButtonsEnter = viewButtons.enter().append('div')
      .classed('button', true);
    viewButtons = viewButtons.merge(viewButtonsEnter);

    viewButtonsEnter.append('a').append('img');
    viewButtons.select('img').attr('src', d => d.button.icon);

    viewButtons.classed('selected', d => d.button.views.every(className => window.controller.getView(d.metadata.label, className)));
    viewButtons.classed('disabled', d => !d.button.enabled(d.metadata));

    viewButtons
      .on('mouseenter', function (d) {
        window.tooltip.show({
          content: d.button.tooltip(d.metadata),
          targetBounds: this.getBoundingClientRect()
        });
      })
      .on('mouseleave', () => { window.tooltip.hide(); })
      .on('click', d => {
        if (d.button.enabled(d.metadata)) {
          if (d.button.pairwise) {
            if (this.pairwiseMode === null) {
              this.pairwiseMode = {
                type: d.button.view,
                metadata: d.metadata
              };
              this.render();
            } else {
              throw new Error('unimplemented');
              /*
              window.controller.openViews(d.button.views, {
                label: this.pairwiseMode.metadata.label,
                comparisonLabel: d.metadata.label
              });
              this.pairwiseMode = null;
              this.render();
              */
            }
          } else {
            window.controller.openViews(d.button.views, {
              label: d.metadata.label
            });
          }
        }
      });
  }
}
export default SummaryView;
