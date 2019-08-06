import CodeView from './CodeView.js';

class PhyslView extends CodeView {
  constructor (argObj) {
    const label = encodeURIComponent(argObj.state.label);
    argObj.resources = [
      { type: 'json', url: `/datasets/${label}/physl` }
    ];
    super(argObj);
  }
  get mode () {
    return 'scheme';
  }
}
export default PhyslView;
