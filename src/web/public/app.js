// MicroClaw Chat UI
(function() {
  'use strict';

  var MAX_HISTORY_SIZE = 200;

  var messagesEl = document.getElementById('messages');
  var inputForm = document.getElementById('input-form');
  var messageInput = document.getElementById('message-input');
  var sendBtn = document.getElementById('send-btn');
  var typingIndicator = document.getElementById('typing-indicator');
  var connectionStatus = document.getElementById('connection-status');
  var channelList = document.getElementById('channel-list');
  var memoryStatus = document.getElementById('memory-status');

  var ws = null;
  var isConnected = false;
  var isFirstConnect = true;
  var messageHistory = [];
  var reconnectDelay = 1000;
  var MAX_RECONNECT_DELAY = 30000;

  // Channels
  var channels = [
    { id: 'web', label: 'Web Chat', active: true },
    { id: 'telegram', label: 'Telegram' },
    { id: 'whatsapp', label: 'WhatsApp' },
    { id: 'discord', label: 'Discord' },
    { id: 'googlechat', label: 'Google Chat' },
    { id: 'slack', label: 'Slack' },
    { id: 'signal', label: 'Signal' },
    { id: 'imessage', label: 'iMessage' },
  ];

  function trimHistory() {
    if (messageHistory.length > MAX_HISTORY_SIZE) {
      messageHistory = messageHistory.slice(-MAX_HISTORY_SIZE);
    }
  }

  function renderChannels() {
    var label = channelList.querySelector('.nav-section-label');
    channelList.innerHTML = '';
    channelList.appendChild(label);

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      var el = document.createElement('div');
      el.className = 'channel-item' + (ch.active ? ' active' : '');
      var dot = document.createElement('span');
      dot.className = 'channel-dot';
      el.appendChild(dot);
      el.appendChild(document.createTextNode(ch.label));
      el.addEventListener('click', (function(channel, element) {
        return function() {
          document.querySelectorAll('.channel-item').forEach(function(item) {
            item.classList.remove('active');
          });
          element.classList.add('active');
          document.getElementById('chat-title').textContent = channel.label;
        };
      })(ch, el));
      channelList.appendChild(el);
    }
  }

  function formatTime(timestamp) {
    var d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function addMessage(role, text, timestamp) {
    var msgEl = document.createElement('div');
    msgEl.className = 'message ' + role;

    var bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';
    bubbleEl.textContent = text;

    var timeEl = document.createElement('div');
    timeEl.className = 'message-time';
    timeEl.textContent = formatTime(timestamp || Date.now());

    msgEl.appendChild(bubbleEl);
    msgEl.appendChild(timeEl);
    messagesEl.appendChild(msgEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    typingIndicator.classList.remove('hidden');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    typingIndicator.classList.add('hidden');
  }

  function setConnected(connected) {
    isConnected = connected;
    connectionStatus.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
  }

  function loadHistory() {
    fetch('/api/chat/history?channelId=web&limit=50')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success && data.data && data.data.length > 0) {
          messagesEl.innerHTML = '';
          messageHistory = [];
          for (var i = 0; i < data.data.length; i++) {
            var msg = data.data[i];
            addMessage(msg.role, msg.content, msg.timestamp);
            messageHistory.push({ role: msg.role, content: msg.content, timestamp: msg.timestamp });
          }
          trimHistory();
        }
      })
      .catch(function() {
        // History loading is best-effort
      });
  }

  function connectWebSocket() {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host + '/ws';

    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      setConnected(true);
      reconnectDelay = 1000;
      if (isFirstConnect) {
        loadHistory();
        isFirstConnect = false;
      }
    };

    ws.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        if (data.type === 'message') {
          hideTyping();
          addMessage('assistant', data.text, data.timestamp);
          messageHistory.push({ role: 'assistant', content: data.text, timestamp: data.timestamp });
          trimHistory();

          // Notify voice module of assistant response for TTS
          if (window.MicroClawVoice && window.MicroClawVoice.onAssistantMessage) {
            window.MicroClawVoice.onAssistantMessage(data.text);
          }
        } else if (data.type === 'typing') {
          showTyping();
        } else if (data.type === 'memory_status') {
          memoryStatus.textContent = data.status;
        } else if (data.type === 'container_status') {
          if (data.enabled && (memoryStatus.textContent || '').indexOf('[container]') === -1) {
            memoryStatus.textContent = (memoryStatus.textContent || '') + ' [container]';
          }
        } else if (data.type === 'canvas_present' || data.type === 'canvas_hide' ||
                   data.type === 'canvas_update' || data.type === 'canvas_eval' ||
                   data.type === 'canvas_a2ui' || data.type === 'canvas_a2ui_reset') {
          if (window.MicroClawCanvas && window.MicroClawCanvas.handleMessage) {
            window.MicroClawCanvas.handleMessage(data);
          }
        } else if (data.type === 'error') {
          hideTyping();
          addMessage('assistant', 'Error: ' + data.message, Date.now());
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.onclose = function() {
      setConnected(false);
      var delay = Math.min(reconnectDelay + Math.random() * 500, MAX_RECONNECT_DELAY);
      setTimeout(connectWebSocket, delay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    };

    ws.onerror = function() {
      setConnected(false);
    };
  }

  function sendMessage(text) {
    if (!text.trim() || !isConnected) return;

    var now = Date.now();
    addMessage('user', text, now);
    messageHistory.push({ role: 'user', content: text, timestamp: now });
    trimHistory();

    ws.send(JSON.stringify({
      type: 'message',
      text: text,
      id: now.toString(),
      timestamp: now,
    }));

    showTyping();
  }

  // Expose sendMessage for voice module
  window.MicroClaw = window.MicroClaw || {};
  window.MicroClaw.sendMessage = sendMessage;

  // Expose sendCanvasAction for canvas module
  window.MicroClaw.sendCanvasAction = function(actionData) {
    if (ws && isConnected) {
      ws.send(JSON.stringify(actionData));
    }
  };

  // Auto-resize textarea
  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Submit on Enter (Shift+Enter for newline)
  messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputForm.dispatchEvent(new Event('submit'));
    }
  });

  inputForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var text = messageInput.value;
    if (text.trim()) {
      sendMessage(text);
      messageInput.value = '';
      messageInput.style.height = 'auto';
    }
  });

  // Initialize
  renderChannels();
  connectWebSocket();

  // Initialize canvas module
  if (window.MicroClawCanvas && window.MicroClawCanvas.init) {
    window.MicroClawCanvas.init();
  }

  // Initialize voice module
  if (window.MicroClawVoice && window.MicroClawVoice.init) {
    window.MicroClawVoice.init();
  }
})();
