// MicroClaw Voice Module - Wake Word Detection + Talk Mode
(function() {
  'use strict';

  // ─── Feature Detection ───
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var speechSupported = Boolean(SpeechRecognition);

  // ─── State ───
  var wakeEnabled = false;
  var talkMode = false;
  var isListening = false;
  var isSpeaking = false;
  var wakeTriggers = ['microclaw', 'claude', 'computer'];
  var recognition = null;
  var currentAudio = null;
  var talkPhase = 'idle'; // idle | listening | thinking | speaking

  // ─── DOM Elements (set in init) ───
  var micBtn = null;
  var wakeToggle = null;
  var talkBtn = null;
  var voiceStatus = null;
  var voiceOrb = null;

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

  // ─── Wake Word Detection ───
  function containsWakeWord(transcript) {
    var lower = transcript.toLowerCase();
    for (var i = 0; i < wakeTriggers.length; i++) {
      var idx = lower.indexOf(wakeTriggers[i]);
      if (idx !== -1) {
        // Return the text after the wake word
        var afterWake = transcript.slice(idx + wakeTriggers[i].length).trim();
        return { found: true, command: afterWake, trigger: wakeTriggers[i] };
      }
    }
    return { found: false, command: '', trigger: '' };
  }

  function startWakeListening() {
    if (!speechSupported || !wakeEnabled || isListening) return;

    recognition = createRecognition();
    if (!recognition) return;

    isListening = true;
    updateUI();

    var finalTranscript = '';
    var wakeDetected = false;
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

      // Check both interim and final for wake word
      var fullText = finalTranscript + ' ' + interimTranscript;
      var wakeResult = containsWakeWord(fullText);

      if (wakeResult.found && !wakeDetected) {
        wakeDetected = true;
        setVoiceStatus('Wake word "' + wakeResult.trigger + '" detected');

        // Clear previous timer
        if (silenceTimer) clearTimeout(silenceTimer);

        // Wait for the user to finish their command after wake word
        silenceTimer = setTimeout(function() {
          var command = wakeResult.command.trim();
          if (command.length > 0) {
            handleVoiceCommand(command);
          }
          // Reset for next wake word
          finalTranscript = '';
          wakeDetected = false;
        }, 2000);
      }

      // If wake was detected, keep updating the command
      if (wakeDetected) {
        var updatedResult = containsWakeWord(fullText);
        if (updatedResult.command.trim().length > 0) {
          setVoiceStatus('Hearing: "' + updatedResult.command.trim() + '"');
          // Reset silence timer on new speech
          if (silenceTimer) clearTimeout(silenceTimer);
          silenceTimer = setTimeout(function() {
            var cmd = updatedResult.command.trim();
            if (cmd.length > 0) {
              handleVoiceCommand(cmd);
            }
            finalTranscript = '';
            wakeDetected = false;
          }, 2000);
        }
      }
    };

    recognition.onend = function() {
      // Auto-restart if wake mode still enabled
      if (wakeEnabled && !talkMode) {
        setTimeout(function() {
          if (wakeEnabled && !talkMode) {
            isListening = false;
            try {
              startWakeListening();
            } catch (e) {
              setVoiceStatus('Failed to restart wake listening');
              wakeEnabled = false;
              updateUI();
            }
          }
        }, 300);
      } else {
        isListening = false;
        updateUI();
      }
    };

    recognition.onerror = function(event) {
      if (event.error === 'not-allowed') {
        setVoiceStatus('Microphone permission denied');
        wakeEnabled = false;
        isListening = false;
        updateUI();
        return;
      }
      if (event.error === 'no-speech') {
        // Normal timeout, will auto-restart
        return;
      }
      setVoiceStatus('Recognition error: ' + event.error);
    };

    try {
      recognition.start();
      setVoiceStatus('Listening for wake word...');
    } catch (e) {
      isListening = false;
      setVoiceStatus('Failed to start recognition');
    }
  }

  function stopWakeListening() {
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* ignore */ }
      recognition = null;
    }
    isListening = false;
    updateUI();
  }

  // ─── Talk Mode ───
  function startTalkMode() {
    if (!speechSupported) {
      setVoiceStatus('Speech recognition not supported');
      return;
    }

    talkMode = true;
    stopWakeListening();
    setTalkPhase('listening');
    startTalkListening();
    updateUI();
  }

  function stopTalkMode() {
    talkMode = false;
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

    // Resume wake listening if enabled
    if (wakeEnabled) {
      setTimeout(startWakeListening, 300);
    }
    updateUI();
  }

  function startTalkListening() {
    if (!talkMode) return;

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
      // Don't auto-restart in talk mode - wait for TTS to finish
      if (talkMode && talkPhase === 'listening' && !isSpeaking) {
        setTimeout(function() {
          if (talkMode && !isSpeaking) {
            startTalkListening();
          }
        }, 300);
      }
    };

    recognition.onerror = function(event) {
      if (event.error === 'not-allowed') {
        setVoiceStatus('Microphone permission denied');
        stopTalkMode();
        return;
      }
      if (event.error === 'no-speech') {
        return;
      }
      if (event.error === 'aborted') {
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

    setTalkPhase('thinking');
    setVoiceStatus('Processing: "' + text + '"');

    // Send message through the main chat system
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

    // Stop listening while speaking to avoid echo
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

        if (talkMode) {
          setTalkPhase('listening');
          startTalkListening();
        } else {
          setTalkPhase('idle');
          setVoiceStatus(wakeEnabled ? 'Listening for wake word...' : '');
        }
      };

      currentAudio.onerror = function() {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        isSpeaking = false;
        setVoiceStatus('Audio playback failed');
        updateUI();

        if (talkMode) {
          setTalkPhase('listening');
          startTalkListening();
        } else {
          setTalkPhase('idle');
        }
      };

      currentAudio.play().catch(function(err) {
        isSpeaking = false;
        setVoiceStatus('Audio play blocked: ' + err.message);
        updateUI();
        if (talkMode) {
          setTalkPhase('listening');
          startTalkListening();
        }
      });
    })
    .catch(function(err) {
      isSpeaking = false;
      setVoiceStatus('TTS failed: ' + err.message);
      updateUI();
      if (talkMode) {
        setTalkPhase('listening');
        startTalkListening();
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

    // Stop wake listening temporarily
    if (wakeEnabled && isListening) {
      stopWakeListening();
    }

    recognition = createRecognition();
    if (!recognition) return;

    recognition.continuous = false; // Single utterance for PTT
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
      // Resume wake listening if enabled
      if (wakeEnabled && !talkMode) {
        setTimeout(startWakeListening, 500);
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
      if (wakeEnabled && !talkMode) {
        setTimeout(startWakeListening, 500);
      }
    };

    try {
      recognition.start();
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

  // ─── Load Wake Triggers from Server ───
  function loadWakeTriggers() {
    fetch('/api/voicewake')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.success && data.data && Array.isArray(data.data.triggers)) {
          wakeTriggers = data.data.triggers;
        }
      })
      .catch(function() {
        // Use defaults
      });
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
      micBtn.classList.toggle('active', isListening && !wakeEnabled && !talkMode);
      micBtn.disabled = talkMode;
    }
    if (wakeToggle) {
      wakeToggle.classList.toggle('active', wakeEnabled);
    }
    if (talkBtn) {
      talkBtn.classList.toggle('active', talkMode);
      talkBtn.textContent = talkMode ? 'End Talk' : 'Talk';
    }
    if (voiceOrb) {
      voiceOrb.classList.toggle('hidden', !talkMode && !isListening);
    }
  }

  // ─── Public API ───
  window.MicroClawVoice = {
    init: function() {
      micBtn = document.getElementById('mic-btn');
      wakeToggle = document.getElementById('wake-toggle');
      talkBtn = document.getElementById('talk-btn');
      voiceStatus = document.getElementById('voice-status');
      voiceOrb = document.getElementById('voice-orb');

      if (!speechSupported) {
        setVoiceStatus('Speech recognition not supported in this browser');
        if (micBtn) micBtn.disabled = true;
        if (wakeToggle) wakeToggle.disabled = true;
        if (talkBtn) talkBtn.disabled = true;
        return;
      }

      loadWakeTriggers();

      // Mic button: push-to-talk
      if (micBtn) {
        micBtn.addEventListener('mousedown', function() {
          if (talkMode) return;
          startPushToTalk();
        });
        micBtn.addEventListener('mouseup', function() {
          if (talkMode) return;
          stopPushToTalk();
        });
        micBtn.addEventListener('mouseleave', function() {
          if (talkMode) return;
          if (isListening && !wakeEnabled) {
            stopPushToTalk();
          }
        });
        // Touch support
        micBtn.addEventListener('touchstart', function(e) {
          e.preventDefault();
          if (talkMode) return;
          startPushToTalk();
        });
        micBtn.addEventListener('touchend', function(e) {
          e.preventDefault();
          if (talkMode) return;
          stopPushToTalk();
        });
      }

      // Wake toggle
      if (wakeToggle) {
        wakeToggle.addEventListener('click', function() {
          if (talkMode) return;
          wakeEnabled = !wakeEnabled;
          if (wakeEnabled) {
            startWakeListening();
            setVoiceStatus('Listening for wake word...');
          } else {
            stopWakeListening();
            setVoiceStatus('');
          }
          updateUI();
        });
      }

      // Talk mode button
      if (talkBtn) {
        talkBtn.addEventListener('click', function() {
          if (talkMode) {
            stopTalkMode();
          } else {
            startTalkMode();
          }
        });
      }

      updateUI();
    },

    // Called by app.js when an assistant message arrives
    onAssistantMessage: function(text) {
      // Speak if in talk mode OR if wake word triggered a command
      if (talkMode || (wakeEnabled && talkPhase !== 'idle')) {
        speakText(text);
      }
    },

    isActive: function() {
      return talkMode || isListening;
    },

    // Interrupt speaking (barge-in)
    interrupt: function() {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        isSpeaking = false;
      }
    },
  };
})();
