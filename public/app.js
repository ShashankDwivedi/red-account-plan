(function () {
  'use strict';

  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const dropzone = document.getElementById('dropzone');
  const fileNameEl = document.getElementById('file-name');
  const analyzeBtn = document.getElementById('analyze-btn');
  const btnLabel = analyzeBtn.querySelector('.btn-label');
  const spinner = analyzeBtn.querySelector('.spinner');
  const errorBox = document.getElementById('error-box');
  const uploadView = document.getElementById('upload-view');
  const resultsView = document.getElementById('results-view');

  let selectedFile = null;
  let currentAnalysis = null;

  // ---- Helpers ----------------------------------------------------------
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function setFile(file) {
    selectedFile = file;
    if (file) {
      fileNameEl.hidden = false;
      fileNameEl.textContent = '✓ ' + file.name;
      dropzone.classList.add('has-file');
      analyzeBtn.disabled = false;
    } else {
      fileNameEl.hidden = true;
      dropzone.classList.remove('has-file');
      analyzeBtn.disabled = true;
    }
    clearError();
  }

  function iconFor(format) {
    // Small document glyph; color comes from CSS.
    var badge = format === 'pdf' ? 'PDF' : format === 'docx' ? 'W' : 'P';
    return (
      '<svg class="doc-icon" viewBox="0 0 24 24" width="15" height="15" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14 3v5h5" />' +
      '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />' +
      '</svg>'
    );
  }

  function ragColor(status) {
    return status === 'Green'
      ? 'var(--green)'
      : status === 'Yellow'
      ? 'var(--amber)'
      : 'var(--red)';
  }

  function barColor(score) {
    if (score >= 75) return 'var(--green)';
    if (score >= 45) return 'var(--amber)';
    return 'var(--red)';
  }

  // ---- File selection ---------------------------------------------------
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', function (e) {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files[0]) {
      fileInput.files = files;
      setFile(files[0]);
    }
  });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // ---- Submit -----------------------------------------------------------
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!selectedFile) return;
    clearError();

    analyzeBtn.disabled = true;
    spinner.hidden = false;
    btnLabel.textContent = 'Analyzing workbook…';

    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      renderResults(data);
    } catch (err) {
      showError(err.message || 'Failed to analyze the file.');
    } finally {
      analyzeBtn.disabled = false;
      spinner.hidden = true;
      btnLabel.textContent = 'Generate Success Plan';
    }
  });

  // ---- Rendering --------------------------------------------------------
  async function exportPlan(format, btn) {
    if (!currentAnalysis) return;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = '<span class="mini-spinner"></span> Preparing…';
    try {
      const res = await fetch('/api/export/' + format, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentAnalysis),
      });
      if (!res.ok) {
        let msg = 'Export failed.';
        try {
          msg = (await res.json()).error || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const name = match ? match[1] : 'success-plan.' + format;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Could not generate the file.');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.innerHTML = original;
    }
  }

  async function downloadFilled(btn) {
    if (!selectedFile) {
      alert('Please re-upload the Excel file to download a filled copy.');
      return;
    }
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = '<span class="mini-spinner"></span> Preparing…';
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      const res = await fetch('/api/fill', { method: 'POST', body: fd });
      if (!res.ok) {
        let msg = 'Could not fill the workbook.';
        try {
          msg = (await res.json()).error || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const name = match ? match[1] : 'filled.xlsx';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Could not fill the workbook.');
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.innerHTML = original;
    }
  }

  function renderResults(data) {
    currentAnalysis = data;
    const o = data.overall;
    const genDate = new Date(data.generatedAt).toLocaleString();

    const tabsHtml = data.tabs
      .map(function (t) {
        return (
          '<div class="bar-row">' +
          '<span class="bar-label">' + esc(t.tab) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' +
          t.score + '%;background:' + barColor(t.score) + '"></span></span>' +
          '<span class="bar-meta"><span class="pct">' + t.score +
          '%</span> · ' + t.yes + '/' + t.total + ' yes</span>' +
          '</div>'
        );
      })
      .join('');

    const risksHtml =
      data.topRisks.length > 0
        ? data.topRisks
            .map(function (r) {
              return (
                '<li class="risk-item"><span class="icon">✕</span><span>' +
                esc(r.question) + '</span></li>'
              );
            })
            .join('')
        : '<li class="strength-item"><span class="icon">✓</span>No gaps detected — every criterion is met.</li>';

    const strengthsHtml =
      data.strengths.length > 0
        ? data.strengths
            .map(function (s) {
              return (
                '<li class="strength-item"><span class="icon">✓</span><span>' +
                esc(s.question) + '</span></li>'
              );
            })
            .join('')
        : '<li class="risk-item"><span class="icon">✕</span>No strengths recorded yet.</li>';

    const phasesHtml = data.plan
      .map(function (p) {
        const actions = p.actions
          .map(function (a) {
            return (
              '<div class="action">' +
              '<div class="action-head">' +
              '<span class="action-title">' + esc(a.title) + '</span>' +
              '<span class="prio prio-' + esc(a.priority) + '">' + esc(a.priority) + '</span>' +
              '</div>' +
              '<p class="action-detail">' + esc(a.detail) + '</p>' +
              '<p class="action-owner">👤 <b>' + esc(a.owner) + '</b></p>' +
              (a.addresses
                ? '<p class="action-addresses"><b>Addresses:</b> ' + esc(a.addresses) + '</p>'
                : '') +
              '</div>'
            );
          })
          .join('');

        const metrics = p.successMetrics
          .map(function (m) { return '<li>' + esc(m) + '</li>'; })
          .join('');
        const exits = p.exitCriteria
          .map(function (x) { return '<li>' + esc(x) + '</li>'; })
          .join('');

        return (
          '<div class="phase phase-' + p.horizon + '">' +
          '<div class="phase-head">' +
          '<div class="phase-horizon">' + esc(p.label.split('·')[0].trim()) + '</div>' +
          '<div class="phase-title">' + esc(p.label.split('·').slice(1).join('·').trim()) + '</div>' +
          '<div class="phase-target">Target: <b>' + esc(p.targetStatus) + '</b></div>' +
          '</div>' +
          '<div class="phase-body">' +
          '<p class="phase-objective">' + esc(p.objective) + '</p>' +
          actions +
          '</div>' +
          '<div class="phase-foot">' +
          '<div class="foot-block"><div class="foot-title">Success Metrics</div><ul class="foot-list">' + metrics + '</ul></div>' +
          '<div class="foot-block"><div class="foot-title">Exit Criteria</div><ul class="foot-list">' + exits + '</ul></div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    resultsView.innerHTML =
      '<div class="results-head">' +
      '<div class="results-title"><h2>Account Success Plan</h2>' +
      '<p>' + esc(data.fileName) + ' · generated ' + esc(genDate) + '</p></div>' +
      '<div class="head-actions">' +
      '<div class="export-group" role="group" aria-label="Download plan">' +
      '<span class="export-label">Export:</span>' +
      '<button class="btn-export btn-export-pdf" data-format="pdf" title="Download as PDF">' +
      iconFor('pdf') + '<span>PDF</span></button>' +
      '<button class="btn-export btn-export-docx" data-format="docx" title="Download as Word">' +
      iconFor('docx') + '<span>Word</span></button>' +
      '<button class="btn-export btn-export-pptx" data-format="pptx" title="Download as PowerPoint">' +
      iconFor('pptx') + '<span>PPT</span></button>' +
      '<button id="fill-btn" class="btn-export btn-export-xlsx" title="Download the Excel with chaos values filled into Col 2">' +
      iconFor('pptx') + '<span>Filled Excel</span></button>' +
      '</div>' +
      '<button id="restart-btn" class="btn-ghost">↑ New file</button>' +
      '</div>' +
      '</div>' +

      // Non-fatal warnings (e.g. chaos data unavailable)
      (data.warnings && data.warnings.length
        ? '<div class="warning-banner" role="alert">⚠ ' +
          data.warnings.map(esc).join('<br>⚠ ') +
          '</div>'
        : '') +

      // Health card
      '<div class="card health-card">' +
      '<div class="gauge" style="--pct:' + o.score + ';--col:' + ragColor(o.status) + '">' +
      '<div class="gauge-inner"><div class="gauge-score" style="color:' + ragColor(o.status) + '">' +
      o.score + '</div><div class="gauge-label">Health Score</div></div></div>' +
      '<div>' +
      '<span class="status-badge status-' + esc(o.status) + '">Account Status: ' + esc(o.status) + '</span>' +
      '<p class="exec-summary">' + esc(data.executiveSummary) + '</p>' +
      '<div class="stat-row">' +
      '<span class="stat"><b>' + o.total + '</b>Criteria assessed</span>' +
      '<span class="stat"><b style="color:var(--green)">' + o.yes + '</b>Yes / met</span>' +
      '<span class="stat"><b style="color:var(--red)">' + o.no + '</b>No / gaps</span>' +
      '<span class="stat"><b>' + data.tabs.length + '</b>Tabs analyzed</span>' +
      '</div></div></div>' +

      // Tab breakdown
      '<div class="card"><h3>Health by Assessment Area</h3>' +
      '<p class="card-sub">Percentage of criteria met per worksheet tab (lowest first).</p>' +
      '<div class="bars">' + tabsHtml + '</div></div>' +

      // Risks & strengths
      '<div class="two-col">' +
      '<div class="card"><h3>Top Risks <span class="count-pill">' + data.topRisks.length + '</span></h3><p class="card-sub">All unmet criteria threatening the account.</p>' +
      '<ul class="chip-list">' + risksHtml + '</ul></div>' +
      '<div class="card"><h3>Strengths to Leverage <span class="count-pill">' + data.strengths.length + '</span></h3><p class="card-sub">All met criteria to build recovery on.</p>' +
      '<ul class="chip-list">' + strengthsHtml + '</ul></div>' +
      '</div>' +

      // Plan
      '<h3 class="section-title-dark">The 30·60·90 Day Recovery Plan</h3>' +
      '<div class="timeline">' + phasesHtml + '</div>';

    uploadView.hidden = true;
    resultsView.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    Array.prototype.forEach.call(
      resultsView.querySelectorAll('.btn-export[data-format]'),
      function (btn) {
        btn.addEventListener('click', function () {
          exportPlan(btn.getAttribute('data-format'), btn);
        });
      }
    );

    var fillBtn = document.getElementById('fill-btn');
    if (fillBtn) {
      fillBtn.addEventListener('click', function () {
        downloadFilled(fillBtn);
      });
    }

    document
      .getElementById('restart-btn')
      .addEventListener('click', function () {
        resultsView.hidden = true;
        uploadView.hidden = false;
        setFile(null);
        fileInput.value = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
  }
})();
