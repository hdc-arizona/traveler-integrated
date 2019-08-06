import CodeView from './CodeView.js';

class PythonView extends CodeView {
  constructor (argObj) {
    const label = encodeURIComponent(argObj.state.label);
    argObj.resources = [
      { type: 'json', url: `/datasets/${label}/python` }
    ];
    super(argObj);
  }
  get mode () {
    return 'python';
  }
}
export default PythonView;
