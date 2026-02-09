(function () {
  'use strict';

  var dialog = null;
  var calendarGrid = null;
  var monthLabel = null;
  var runs = [];
  var jobs = [];
  var viewDate = new Date();
  var activePopoverCleanup = null;

  function init() {
    dialog = document.getElementById('calendar-dialog');
    calendarGrid = document.getElementById('calendar-grid');
    monthLabel = document.getElementById('calendar-month-label');

    var openBtn = document.getElementById('calendar-open-btn');
    if (openBtn) {
      openBtn.addEventListener('click', openCalendar);
    }

    var closeBtn = document.getElementById('calendar-dialog-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeCalendar);
    }

    if (dialog) {
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) closeCalendar();
      });
    }

    var prevBtn = document.getElementById('calendar-prev');
    var nextBtn = document.getElementById('calendar-next');
    if (prevBtn) prevBtn.addEventListener('click', prevMonth);
    if (nextBtn) nextBtn.addEventListener('click', nextMonth);
  }

  function openCalendar() {
    viewDate = new Date();
    fetchCalendar().then(function () {
      renderMonth();
      if (dialog) dialog.classList.remove('hidden');
    });
  }

  function closeCalendar() {
    if (dialog) dialog.classList.add('hidden');
  }

  function prevMonth() {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderMonth();
  }

  function nextMonth() {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderMonth();
  }

  function fetchCalendar() {
    return fetch('/api/cron/calendar?days=90')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          runs = data.data.runs || [];
          jobs = data.data.jobs || [];
        }
      })
      .catch(function () {
        runs = [];
        jobs = [];
      });
  }

  function cleanupPopover() {
    if (activePopoverCleanup) {
      activePopoverCleanup();
      activePopoverCleanup = null;
    }
  }

  function renderMonth() {
    if (!calendarGrid || !monthLabel) return;
    cleanupPopover();

    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    var monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    monthLabel.textContent = monthNames[month] + ' ' + year;

    // Build run index by day key
    var runsByDay = {};
    for (var i = 0; i < runs.length; i++) {
      var d = new Date(runs[i].runAtMs);
      if (d.getFullYear() === year && d.getMonth() === month) {
        var key = d.getDate();
        if (!runsByDay[key]) runsByDay[key] = [];
        runsByDay[key].push(runs[i]);
      }
    }

    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = new Date();
    var isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

    var html = '';
    // Day headers
    var dayHeaders = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (var h = 0; h < 7; h++) {
      html += '<div class="cal-header">' + dayHeaders[h] + '</div>';
    }

    // Empty cells before first day
    for (var e = 0; e < firstDay; e++) {
      html += '<div class="cal-cell cal-empty"></div>';
    }

    // Day cells
    for (var day = 1; day <= daysInMonth; day++) {
      var isToday = isCurrentMonth && day === today.getDate();
      var dayRuns = runsByDay[day] || [];
      var cls = 'cal-cell';
      if (isToday) cls += ' cal-today';
      if (dayRuns.length > 0) cls += ' cal-has-jobs';

      html += '<div class="' + cls + '" data-day="' + day + '">';
      html += '<span class="cal-day-num">' + day + '</span>';

      if (dayRuns.length > 0) {
        html += '<div class="cal-dots">';
        // Show up to 4 unique job dots
        var seen = {};
        var dotCount = 0;
        for (var r = 0; r < dayRuns.length && dotCount < 4; r++) {
          var jid = dayRuns[r].jobId;
          if (!seen[jid]) {
            seen[jid] = true;
            var color = jobColor(jid);
            html += '<span class="cal-dot" style="background:' + color + '"></span>';
            dotCount++;
          }
        }
        if (dayRuns.length > 4) {
          html += '<span class="cal-dot-more">+</span>';
        }
        html += '</div>';
      }

      html += '</div>';
    }

    calendarGrid.innerHTML = html;

    // Click handlers for day cells
    var cells = calendarGrid.querySelectorAll('.cal-has-jobs');
    for (var c = 0; c < cells.length; c++) {
      cells[c].addEventListener('click', onDayClick);
    }
  }

  function onDayClick(e) {
    var cell = e.currentTarget;
    var day = parseInt(cell.getAttribute('data-day'), 10);
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();

    // Remove existing popover
    var existing = document.querySelector('.cal-popover');
    if (existing) existing.remove();

    // Get runs for this day
    var dayRuns = [];
    for (var i = 0; i < runs.length; i++) {
      var d = new Date(runs[i].runAtMs);
      if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
        dayRuns.push(runs[i]);
      }
    }

    if (dayRuns.length === 0) return;

    var popover = document.createElement('div');
    popover.className = 'cal-popover';

    var title = document.createElement('div');
    title.className = 'cal-popover-title';
    title.textContent = new Date(year, month, day).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    popover.appendChild(title);

    for (var j = 0; j < dayRuns.length; j++) {
      var run = dayRuns[j];
      var item = document.createElement('div');
      item.className = 'cal-popover-item';
      var color = jobColor(run.jobId);
      var time = new Date(run.runAtMs).toLocaleTimeString(undefined, {
        hour: '2-digit', minute: '2-digit'
      });
      item.innerHTML =
        '<span class="cal-dot" style="background:' + color + '"></span>' +
        '<span class="cal-popover-name">' + escapeHtml(run.jobName) + '</span>' +
        '<span class="cal-popover-time">' + time + '</span>';
      popover.appendChild(item);
    }

    cell.style.position = 'relative';
    cell.appendChild(popover);

    // Close on click outside
    function closePopover(ev) {
      if (!popover.contains(ev.target) && ev.target !== cell) {
        popover.remove();
        document.removeEventListener('click', closePopover);
        activePopoverCleanup = null;
      }
    }
    cleanupPopover();
    activePopoverCleanup = function () {
      document.removeEventListener('click', closePopover);
      if (popover.parentNode) popover.remove();
    };
    setTimeout(function () {
      document.addEventListener('click', closePopover);
    }, 0);
  }

  var JOB_COLORS = [
    '#E87B35', '#5856D6', '#34C759', '#FF3B30',
    '#007AFF', '#FF9500', '#AF52DE', '#00C7BE'
  ];
  var jobColorMap = {};

  function jobColor(jobId) {
    if (!jobColorMap[jobId]) {
      var idx = Object.keys(jobColorMap).length % JOB_COLORS.length;
      jobColorMap[jobId] = JOB_COLORS[idx];
    }
    return jobColorMap[jobId];
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.EClawCalendar = { init: init };
})();
