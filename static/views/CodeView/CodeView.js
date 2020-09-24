/* globals uki, CodeMirror */

class CodeView extends uki.ui.GLView {
  constructor (options) {
    options.resources = options.resources || [];
    options.resources.push(...[
      { type: 'less', url: 'views/CodeView/style.less' },
      { type: 'json', url: `/datasets/${options.datasetId}/${options.variant}`, name: 'code' }
    ]);
    super(options);

    this.codeType = options.variant;

    switch (options.variant) {
      case 'cpp': this.mode = 'clike'; break;
      case 'physl': this.mode = 'scheme'; break;
      case 'python': this.mode = 'python'; break;
    }
  }

  get error () {
    if (super.error) {
      return super.error;
    } else {
      const codeFileDoesntExist = window.controller.info.sourceFiles
        .find(d => d.fileType === this.codeType) === undefined;
      return codeFileDoesntExist ? `Dataset does not have a ${this.codeType} file` : null;
    }
  }

  get isLoading () {
    return super.isLoaindg || window.controller.currentDataset.info.sourceFiles
      .find(d => d.fileType === this.codeType)?.stillLoading;
  }

  async setup () {
    await super.setup(...arguments);

    this.codeMirror = CodeMirror(this.d3el.node(), {
      theme: 'base16-light',
      mode: this.mode,
      lineNumbers: true,
      styleActiveLine: true,
      value: this.getNamedResource('code')
    });

    // TODO: linked highlighting
    /* this.codeMirror.setCursor({
      line: details.line,
      ch: details.char
    }); */
  }

  async draw () {
    await super.draw(...arguments);
    this.codeMirror.refresh();
  }
}
export default CodeView;
