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
ROLE_OPTIONS.unshift({ key: null, value: "(don't parse file)" });

class UploadView extends IntrospectableMixin(View) {
  constructor (d3el) {
    super(d3el, [
      { type: 'text', url: 'views/SummaryView/uploadTemplate.html' }
    ]);

    this.selectedFiles = [];
    this.log = null;
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
    const label = this.d3el.select('.datasetLabel').node();
    return label && label.value && !window.controller.datasets[label.value] && this.selectedFiles.some(d => d.role !== null);
  }
  setup () {
    this.d3el.html(this.resources[0]);

    this.d3el.select('.cancel.button').on('click', () => {
      if (this.loading) {
        console.warn('TODO: abort the upload process, probably just with oboe stream.abort()');
      }
      window.controller.hideModal();
    });
    this.d3el.select('.upload.button').on('click', () => {
      this.d3el.select('.hiddenUpload').node().click();
    });
    this.d3el.select('.datasetLabel').on('change', () => { this.render(); });
    this.d3el.select('.hiddenUpload').on('change', () => {
      for (const fileObj of d3.event.target.files) {
        if (!this.selectedFiles.find(d => d.fileObj === fileObj)) {
          const extension = fileObj.name.toLocaleLowerCase().split('.').pop();
          let role = null;
          if (LOG_EXTENSIONS[extension] && this.tree === null && this.csv === null && this.dot === null) {
            this.log = this.tree = this.csv = this.dot = this.selectedFiles.length;
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
        this.render();
        await this.uploadFiles();
        this.loading = false;
        this.render();
      }
    });
    this.d3el.select('.uploadLog').node().value = 'Upload progress:\n================\n';
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

    filesEnter.append('select')
      .on('change', (d, i) => {
        const newRole = d3.event.target.value || null;
        if (newRole === 'log') {
          if (this.log !== null) {
            this.selectedFiles[this.log].role = null;
          }
          if (this.tree !== null) {
            this.selectedFiles[this.tree].role = null;
          }
          if (this.csv !== null) {
            this.selectedFiles[this.csv].role = null;
          }
          if (this.dot !== null) {
            this.selectedFiles[this.dot].role = null;
          }
          this.log = this.tree = this.csv = this.dot = i;
          d.role = 'log';
        } else if (newRole !== null) {
          if (this[newRole] !== null) {
            this.selectedFiles[this[newRole]].role = null;
          }
          this[newRole] = i;
        }
        d.role = newRole;
        this.render();
      });
    const options = files.select('select').selectAll('option')
      .data(ROLE_OPTIONS);
    options.enter().append('option')
      .property('value', d => d.key || '')
      .text(d => d.value);
    files.select('select')
      .property('value', d => d.role || '');

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
  async uploadFiles () {
    const label = this.d3el.select('.datasetLabel').node().value;
    // TODO: use oboe to stream the log response more cleanly, but unfortunately
    // oboe can't POST files yet... when I get a chance, maybe look into helping
    // with https://github.com/jimhigson/oboe.js/pull/167
    const decoder = new TextDecoder('utf-8');
    const uploadLog = this.d3el.select('.uploadLog').node();

    async function handleResponse (response, message = null) {
      const reader = response.body.getReader();
      while (true) {
        let { done, value } = await reader.read();
        if (done) {
          break;
        } else {
          if (!response.ok) {
            uploadLog.value += `\n\nERROR communicating with server: ${response.status}\n\n`;
            throw new Error(decoder.decode(value));
          } else if (message) {
            uploadLog.value += message;
          } else {
            uploadLog.value += decoder.decode(value);
          }
        }
      }
    }

    try {
      await handleResponse(await window.fetch(`/datasets/${label}`, {
        method: 'POST'
      }), `Dataset created: ${label}\n`);
      for (const { fileObj, role } of this.selectedFiles) {
        if (role !== null) {
          const body = new window.FormData();
          body.append('file', fileObj);
          await handleResponse(await window.fetch(`/datasets/${label}/${role}`, {
            method: 'POST',
            body
          }));
        }
      }
    } catch (e) {
      console.warn(e);
    }

    await window.controller.getDatasets();
    window.controller.renderAllViews();
  }
}
export default UploadView;
