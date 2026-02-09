// EClaw Voice Module - Simple on/off toggle with talk mode
(function() {
  'use strict';

  // ─── Feature Detection ───
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var speechSupported = Boolean(SpeechRecognition);

  // ─── State ───
  var voiceOn = false;
  var isListening = false;
  var isSpeaking = false;
  var talkPhase = 'idle'; // idle | listening | thinking | speaking
  var voiceConfigured = false;
  var voiceProvider = '';
  var voiceLang = 'en-US';
  var recognition = null;
  var currentAudio = null;
  var micPermissionGranted = false;
  var silenceTimer = null;
  var thinkingTimer = null;
  var listenGeneration = 0;

  // ─── Sound Effects (loaded from sound-fx.js) ───
  var SoundFX = window.EClawSoundFX || { init: function() {}, play: function() {} };

  // ─── DOM Elements (set in init) ───
  var micBtn = null;
  var voiceToggle = null;
  var voiceToggleLabel = null;
  var voiceStatus = null;
  var voiceOrb = null;
  var voiceProviderEl = null;
  var voiceLangSelect = null;
  var messageInput = null;
  var sendBtn = null;

  // ─── Microphone Permission ───
  function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function(stream) {
        stream.getTracks().forEach(function(track) { track.stop(); });
        micPermissionGranted = true;
      })
      .catch(function() {
        micPermissionGranted = false;
      });
  }

  // ─── Speech Recognition Setup ───
  function createRecognition() {
    if (!speechSupported) return null;
    var rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    if (voiceLang !== 'auto') {
      rec.lang = voiceLang;
    }
    rec.maxAlternatives = 3;
    return rec;
  }

  // ─── Talk Mode (continuous conversation) ───
  function startVoice() {
    if (!speechSupported) {
      setVoiceStatus('Speech recognition not supported');
      return;
    }

    // Gate on mic permission — request if not yet granted
    if (!micPermissionGranted) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function(stream) {
          stream.getTracks().forEach(function(track) { track.stop(); });
          micPermissionGranted = true;
          startVoice();
        })
        .catch(function() {
          setVoiceStatus('Microphone permission denied');
        });
      return;
    }

    voiceOn = true;
    SoundFX.play('talk-start');
    setTalkPhase('listening');
    startListening();
    updateUI();
  }

  function stopVoice() {
    voiceOn = false;
    SoundFX.play('talk-end');
    setTalkPhase('idle');
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      thinkingTimer = null;
    }
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
      recognition = null;
    }
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    isListening = false;
    isSpeaking = false;
    setVoiceStatusIdle();
    updateUI();
  }

  function startListening() {
    if (!voiceOn) return;

    // Bump generation so stale callbacks from old sessions are ignored
    var gen = ++listenGeneration;

    recognition = createRecognition();
    if (!recognition) return;

    isListening = true;
    var finalTranscript = '';
    var lastInterim = '';

    recognition.onresult = function(event) {
      if (gen !== listenGeneration) return; // stale session
      var interimTranscript = '';

      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      lastInterim = interimTranscript;
      var displayText = (finalTranscript + ' ' + interimTranscript).trim();
      if (displayText) {
        setVoiceStatus('You: "' + displayText + '"');
      }

      // Reset silence timer on new speech
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(function() {
        if (gen !== listenGeneration) return; // stale
        // Use finalTranscript if available, fall back to interim
        // (Chinese recognition often keeps results as interim until session ends)
        var command = finalTranscript.trim() || lastInterim.trim();
        if (command.length > 0) {
          recognition.stop();
          handleVoiceCommand(command);
          finalTranscript = '';
          lastInterim = '';
        }
      }, 1500);
    };

    recognition.onend = function() {
      if (gen !== listenGeneration) return; // stale session, ignore
      isListening = false;
      if (voiceOn && talkPhase === 'listening' && !isSpeaking) {
        setTimeout(function() {
          if (gen !== listenGeneration) return; // stale
          if (voiceOn && !isSpeaking) {
            startListening();
          }
        }, 300);
      }
    };

    recognition.onerror = function(event) {
      if (gen !== listenGeneration) return; // stale session
      if (event.error === 'not-allowed') {
        setVoiceStatus('Microphone denied — allow mic at: chrome://settings/content/microphone');
        stopVoice();
        return;
      }
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      setVoiceStatus('Recognition error: ' + event.error);
    };

    try {
      recognition.start();
      setVoiceStatus('Listening...');
    } catch (e) {
      isListening = false;
      setVoiceStatus('Failed to start listening');
    }
  }

  // ─── Voice Command Handler ───
  function handleVoiceCommand(text) {
    if (!text.trim()) return;

    SoundFX.play('send');
    setTalkPhase('thinking');
    setVoiceStatusHtml('Processing: &ldquo;' + escapeHtml(text) + '&rdquo; &mdash; <span class="voice-paused">voice input paused</span>');

    // Timeout: if no LLM response within 30s, resume listening
    if (thinkingTimer) clearTimeout(thinkingTimer);
    thinkingTimer = setTimeout(function() {
      thinkingTimer = null;
      if (voiceOn && talkPhase === 'thinking') {
        setVoiceStatus('No response — resuming listening...');
        setTalkPhase('listening');
        startListening();
      }
    }, 30000);

    if (window.EClaw && window.EClaw.sendMessage) {
      window.EClaw.sendMessage(text);
    }
  }

  // ─── TTS Playback ───
  function speakText(text) {
    // Clear thinking timeout — response arrived
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      thinkingTimer = null;
    }

    if (!text || text.trim().length === 0) {
      // Empty response — resume listening instead of getting stuck
      if (voiceOn) {
        setTalkPhase('listening');
        startListening();
      }
      return;
    }

    setTalkPhase('speaking');
    isSpeaking = true;
    setVoiceStatusHtml('Speaking... &mdash; <span class="voice-paused">voice input paused</span>');
    updateUI();

    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
    }

    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    })
    .then(function(response) {
      if (!response.ok) {
        throw new Error('TTS request failed: ' + response.status);
      }
      return response.blob();
    })
    .then(function(blob) {
      // Recheck voiceOn — user may have toggled off during async fetch
      if (!voiceOn) {
        isSpeaking = false;
        setTalkPhase('idle');
        setVoiceStatus('');
        updateUI();
        return;
      }
      var audioUrl = URL.createObjectURL(blob);
      try {
        currentAudio = new Audio(audioUrl);
      } catch (err) {
        URL.revokeObjectURL(audioUrl);
        throw err;
      }

      currentAudio.onended = function() {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        isSpeaking = false;
        updateUI();

        if (voiceOn) {
          setTalkPhase('listening');
          startListening();
        } else {
          setTalkPhase('idle');
          setVoiceStatus('');
        }
      };

      currentAudio.onerror = function() {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        isSpeaking = false;
        setVoiceStatus('Audio playback failed');
        updateUI();

        if (voiceOn) {
          setTalkPhase('listening');
          startListening();
        } else {
          setTalkPhase('idle');
        }
      };

      currentAudio.play().catch(function(err) {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        isSpeaking = false;
        setVoiceStatus('Audio play blocked: ' + err.message);
        updateUI();
        if (voiceOn) {
          setTalkPhase('listening');
          startListening();
        }
      });
    })
    .catch(function(err) {
      isSpeaking = false;
      SoundFX.play('error');
      setVoiceStatus('TTS failed: ' + err.message);
      updateUI();
      if (voiceOn) {
        setTalkPhase('listening');
        startListening();
      } else {
        setTalkPhase('idle');
      }
    });
  }

  // ─── Mic Button: Click-to-Record ───
  function toggleMicCapture() {
    if (voiceOn) return;

    // If already listening, stop
    if (isListening && recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
      return;
    }

    if (!speechSupported) {
      setVoiceStatus('Speech recognition not supported');
      return;
    }

    recognition = createRecognition();
    if (!recognition) return;

    recognition.continuous = false;
    isListening = true;
    var finalTranscript = '';

    recognition.onresult = function(event) {
      for (var i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        setVoiceStatus('You said: "' + finalTranscript.trim() + '"');
      }
    };

    recognition.onend = function() {
      isListening = false;
      updateUI();
      var text = finalTranscript.trim();
      if (text) {
        handleVoiceCommand(text);
      }
    };

    recognition.onerror = function(event) {
      isListening = false;
      updateUI();
      if (event.error === 'not-allowed') {
        setVoiceStatus('Microphone denied — allow mic at: chrome://settings/content/microphone');
        return;
      }
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setVoiceStatus('Recognition error: ' + event.error);
      }
    };

    try {
      recognition.start();
      SoundFX.play('listen');
      setVoiceStatus('Listening... speak now');
      updateUI();
    } catch (e) {
      isListening = false;
      setVoiceStatus('Failed to start recognition');
      updateUI();
    }
  }

  // ─── Load Voice Config from Server ───
  function loadVoiceConfig() {
    fetch('/api/voice/config')
      .then(function(res) {
        if (!res.ok) throw new Error('Voice config fetch failed');
        return res.json();
      })
      .then(function(data) {
        if (data.success && data.data) {
          voiceConfigured = data.data.ttsConfigured === true;
          voiceProvider = data.data.provider || '';
          if (data.data.language) {
            voiceLang = data.data.language;
            if (voiceLangSelect) {
              voiceLangSelect.value = voiceLang;
            }
          }
          updateProviderLabel();
        }
      })
      .catch(function() {
        voiceConfigured = false;
        voiceProvider = '';
        updateProviderLabel();
      });
  }

  function updateProviderLabel() {
    if (!voiceProviderEl) return;

    var PROVIDER_NAMES = {
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
    };

    if (voiceConfigured && voiceProvider) {
      voiceProviderEl.textContent = PROVIDER_NAMES[voiceProvider] || voiceProvider;
    } else if (!voiceConfigured) {
      voiceProviderEl.textContent = 'Not configured';
    } else {
      voiceProviderEl.textContent = '';
    }
  }

  // ─── UI Updates ───
  function setTalkPhase(phase) {
    talkPhase = phase;
    if (voiceOrb) {
      voiceOrb.className = 'voice-orb ' + phase;
    }
    updateUI();
  }

  function setVoiceStatus(text) {
    if (voiceStatus) {
      voiceStatus.classList.remove('voice-idle');
      voiceStatus.textContent = text;
      voiceStatus.classList.toggle('hidden', !text);
    }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setVoiceStatusHtml(html) {
    if (voiceStatus) {
      voiceStatus.classList.remove('voice-idle');
      voiceStatus.innerHTML = html;
      voiceStatus.classList.toggle('hidden', !html);
    }
  }

  function setVoiceStatusIdle() {
    if (voiceStatus) {
      voiceStatus.textContent = 'Voice off \u2014 speech input ignored';
      voiceStatus.classList.remove('hidden');
      voiceStatus.classList.add('voice-idle');
    }
  }

  function updateUI() {
    if (micBtn) {
      micBtn.classList.toggle('active', isListening && !voiceOn);
      micBtn.disabled = voiceOn;
    }
    if (voiceToggle) {
      voiceToggle.classList.toggle('active', voiceOn);
    }
    if (voiceToggleLabel) {
      voiceToggleLabel.textContent = voiceOn ? 'On' : 'Off';
    }
    if (voiceOrb) {
      voiceOrb.classList.toggle('hidden', !voiceOn && !isListening);
    }
    if (messageInput) {
      messageInput.disabled = voiceOn;
      messageInput.classList.toggle('voice-disabled', voiceOn);
    }
    if (sendBtn) {
      sendBtn.disabled = voiceOn;
      sendBtn.classList.toggle('voice-disabled', voiceOn);
    }
  }

  // ─── Public API ───
  window.EClawVoice = {
    init: function() {
      micBtn = document.getElementById('mic-btn');
      voiceToggle = document.getElementById('voice-toggle');
      voiceToggleLabel = voiceToggle ? voiceToggle.querySelector('.voice-toggle-label') : null;
      voiceStatus = document.getElementById('voice-status');
      voiceOrb = document.getElementById('voice-orb');
      voiceProviderEl = document.getElementById('voice-provider');
      voiceLangSelect = document.getElementById('voice-lang');
      messageInput = document.getElementById('message-input');
      sendBtn = document.getElementById('send-btn');

      if (voiceLangSelect) {
        voiceLangSelect.addEventListener('change', function() {
          voiceLang = voiceLangSelect.value;
          // Restart recognition immediately with the new language
          if (voiceOn && talkPhase === 'listening') {
            if (recognition) {
              try { recognition.stop(); } catch (e) { /* ignore */ }
              recognition = null;
            }
            isListening = false;
            startListening();
          }
        });
      }

      SoundFX.init();
      loadVoiceConfig();

      if (!speechSupported) {
        setVoiceStatus('Speech recognition not supported in this browser');
        if (micBtn) micBtn.disabled = true;
        if (voiceToggle) voiceToggle.disabled = true;
        return;
      }

      // Request mic permission eagerly so clicks work instantly
      requestMicPermission();

      // Single voice on/off toggle
      if (voiceToggle) {
        voiceToggle.addEventListener('click', function() {
          if (voiceOn) {
            stopVoice();
          } else {
            startVoice();
          }
        });
      }

      // Mic button: click to start recording, auto-stops after silence
      if (micBtn) {
        micBtn.addEventListener('click', function() {
          toggleMicCapture();
        });
      }

      setVoiceStatusIdle();
      updateUI();
    },

    // Called by app.js when an assistant message arrives
    onAssistantMessage: function(text) {
      if (voiceOn) {
        speakText(text);
      }
    },

    isActive: function() {
      return voiceOn || isListening;
    },

    // Interrupt speaking (barge-in)
    interrupt: function() {
      if (currentAudio) {
        if (currentAudio.src) {
          URL.revokeObjectURL(currentAudio.src);
        }
        currentAudio.pause();
        currentAudio = null;
        isSpeaking = false;
        setTalkPhase('idle');
        updateUI();
      }
    },
  };
})();
