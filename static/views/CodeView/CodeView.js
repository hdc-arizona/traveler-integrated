/* globals CodeMirror */
import GoldenLayoutView from '../common/GoldenLayoutView.js';

class CodeView extends GoldenLayoutView {
  constructor (argObj) {
    const label = encodeURIComponent(argObj.state.label);
    argObj.resources = [
      { type: 'less', url: `views/CodeView/style.less` },
      { type: 'json', url: `/datasets/${label}/code` }
    ];
    super(argObj);
  }
  setup () {
    super.setup();

    this.codeMirror = CodeMirror(this.content.node(), {
      theme: 'base16-light',
      mode: 'scheme',
      lineNumbers: true,
      value: this.resources[1]
    });
  }
}
export default CodeView;
