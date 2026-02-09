// MicroClaw Memory Editor
(function () {
  'use strict';

  var TABS = [
    { id: 'profile', label: 'Profile', endpoint: '/api/memory/profile' },
    { id: 'event-planning', label: 'Events', endpoint: '/api/memory/event-planning' },
    { id: 'workflow', label: 'Workflow', endpoint: '/api/memory/workflow' },
    { id: 'tasks', label: 'Tasks', endpoint: '/api/memory/tasks' },
    { id: 'skills', label: 'Skills', endpoint: '/api/memory/skills' },
    { id: 'programming-planning', label: 'Planning', endpoint: '/api/memory/programming-planning' },
    { id: 'history', label: 'History', endpoint: null },
  ];

  // Field definitions for each tab
  var FIELD_DEFS = {
    profile: {
      strings: ['name', 'location', 'timezone', 'occupation', 'communicationStyle'],
      arrays: [
        'interests', 'preferences', 'favoriteFoods', 'restaurants',
        'coffeePlaces', 'clubs', 'shoppingPlaces', 'workPlaces',
        'dailyPlaces', 'exerciseRoutes', 'keyFacts',
      ],
    },
    skills: {
      strings: [],
      arrays: [
        'languages', 'frameworks', 'architecturePatterns', 'codingStylePreferences',
        'testingApproach', 'toolsAndLibraries', 'approvedPatterns',
        'buildAndDeployment', 'editorAndEnvironment', 'keyInsights',
      ],
    },
    'programming-planning': {
      strings: [],
      arrays: [
        'confirmedPlans', 'modifiedPatterns', 'discardedReasons',
        'planStructure', 'scopePreferences', 'detailLevel',
        'reviewPatterns', 'implementationFlow', 'planningInsights',
      ],
    },
    'event-planning': {
      strings: [],
      arrays: [
        'preferredTimes', 'preferredDays', 'recurringSchedules',
        'venuePreferences', 'calendarHabits', 'planningStyle',
        'eventTypes', 'schedulingInsights',
      ],
    },
    workflow: {
      strings: [],
      arrays: [
        'decompositionPatterns', 'taskSizingPreferences', 'prioritizationApproach',
        'sequencingPatterns', 'dependencyHandling', 'estimationStyle',
        'toolsAndProcesses', 'workflowInsights',
      ],
    },
    tasks: {
      strings: [],
      arrays: [
        'activeTasks', 'completedTasks', 'blockedTasks', 'upcomingTasks',
        'currentGoals', 'projectContext', 'deadlines', 'taskInsights',
      ],
    },
  };

  // Friendly labels for field names
  var FIELD_LABELS = {
    name: 'Name', location: 'Location', timezone: 'Timezone',
    occupation: 'Occupation', communicationStyle: 'Communication Style',
    interests: 'Interests', preferences: 'Preferences',
    favoriteFoods: 'Favorite Foods', restaurants: 'Restaurants',
    coffeePlaces: 'Coffee Places', clubs: 'Clubs / Gyms',
    shoppingPlaces: 'Shopping Places', workPlaces: 'Work Places',
    dailyPlaces: 'Daily Places', exerciseRoutes: 'Exercise Routes',
    keyFacts: 'Key Facts',
    languages: 'Languages', frameworks: 'Frameworks',
    architecturePatterns: 'Architecture Patterns',
    codingStylePreferences: 'Coding Style', testingApproach: 'Testing Approach',
    toolsAndLibraries: 'Tools & Libraries', approvedPatterns: 'Approved Patterns',
    buildAndDeployment: 'Build & Deploy', editorAndEnvironment: 'Editor & Environment',
    keyInsights: 'Key Insights',
    confirmedPlans: 'Confirmed Plans', modifiedPatterns: 'Modification Patterns',
    discardedReasons: 'Discard Reasons', planStructure: 'Plan Structure',
    scopePreferences: 'Scope Preferences', detailLevel: 'Detail Level',
    reviewPatterns: 'Review Patterns', implementationFlow: 'Implementation Flow',
    planningInsights: 'Planning Insights',
    preferredTimes: 'Preferred Times', preferredDays: 'Preferred Days',
    recurringSchedules: 'Recurring Schedules', venuePreferences: 'Venue Preferences',
    calendarHabits: 'Calendar Habits', planningStyle: 'Planning Style',
    eventTypes: 'Event Types', schedulingInsights: 'Scheduling Insights',
    decompositionPatterns: 'Decomposition Patterns', taskSizingPreferences: 'Task Sizing',
    prioritizationApproach: 'Prioritization', sequencingPatterns: 'Sequencing',
    dependencyHandling: 'Dependency Handling', estimationStyle: 'Estimation Style',
    toolsAndProcesses: 'Tools & Processes', workflowInsights: 'Workflow Insights',
    activeTasks: 'Active Tasks', completedTasks: 'Completed Tasks',
    blockedTasks: 'Blocked Tasks', upcomingTasks: 'Upcoming Tasks',
    currentGoals: 'Current Goals', projectContext: 'Project Context',
    deadlines: 'Deadlines', taskInsights: 'Task Insights',
  };

  var GCC_TYPES = [
    { value: 'programming_skills', label: 'Skills' },
    { value: 'programming_planning', label: 'Planning' },
    { value: 'event_planning', label: 'Events' },
    { value: 'workflow', label: 'Workflow' },
    { value: 'tasks', label: 'Tasks' },
  ];

  var activeTab = 'profile';
  var tabData = { profile: null, skills: null, 'programming-planning': null, 'event-planning': null, workflow: null, tasks: null };
  var dirty = false;
  var historyState = { type: 'programming_skills', entries: [] };

  function getDialog() { return document.getElementById('memory-dialog'); }
  function getBody() { return document.getElementById('memory-dialog-body'); }
  function getSaveBtn() { return document.getElementById('memory-dialog-save'); }
  function getTabBar() { return document.getElementById('memory-tab-bar'); }
  function getLastUpdated() { return document.getElementById('memory-last-updated'); }

  function fieldLabel(name) {
    return FIELD_LABELS[name] || name.replace(/([A-Z])/g, ' $1').replace(/^./, function (s) { return s.toUpperCase(); });
  }

  function show() {
    var dlg = getDialog();
    if (dlg) dlg.classList.remove('hidden');
    activeTab = 'profile';
    dirty = false;
    loadAllTabs();
  }

  function hide() {
    var dlg = getDialog();
    if (dlg) dlg.classList.add('hidden');
  }

  function loadAllTabs() {
    TABS.forEach(function (tab) {
      if (!tab.endpoint) return;
      fetch(tab.endpoint)
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success) {
            tabData[tab.id] = json.data;
          }
          if (tab.id === activeTab) renderTab();
        })
        .catch(function () {
          tabData[tab.id] = null;
          if (tab.id === activeTab) renderTab();
        });
    });
  }

  function switchTab(tabId) {
    if (dirty) {
      collectCurrentTab();
    }
    activeTab = tabId;
    renderTabBar();
    renderTab();
  }

  function renderTabBar() {
    var bar = getTabBar();
    if (!bar) return;
    var btns = bar.querySelectorAll('.mem-tab-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.tab === activeTab);
    }
  }

  function renderTab() {
    var body = getBody();
    if (!body) return;
    body.innerHTML = '';

    // History tab has its own rendering
    if (activeTab === 'history') {
      renderHistoryTab(body);
      updateLastUpdated(null);
      return;
    }

    var data = tabData[activeTab];
    var defs = FIELD_DEFS[activeTab];

    if (!data) {
      body.innerHTML = '<div class="mem-empty">No data yet. Data will be extracted automatically from conversations.</div>';
      updateLastUpdated(null);
      return;
    }

    updateLastUpdated(data.lastUpdated);

    // String fields
    if (defs.strings) {
      for (var i = 0; i < defs.strings.length; i++) {
        var key = defs.strings[i];
        body.appendChild(createStringField(key, data[key] || ''));
      }
    }

    // Array fields
    if (defs.arrays) {
      for (var j = 0; j < defs.arrays.length; j++) {
        var arrKey = defs.arrays[j];
        body.appendChild(createArrayField(arrKey, data[arrKey] || []));
      }
    }

    renderTabBar();
  }

  function renderHistoryTab(body) {
    // Type selector
    var selector = document.createElement('div');
    selector.className = 'mem-history-selector';

    var label = document.createElement('label');
    label.textContent = 'Memory type: ';
    label.className = 'mem-field-label';
    selector.appendChild(label);

    var select = document.createElement('select');
    select.className = 'mem-history-select';
    for (var i = 0; i < GCC_TYPES.length; i++) {
      var opt = document.createElement('option');
      opt.value = GCC_TYPES[i].value;
      opt.textContent = GCC_TYPES[i].label;
      if (GCC_TYPES[i].value === historyState.type) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', function () {
      historyState.type = select.value;
      loadHistory();
    });
    selector.appendChild(select);
    body.appendChild(selector);

    // Log container
    var logContainer = document.createElement('div');
    logContainer.className = 'mem-history-log';
    logContainer.id = 'gcc-history-log';
    body.appendChild(logContainer);

    loadHistory();
  }

  function loadHistory() {
    var container = document.getElementById('gcc-history-log');
    if (!container) return;
    container.innerHTML = '<div class="mem-empty">Loading...</div>';

    fetch('/api/memory/gcc/' + historyState.type + '/log?limit=50')
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (!json.success || !json.data || json.data.length === 0) {
          container.innerHTML = '<div class="mem-empty">No commit history yet.</div>';
          return;
        }
        historyState.entries = json.data;
        renderHistoryLog(container, json.data);
      })
      .catch(function () {
        container.innerHTML = '<div class="mem-empty">Failed to load history.</div>';
      });
  }

  function renderHistoryLog(container, entries) {
    container.innerHTML = '';
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var row = document.createElement('div');
      row.className = 'mem-history-entry';

      var header = document.createElement('div');
      header.className = 'mem-history-entry-header';

      var hash = document.createElement('span');
      hash.className = 'mem-history-hash';
      hash.textContent = entry.hash.slice(0, 8);
      header.appendChild(hash);

      var confidence = document.createElement('span');
      confidence.className = 'mem-history-confidence mem-confidence-' + (entry.confidence || 'high').toLowerCase().replace('_confidence', '');
      confidence.textContent = (entry.confidence || '').replace('_', ' ');
      header.appendChild(confidence);

      var date = document.createElement('span');
      date.className = 'mem-history-date';
      var d = new Date(entry.createdAt);
      date.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      header.appendChild(date);

      row.appendChild(header);

      var msg = document.createElement('div');
      msg.className = 'mem-history-message';
      msg.textContent = entry.message;
      row.appendChild(msg);

      // Delta summary
      var added = entry.deltaAdded || 0;
      var removed = entry.deltaRemoved || 0;
      if (added > 0 || removed > 0) {
        var delta = document.createElement('div');
        delta.className = 'mem-history-delta';
        if (added > 0) {
          var addSpan = document.createElement('span');
          addSpan.className = 'mem-delta-added';
          addSpan.textContent = '+' + added;
          delta.appendChild(addSpan);
        }
        if (removed > 0) {
          var rmSpan = document.createElement('span');
          rmSpan.className = 'mem-delta-removed';
          rmSpan.textContent = '-' + removed;
          delta.appendChild(rmSpan);
        }
        row.appendChild(delta);
      }

      // Rollback button
      var rollbackBtn = document.createElement('button');
      rollbackBtn.className = 'mem-rollback-btn';
      rollbackBtn.textContent = 'Rollback to here';
      rollbackBtn.dataset.hash = entry.hash;
      rollbackBtn.addEventListener('click', (function (h) {
        return function () { doRollback(h); };
      })(entry.hash));
      row.appendChild(rollbackBtn);

      container.appendChild(row);
    }
  }

  function doRollback(hash) {
    if (!confirm('Rollback to commit ' + hash.slice(0, 8) + '? This creates a new commit reverting to that state.')) {
      return;
    }
    fetch('/api/memory/gcc/' + historyState.type + '/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: hash }),
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json.success) {
          loadHistory();
          loadAllTabs();
        } else {
          alert('Rollback failed: ' + (json.error || 'Unknown error'));
        }
      })
      .catch(function (err) {
        alert('Rollback failed: ' + err.message);
      });
  }

  function updateLastUpdated(ts) {
    var el = getLastUpdated();
    if (!el) return;
    if (ts) {
      var d = new Date(ts);
      el.textContent = 'Last updated: ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    } else {
      el.textContent = '';
    }
  }

  function createStringField(key, value) {
    var group = document.createElement('div');
    group.className = 'mem-field-group';

    var label = document.createElement('label');
    label.className = 'mem-field-label';
    label.textContent = fieldLabel(key);
    group.appendChild(label);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'mem-field-input';
    input.value = value;
    input.dataset.field = key;
    input.dataset.type = 'string';
    input.addEventListener('input', function () { dirty = true; });
    group.appendChild(input);

    return group;
  }

  function createArrayField(key, items) {
    var group = document.createElement('div');
    group.className = 'mem-field-group';

    var header = document.createElement('div');
    header.className = 'mem-array-header';

    var label = document.createElement('label');
    label.className = 'mem-field-label';
    label.textContent = fieldLabel(key) + ' (' + items.length + ')';
    header.appendChild(label);

    var addBtn = document.createElement('button');
    addBtn.className = 'mem-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add item';
    addBtn.addEventListener('click', function () {
      var container = group.querySelector('.mem-array-items');
      if (container) {
        container.appendChild(createArrayItem(key, '', container));
        updateArrayCount(group, key, container);
        dirty = true;
      }
    });
    header.appendChild(addBtn);
    group.appendChild(header);

    var container = document.createElement('div');
    container.className = 'mem-array-items';
    container.dataset.field = key;
    container.dataset.type = 'array';

    for (var i = 0; i < items.length; i++) {
      container.appendChild(createArrayItem(key, items[i], container));
    }
    group.appendChild(container);

    return group;
  }

  function createArrayItem(key, value, container) {
    var row = document.createElement('div');
    row.className = 'mem-array-item';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'mem-array-input';
    input.value = value;
    input.addEventListener('input', function () { dirty = true; });
    row.appendChild(input);

    var removeBtn = document.createElement('button');
    removeBtn.className = 'mem-remove-btn';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', function () {
      row.remove();
      var group = container.closest('.mem-field-group');
      if (group) updateArrayCount(group, key, container);
      dirty = true;
    });
    row.appendChild(removeBtn);

    return row;
  }

  function updateArrayCount(group, key, container) {
    var label = group.querySelector('.mem-field-label');
    if (label) {
      var count = container.querySelectorAll('.mem-array-item').length;
      label.textContent = fieldLabel(key) + ' (' + count + ')';
    }
  }

  function collectCurrentTab() {
    if (activeTab === 'history') return;
    var body = getBody();
    if (!body) return;

    var data = tabData[activeTab] || {};
    var defs = FIELD_DEFS[activeTab];
    if (!defs) return;

    // Collect string fields
    var stringInputs = body.querySelectorAll('input[data-type="string"]');
    for (var i = 0; i < stringInputs.length; i++) {
      var inp = stringInputs[i];
      var val = inp.value.trim();
      data[inp.dataset.field] = val || undefined;
    }

    // Collect array fields
    var arrayContainers = body.querySelectorAll('.mem-array-items[data-type="array"]');
    for (var j = 0; j < arrayContainers.length; j++) {
      var container = arrayContainers[j];
      var fieldName = container.dataset.field;
      var items = container.querySelectorAll('.mem-array-input');
      var values = [];
      for (var k = 0; k < items.length; k++) {
        var v = items[k].value.trim();
        if (v) values.push(v);
      }
      data[fieldName] = values;
    }

    tabData[activeTab] = data;
  }

  function saveAll() {
    collectCurrentTab();

    var saveBtn = getSaveBtn();
    if (saveBtn) {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;
    }

    var pending = 0;
    var errors = [];

    TABS.forEach(function (tab) {
      if (!tab.endpoint) return;
      var data = tabData[tab.id];
      if (!data) return;
      pending++;
      fetch(tab.endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (res) { return res.json(); })
        .then(function (json) {
          if (json.success && json.data) {
            tabData[tab.id] = json.data;
          } else if (!json.success) {
            errors.push(tab.label + ': ' + (json.error || 'Unknown error'));
          }
        })
        .catch(function (err) {
          errors.push(tab.label + ': ' + err.message);
        })
        .finally(function () {
          pending--;
          if (pending === 0) {
            if (saveBtn) {
              saveBtn.textContent = 'Save';
              saveBtn.disabled = false;
            }
            dirty = false;
            if (errors.length > 0) {
              alert('Save errors:\n' + errors.join('\n'));
            }
            renderTab();
          }
        });
    });

    // If nothing to save
    if (pending === 0 && saveBtn) {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  }

  function init() {
    var editBtn = document.getElementById('memory-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', show);
    }

    var closeBtn = document.getElementById('memory-dialog-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hide);
    }

    var saveBtn = getSaveBtn();
    if (saveBtn) {
      saveBtn.addEventListener('click', saveAll);
    }

    // Tab buttons
    var bar = getTabBar();
    if (bar) {
      var btns = bar.querySelectorAll('.mem-tab-btn');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', (function (btn) {
          return function () { switchTab(btn.dataset.tab); };
        })(btns[i]));
      }
    }

    // Close on overlay click
    var overlay = getDialog();
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) hide();
      });
    }
  }

  window.MicroClawMemory = { init: init };
})();
