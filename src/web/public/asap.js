(function () {
  'use strict';

  var panel = null;
  var listEl = null;
  var countBadge = null;
  var dialog = null;
  var jobs = [];
  var pollIntervalId = null;

  function init() {
    panel = document.getElementById('asap-panel');
    listEl = document.getElementById('asap-list');
    countBadge = document.getElementById('asap-count');
    dialog = document.getElementById('asap-dialog');

    var addBtn = document.getElementById('asap-add-btn');
    if (addBtn) addBtn.addEventListener('click', openDialog);

    var closeBtn = document.getElementById('asap-dialog-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDialog);

    var saveBtn = document.getElementById('asap-dialog-save');
    if (saveBtn) saveBtn.addEventListener('click', saveJob);

    if (dialog) {
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) closeDialog();
      });
    }

    loadJobs();
    // Poll every 5 seconds (clear any existing interval to prevent double-polling)
    if (pollIntervalId) clearInterval(pollIntervalId);
    pollIntervalId = setInterval(loadJobs, 5000);
  }

  function loadJobs() {
    fetch('/api/asap/jobs')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          jobs = data.data || [];
          renderList();
        }
      })
      .catch(function () {});
  }

  function renderList() {
    if (!listEl) return;

    // Update count badge
    var pendingCount = jobs.filter(function (j) { return j.status === 'pending' || j.status === 'running'; }).length;
    if (countBadge) {
      countBadge.textContent = pendingCount > 0 ? String(pendingCount) : '';
      countBadge.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
    }

    if (jobs.length === 0) {
      listEl.innerHTML = '<div class="asap-empty">No ASAP jobs</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var statusCls = 'asap-status-' + job.status;
      var statusLabel = job.status.charAt(0).toUpperCase() + job.status.slice(1);
      var timeAgo = formatTimeAgo(job.createdAt);

      html += '<div class="asap-item" data-id="' + job.id + '">';
      html += '<div class="asap-item-info">';
      html += '<span class="asap-item-name">' + escapeHtml(job.name) + '</span>';
      html += '<span class="asap-item-time">' + timeAgo + '</span>';
      html += '</div>';
      html += '<span class="asap-badge ' + statusCls + '">' + statusLabel + '</span>';
      html += '<div class="asap-item-actions">';

      if (job.status === 'failed') {
        html += '<button class="cron-action-btn asap-retry-btn" title="Retry" data-id="' + job.id + '">R</button>';
      }
      if (job.status !== 'running') {
        html += '<button class="cron-action-btn asap-delete-btn" title="Delete" data-id="' + job.id + '">&times;</button>';
      }

      html += '</div>';
      html += '</div>';
    }

    listEl.innerHTML = html;

    // Attach event handlers
    var retryBtns = listEl.querySelectorAll('.asap-retry-btn');
    for (var r = 0; r < retryBtns.length; r++) {
      retryBtns[r].addEventListener('click', onRetry);
    }

    var deleteBtns = listEl.querySelectorAll('.asap-delete-btn');
    for (var d = 0; d < deleteBtns.length; d++) {
      deleteBtns[d].addEventListener('click', onDelete);
    }
  }

  function onRetry(e) {
    e.stopPropagation();
    var id = e.currentTarget.getAttribute('data-id');
    fetch('/api/asap/jobs/' + id + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).then(function () { loadJobs(); });
  }

  function onDelete(e) {
    e.stopPropagation();
    var id = e.currentTarget.getAttribute('data-id');
    fetch('/api/asap/jobs/' + id, {
      method: 'DELETE',
    }).then(function () { loadJobs(); });
  }

  function openDialog() {
    if (!dialog) return;
    var nameInput = document.getElementById('asap-field-name');
    var descInput = document.getElementById('asap-field-desc');
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    dialog.classList.remove('hidden');
    if (nameInput) nameInput.focus();
  }

  function closeDialog() {
    if (dialog) dialog.classList.add('hidden');
  }

  function saveJob() {
    var nameInput = document.getElementById('asap-field-name');
    var descInput = document.getElementById('asap-field-desc');
    var name = nameInput ? nameInput.value.trim() : '';
    var desc = descInput ? descInput.value.trim() : '';

    if (!name || !desc) return;

    fetch('/api/asap/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, description: desc }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          closeDialog();
          loadJobs();
        }
      })
      .catch(function () {});
  }

  function formatTimeAgo(isoStr) {
    var now = Date.now();
    var then = new Date(isoStr).getTime();
    var diff = Math.max(0, now - then);
    var secs = Math.floor(diff / 1000);

    if (secs < 60) return 'just now';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.EClawAsap = { init: init };
})();
