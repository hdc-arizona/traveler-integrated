/* globals d3 */
import { View } from '../../node_modules/uki/dist/uki.esm.js';
import IntrospectableMixin from '../../utils/IntrospectableMixin.js';

const LOG_EXTENSIONS = { log: true, txt: true };
const CANDIDATE_EXTENSIONS = {
  tree: { newick: true, txt: true },
  csv: { perf: true, csv: true },
  dot: { dot: true },
  otf2: { dump: true },
  python: { py: true },
  cpp: { cpp: true },
  physl: { physl: true }
};
const ROLE_OPTIONS = d3.entries({
  log: 'Combined Phylanx log',
  tree: 'Newick tree',
  csv: 'Performance CSV',
  dot: 'DOT graph',
  otf2: 'otf2-print dump',
  python: 'Python source code',
  cpp: 'C++ source code',
  physl: 'Physl source code'
});
ROLE_OPTIONS.unshift({ key: null, value: 'Select file type:' });

class UploadView extends IntrospectableMixin(View) {
  constructor (d3el) {
    super(d3el, [
      { type: 'text', url: 'views/SummaryView/uploadTemplate.html' }
    ]);

    this.selectedFiles = [];
    this.tree = null;
    this.csv = null;
    this.dot = null;
    this.otf2 = null;
    this.python = null;
    this.cpp = null;
    this.physl = null;

    this.loading = false;
  }
  get ready () {
    return this.selectedFiles.some(d => d.role !== null);
  }
  setup () {
    this.d3el.html(this.resources[0]);

    this.d3el.select('.cancel.button').on('click', () => {
      if (this.loading) {
        console.warn('todo: cancel the upload in progress');
      }
      window.controller.hideModal();
    });
    this.d3el.select('.upload.button').on('click', () => {
      this.d3el.select('.hiddenUpload').node().click();
    });
    this.d3el.select('.hiddenUpload').on('change', () => {
      for (const fileObj of d3.event.target.files) {
        if (!this.selectedFiles.find(d => d.fileObj === fileObj)) {
          const extension = fileObj.name.toLocaleLowerCase().split('.').pop();
          let role = null;
          if (LOG_EXTENSIONS[extension] && this.tree === null && this.csv === null && this.dot === null) {
            this.tree = this.csv = this.dot = this.selectedFiles.length;
            role = 'log';
          } else {
            for (const [possibleRole, candidates] of Object.entries(CANDIDATE_EXTENSIONS)) {
              if (candidates[extension] && this[possibleRole] === null) {
                this[possibleRole] = this.selectedFiles.length;
                role = possibleRole;
              }
            }
          }
          this.selectedFiles.push({ fileObj, role });
        }
      }
      this.render();
    });
    this.d3el.select('.ok.button').on('click', async () => {
      if (this.ready && !this.loading) {
        this.loading = true;
        console.warn('todo: actually upload the files');
        window.controller.hideModal();
      }
    });
  }
  draw () {
    this.d3el.select('.ok.button')
      .classed('disabled', !this.ready && !this.loading);
    this.d3el.select('.uploadSpinner')
      .style('display', this.loading ? null : 'none');
    this.drawFiles();
  }
  drawFiles () {
    let files = this.d3el.select('.selectedFiles')
      .selectAll('.file').data(this.selectedFiles);
    files.exit().remove();
    const filesEnter = files.enter().append('div')
      .classed('file', true);
    files = files.merge(filesEnter);

    filesEnter.append('img')
      .attr('src', '/static/img/hamburger.svg')
      .classed('dragHandle', true);
    // TODO: enable reordering

    filesEnter.append('div').classed('filename', true);
    files.select('.filename').text(d => d.fileObj.name);

    filesEnter.append('select');
    const options = files.select('select').selectAll('option')
      .data(ROLE_OPTIONS);
    options.enter().append('option')
      .property('value', d => d.key)
      .text(d => d.value);
    files.select('select')
      .property('value', d => d.role);

    filesEnter.append('img')
      .classed('status', true);
    files.select('.status')
      .attr('src', d => {
        if (d.fileObj.name.toLocaleLowerCase().endsWith('.otf2')) {
          return '/static/img/warning.svg';
        } else if (d.role !== null) {
          return '/static/img/check.svg';
        } else {
          return '/static/img/ex.svg';
        }
      });
  }
}
export default UploadView;
