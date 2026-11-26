// Astolfo in-site chat client — visual-novel dialogue box.
// Talks to the local Astolfo proxy (see server/run_local.sh). No API key here, ever.
// Plain script. Exposes window.Chat { init, send }.
(function () {
  'use strict';

  // The only line to change when the proxy moves (e.g. Render URL). No trailing slash.
  var CHAT_API_BASE_URL = 'https://twinkywinky-chat.onrender.com';
  var CHAT_COINS_PER_DAY = 10;

  var logEl = null, inputEl = null, sendBtn = null;
  var trackEl = null, thumbEl = null;
  var audioCtx = null;

  // Local fallback lines (used only if the proxy itself is unreachable;
  // the server also has its own fallback pool for Gemini failures).
  var LOCAL_FALLBACK = [
    'یاهو! مغزم یه لحظه رفت استراحت، یه بار دیگه بگو ببینم!',
    'اوه! سرم یه کم گیج رفت، ولی برگشتم! دوباره بگو چی گفتی؟',
    'هی هی! یه لحظه هنگ کردم، ولی الان سر حالم! دوباره بگو!'
  ];

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Custom pixel scrollbar for the log (the native one never paints in
  // headless Chromium — overlay scrollbars hide in static screenshots).
  // A white track + solid black thumb, always visible while the log
  // overflows; the thumb drags and the track click-jumps like a real one.
  function updateChatScrollbar() {
    if (!logEl) return;
    if (!trackEl) trackEl = document.getElementById('chat-scrollbar');
    if (!thumbEl) thumbEl = document.getElementById('chat-scrollbar-thumb');
    if (!trackEl || !thumbEl) return;
    var overflows = logEl.scrollHeight > logEl.clientHeight + 1;
    trackEl.classList.toggle('show', overflows);
    if (!overflows) return;
    var trackH = trackEl.clientHeight;
    var thumbH = Math.max(22, Math.round(trackH * logEl.clientHeight / logEl.scrollHeight));
    var maxTop = Math.max(1, trackH - thumbH);
    var range = Math.max(1, logEl.scrollHeight - logEl.clientHeight);
    thumbEl.style.height = thumbH + 'px';
    thumbEl.style.top = Math.round(logEl.scrollTop / range * maxTop) + 'px';
  }

  function bindScrollbar() {
    if (!logEl) return;
    trackEl = document.getElementById('chat-scrollbar');
    thumbEl = document.getElementById('chat-scrollbar-thumb');
    if (!trackEl || !thumbEl) return;
    logEl.addEventListener('scroll', updateChatScrollbar);
    window.addEventListener('resize', updateChatScrollbar);
    var dragging = false, startY = 0, startTop = 0;
    thumbEl.addEventListener('pointerdown', function (e) {
      dragging = true; startY = e.clientY; startTop = logEl.scrollTop;
      try { thumbEl.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    thumbEl.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var maxTop = Math.max(1, trackEl.clientHeight - thumbEl.offsetHeight);
      var frac = (e.clientY - startY) / maxTop;
      logEl.scrollTop = startTop + frac * (logEl.scrollHeight - logEl.clientHeight);
    });
    var endDrag = function () { dragging = false; };
    thumbEl.addEventListener('pointerup', endDrag);
    thumbEl.addEventListener('pointercancel', endDrag);
    trackEl.addEventListener('pointerdown', function (e) {
      if (e.target !== trackEl) return;
      var r = trackEl.getBoundingClientRect();
      logEl.scrollTop = (e.clientY - r.top) / r.height * logEl.scrollHeight;
    });
    updateChatScrollbar();
  }

  function appendMsg(cls, text) {
    if (!logEl) logEl = document.getElementById('chat-log');
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    updateChatScrollbar();
    return div;
  }

  function blip() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 1150 + Math.random() * 250;
      g.gain.setValueAtTime(0.06, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.07);
    } catch (e) {}
  }

  // Typewriter reveal (visual-novel feel) with a soft blip every few chars.
  function typewriter(el, fullText, done) {
    var i = 0;
    el.textContent = '';
    var step = function () {
      i += 2;
      el.textContent = fullText.slice(0, i);
      if (logEl) { logEl.scrollTop = logEl.scrollHeight; updateChatScrollbar(); }
      if (i % 8 === 0) blip();
      if (i < fullText.length) setTimeout(step, 18);
      else if (done) done();
    };
    step();
  }

  function awardChatCoin() {
    if (!window.Game) return;
    var s = window.Game.state;
    var today = todayStr();
    if (s.chatCoinsDate !== today) { s.chatCoinsDate = today; s.chatCoinsToday = 0; }
    if (s.chatCoinsToday < CHAT_COINS_PER_DAY) {
      s.chatCoinsToday += 1;
      window.Game.addCoins(1, 'chat');
    }
    window.Game.save();
  }

  function send(text) {
    // A chat exchange replaces any lingering stage speech bubble (a stale
    // "خواب خوبی بود!" over the stage during a chat looks desynced).
    if (window.Game && window.Game.clearBubble) window.Game.clearBubble();
    appendMsg('me', text);
    var typing = appendMsg('sys', 'داره فکر می‌کنه...');
    if (sendBtn) sendBtn.disabled = true;
    if (inputEl) inputEl.disabled = true;

    fetch(CHAT_API_BASE_URL + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        typing.remove();
        var reply = (data && data.reply) ? String(data.reply) : '';
        if (!reply) reply = LOCAL_FALLBACK[Math.floor(Math.random() * LOCAL_FALLBACK.length)];
        var el = appendMsg('astolfo', '');
        typewriter(el, reply, function () {
          awardChatCoin();
          if (window.Rig) window.Rig.chatReact();
        });
      })
      .catch(function () {
        typing.remove();
        var reply = LOCAL_FALLBACK[Math.floor(Math.random() * LOCAL_FALLBACK.length)];
        var el = appendMsg('astolfo', '');
        typewriter(el, reply);
        appendMsg('sys', '(چت آفلاین شد — ولی آستولفو هنوز اینجاست!)');
      })
      .finally(function () {
        if (sendBtn) sendBtn.disabled = false;
        if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
      });
  }

  function init() {
    logEl = document.getElementById('chat-log');
    inputEl = document.getElementById('chat-input');
    sendBtn = document.getElementById('chat-send');
    bindScrollbar();
  }

  window.Chat = { init: init, send: send, baseUrl: CHAT_API_BASE_URL };
})();
