/* globals CodeMirror */
import GoldenLayoutView from '../common/GoldenLayoutView.js';
import LinkedMixin from '../common/LinkedMixin.js';

class CodeView extends LinkedMixin(GoldenLayoutView) {
  constructor (argObj) {
    argObj.resources.push({ type: 'less', url: `views/CodeView/style.less` });
    super(argObj);
  }
  get mode () {
    throw new Error('This function should be overridden to return an appropriate codeMirror mode');
  }
  setup () {
    super.setup();

    this.codeMirror = CodeMirror(this.content.node(), {
      theme: 'base16-light',
      mode: this.mode,
      lineNumbers: true,
      styleActiveLine: true,
      value: this.resources[0]
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
