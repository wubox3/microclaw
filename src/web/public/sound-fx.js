// MicroClaw Sound Effects - Web Audio API tones with custom .mp3 overrides
(function() {
  'use strict';

  var audioCtx = null;
  var customSounds = {}; // name → AudioBuffer (loaded from .mp3)
  var customLoaded = false;

  var SOUND_NAMES = ['wake', 'listen', 'send', 'error', 'talk-start', 'talk-end'];

  function getCtx() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Load custom .mp3 overrides from /sounds/ (only fetches sounds that exist)
  function loadCustomSounds() {
    if (customLoaded) return;
    customLoaded = true;

    // Single preflight: check which custom sounds are available
    fetch('/api/sounds/available')
      .then(function(res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function(data) {
        if (!data || !Array.isArray(data.sounds)) return;
        data.sounds.forEach(function(name) {
          if (SOUND_NAMES.indexOf(name) === -1) return;
          fetch('/sounds/' + name + '.mp3')
            .then(function(res) {
              if (!res.ok) return null;
              return res.arrayBuffer();
            })
            .then(function(buf) {
              if (!buf) return;
              var ctx = getCtx();
              if (!ctx) return;
              return ctx.decodeAudioData(buf);
            })
            .then(function(decoded) {
              if (decoded) {
                // Reassign for immutability of reference
                var updated = {};
                Object.keys(customSounds).forEach(function(k) { updated[k] = customSounds[k]; });
                updated[name] = decoded;
                customSounds = updated;
              }
            })
            .catch(function() { /* corrupt or unavailable, use generated fallback */ });
        });
      })
      .catch(function() { /* no custom sounds endpoint, use generated tones */ });
  }

  function playBuffer(buffer) {
    var ctx = getCtx();
    if (!ctx) return;
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }

  // ─── Generated Tone Definitions ───

  function playTone(freq, duration, type, gain) {
    var ctx = getCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var vol = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    vol.gain.setValueAtTime(gain || 0.3, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  // Wake: two-tone ascending chime
  function genWake() {
    playTone(880, 0.15, 'sine', 0.25);
    setTimeout(function() { playTone(1320, 0.2, 'sine', 0.25); }, 120);
  }

  // Listen: soft click
  function genListen() {
    playTone(1200, 0.06, 'sine', 0.15);
  }

  // Send: quick ascending sweep
  function genSend() {
    var ctx = getCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var vol = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.15);
    vol.gain.setValueAtTime(0.2, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }

  // Error: low descending buzz
  function genError() {
    playTone(300, 0.12, 'square', 0.15);
    setTimeout(function() { playTone(200, 0.18, 'square', 0.12); }, 100);
  }

  // Talk start: three ascending notes
  function genTalkStart() {
    playTone(660, 0.1, 'sine', 0.2);
    setTimeout(function() { playTone(880, 0.1, 'sine', 0.2); }, 100);
    setTimeout(function() { playTone(1100, 0.15, 'sine', 0.2); }, 200);
  }

  // Talk end: two descending notes
  function genTalkEnd() {
    playTone(880, 0.1, 'sine', 0.2);
    setTimeout(function() { playTone(550, 0.18, 'sine', 0.2); }, 100);
  }

  var generators = {
    'wake': genWake,
    'listen': genListen,
    'send': genSend,
    'error': genError,
    'talk-start': genTalkStart,
    'talk-end': genTalkEnd
  };

  window.MicroClawSoundFX = {
    init: function() {
      loadCustomSounds();
    },
    play: function(name) {
      // Prefer custom .mp3 if loaded
      if (customSounds[name]) {
        playBuffer(customSounds[name]);
        return;
      }
      // Fall back to generated tone
      if (generators[name]) {
        generators[name]();
      }
    }
  };
})();
