// MicroClaw Chat UI
(function() {
  'use strict';

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
  var messageHistory = [];

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

  function renderChannels() {
    var label = channelList.querySelector('.nav-section-label');
    channelList.innerHTML = '';
    channelList.appendChild(label);

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      var el = document.createElement('div');
      el.className = 'channel-item' + (ch.active ? ' active' : '');
      el.innerHTML = '<span class="channel-dot"></span>' + ch.label;
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
      loadHistory();
    };

    ws.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        if (data.type === 'message') {
          hideTyping();
          addMessage('assistant', data.text, data.timestamp);
          messageHistory.push({ role: 'assistant', content: data.text, timestamp: data.timestamp });
        } else if (data.type === 'typing') {
          showTyping();
        } else if (data.type === 'memory_status') {
          memoryStatus.textContent = data.status;
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
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = function() {
      setConnected(false);
    };
  }

  function sendMessage(text) {
    if (!text.trim() || !isConnected) return;

    addMessage('user', text, Date.now());
    messageHistory.push({ role: 'user', content: text, timestamp: Date.now() });

    ws.send(JSON.stringify({
      type: 'message',
      text: text,
      id: Date.now().toString(),
      timestamp: Date.now(),
    }));

    showTyping();
  }

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
})();
