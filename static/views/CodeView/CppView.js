import CodeView from './CodeView.js';

class CppView extends CodeView {
  get mode () {
    return 'clike';
  }
}
export default CppView;
