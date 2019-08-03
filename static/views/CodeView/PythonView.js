import CodeView from './CodeView.js';

class PythonView extends CodeView {
  get mode () {
    return 'python';
  }
}
export default PythonView;
