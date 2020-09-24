/* globals uki */

class MenuView extends uki.View {
  constructor (options = {}) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { name: 'template', type: 'text', url: 'views/MenuView/template.html' },
      { name: 'aboutModal', type: 'text', url: 'views/MenuView/aboutModal.html' },
      { type: 'less', url: 'views/MenuView/style.less' }
    ]);

    super(options);

    this._expanded = false;
    this._folderMode = false;
  }

  get expanded () {
    return this._expanded;
  }

  set expanded (value) {
    this._expanded = value;
    window.controller.renderAllViews();
  }

  get folderMode () {
    return this._folderMode;
  }

  set folderMode (value) {
    this._folderMode = value;
    this.render();
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.html(this.getNamedResource('template'));

    this.mainButton = new uki.ui.ButtonView({
      d3el: this.d3el.select('.main.button'),
      img: 'img/traveler_bw.svg',
      onclick: () => {
        this.showMainMenu();
      }
    });
    this.toggleExpandButton = new uki.ui.ButtonView({
      d3el: this.d3el.select('.toggleExpand.button'),
      onclick: () => {
        this.expanded = !this.expanded;
      }
    });
    this.viewModeButton = new uki.ui.ButtonView({
      d3el: this.d3el.select('.viewMode.button'),
      onclick: () => {
        this.folderMode = !this.folderMode;
      }
    });
  }

  async draw () {
    await super.draw(...arguments);

    this.d3el.classed('expanded', this.expanded);

    this.mainButton.label = this.expanded ? 'Traveler' : null;
    this.mainButton.tooltip = this.expanded ? null : { content: 'Traveler' };

    this.toggleExpandButton.img = this.expanded ? 'img/collapse_left.png' : 'img/collapse_right.png';
    this.toggleExpandButton.label = this.expanded ? 'Collapse' : null;
    this.toggleExpandButton.tooltip = this.expanded ? null : { content: 'Expand' };

    this.viewModeButton.img = this.folderMode ? 'img/folder.svg' : 'img/tag.svg';
    this.viewModeButton.label = this.expanded ? (this.folderMode ? 'Sort by folder' : 'Sort by tag') : null;
    this.viewModeButton.tooltip = this.expanded ? null
      : { content: this.folderMode ? 'Sort by folder' : 'Sort by tag' };

    let datasets = this.d3el.select('.datasetList').selectAll('.dataset')
      .data(window.controller.datasetList, d => d.info.datasetId);
    datasets.exit().remove();
    const datasetsEnter = datasets.enter().append('div')
      .classed('dataset', true);
    datasets = datasets.merge(datasetsEnter);

    datasetsEnter.append('div').classed('label', true);
    datasets.select('.label')
      .text(d => this.expanded ? d.info.label : null)
      .style('display', this.expanded ? null : 'none');

    datasetsEnter.append('div').classed('tags', true);
    datasets.select('.tags')
      .text('')
      .style('display', this.expanded ? null : 'none');

    datasetsEnter.append('div').classed('button', true);
    uki.ui.ButtonView.initForD3Selection(datasetsEnter.select('.button'), d => {
      return { img: 'img/hamburger.svg' };
    });
    uki.ui.ButtonView.iterD3Selection(datasets.select('.button'), (buttonView, d) => {
      buttonView.tooltip = { content: d.info.label };
      buttonView.onclick = async event => {
        uki.ui.showContextMenu({
          menuEntries: await d.getMenu(),
          target: buttonView.d3el,
          showEvent: event
        });
      };
    });
  }

  showMainMenu () {
    uki.ui.showContextMenu({
      target: this.mainButton.d3el,
      menuEntries: [
        {
          label: 'About Traveler...',
          onclick: () => { this.showAboutModal(); }
        },
        {
          label: 'Upload Dataset...',
          onclick: () => { this.showUploadModal(); }
        },
        {
          label: 'Refresh Datasets',
          onclick: () => { window.controller.refreshDatasets(); }
        }
      ]
    });
  }

  showAboutModal () {
    uki.ui.showModal({
      content: this.getNamedResource('aboutModal'),
      buttonSpecs: [{
        label: 'ok',
        primary: true,
        onclick: () => { uki.ui.hideModal(); }
      }]
    });
  }

  showUploadModal () {
    throw new Error('Not implemented yet');
  }
}

export default MenuView;
