// MicroClaw Cron Job Manager
(function() {
  'use strict';

  var cronListEl = null;
  var cronStatusEl = null;
  var cronAddBtn = null;
  var cronDialog = null;
  var cronDialogTitle = null;
  var cronDialogClose = null;
  var cronDialogSave = null;
  var cronDialogDelete = null;

  var jobs = [];
  var editingJobId = null;

  function init() {
    cronListEl = document.getElementById('cron-list');
    cronStatusEl = document.getElementById('cron-status');
    cronAddBtn = document.getElementById('cron-add-btn');
    cronDialog = document.getElementById('cron-dialog');
    cronDialogTitle = document.getElementById('cron-dialog-title');
    cronDialogClose = document.getElementById('cron-dialog-close');
    cronDialogSave = document.getElementById('cron-dialog-save');
    cronDialogDelete = document.getElementById('cron-dialog-delete');

    if (cronAddBtn) {
      cronAddBtn.addEventListener('click', function() {
        showJobDialog(null);
      });
    }
    if (cronDialogClose) {
      cronDialogClose.addEventListener('click', hideJobDialog);
    }
    if (cronDialogSave) {
      cronDialogSave.addEventListener('click', saveJob);
    }
    if (cronDialogDelete) {
      cronDialogDelete.addEventListener('click', function() {
        if (editingJobId) deleteJob(editingJobId);
      });
    }
    if (cronDialog) {
      cronDialog.addEventListener('click', function(e) {
        if (e.target === cronDialog) hideJobDialog();
      });
    }

    var typeSelect = document.getElementById('cron-field-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', updateValuePlaceholder);
    }

    loadJobs();
  }

  function loadJobs() {
    fetch('/api/cron/jobs?includeDisabled=true')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data.success && Array.isArray(data.data)) {
          jobs = data.data;
          renderJobList(jobs);
        } else {
          if (cronStatusEl) cronStatusEl.textContent = 'No cron service';
        }
      })
      .catch(function() {
        if (cronStatusEl) cronStatusEl.textContent = 'Failed to load jobs';
      });
  }

  function renderJobList(jobList) {
    if (!cronListEl) return;
    cronListEl.innerHTML = '';

    if (cronStatusEl) {
      var enabled = jobList.filter(function(j) { return j.enabled; }).length;
      cronStatusEl.textContent = jobList.length + ' job' + (jobList.length !== 1 ? 's' : '') +
        (enabled < jobList.length ? ' (' + enabled + ' active)' : '');
    }

    for (var i = 0; i < jobList.length; i++) {
      var job = jobList[i];
      var item = document.createElement('div');
      item.className = 'cron-item';

      var dot = document.createElement('span');
      dot.className = 'cron-dot ' + (job.enabled ? 'enabled' : 'disabled');
      dot.title = job.enabled ? 'Enabled' : 'Disabled';

      var info = document.createElement('div');
      info.className = 'cron-item-info';

      var nameEl = document.createElement('div');
      nameEl.className = 'cron-item-name';
      nameEl.textContent = job.name || job.id.slice(0, 8);

      var schedEl = document.createElement('div');
      schedEl.className = 'cron-item-schedule';
      schedEl.textContent = formatSchedule(job.schedule);

      info.appendChild(nameEl);
      info.appendChild(schedEl);

      var actions = document.createElement('div');
      actions.className = 'cron-item-actions';

      var toggleBtn = document.createElement('button');
      toggleBtn.className = 'cron-action-btn';
      toggleBtn.title = job.enabled ? 'Disable' : 'Enable';
      toggleBtn.textContent = job.enabled ? 'ON' : 'OFF';
      toggleBtn.addEventListener('click', (function(j) {
        return function(e) {
          e.stopPropagation();
          toggleJob(j.id, j.enabled);
        };
      })(job));

      var runBtn = document.createElement('button');
      runBtn.className = 'cron-action-btn cron-run-btn';
      runBtn.title = 'Run now';
      runBtn.textContent = '\u25B6';
      runBtn.addEventListener('click', (function(j) {
        return function(e) {
          e.stopPropagation();
          runJob(j.id);
        };
      })(job));

      actions.appendChild(toggleBtn);
      actions.appendChild(runBtn);

      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(actions);

      item.addEventListener('click', (function(j) {
        return function() { showJobDialog(j); };
      })(job));

      cronListEl.appendChild(item);
    }
  }

  function formatSchedule(schedule) {
    if (!schedule) return 'No schedule';
    if (schedule.kind === 'cron') return schedule.expr;
    if (schedule.kind === 'every') {
      var ms = schedule.everyMs;
      if (ms >= 86400000) return 'every ' + Math.round(ms / 86400000) + 'd';
      if (ms >= 3600000) return 'every ' + Math.round(ms / 3600000) + 'h';
      if (ms >= 60000) return 'every ' + Math.round(ms / 60000) + 'm';
      return 'every ' + Math.round(ms / 1000) + 's';
    }
    if (schedule.kind === 'at') {
      try {
        return 'at ' + new Date(schedule.at).toLocaleString();
      } catch (e) {
        return 'at ' + schedule.at;
      }
    }
    return 'Unknown';
  }

  function showJobDialog(job) {
    if (!cronDialog) return;
    editingJobId = job ? job.id : null;

    if (cronDialogTitle) {
      cronDialogTitle.textContent = job ? 'Edit Job' : 'New Job';
    }
    if (cronDialogDelete) {
      cronDialogDelete.classList.toggle('hidden', !job);
    }

    var nameInput = document.getElementById('cron-field-name');
    var typeSelect = document.getElementById('cron-field-type');
    var valueInput = document.getElementById('cron-field-value');
    var targetSelect = document.getElementById('cron-field-target');
    var messageInput = document.getElementById('cron-field-message');
    var enabledCheck = document.getElementById('cron-field-enabled');
    var payloadKindSelect = document.getElementById('cron-field-payload-kind');

    if (job) {
      if (nameInput) nameInput.value = job.name || '';
      if (typeSelect) typeSelect.value = job.schedule ? job.schedule.kind : 'cron';
      if (valueInput) {
        if (job.schedule) {
          if (job.schedule.kind === 'cron') valueInput.value = job.schedule.expr || '';
          else if (job.schedule.kind === 'every') valueInput.value = String(job.schedule.everyMs || '');
          else if (job.schedule.kind === 'at') valueInput.value = job.schedule.at || '';
        }
      }
      if (targetSelect) targetSelect.value = job.sessionTarget || 'main';
      if (messageInput) {
        messageInput.value = job.payload
          ? (job.payload.text || job.payload.message || '')
          : '';
      }
      if (enabledCheck) enabledCheck.checked = job.enabled !== false;
      if (payloadKindSelect) payloadKindSelect.value = job.payload ? job.payload.kind : 'systemEvent';
    } else {
      if (nameInput) nameInput.value = '';
      if (typeSelect) typeSelect.value = 'cron';
      if (valueInput) valueInput.value = '';
      if (targetSelect) targetSelect.value = 'main';
      if (messageInput) messageInput.value = '';
      if (enabledCheck) enabledCheck.checked = true;
      if (payloadKindSelect) payloadKindSelect.value = 'systemEvent';
    }

    updateValuePlaceholder();
    cronDialog.classList.remove('hidden');
  }

  function updateValuePlaceholder() {
    var typeSelect = document.getElementById('cron-field-type');
    var valueInput = document.getElementById('cron-field-value');
    if (!typeSelect || !valueInput) return;

    var kind = typeSelect.value;
    if (kind === 'cron') {
      valueInput.placeholder = '*/5 * * * * (cron expression)';
      valueInput.type = 'text';
    } else if (kind === 'every') {
      valueInput.placeholder = '60000 (interval in ms)';
      valueInput.type = 'number';
    } else if (kind === 'at') {
      valueInput.placeholder = '2026-01-01T00:00:00Z';
      valueInput.type = 'datetime-local';
    }
  }

  function hideJobDialog() {
    if (cronDialog) {
      cronDialog.classList.add('hidden');
    }
    editingJobId = null;
  }

  function saveJob() {
    var nameInput = document.getElementById('cron-field-name');
    var typeSelect = document.getElementById('cron-field-type');
    var valueInput = document.getElementById('cron-field-value');
    var targetSelect = document.getElementById('cron-field-target');
    var messageInput = document.getElementById('cron-field-message');
    var enabledCheck = document.getElementById('cron-field-enabled');
    var payloadKindSelect = document.getElementById('cron-field-payload-kind');

    var name = nameInput ? nameInput.value.trim() : '';
    var scheduleKind = typeSelect ? typeSelect.value : 'cron';
    var scheduleValue = valueInput ? valueInput.value.trim() : '';
    var sessionTarget = targetSelect ? targetSelect.value : 'main';
    var message = messageInput ? messageInput.value.trim() : '';
    var enabled = enabledCheck ? enabledCheck.checked : true;
    var payloadKind = payloadKindSelect ? payloadKindSelect.value : 'systemEvent';

    if (!name) {
      alert('Name is required');
      return;
    }
    if (!scheduleValue) {
      alert('Schedule value is required');
      return;
    }
    if (!message) {
      alert('Message/payload is required');
      return;
    }

    var schedule = {};
    if (scheduleKind === 'cron') {
      schedule = { kind: 'cron', expr: scheduleValue };
    } else if (scheduleKind === 'every') {
      var ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms < 1000) {
        alert('Interval must be at least 1000ms (1 second)');
        return;
      }
      schedule = { kind: 'every', everyMs: ms };
    } else if (scheduleKind === 'at') {
      var atValue = scheduleValue;
      if (valueInput && valueInput.type === 'datetime-local') {
        atValue = new Date(scheduleValue).toISOString();
      }
      schedule = { kind: 'at', at: atValue };
    }

    var payload = {};
    if (payloadKind === 'agentTurn') {
      payload = { kind: 'agentTurn', message: message };
    } else {
      payload = { kind: 'systemEvent', text: message };
    }

    var body = {
      name: name,
      schedule: schedule,
      sessionTarget: sessionTarget,
      payload: payload,
      enabled: enabled,
    };

    var url = editingJobId
      ? '/api/cron/jobs/' + encodeURIComponent(editingJobId)
      : '/api/cron/jobs';
    var method = editingJobId ? 'PATCH' : 'POST';

    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data.success) {
          hideJobDialog();
          loadJobs();
        } else {
          alert('Error: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Request failed: ' + err.message);
      });
  }

  function deleteJob(id) {
    if (!confirm('Delete this job?')) return;

    fetch('/api/cron/jobs/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data.success) {
          hideJobDialog();
          loadJobs();
        } else {
          alert('Error: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Delete failed: ' + err.message);
      });
  }

  function toggleJob(id, currentEnabled) {
    fetch('/api/cron/jobs/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentEnabled }),
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data.success) {
          loadJobs();
        }
      })
      .catch(function() {
        loadJobs();
      });
  }

  function runJob(id) {
    fetch('/api/cron/jobs/' + encodeURIComponent(id) + '/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function(data) {
        if (data.success) {
          loadJobs();
        } else {
          alert('Run failed: ' + (data.error || 'Unknown error'));
        }
      })
      .catch(function(err) {
        alert('Run failed: ' + err.message);
      });
  }

  function handleMessage(data) {
    if (data.type === 'cron_status') {
      loadJobs();
    }
  }

  window.MicroClawCron = {
    init: init,
    handleMessage: handleMessage,
  };
})();
