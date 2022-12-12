/* globals uki, d3 */

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
    this._tagSortMode = 'a-z(filtered)';
    this.openFolders = {};
    this.filteredTags = {};
  }

  get expanded () {
    return this._expanded;
  }

  set expanded (value) {
    this._expanded = value;
    window.controller.render(); // expanding or contracting the menu affects all views
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
    //Function enables to switch between folder mode and tag mode
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
    //necessary UI changes of the tagging and folder system 
    this.viewModeButton.img = this.folderMode ? 'img/tag.svg' : 'img/folder.svg';
    this.viewModeButton.label = this.folderMode ? 'Sort by tag' : 'Sort by folder';
    this.viewModeButton.tooltip = { content: this.folderMode ? 'Sort by tag' : 'Sort by folder' };
    this.viewModeButton.d3el.style('display', this.expanded ? null : 'none');

    this.d3el.select('.underlay')
      .style('display', this.expanded ? null : 'none');
    this.d3el.select('.tagHeaderWrapper')
      .style('display', this.expanded && !this.folderMode ? null : 'none');
    this.d3el.select('.datasetList')
      .classed('enableClickThrough', !this.folderMode); // prevent datasetList from stealing pointer events in tag mode
    //if 'sort by folder' is selected, it will enable the folder mode and 'sort by tag' will enable the tag mode(!this.folderMode)
    if (this.folderMode) {
      this._tempDatasetList = this.computeFolderedDatasetList();
      if (!this.expanded) {
        this._tempDatasetList = this._tempDatasetList.filter(d => !d.folder);
      }
    } else if(!this.folderMode) {
      this._tempDatasetList = this.computeTaggedDatasetList();
      this._tempTagList = this.computeTagList();
    }

    await this.drawDatasets();

    if (this.expanded) {
      if (this.folderMode) {
        this.drawFolderUnderlay();
      } else if(!this.folderMode) {
        this.drawTagUnderlay();
      }
    }

    //loads in custom DB color from database
    console.log("dataset id: " + window.controller.currentDatasetId);
    for (const dataset of window.controller.datasetList) {
      if(dataset.info.datasetId === window.controller.currentDatasetId)
      {
        var color = dataset.info.color;

        //converts hex to rgb
        var red = parseInt(color.substring(1,3), 16);
        var green = parseInt(color.substring(3,5), 16);
        var blue = parseInt(color.substring(5,7), 16);

        //difference between the border and the main color
        var border_rgb_difference = 55;

        //decreases from max value for rgb if maxed out so colors can be darkened for border
        if(red>=(255 - border_rgb_difference))
          red-= border_rgb_difference;
        if(green>=(255 - border_rgb_difference))
          green-= border_rgb_difference;
        if(blue>=(255 - border_rgb_difference))
          blue-= border_rgb_difference;
        
        //updates color and border_color based on border_rgb_difference
        color = "rgb(" + red + "," + green + "," + blue + ")";
        red+=border_rgb_difference, green+=border_rgb_difference, blue+=border_rgb_difference;
        var border_color = "rgb(" + red + "," + green + "," + blue + ")";

        //changes the color of the slection and border via html (for utilization view)
        var page = document.body.style;
        page.cssText = 
        "--selection-color: " + color + ";" + "\n"
        + "--selection-border-color: " + border_color + ";";
        //+ "--disabled-color: " + color + ";" + "\n";

        //changes the color of the selection and border directly (for general colors)
        var theme = globalThis.controller.getNamedResource('theme').cssVariables;
        theme["--selection-color"] = color;
        theme["--selection-border-color"] = border_color;
        break;
      }
        
    }
  }

  async drawDatasets () {
    const datasetList = this._tempDatasetList;
    // To test vertical overflow, enable this code instead of the previous line:
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
      .data(datasetList, d => d.id).order();
    datasets.exit().remove();
    const datasetsEnter = datasets.enter().append('div')
      .classed('dataset', true);
    datasets = datasets.merge(datasetsEnter);

    datasetsEnter.append('div').classed('folderStuff', true);
    datasets.select('.folderStuff')
      .style('display', this.expanded ? null : 'none');
    this.drawFolderStuff(datasetsEnter, datasets);

    datasetsEnter.append('div').classed('button', true);
    await uki.ui.ButtonView.initForD3Selection(datasetsEnter.select('.button'), d => {
      return { img: 'img/hamburger.svg' };
    });
    await uki.ui.ButtonView.iterD3Selection(datasets.select('.button'), (buttonView, d) => {
      buttonView.d3el.style('display', d.getMenu ? null : 'none');
      buttonView.tooltip = { content: d.label };
      buttonView.primary = d.id === window.controller.currentDatasetId;
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

    datasetsEnter.append('img').classed('spinner', true);
    datasets.select('.spinner')
      .style('display', d => d.linkedState?.isLoading ? null : 'none')
      .attr('src', 'img/spinner.png');
  }

  drawFolderStuff (datasetsEnter, datasets) {
    const self = this;

    const fsEnter = datasetsEnter.select('.folderStuff');
    const fs = datasets.select('.folderStuff')
      .classed('dragTarget', false)
      .style('margin-left', d => 0.5 + 1.5 * (d.depth || 0) + 'em');

    datasets.classed('isFolder', d => d.folder);

    fsEnter.append('div').classed('opener', true);
    fs.select('.opener').classed('open', d => d.open)
      .text(d => d.open ? '-' : '+')
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

    fsEnter.append('div').classed('label', true);
    fs.select('.label')
      .attr('contenteditable', 'true')
      .text(d => d.label)
      .on('keypress', function (event) {
        // Prevent newlines in labels; hitting enter blurs instead
        if (event.keyCode === 13) {
          event.preventDefault();
          this.blur();
        }
      }).on('blur', function (event, d) {
        // User just focused away from the contenteditable, meaning they've
        // finished renaming it
        const rawNewLabel = d3.select(this).text();
        let newLabel = rawNewLabel.replace(/^\/*|\/*$/g, ''); // remove leading or trailing slashes
        if (newLabel.length === 0) {
          // Only allow removing a folder's label (delete the folder and move
          // its children up a level)
          if (d.folder === true) {
            self.dissolveFolder(d.id);
          }
        } else if (newLabel !== d.label) {
          // User actually changed the label...
          if (d.folder === true) {
            // Need to rename all of the descendant datasets of this folder
            const updateUrls = window.controller.datasetList.filter(linkedState => {
              return linkedState.info.label.startsWith(d.id);
            }).map(linkedState => {
              const baseLabel = linkedState.info.label.substring(d.id.length + 1); // chop off the folder that we're renaming
              const parentPath = d.id.match(/(.*)\//)?.[1] || ''; // get the folder's parent path
              const prefix = parentPath ? parentPath + '/' + newLabel : newLabel;
              return linkedState.getUpdateUrl(prefix + '/' + baseLabel);
            });
            self.bulkRename(updateUrls);
          } else {
            // Rename the dataset in context of its parent hierarchy (if there is any)
            const parentPath = d.linkedState.info.label.match(/(.*)\//)?.[1];
            if (parentPath) {
              newLabel = parentPath + '/' + newLabel;
            }
            d.linkedState.setLabelAndTags(newLabel);
          }
        } else if (rawNewLabel !== d.label) {
          // User added some slashes that we auto-strip; just need to render so
          // that they know right away that what they did was invalid
          self.render();
        }
      });

    let x0, y0;
    datasets.classed('dragTarget', false); // Remove any leftover highlights on redraw
    fs.call(d3.drag()
      .filter(event => {
        // We only want the icon handle to initiate drag events (dragging the
        // label stops event propagation, and prevents contenteditable from
        // working properly)... but d3 expects the drag behavior to exist on the
        // parent node. So this adds an extra filter to d3's default filter.
        // Even though it feels like a hack, it's technically correct
        return !event.ctrlKey && !event.button && //    d3's default filter
          d3.select(event.target).classed('icon'); //   our addition
      })
      .on('start', function (event, d) {
        x0 = event.x;
        y0 = event.y;
      })
      .on('drag', function (event, d) {
        // Use CSS to offset the folderStuff div
        const x = event.x - x0;
        const y = event.y - y0;
        d3.select(this).style('transform', `translate(${x}px,${y}px)`);

        // Update each row, based on whether or not it's being targeted by the
        // drag
        const dragTarget = self.getFolderDragAction(event, d, false);
        datasets.classed('dragTarget', d => d === dragTarget);
      })
      .on('end', function (event, d) {
        d3.select(this).style('transform', null);
        datasets.classed('dragTarget', false);
        self.getFolderDragAction(event, d, true);
      }));
  }

  openAllAncestorFolders (label) {
    let ancestorChain = '';
    for (const ancestor of label.split('/').slice(0, -1)) {
      ancestorChain += ancestorChain === '' ? ancestor : '/' + ancestor;
      this.openFolders[ancestorChain] = true;
    }
    this.render();
  }

  getFolderDragAction (event, draggedDatum, performAction) {
    const x = event.sourceEvent.clientX;
    const y = event.sourceEvent.clientY;
    const target = Array.from(document.elementsFromPoint(x, y))
      .filter(node => d3.select(node).classed('isFolder'))[0];
    if (target === undefined) {
      // Dragged onto nothing; do nothing
      return null;
    }
    const targetDatum = d3.select(target).datum();
    if (targetDatum === draggedDatum) {
      // Dragged a thing onto itself; don't do anything
      return null;
    }
    if (draggedDatum.folder === true) {
      // Dragging a folder...
      if (targetDatum.folder === false) {
        // Dragged a folder onto a dataset; don't do anything
        return null;
      } else if (targetDatum.id.startsWith(draggedDatum.id)) {
        // Dragged a folder onto one of its descendant folders; don't do anything
        return null;
      } else if (targetDatum.id === draggedDatum.id.match(/(.*)\//)?.[1]) {
        // Dragged a folder onto its current parent; do nothing
        return null;
      } else {
        // Dragged a folder onto another valid folder; add the targetDatum's
        // full path (its id) to every descendant dataset of draggedDatum
        if (performAction) {
          const updateUrls = window.controller.datasetList.filter(linkedState => {
            return linkedState.info.label.startsWith(draggedDatum.id);
          }).map(linkedState => {
            const baseLabel = linkedState.info.label.substring(draggedDatum.id.length + 1);
            let prefix = targetDatum.id + '/' + draggedDatum.label;
            let copyNumber = 1;
            while (window.controller.datasetList.some(otherLinkedState => {
              return otherLinkedState.info.label.startsWith(prefix);
            })) {
              prefix = targetDatum.id + `/${draggedDatum.label} (${copyNumber})`;
              copyNumber += 1;
            }
            const newLabel = prefix + '/' + baseLabel;
            return linkedState.getUpdateUrl(newLabel);
          });
          this.bulkRename(updateUrls);
        }
      }
    } else {
      // Dragging a dataset...
      if (targetDatum.folder === true) {
        // Dragged a dataset onto a folder; change its label prefix to be
        // the folder's full path (its id)
        if (performAction) {
          const baseLabel = draggedDatum.label.match(/([^/]*)$/)[1];
          const newLabel = targetDatum.id + '/' + baseLabel;
          draggedDatum.linkedState.setLabelAndTags(newLabel);
        }
      } else {
        // Dragged a dataset onto a dataset; do nothing
        return null;
      }
    }
    if (!performAction) {
      // For convenience, we reuse the logic in this function for flagging
      // whether something can be dropped (during a drag), before the mouse
      // button is released. Returning the target is needed to know which
      // thing is being hovered
      return targetDatum;
    }
  }

  async wrapInFolder (linkedState) {
    let parentPath = linkedState.info.label.match(/(.*)\//)?.[1];
    parentPath = parentPath ? parentPath + '/' : '';
    const baseLabel = linkedState.info.label.match(/([^/]*)$/)[1];
    let prefix = parentPath + 'Untitled Folder';
    let copyNumber = 1;
    while (window.controller.datasetList.some(otherLinkedState => {
      return otherLinkedState.info.label.startsWith(prefix);
    })) {
      prefix = parentPath + `Untitled Folder (${copyNumber})`;
      copyNumber += 1;
    }
    const newLabel = prefix + '/' + baseLabel;
    this.openFolders[newLabel] = true;
    return linkedState.setLabelAndTags(newLabel);
  }

  async deleteFolder (folderPath) {
    const urls = window.controller.datasetList.filter(linkedState => {
      return linkedState.info.label.startsWith(folderPath);
    }).map(linkedState => `/datasets/${linkedState.info.datasetId}`);
    await Promise.all(urls.map(url => window.fetch(url, { method: 'DELETE' })));
    await window.controller.refreshDatasets();
  }

  async dissolveFolder (folderPath) {
    const grandParentPath = folderPath.match(/(.*)\//)?.[1];
    const updateUrls = window.controller.datasetList.filter(linkedState => {
      return linkedState.info.label.startsWith(folderPath);
    }).map(linkedState => {
      let strippedLabel = linkedState.info.label.substring(folderPath.length + 1); // chop off the folder that we're deleting
      if (grandParentPath) {
        // If the deleted folder was in a folder, restore the parent path
        strippedLabel = grandParentPath + '/' + strippedLabel;
      }
      return linkedState.getUpdateUrl(strippedLabel);
    });
    await this.bulkRename(updateUrls);
  }

  async renameFolder (folderPath, newFolderPath) {
    newFolderPath = newFolderPath.replace(/^\/*|\/*$/g, ''); // remove any leading or trailing slashes
    const updateUrls = window.controller.datasetList.filter(linkedState => {
      return linkedState.info.label.startsWith(folderPath);
    }).map(linkedState => {
      let strippedLabel = linkedState.info.label.substring(folderPath.length + 1); // chop off the path that we're renaming
      strippedLabel = newFolderPath + '/' + strippedLabel; // add the new one
      return linkedState.getUpdateUrl(strippedLabel);
    });
    await this.bulkRename(updateUrls);
  }

  async bulkRename (updateUrls) {
    await Promise.all(updateUrls.map(url => {
      return window.fetch(url, { method: 'PUT' });
    }));
    await window.controller.refreshDatasets();
  }

  drawFolderUnderlay () {
    const svg = this.d3el.select('.underlay svg');
    svg.select('.circles').html(''); // Don't need to draw circles for folders

    const listBounds = this.d3el.select('.datasetList')
      .node().getBoundingClientRect();
    const allPositions = {};
    const links = [];
    let maxX = 0;
    let maxY = 0;
    this.d3el.select('.datasetList').selectAll('.dataset').each(function (d) {
      const bounds = d3.select(this).select('.icon').node().getBoundingClientRect();
      const childPath = d.folder ? d.id : d.linkedState.info.label;
      const parentPath = childPath.match(/(.*)\//)?.[1];
      allPositions[d.id] = {
        x: bounds.right - bounds.width / 2 - listBounds.left,
        y: bounds.bottom - bounds.height / 2 - listBounds.top
      };
      maxX = Math.max(maxX, allPositions[d.id].x);
      maxY = Math.max(maxY, allPositions[d.id].y);
      if (parentPath) {
        links.push({ parentPath, childId: d.id });
      }
    });

    svg.attr('width', maxX)
      .attr('height', maxY);

    let folderLines = svg.select('.lines').selectAll('path')
      .data(links, d => d.childId);
    folderLines.exit().remove();
    const folderLinesEnter = folderLines.enter().append('path');
    folderLines = folderLines.merge(folderLinesEnter);

    folderLines
      .order()
      .attr('d', d => {
        const parentPos = allPositions[d.parentPath];
        const childPos = allPositions[d.childId];
        return `M${parentPos.x},${parentPos.y}L${parentPos.x},${childPos.y}L${childPos.x},${childPos.y}`;
      });
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
          d.linkedState.setLabelAndTags(undefined, undefined, addOrRemoveArg);
        } else {
          d.linkedState.setLabelAndTags(undefined, addOrRemoveArg);
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
            open,
            getMenu: () => {
              return [
                {
                  label: 'Delete Folder',
                  onclick: () => {
                    uki.ui.confirm(`Delete all datasets and folders in ${folderLabel}?`, {
                      confirmAction: async () => await this.deleteFolder(id)
                    });
                  }
                },
                {
                  label: 'Dissolve Folder',
                  onclick: () => { this.dissolveFolder(id); }
                },
                {
                  label: 'Rename folder',
                  onclick: () => {
                    uki.ui.prompt('New Folder Path', id, {
                      validate: newPath => {
                        newPath = newPath.replace(/^\/*|\/*$/g, ''); // remove any leading or trailing slashes
                        return newPath && newPath !== id;
                      },
                      confirmAction: async newPath => await this.renameFolder(id, newPath)
                    });
                  }
                }
              ];
            }
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
          getMenu: async () => {
            const menu = await dataset.getMenu();
            if (this.expanded && this.folderMode) {
              menu.push({
                label: 'Wrap in Folder',
                onclick: () => {
                  // Wrap this dataset in a new 'Untitled Folder'
                  this.wrapInFolder(dataset);
                }
              });
            }
            return menu;
          },
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
