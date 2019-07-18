/* globals CodeMirror */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import SingleDatasetMixin from '../common/SingleDatasetMixin.js';

class CodeView extends SingleDatasetMixin(GoldenLayoutView) {
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
      styleActiveLine: true,
      value: this.resources[1]
    });

    // Move the cursor when a new primitive is selected
    this.linkedState.on('primitiveSelected', () => {
      const details = this.linkedState.getPrimitiveDetails();
      if (details) {
        /*this.codeMirror.setCursor({
          line: details.line,
          ch: details.char
        });*/
      }
    });
  }
}
export default CodeView;
