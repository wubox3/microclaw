// EClaw Sound Effects - Web Audio API based UI sounds
(function() {
  'use strict';

  var audioCtx = null;

  function getContext() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    return audioCtx;
  }

  function playTone(freq, duration, type, gain) {
    var ctx = getContext();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var vol = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    vol.gain.value = gain || 0.08;
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  var sounds = {
    'talk-start': function() { playTone(660, 0.12, 'sine', 0.08); },
    'talk-end': function() { playTone(440, 0.12, 'sine', 0.08); },
    'send': function() { playTone(880, 0.08, 'sine', 0.06); },
    'listen': function() { playTone(520, 0.15, 'sine', 0.06); },
    'error': function() { playTone(220, 0.25, 'triangle', 0.1); }
  };

  window.EClawSoundFX = {
    init: function() { getContext(); },
    play: function(name) {
      var fn = sounds[name];
      if (fn) { try { fn(); } catch (e) { /* silent */ } }
    }
  };
})();
