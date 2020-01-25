import { View } from '../../node_modules/uki/dist/uki.esm.js';
import LinkedMixin from '../common/LinkedMixin.js';
import LinkedState from '../../models/LinkedState.js';

/**
 * HelperView represents a single dataset inside SummaryView
 */

class HelperView extends LinkedMixin(View) {
  constructor ({ linkedState, datasetTemplate }) {
    super({ linkedState });
    this.datasetTemplate = datasetTemplate;
  }
  setup () {
    this.d3el.html(this.datasetTemplate);
    this.d3el.select('.label').text(this.linkedState.label);
    this.setupButtonListeners();
  }
  setupButtonListeners () {
    const self = this;

    // Delete button
    this.d3el.select('.delete.button')
      .on('mouseenter', function () {
        window.controller.tooltip.show({
          content: `Delete ${self.linkedState.label}`,
          targetBounds: this.getBoundingClientRect()
        });
      })
      .on('mouseleave', () => { window.controller.tooltip.hide(); })
      .on('click', async d => {
        if (window.confirm(`Are you sure you want to delete ${this.linkedState.label}?`)) {
          await window.fetch(`/datasets/${encodeURIComponent(d)}`, {
            method: 'delete'
          });
          window.controller.closeAllViews(this.linkedState);
          await window.controller.getDatasets();
        }
      });

    // Assemble views button
    this.d3el.select('.assemble.button')
      .on('mouseenter', function () {
        window.controller.tooltip.show({
          content: `Show all views for ${self.linkedState.label}`,
          targetBounds: this.getBoundingClientRect()
        });
      })
      .on('mouseleave', () => { window.controller.tooltip.hide(); })
      .on('click', () => { window.controller.assembleViews(this.linkedState, this); });

    // Color mode button
    this.d3el.select('.color.button')
      .on('mouseenter', function () {
        self._standardMousing = true;
        window.controller.tooltip.show({
          content: `Color by...`,
          targetBounds: this.getBoundingClientRect()
        });
      })
      .on('mouseleave', () => {
        if (this._standardMousing) {
          window.controller.tooltip.hide();
        }
      })
      .on('click', function () {
        self._standardMousing = false;
        const menuEntries = Object.entries(LinkedState.COLOR_SCHEMES).map(([label, colors]) => {
          return {
            content: d3el => {
              const labelWrapper = d3el.select('.label');
              labelWrapper.append('div')
                .classed('colorSquare', true)
                .style('background', colors.selectionColor);
              labelWrapper.append('div')
                .classed('padded', true)
                .text(label);
              for (const scaleColor of colors.timeScale) {
                labelWrapper.append('div')
                  .classed('colorSquare', true)
                  .style('background', scaleColor);
              }
            },
            onClick: () => {
              self.linkedState.mode = label;
            }
          };
        });
        window.controller.tooltip.showContextMenu({
          targetBounds: this.getBoundingClientRect(),
          menuEntries
        });
      });

    // Hamburger menu
    this.d3el.select('.hamburger.button')
      .on('mouseenter', function () {
        self._standardMousing = true;
        window.controller.tooltip.show({
          content: `Color by...`,
          targetBounds: this.getBoundingClientRect()
        });
      })
      .on('mouseleave', () => {
        if (this._standardMousing) {
          window.controller.tooltip.hide();
        }
      })
      .on('click', function () {
        self._standardMousing = false;
        window.controller.tooltip.showContextMenu({
          menuEntries: [
            {
              content: 'this',
              onClick: () => {}
            },
            {
              content: 'is',
              subEntries: [
                {
                  content: 'a',
                  subEntries: [
                    {
                      content: 'test',
                      subEntries: [
                        {
                          content: 'of',
                          onClick: () => {}
                        },
                        {
                          content: 'nested',
                          subEntries: [
                            {
                              content: 'context',
                              onClick: () => {}
                            },
                            {
                              content: 'menus',
                              onClick: () => {}
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          targetBounds: this.getBoundingClientRect()
        });
      });
  }
  draw () {}
}

export default HelperView;
