/* globals d3 */
import { View } from '../../node_modules/uki/dist/uki.esm.js';

class GoldenLayoutView extends View {
  constructor ({
    container,
    resources = {}
  }) {
    super(null, resources);
    this.container = container;
    this._title = this.constructor.name;
    this.container.on('tab', tab => {
      this.tabElement = d3.select(tab.element[0]);
      this.setupTab();
    });
    this.container.on('open', () => {
      this.render(d3.select(this.container.getElement()[0]));
    });
    this.container.on('show', () => this.render());
    this.container.on('resize', () => this.render());
  }
  set title (newTitle) {
    if (this.tabElement) {
      this.tabElement.classed(this._title, false);
      this.tabElement.classed(newTitle, true);
    }
    if (this.d3el) {
      this.d3el.classed(this._title, false);
      this.d3el.classed(newTitle, true);
    }
    this._title = newTitle;
  }
  get title () {
    return this._title;
  }
  get isEmpty () {
    // Should be overridden when a view has nothing to show
    return false;
  }
  setup () {
    this.d3el.classed(this.title, true);
    this.emptyStateDiv = this.d3el.append('div')
      .classed('emptyState', true)
      .style('display', 'none');
    this.content = this.setupContentElement(this.d3el);
  }
  setupTab () {
    this.tabElement.classed(this.title, true);
  }
  drawTab () {
    this.tabElement.select(':scope > .lm_title')
      .text(this.title);
  }
  setupContentElement () {
    // Default setup is a scrollable div; SvgViewMixin overrides this
    return this.d3el.append('div')
      .classed('scrollArea', true);
  }
  draw () {
    this.emptyStateDiv.style('display', this.isEmpty ? null : 'none');
    if (this.tabElement) {
      this.drawTab();
    }
  }
}

export default GoldenLayoutView;
