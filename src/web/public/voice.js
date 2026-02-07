// MicroClaw Voice Module - Simple on/off toggle with talk mode
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
  var recognition = null;
  var currentAudio = null;

  // ─── Sound Effects (loaded from sound-fx.js) ───
  var SoundFX = window.MicroClawSoundFX || { init: function() {}, play: function() {} };

  // ─── DOM Elements (set in init) ───
  var micBtn = null;
  var voiceToggle = null;
  var voiceToggleLabel = null;
  var voiceStatus = null;
  var voiceOrb = null;
  var voiceProviderEl = null;

  // ─── Speech Recognition Setup ───
  function createRecognition() {
    if (!speechSupported) return null;
    var rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 3;
    return rec;
  }

  // ─── Talk Mode (continuous conversation) ───
  function startVoice() {
    if (!speechSupported) {
      setVoiceStatus('Speech recognition not supported');
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
    setVoiceStatus('');
    updateUI();
  }

  function startListening() {
    if (!voiceOn) return;

    recognition = createRecognition();
    if (!recognition) return;

    isListening = true;
    var finalTranscript = '';
    var silenceTimer = null;

    recognition.onresult = function(event) {
      var interimTranscript = '';

      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      var displayText = (finalTranscript + ' ' + interimTranscript).trim();
      if (displayText) {
        setVoiceStatus('You: "' + displayText + '"');
      }

      // Reset silence timer on new speech
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(function() {
        var command = finalTranscript.trim();
        if (command.length > 0) {
          recognition.stop();
          handleVoiceCommand(command);
          finalTranscript = '';
        }
      }, 1500);
    };

    recognition.onend = function() {
      isListening = false;
      if (voiceOn && talkPhase === 'listening' && !isSpeaking) {
        setTimeout(function() {
          if (voiceOn && !isSpeaking) {
            startListening();
          }
        }, 300);
      }
    };

    recognition.onerror = function(event) {
      if (event.error === 'not-allowed') {
        setVoiceStatus('Microphone permission denied');
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
    setVoiceStatus('Processing: "' + text + '"');

    if (window.MicroClaw && window.MicroClaw.sendMessage) {
      window.MicroClaw.sendMessage(text);
    }
  }

  // ─── TTS Playback ───
  function speakText(text) {
    if (!text || text.trim().length === 0) return;

    setTalkPhase('speaking');
    isSpeaking = true;
    setVoiceStatus('Speaking...');
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

  // ─── Push-to-Talk (mic button) ───
  function startPushToTalk() {
    if (!speechSupported) {
      setVoiceStatus('Speech recognition not supported');
      return;
    }

    if (voiceOn) {
      stopVoice();
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
        setVoiceStatus('Microphone permission denied');
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

  function stopPushToTalk() {
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
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
      voiceStatus.textContent = text;
      voiceStatus.classList.toggle('hidden', !text);
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
  }

  // ─── Public API ───
  window.MicroClawVoice = {
    init: function() {
      micBtn = document.getElementById('mic-btn');
      voiceToggle = document.getElementById('voice-toggle');
      voiceToggleLabel = voiceToggle ? voiceToggle.querySelector('.voice-toggle-label') : null;
      voiceStatus = document.getElementById('voice-status');
      voiceOrb = document.getElementById('voice-orb');
      voiceProviderEl = document.getElementById('voice-provider');

      SoundFX.init();
      loadVoiceConfig();

      if (!speechSupported) {
        setVoiceStatus('Speech recognition not supported in this browser');
        if (micBtn) micBtn.disabled = true;
        if (voiceToggle) voiceToggle.disabled = true;
        return;
      }

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

      // Mic button: push-to-talk
      if (micBtn) {
        micBtn.addEventListener('mousedown', function() {
          if (voiceOn) return;
          startPushToTalk();
        });
        micBtn.addEventListener('mouseup', function() {
          if (voiceOn) return;
          stopPushToTalk();
        });
        micBtn.addEventListener('mouseleave', function() {
          if (voiceOn) return;
          if (isListening) {
            stopPushToTalk();
          }
        });
        micBtn.addEventListener('touchstart', function(e) {
          e.preventDefault();
          if (voiceOn) return;
          startPushToTalk();
        });
        micBtn.addEventListener('touchend', function(e) {
          e.preventDefault();
          if (voiceOn) return;
          stopPushToTalk();
        });
      }

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
      }
    },
  };
})();
