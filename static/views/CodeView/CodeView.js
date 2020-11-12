/* globals uki, CodeMirror */
import LinkedMixin from '../common/LinkedMixin.js';

class CodeView extends LinkedMixin(uki.ui.GLView) {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'less', url: 'views/CodeView/style.less' },
      { type: 'css', url: 'node_modules/codemirror/lib/codemirror.css' },
      { type: 'css', url: 'node_modules/codemirror/theme/base16-dark.css' },
      { type: 'css', url: 'node_modules/codemirror/theme/base16-light.css' },
      { type: 'json', url: `/datasets/${options.glState.datasetId}/${options.glState.variant}`, name: 'code' }
    ]);
    super(options);

    this.codeType = options.glState.variant;

    switch (this.codeType) {
      case 'cpp': this.mode = 'clike'; break;
      case 'physl': this.mode = 'scheme'; break;
      case 'python': this.mode = 'python'; break;
    }

    window.matchMedia?.('(prefers-color-scheme: dark)')
      ?.addEventListener('change', () => { this.render(); });
  }

  get title () {
    return this.codeType[0].toLocaleUpperCase() + this.codeType.slice(1);
  }

  get isLoading () {
    return super.isLoading || (this.linkedState?.info?.sourceFiles || [])
      .find(d => d.fileType === this.codeType)?.stillLoading;
  }

  setupD3El () {
    return this.glEl.append('div');
  }

  async setup () {
    await super.setup(...arguments);

    this.d3el.classed('CodeView', true);

    this.codeMirror = CodeMirror(this.d3el.node(), {
      mode: this.mode,
      lineNumbers: true,
      styleActiveLine: true,
      value: this.getNamedResource('code')
    });

    // CodeMirror uses some z-index magic, so we need to tell our overlay to
    // display on top of it
    this.overlayContentEl.classed('CodeOverlay', true);

    // TODO: linked highlighting
    /* this.codeMirror.setCursor({
      line: details.line,
      ch: details.char
    }); */
  }

  async draw () {
    await super.draw(...arguments);
    // Update color mode and size based on the goldenlayout element (using
    // this.d3el would just calculate the CodeMirror's existing size)
    const darkMode = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    const bounds = this.glEl.node().getBoundingClientRect();
    this.codeMirror.setOption('theme', darkMode ? 'base16-dark' : 'base16-light');
    this.codeMirror.setSize(bounds.width, bounds.height);
    this.codeMirror.refresh();
  }
}
export default CodeView;
