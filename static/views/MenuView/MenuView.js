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
    this._folderMode = true;
    this.openFolders = {};
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

    this.viewModeButton.img = this.folderMode ? 'img/tag.svg' : 'img/folder.svg';
    this.viewModeButton.label = this.folderMode ? 'Sort by tag' : 'Sort by folder';
    this.viewModeButton.tooltip = { content: this.folderMode ? 'Sort by tag' : 'Sort by folder' };
    this.viewModeButton.d3el.style('display', this.expanded ? null : 'none');

    let tempDatasetList;
    if (this.folderMode) {
      tempDatasetList = this.computeFolderList();
      if (!this.expanded) {
        tempDatasetList = tempDatasetList.filter(d => !d.folder);
      }
    } else {
      tempDatasetList = this.computeTagList();
    }

    let datasets = this.d3el.select('.datasetList').selectAll('.dataset')
      .data(tempDatasetList, d => d.id);
    datasets.exit().remove();
    const datasetsEnter = datasets.enter().append('div')
      .classed('dataset', true);
    datasets = datasets.merge(datasetsEnter);

    datasetsEnter.append('div').classed('folderStuff', true);
    datasets.select('.folderStuff')
      .style('display', this.expanded && this.folderMode ? null : 'none');
    if (this.expanded && this.folderMode) {
      this.drawFolderStuff(datasetsEnter, datasets);
    }

    datasetsEnter.append('div').classed('tagStuff', true);
    datasets.select('.tagStuff')
      .style('display', this.expanded && !this.folderMode ? null : 'none');
    if (this.expanded && !this.folderMode) {
      this.drawTagStuff(datasetsEnter, datasets);
    }

    datasetsEnter.append('div').classed('label', true);
    datasets.select('.label')
      .text(d => this.expanded ? d.label : null)
      .style('display', this.expanded ? null : 'none');

    datasetsEnter.append('div').classed('button', true);
    uki.ui.ButtonView.initForD3Selection(datasetsEnter.select('.button'), d => {
      return { img: 'img/hamburger.svg' };
    });
    uki.ui.ButtonView.iterD3Selection(datasets.select('.button'), (buttonView, d) => {
      buttonView.d3el.style('display', d.getMenu ? null : 'none');
      buttonView.tooltip = { content: d.label };
      buttonView.onclick = async event => {
        if (d.getMenu) {
          uki.ui.showContextMenu({
            menuEntries: await d.getMenu(),
            target: buttonView.d3el,
            showEvent: event
          });
        }
      };
    });
  }

  drawTagStuff (datasetsEnter, datasets) {
    // TODO
  }

  drawFolderStuff (datasetsEnter, datasets) {
    const fsEnter = datasetsEnter.select('.folderStuff');
    const fs = datasets.select('.folderStuff');

    datasets.classed('isFolder', d => d.folder);

    fsEnter.append('div').classed('opener', true);
    fs.select('.opener').classed('open', d => d.open)
      .style('margin-left', d => (d.depth || 0) + 'em')
      .on('click', (event, d) => {
        if (this.openFolders[d.id]) {
          delete this.openFolders[d.id];
        } else {
          this.openFolders[d.id] = true;
        }
        this.render();
      });

    fsEnter.append('img').classed('icon', true);
    fs.select('.icon')
      .attr('src', d => d.folder ? 'img/folder.svg' : 'img/handle.svg');
  }

  computeFolderList () {
    // Build the tree
    const tree = [];
    for (const dataset of window.controller.datasetList) {
      let label = dataset.info.label;
      let labelChunks = label.match(/([^/]*)\/(.*)/);
      let parentList = tree;
      let depth = 0;
      const ancestorLabels = [];
      let skipDataset = false;
      while (labelChunks !== null) {
        const folderLabel = labelChunks[1];
        ancestorLabels.push(folderLabel);
        let folder = parentList.find(d => d.folder && d.label === folderLabel);
        if (folder === undefined) {
          const id = ancestorLabels.join('/');
          const open = this.openFolders[id] || false;
          folder = {
            id,
            folder: true,
            label: folderLabel,
            children: [],
            depth,
            open
          };
          parentList.push(folder);
          if (!open) {
            skipDataset = true;
            break;
          }
        }
        depth += 1;
        label = labelChunks[2];
        labelChunks = label.match(/([^/]*)\/(.*)/);
        parentList = folder.children;
      }
      if (!skipDataset) {
        parentList.push({
          linkedState: dataset,
          id: dataset.info.datasetId,
          label,
          getMenu: async () => { return await dataset.getMenu(); },
          depth
        });
      }
    }
    // Flatten the tree
    function * iterTree (tree) {
      for (const item of tree) {
        yield item;
        if (item.children) {
          yield * iterTree(item.children);
        }
      }
    }
    return Array.from(iterTree(tree));
  }

  computeTagList () {
    // TODO: enable sorting / filtering by tags
    return window.controller.datasetList.map(d => {
      return {
        linkedState: d,
        id: d.info.datasetId,
        label: d.info.label,
        getMenu: async () => { return await d.getMenu(); }
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
