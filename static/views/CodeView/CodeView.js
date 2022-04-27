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
    this.overlayShadowEl.classed('CodeOverlay', true);

    let __self = this;
    this.linkedState.on('selectionChanged', () => {
      if(this.linkedState?.selection) {
        let customizedLabel = this.linkedState.selection.label;
        if(Array.isArray(customizedLabel)) {
          customizedLabel = this.linkedState.selection.label[0];
        }
        if(this.linkedState.selection.intervalDetails?.Primitive) {
          customizedLabel = this.linkedState.selection.intervalDetails.Primitive
        }
        if (customizedLabel.includes('$')) {
          let sCL = customizedLabel.substring(0, customizedLabel.lastIndexOf('$'));
          const ln = sCL.substring(sCL.lastIndexOf('$')+1);
          const cha = customizedLabel.substring(customizedLabel.lastIndexOf('$')+1);
          __self.codeMirror.setCursor({
            line: ln-1,
            ch: cha
          });
          __self.codeMirror.refresh();
        }
      }
    });
  }

  async draw () {
    await super.draw(...arguments);

    if (this.isLoading) {
      // Don't draw anything if we're still waiting on something; super.draw
      // will show a spinner
      return;
    }

    // Update color mode and size based on the goldenlayout element (using
    // this.d3el would just calculate the CodeMirror's existing size)
    const darkMode = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    const bounds = this.glEl.node().getBoundingClientRect();
    this.codeMirror.setOption('theme', darkMode ? 'base16-dark' : 'base16-light');
    this.codeMirror.setSize(bounds.width, bounds.height);
    this.codeMirror.refresh();

    // TODO: highlight chunks of code based on linkedState.colorMode, and/or
    // the currently selected primitive
  }
}
export default CodeView;
