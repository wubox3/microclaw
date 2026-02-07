// MicroClaw Canvas Panel
(function() {
  'use strict';

  var panel = null;
  var iframe = null;
  var header = null;
  var closeBtn = null;
  var resizeHandle = null;
  var toggleBtn = null;
  var iframeReady = false;
  var pendingMessages = [];
  var MAX_PENDING_MESSAGES = 1000;

  function init() {
    panel = document.getElementById('canvas-panel');
    iframe = document.getElementById('canvas-iframe');
    header = document.getElementById('canvas-header');
    closeBtn = document.getElementById('canvas-close-btn');
    resizeHandle = document.getElementById('canvas-resize-handle');
    toggleBtn = document.getElementById('canvas-toggle-btn');

    if (!panel || !iframe) return;

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', hide);
    }

    // Toggle button
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function() {
        if (panel.classList.contains('hidden')) {
          show();
        } else {
          hide();
        }
      });
    }

    // Resize handle
    if (resizeHandle) {
      setupResize();
    }

    // Listen for postMessage from iframe (validate source is our iframe)
    window.addEventListener('message', function(event) {
      if (!iframe || event.source !== iframe.contentWindow) return;

      var data = event.data;
      if (!data || !data.type) return;

      if (data.type === 'canvas_ready') {
        iframeReady = true;
        // Flush pending messages
        for (var i = 0; i < pendingMessages.length; i++) {
          sendToIframe(pendingMessages[i]);
        }
        pendingMessages = [];
        return;
      }

      if (data.type === 'canvas_action') {
        // Forward action from iframe to server via WebSocket
        if (window.MicroClaw && window.MicroClaw.sendCanvasAction) {
          window.MicroClaw.sendCanvasAction(data);
        }
      }
    });
  }

  function sendToIframe(data) {
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(data, window.location.origin);
  }

  function show() {
    if (!panel) return;
    panel.classList.remove('hidden');
    if (toggleBtn) {
      toggleBtn.classList.add('active');
    }
  }

  function hide() {
    if (!panel) return;
    panel.classList.add('hidden');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
    }
  }

  function handleMessage(data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'canvas_present':
        show();
        break;

      case 'canvas_hide':
        hide();
        break;

      case 'canvas_update':
      case 'canvas_a2ui':
      case 'canvas_a2ui_reset':
        if (iframeReady) {
          sendToIframe(data);
        } else {
          if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
            pendingMessages.shift();
          }
          pendingMessages.push(data);
        }
        break;
    }
  }

  function setupResize() {
    var isResizing = false;
    var startX = 0;
    var startWidth = 0;
    var MIN_WIDTH = 300;
    var MAX_WIDTH = 900;

    resizeHandle.addEventListener('mousedown', function(e) {
      isResizing = true;
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!isResizing) return;
      // Dragging left increases width (panel is on the right)
      var delta = startX - e.clientX;
      var newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
      panel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  window.MicroClawCanvas = {
    init: init,
    show: show,
    hide: hide,
    handleMessage: handleMessage
  };
})();
