import CodeView from './CodeView.js';

class CppView extends CodeView {
  constructor (argObj) {
    const label = encodeURIComponent(argObj.state.label);
    argObj.resources = [
      { type: 'json', url: `/datasets/${label}/cpp` }
    ];
    super(argObj);
  }

  get mode () {
    return 'clike';
  }
}
export default CppView;
