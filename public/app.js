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

    // Categorize an item by which tab it came from.
    function categoryOf(item) {
      var t = (item.tab || '').toLowerCase().replace(/[\s_-]+/g, '-');
      if (t.indexOf('chaos') !== -1) return 'chaos';
      return 'business';
    }

    // Render a categorized set (Business Related + Chaos) of items as sub-groups.
    function renderCategorized(items, itemClass, icon, businessLabel, chaosLabel, emptyMsg) {
      if (!items || items.length === 0) {
        return (
          '<li class="' + (itemClass === 'risk-item' ? 'strength-item' : 'risk-item') +
          '"><span class="icon">' + (itemClass === 'risk-item' ? '✓' : '✕') + '</span>' +
          emptyMsg + '</li>'
        );
      }
      var business = items.filter(function (i) { return categoryOf(i) === 'business'; });
      var chaos = items.filter(function (i) { return categoryOf(i) === 'chaos'; });

      function group(label, groupItems) {
        if (groupItems.length === 0) return '';
        var lis = groupItems
          .map(function (i) {
            // For numeric chaos metrics show the actual measured value;
            // for all checkbox questions show Yes / No.
            var answerText = i.displayValue != null
              ? i.displayValue
              : (i.answer ? 'Yes' : 'No');
            var answerClass = i.displayValue != null
              ? 'answer-value'
              : (i.answer ? 'answer-yes' : 'answer-no');
            return (
              '<li class="' + itemClass + '">' +
              '<span class="icon">' + icon + '</span>' +
              '<span class="item-question">' + esc(i.question) + '</span>' +
              '<span class="answer-badge ' + answerClass + '">' + esc(answerText) + '</span>' +
              '</li>'
            );
          })
          .join('');
        return (
          '<li class="cat-heading">' + esc(label) +
          ' <span class="count-pill">' + groupItems.length + '</span></li>' + lis
        );
      }

      return group(businessLabel, business) + group(chaosLabel, chaos);
    }

    var risksHtml = renderCategorized(
      data.topRisks, 'risk-item', '✕',
      'Business Related Risks', 'Chaos Risks',
      'No gaps detected — every criterion is met.'
    );

    var strengthsHtml = renderCategorized(
      data.strengths, 'strength-item', '✓',
      'Business Related Strengths', 'Chaos Strengths',
      'No strengths recorded yet.'
    );

    // Account Details card (from the Account_Details tab), shown at the top.
    var accountDetailsHtml = '';
    if (data.accountDetails && data.accountDetails.length) {
      accountDetailsHtml =
        '<div class="card account-card"><h3>Account Details</h3>' +
        '<p class="card-sub">Key account context from the Account Details tab.</p>' +
        '<div class="detail-grid">' +
        data.accountDetails
          .map(function (d) {
            return (
              '<div class="detail-item">' +
              '<div class="detail-label">' + esc(d.label) + '</div>' +
              '<div class="detail-value">' + esc(d.value || '—') + '</div>' +
              '</div>'
            );
          })
          .join('') +
        '</div></div>';
    }

    // Chaos metric values card (only when live chaos data was fetched).
    var chaosMetricsHtml = '';
    if (data.chaosMetrics) {
      var m = data.chaosMetrics;
      var metricDefs = [
        { label: 'Percentage of Teams Onboarded', value: m.teamsOnboardedPct, suffix: '%' },
        { label: 'License Utilisation', value: m.licenseUtilizationPct, suffix: '%' },
        { label: 'Avg Monthly Experiment Runs', value: m.avgMonthlyExperimentRuns, suffix: '' },
        { label: 'Total Number of Experiment Runs', value: m.totalExperimentRuns, suffix: '' },
      ];
      chaosMetricsHtml =
        '<div class="card"><h3>Chaos Data Metrics</h3>' +
        '<p class="card-sub">Live values fetched from Harness for this account.</p>' +
        '<div class="metric-grid">' +
        metricDefs
          .map(function (d) {
            return (
              '<div class="metric-tile">' +
              '<div class="metric-value">' + esc(String(d.value)) + esc(d.suffix) + '</div>' +
              '<div class="metric-label">' + esc(d.label) + '</div>' +
              '</div>'
            );
          })
          .join('') +
        '</div></div>';
    }

    // Correlated risk patterns card — the consultant's diagnosis.
    var riskPatternsHtml = '';
    if (data.riskPatterns && data.riskPatterns.length) {
      var severityIcon = { Critical: '🔴', High: '🟠', Medium: '🟡' };
      var patternCards = data.riskPatterns
        .map(function (p) {
          var icon = severityIcon[p.severity] || '⚪';
          var risksPreview = p.matchedRisks.slice(0, 3).map(esc).join(' · ') +
            (p.matchedRisks.length > 3 ? ' · +' + (p.matchedRisks.length - 3) + ' more' : '');
          return (
            '<div class="pattern-card pattern-' + esc(p.severity.toLowerCase()) + '">' +
            '<div class="pattern-header">' +
            '<span class="pattern-severity">' + icon + ' ' + esc(p.severity) + '</span>' +
            '<span class="pattern-name">' + esc(p.name) + '</span>' +
            '<span class="pattern-count">' + p.matchedRisks.length + ' risks</span>' +
            '</div>' +
            '<p class="pattern-headline">' + esc(p.description) + '</p>' +
            '<div class="pattern-detail">' +
            '<div class="pattern-row"><span class="pattern-key">Root Cause:</span><span>' + esc(p.rootCause) + '</span></div>' +
            '<div class="pattern-row"><span class="pattern-key">Business Risk:</span><span>' + esc(p.implication) + '</span></div>' +
            '<div class="pattern-row"><span class="pattern-key">Correlated risks:</span><span class="pattern-risks">' + risksPreview + '</span></div>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      riskPatternsHtml =
        '<div class="card">' +
        '<h3>Correlated Risk Pattern Analysis <span class="count-pill">' + data.riskPatterns.length + '</span></h3>' +
        '<p class="card-sub">The CS consultant engine identified these root-cause clusters — the 30-60-90 plan is structured to address each pattern, not just individual checkboxes.</p>' +
        '<div class="pattern-grid">' + patternCards + '</div>' +
        '</div>';
    }

    const phasesHtml = data.plan
      .map(function (p) {
        // Top 3 actions only — highest priority first (Critical > High > Medium).
        var priorityOrder = { Critical: 0, High: 1, Medium: 2 };
        var topActions = p.actions
          .slice()
          .sort(function(a, b) { return priorityOrder[a.priority] - priorityOrder[b.priority]; })
          .slice(0, 3);

        const actions = topActions
          .map(function (a, idx) {
            // Extract the first meaningful sentence from the detail as the one-liner.
            // Strip the "Correlated risks addressed..." suffix before extracting.
            var cleanDetail = a.detail.split('\n\n')[0].trim();
            // Take the first sentence (up to the first ". " or full stop before capital).
            var firstSentence = cleanDetail.match(/^[^.!?]+[.!?]/)?.[0] || cleanDetail.slice(0, 120);
            if (firstSentence.length > 120) firstSentence = firstSentence.slice(0, 117) + '…';

            var patternTag = a.patternName
              ? '<span class="action-pattern-tag">' + esc(a.patternName) + '</span>'
              : '';

            return (
              '<li class="action-item' + (a.patternId ? ' action-pattern' : '') + '">' +
              '<div class="action-item-num">' + (idx + 1) + '</div>' +
              '<div class="action-item-body">' +
              '<div class="action-head">' +
              '<span class="action-title">' + esc(a.title) + '</span>' +
              '<span class="prio prio-' + esc(a.priority) + '">' + esc(a.priority) + '</span>' +
              '</div>' +
              (patternTag ? '<div class="action-pattern-row">' + patternTag + '</div>' : '') +
              '<p class="action-detail">' + esc(firstSentence) + '</p>' +
              '<p class="action-owner">👤 <b>' + esc(a.owner) + '</b></p>' +
              '</div>' +
              '</li>'
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
          '<ol class="action-list">' + actions + '</ol>' +
          '</div>' +
          '<div class="phase-foot">' +
          '<div class="foot-block"><div class="foot-title">Key Metrics</div><ul class="foot-list">' + metrics + '</ul></div>' +
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

      // Account details (top of report)
      accountDetailsHtml +

      // Health card
      '<div class="card health-card">' +
      '<div class="gauge" style="--pct:' + o.score + ';--col:' + ragColor(o.status) + '">' +
      '<div class="gauge-inner"><div class="gauge-score" style="color:' + ragColor(o.status) + '">' +
      o.score + '</div><div class="gauge-label">Health Score</div></div></div>' +
      '<div>' +
      '<span class="status-badge status-' + esc(o.status) + '">' +
        (o.status === 'Red' ? 'Why Account is Red' : o.status === 'Yellow' ? 'Why Account is Yellow' : 'Account is Healthy') +
      '</span>' +
      '<ul class="exec-bullets">' +
        data.executiveSummary.split('\n').map(function(line) {
          return line.trim() ? '<li>' + esc(line.trim()) + '</li>' : '';
        }).join('') +
      '</ul>' +
      '<div class="stat-row">' +
      '<span class="stat"><b>' + o.total + '</b>Criteria assessed</span>' +
      '<span class="stat"><b style="color:var(--green)">' + o.yes + '</b>Yes / met</span>' +
      '<span class="stat"><b style="color:var(--red)">' + o.no + '</b>No / gaps</span>' +
      '<span class="stat"><b>' + data.tabs.length + '</b>Tabs analyzed</span>' +
      '</div></div></div>' +

      // Chaos metrics
      chaosMetricsHtml +

      // Correlated risk patterns (consultant diagnosis)
      riskPatternsHtml +

      // Tab breakdown
      '<div class="card"><h3>Health by Assessment Area</h3>' +
      '<p class="card-sub">Percentage of criteria met per worksheet tab (lowest first).</p>' +
      '<div class="bars">' + tabsHtml + '</div></div>' +

      // Risks & strengths
      '<div class="two-col">' +
      '<div class="card"><h3>What\'s Not Working Well <span class="count-pill">' + data.topRisks.length + '</span></h3><p class="card-sub">All unmet criteria threatening the account, by area.</p>' +
      '<ul class="chip-list">' + risksHtml + '</ul></div>' +
      '<div class="card"><h3>What\'s Working Well <span class="count-pill">' + data.strengths.length + '</span></h3><p class="card-sub">All met criteria to build recovery on, by area.</p>' +
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
