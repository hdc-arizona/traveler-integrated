/* globals d3 */

const SvgViewMixin = function (superclass) {
  const SvgView = class extends superclass {
    setupContentElement () {
      return this.d3el.append('svg');
    }
    getAvailableSpace () {
      // Don't rely on non-dynamic SVG width / height for available space; use
      // this.d3el instead
      return super.getAvailableSpace(this.d3el);
    }
    draw () {
      super.draw();

      const bounds = this.getAvailableSpace();
      this.content
        .attr('width', bounds.width)
        .attr('height', bounds.height);
    }
    setupTab () {
      super.setupTab();
      this.tabElement
        .classed('svgTab', true)
        .append('div')
        .classed('downloadIcon', true)
        .on('click', () => {
          this.downloadSvg();
        });
    }
    downloadSvg () {
      // Adapted from https://stackoverflow.com/a/37387449/1058935
      const containerElements = ['svg', 'g'];
      const relevantStyles = {
        'svg': ['width', 'height'],
        'rect': ['fill', 'stroke', 'stroke-width', 'opacity'],
        'p': ['font', 'opacity'],
        '.node': ['cursor', 'opacity'],
        'path': ['fill', 'stroke', 'stroke-width', 'opacity'],
        'circle': ['fill', 'stroke', 'stroke-width', 'opacity'],
        'line': ['stroke', 'stroke-width', 'opacity'],
        'text': ['fill', 'font-size', 'text-anchor', 'opacity'],
        'polygon': ['stroke', 'fill', 'opacity']
      };
      const copyStyles = (original, copy) => {
        const tagName = original.tagName;
        const allStyles = window.getComputedStyle(original);
        for (const style of relevantStyles[tagName] || []) {
          d3.select(copy).style(style, allStyles[style]);
        }
        if (containerElements.indexOf(tagName) !== -1) {
          for (let i = 0; i < original.children.length; i++) {
            copyStyles(original.children[i], copy.children[i]);
          }
        }
      };

      const original = this.content.node();
      const copy = original.cloneNode(true);
      copyStyles(original, copy);

      const data = new window.XMLSerializer().serializeToString(copy);
      const svg = new window.Blob([data], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svg);

      const link = d3.select('body')
        .append('a')
        .attr('download', `${this.title}.svg`)
        .attr('href', url);
      link.node().click();
      link.remove();
    }
  };
  SvgView.prototype._instanceOfSvgViewMixin = true;
  return SvgView;
};
Object.defineProperty(SvgViewMixin, Symbol.hasInstance, {
  value: i => !!i._instanceOfSvgViewMixin
});
export default SvgViewMixin;
