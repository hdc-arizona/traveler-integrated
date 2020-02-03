/* globals d3 */
import { View } from '../../node_modules/uki/dist/uki.esm.js';
import LinkedMixin from '../common/LinkedMixin.js';
import LinkedState from '../../models/LinkedState.js';
import ProcMetricView from '../ProcMetricView/ProcMetricView.js';

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
    var clearTooltipStyle = function () {
      d3.selectAll('.tooltip').classed('proctip', false);
    };

    // Delete button
    this.d3el.select('.delete.button')
      .on('mouseenter', function () {
        clearTooltipStyle();
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
        clearTooltipStyle();
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
        clearTooltipStyle();
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
    var hamburgerItemSubContents = function(item, entries) {
      return {
        content: item,
        subEntries: entries
      };
    };
    var hamburgerItemContent = function(title, param) {
      return {
        content: title,
        onClick: () => {
          clearTooltipStyle();
            var newProcMetricView = {
                type: 'component',
                componentName: 'ProcMetricView',
                componentState: { label: self.linkedState.label }
            };
            self.linkedState.selectedProcMetric = param;
            // TODO: the following is a bad hack, need to do it properly by following goldenlayout API
            let cLen = window.controller.goldenLayout.root.contentItems[0]
                .contentItems[0].contentItems[0].contentItems.length;
            window.controller.goldenLayout.root.contentItems[0].contentItems[0].contentItems[0].addChild(newProcMetricView);
            console.log(window.controller.goldenLayout.root.contentItems[0]
                .contentItems[0].contentItems[0].contentItems[cLen].contentItems[0].tab);
            window.controller.goldenLayout.root.contentItems[0]
                .contentItems[0].contentItems[0].contentItems[cLen].contentItems[0].tab.titleElement[0]
                .outerText = self.linkedState.label + " " + param;
        }
      };
    };

    this._intervalTimeout = window.setTimeout(async () => {
      const procMetricList = await d3.json(`/datasets/${self.linkedState.label}/procMetrics`);
      var menuEntriesNestedList = {};
      var menuEntriesList = [];
      procMetricList.forEach(item => {
        if(item.indexOf(':') > -1) {
          var res = item.split(':');
          if(!(res[0] in menuEntriesNestedList)) {
            menuEntriesNestedList[res[0]] = [];
          }
          menuEntriesNestedList[res[0]].push(hamburgerItemContent(res[1], item));
        } else {
          menuEntriesList.push(hamburgerItemContent(item, item));
        }
      });
      for(const key of Object.keys(menuEntriesNestedList)) {
        menuEntriesList.push(hamburgerItemSubContents(key, menuEntriesNestedList[key]));
      }

      self.d3el.select('.hamburger.button')
          .on('mouseenter', function () {
            clearTooltipStyle();
            self._standardMousing = true;
            window.controller.tooltip.show({
              content: `Show views...`,
              targetBounds: this.getBoundingClientRect()
            });
          })
          .on('mouseleave', () => {
            if (self._standardMousing) {
              window.controller.tooltip.hide();
              clearTooltipStyle();
            }
          })
          .on('click', function () {
            self._standardMousing = false;
            window.controller.tooltip.showContextMenu({
              menuEntries: menuEntriesList,
              targetBounds: this.getBoundingClientRect()
            });
            d3.selectAll('.tooltip').classed('proctip', true);
          });
    }, 100);
  }
  draw () {}
}

export default HelperView;
