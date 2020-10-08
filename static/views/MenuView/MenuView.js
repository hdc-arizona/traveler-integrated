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
    this._tagSortMode = 'a-z(filtered)';
    this.openFolders = {};
    this.filteredTags = {};
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
    this.headerOptionsButton = new uki.ui.ButtonView({
      d3el: this.d3el.select('.headerOptions.button'),
      img: '/static/img/hamburger.svg',
      onclick: () => {
        this.showTagHeaderOptionsMenu();
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

    this.d3el.select('.underlay')
      .style('display', this.expanded && !this.folderMode ? null : 'none');
    this.d3el.select('.tagHeaderWrapper')
      .style('display', this.expanded && !this.folderMode ? null : 'none');

    if (this.folderMode) {
      this._tempDatasetList = this.computeFolderedDatasetList();
      if (!this.expanded) {
        this._tempDatasetList = this._tempDatasetList.filter(d => !d.folder);
      }
    } else {
      this._tempDatasetList = this.computeTaggedDatasetList();
      this._tempTagList = this.computeTagList();
    }

    this.drawDatasets();

    if (this.expanded && !this.folderMode) {
      this.drawTagUnderlay();
    }
  }

  drawDatasets () {
    const datasetList = this._tempDatasetList;
    // To test vertical overflow, enable this code instead:
    /*
    const datasetList = this._tempDatasetList.concat(
      Array.from(Array(20).keys()).map(d => {
        return {
          label: `dummy${d}`,
          getMenu: () => {
            return [{ content: `(dummy entry) ${d}` }];
          }
        };
      }));
    */

    let datasets = this.d3el.select('.datasetList').selectAll('.dataset')
      .data(datasetList, d => d.id);
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

    datasetsEnter.append('div').classed('label', true);
    datasets.select('.label')
      .text(d => this.expanded && this.folderMode ? d.label : null)
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

  drawTagUnderlay () {
    // Keep the svg aligned with tagHeader's scroll position
    const headerWrapper = this.d3el.select('.tagHeaderWrapper').node();
    const svg = this.d3el.select('.underlay svg');
    let headerWrapperScrollOffset = headerWrapper.scrollLeft;
    let ticking = false;
    headerWrapper.onscroll = event => {
      headerWrapperScrollOffset = headerWrapper.scrollLeft;
      if (!ticking) {
        window.requestAnimationFrame(() => {
          svg.style('left', -headerWrapperScrollOffset);
          ticking = false;
        });
        ticking = true;
      }
    };

    // Draw the headers
    const tagList = this._tempTagList.concat([null]);
    let tagHeaders = this.d3el.select('.tagHeader')
      .selectAll('.tag').data(tagList, d => d);
    tagHeaders.exit().remove();
    const tagHeadersEnter = tagHeaders.enter().append('div')
      .classed('tag', true);
    tagHeaders = tagHeadersEnter.merge(tagHeaders);

    tagHeadersEnter.append('div').classed('label', true);
    tagHeaders.select('.label').text(d => d === null ? 'Add tag' : d);

    tagHeaders.order()
      .classed('tagAdder', d => d === null)
      .classed('filtered', d => this.filteredTags[d])
      .on('click', async (event, d) => {
        if (d === null) {
          // Add the tag to ALL datasets at first
          const newTag = await uki.ui.prompt('New tag', undefined, value => {
            return !!value && window.controller.datasetList.every(d => d.info.tags[value] === undefined);
          });
          if (newTag !== null) {
            await window.fetch(`/tags/${encodeURIComponent(newTag)}`, {
              method: 'POST'
            });
            await window.controller.refreshDatasets();
          }
        } else if (this.filteredTags[d]) {
          delete this.filteredTags[d];
        } else {
          this.filteredTags[d] = true;
        }
        this.render();
      });

    const headerBounds = this.d3el.select('.tagHeader')
      .node().getBoundingClientRect();
    const listBounds = this.d3el.select('.datasetList')
      .node().getBoundingClientRect();

    // Compute where each of the tag headers and datasets are
    const tagAnchors = {};
    tagHeaders.each(function (d) {
      const bounds = this.getBoundingClientRect();
      tagAnchors[d] = {
        x: bounds.left - 32 + headerWrapperScrollOffset,
        y: bounds.bottom - headerBounds.top
      };
    });

    const datasetPositions = {};
    this.d3el.select('.datasetList').selectAll('.dataset').each(function (d) {
      const bounds = this.getBoundingClientRect();
      datasetPositions[d.id] = bounds.bottom - bounds.height / 2 - listBounds.top;
    });

    // Resize the svg
    svg
      .attr('width', headerBounds.width)
      .attr('height', listBounds.height);

    let tagLines = svg.select('.lines').selectAll('path')
      .data(this._tempTagList, d => d);
    tagLines.exit().remove();
    const tagLinesEnter = tagLines.enter().append('path');
    tagLines = tagLines.merge(tagLinesEnter);

    tagLines
      .order()
      .attr('d', d => {
        return `M${tagAnchors[d].x},${tagAnchors[d].y}L${tagAnchors[d].x},${listBounds.height - tagAnchors[d].y}`;
      });

    let datasetRows = svg.select('.circles')
      .selectAll('g').data(this._tempDatasetList, d => d.id);
    datasetRows.exit().remove();
    const datasetRowsEnter = datasetRows.enter().append('g');
    datasetRows = datasetRowsEnter.merge(datasetRows);

    datasetRows.attr('transform', d => `translate(0,${datasetPositions[d.id]})`);

    let circles = datasetRows.selectAll('circle')
      .data(d => this._tempTagList.map(tag => [tag, d]));
    circles.exit().remove();
    const circlesEnter = circles.enter().append('circle');
    circles = circles.merge(circlesEnter);

    circles
      .order()
      .classed('present', ([tag, d]) => d.linkedState.info.tags[tag])
      .attr('r', 7)
      .attr('cx', ([tag]) => tagAnchors[tag].x)
      .on('click', (event, [tag, d]) => {
        const addOrRemoveArg = {};
        addOrRemoveArg[tag] = true;
        if (d.linkedState.info.tags[tag]) {
          d.linkedState.updateDatasetInfo(undefined, undefined, addOrRemoveArg);
        } else {
          d.linkedState.updateDatasetInfo(undefined, addOrRemoveArg);
        }
      });
  }

  computeFolderedDatasetList () {
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
        const id = ancestorLabels.join('/');
        const open = this.openFolders[id] || false;
        let folder = parentList.find(d => d.folder && d.label === folderLabel);
        if (folder === undefined) {
          folder = {
            id,
            folder: true,
            label: folderLabel,
            children: [],
            depth,
            open
          };
          parentList.push(folder);
        }
        if (!open) {
          skipDataset = true;
          break;
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

  computeTaggedDatasetList () {
    let temp = window.controller.datasetList;
    if (Object.keys(this.filteredTags).length > 0) {
      // When filters are enabled, only show datasets that have at least one
      // unfiltered tag
      temp = temp.filter(d => {
        return Object.keys(d.info.tags).some(tag => !this.filteredTags[tag]);
      });
    }
    return temp.map(d => {
      return {
        linkedState: d,
        id: d.info.datasetId,
        label: d.info.label,
        getMenu: async () => { return await d.getMenu(); }
      };
    });
  }

  computeTagList () {
    const result = {};
    for (const linkedState of window.controller.datasetList) {
      for (const tag of Object.keys(linkedState.info.tags)) {
        result[tag] = true;
      }
    }
    return Object.keys(result)
      .sort(this.getTagSortFunction());
  }

  getTagSortFunction () {
    switch (this._tagSortMode) {
      case 'a-z': return (a, b) => String(a).localeCompare(b);
      case 'a-z(filtered)': return (a, b) => {
        if (this.filteredTags[a]) {
          if (this.filteredTags[b]) {
            return String(a).localeCompare(b);
          } else {
            return 1;
          }
        } else if (this.filteredTags[b]) {
          return -1;
        } else {
          return String(a).localeCompare(b);
        }
      };
    }
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

  showTagHeaderOptionsMenu () {
    const tagList = this.computeTagList();
    uki.ui.showContextMenu({
      target: this.d3el.select('.headerOptions'),
      menuEntries: [
        {
          label: 'Show all',
          onclick: () => {
            this.filteredTags = {};
            this.render();
          }
        },
        {
          label: 'Hide all except',
          subEntries: tagList.map(tag => {
            return {
              label: tag,
              onclick: () => {
                this.filteredTags = {};
                for (const otherTag of tagList) {
                  if (otherTag !== tag) {
                    this.filteredTags[otherTag] = true;
                  }
                }
                this.render();
              }
            };
          })
        },
        null, // separator
        {
          label: 'Sort tags A-Z',
          checked: this._tagSortMode === 'a-z',
          onclick: () => {
            this._tagSortMode = 'a-z';
            this.render();
          }
        },
        {
          label: 'Sort by Visible, then A-Z',
          checked: this._tagSortMode === 'a-z(filtered)',
          onclick: () => {
            this._tagSortMode = 'a-z(filtered)';
            this.render();
          }
        }
      ]
    });
  }
}

export default MenuView;
