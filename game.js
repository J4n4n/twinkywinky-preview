// Astolfo virtual-pet game layer — state, stats, economy, shop, mood, mini-game.
// Plain script (no modules). Exposes window.Game. The character rig lives in rig.js
// and exposes window.Rig; chat lives in chat.js (window.Chat). index.html wires them.
(function () {
  'use strict';

  var STORE_KEY = 'astolfo-pet-v1';
  var DAY_MS = 24 * 60 * 60 * 1000;

  // ---------- default state ----------
  function defaultState() {
    return {
      v: 1,
      stats: { hunger: 80, happiness: 80, energy: 80, cleanliness: 80 },
      affectionXP: 0,
      level: 1,
      coins: 20,
      owned: [],            // accessory ids
      equipped: null,       // accessory id or null
      cake: 0,              // cake treats owned
      sleeping: false,
      lastSeen: Date.now(),
      chatCoinsDate: '',    // yyyy-mm-dd of last chat-coin day
      chatCoinsToday: 0,
      lastPetCoinAt: 0,
      muted: false
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      var s = JSON.parse(raw);
      if (!s || s.v !== 1) return defaultState();
      var d = defaultState();
      for (var k in d) if (s[k] === undefined) s[k] = d[k];
      s.stats = Object.assign({}, d.stats, s.stats || {});
      return s;
    } catch (e) { return defaultState(); }
  }
  function save() {
    state.lastSeen = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---------- decay (slow, capped, never punishing) ----------
  // Offline: 1 point per 90 min per stat, never below 30.
  function applyOfflineDecay() {
    var mins = (Date.now() - (state.lastSeen || Date.now())) / 60000;
    if (mins < 5) return;
    var drop = Math.floor(mins / 90);
    if (drop <= 0) return;
    ['hunger', 'happiness', 'energy', 'cleanliness'].forEach(function (k) {
      state.stats[k] = Math.max(30, state.stats[k] - drop);
    });
    save();
  }
  // Live tick every 60s.
  function tickDecay() {
    if (state.sleeping) {
      state.stats.energy = clamp(state.stats.energy + 2.4, 0, 100); // +2.4 per 60s tick while asleep
    } else {
      state.stats.hunger = clamp(state.stats.hunger - 0.5, 30, 100);
      state.stats.happiness = clamp(state.stats.happiness - 0.3, 30, 100);
      state.stats.energy = clamp(state.stats.energy - 0.2, 30, 100);
      state.stats.cleanliness = clamp(state.stats.cleanliness - 0.3, 30, 100);
    }
    save();
    render();
  }
  setInterval(tickDecay, 60000);

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function addStat(k, d) { state.stats[k] = clamp(state.stats[k] + d, 0, 100); }

  // ---------- affection / level ----------
  function xpForNext() { return 20 * state.level; } // L1->2: 20, L2->3: 40, ...
  function addXP(n) {
    state.affectionXP += n;
    var leveled = false;
    while (state.affectionXP >= xpForNext()) {
      state.affectionXP -= xpForNext();
      state.level += 1;
      state.coins += 20;
      leveled = true;
    }
    if (leveled) {
      save(); render();
      if (window.Rig) window.Rig.celebrate();
      sayBubble('سطح ' + toFaDigits(state.level) + ' شدم! جایزه‌ت ۲۰ سکه‌ست!');
    }
    save(); render();
  }
  function toFaDigits(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[+d]; });
  }

  // ---------- mood ----------
  // Lowest stat drives mood. Sleeping overrides everything.
  function mood() {
    if (state.sleeping) return 'sleeping';
    var s = state.stats;
    var low = 'hunger', lowV = s.hunger;
    ['happiness', 'energy', 'cleanliness'].forEach(function (k) {
      if (s[k] < lowV) { low = k; lowV = s[k]; }
    });
    if (lowV >= 40) return 'happy';
    if (low === 'hunger') return 'hungry';
    if (low === 'energy') return 'sleepy';
    if (low === 'cleanliness') return 'messy';
    return 'sad';
  }
  var MOOD_FA = { happy: 'شاد', hungry: 'گرسنه', sleepy: 'خواب‌آلود', messy: 'کثیف', sad: 'ناراحت', sleeping: 'خواب' };
  var MOOD_ICON = { happy: 'face-happy.png', hungry: 'drumstick.png', sleepy: 'moon.png', messy: 'duck.png', sad: 'face-sad.png', sleeping: 'moon.png' };

  // ---------- idle lines (per mood; level-gated extras) ----------
  var IDLE_LINES = {
    happy: ['یاهو! امروز چه روز خوبیه!', 'بزن بریم یه ماجراجویی!', 'تو بهترین دوستی!', 'هوا خوبه، دلم می‌خواد پرواز کنم!', 'یه چیز ناز بگو ببینم!', 'هی هی! خوشحالم که اینجایی!'],
    hungry: ['شکمم داره قار و قور می‌کنه... یه چیزی بده بخورم!', 'گرسنه‌م! یه اسنک؟ یه غذای درست؟ هرچی!', 'اگه غذا ندی، موهامو خودم می‌خورم! شوخی کردم... یا نه؟'],
    sleepy: ['چشمام داره بسته می‌شه... یه چرت کوچولو؟', 'خسته‌م... بذار یه کم بخوابم.', 'خوابم میاد... تو هم بیا بخوابیم؟'],
    messy: ['اوه... یه کم کثیف شدم. حمومم می‌بری؟', 'حس می‌کنم نیاز به یه حموم خوب دارم!', 'کثیفم ولی هنوز نازم، نه؟'],
    sad: ['یه کم دلم گرفته... بغلم کن؟', 'حوصله‌م سر رفته... باهام بازی می‌کنی؟', '...یه کم ناراحتم. نازم کن خوب می‌شم.'],
    sleeping: ['Zzz...', '...خوابم...']
  };
  var IDLE_EXTRA_L2 = ['راستی، تو رفیق موردعلاقه‌ی منی!', 'یادته اولین بار همدیگه رو دیدیم؟ من یادمه!'];
  var IDLE_EXTRA_L3 = ['سطح سه شدیم! ما یه تیمیم!', 'با تو هر روز یه ماجراجوییه!'];
  function idleLine() {
    var m = mood();
    var pool = IDLE_LINES[m].slice();
    if (state.level >= 2 && m === 'happy') pool = pool.concat(IDLE_EXTRA_L2);
    if (state.level >= 3 && m === 'happy') pool = pool.concat(IDLE_EXTRA_L3);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  var idleTimer = null;
  function startIdleLines() {
    stopIdleLines();
    idleTimer = setInterval(function () {
      if (document.hidden) return;
      if (window.Rig && window.Rig.busy()) return;
      sayBubble(idleLine());
    }, 30000);
  }
  function stopIdleLines() { if (idleTimer) clearInterval(idleTimer); idleTimer = null; }

  // ---------- speech bubble ----------
  var bubbleEl = null, bubbleTimer = null;
  // v9: the sleep bubble lives in #sleep-fx ABOVE the veil, positioned
  // over the stage by positionSleepFx(). The in-stage bubble sits under
  // the veil (dimmed twice) while asleep, and a trailing Latin «Zzz»
  // flipped to the wrong end of the RTL line — the Zzz gets its own
  // dir="ltr" span so the order reads «شب بخیر! Zzz».
  var sleepBubbleEl = null, sleepBubbleTimer = null;
  function positionSleepFx() {
    var wrap = document.getElementById('stage-wrap');
    var note = document.getElementById('sleep-note');
    var bub = document.getElementById('sleep-bubble');
    if (!wrap || !note || !bub) return;
    var r = wrap.getBoundingClientRect();
    note.style.left = Math.round(r.left + r.width / 2) + 'px';
    note.style.top = Math.round(r.top + r.height / 2) + 'px';
    note.style.maxWidth = Math.round(r.width * 0.92) + 'px';
    bub.style.left = Math.round(r.left + r.width / 2) + 'px';
    bub.style.top = Math.round(r.top + 6) + 'px';
    bub.style.maxWidth = Math.round(r.width * 0.88) + 'px';
  }
  function showSleepBubble(html, ms) {
    if (!sleepBubbleEl) sleepBubbleEl = document.getElementById('sleep-bubble');
    if (!sleepBubbleEl) return;
    sleepBubbleEl.innerHTML = html;
    sleepBubbleEl.classList.add('show');
    if (sleepBubbleTimer) clearTimeout(sleepBubbleTimer);
    sleepBubbleTimer = setTimeout(function () { sleepBubbleEl.classList.remove('show'); }, ms || 6000);
  }
  function hideSleepBubble() {
    if (sleepBubbleTimer) { clearTimeout(sleepBubbleTimer); sleepBubbleTimer = null; }
    if (sleepBubbleEl) sleepBubbleEl.classList.remove('show');
  }
  function sayBubble(text, ms) {
    if (state.sleeping) {
      // While asleep, route the line to the sleep bubble above the veil;
      // a leading Zzz gets its own LTR span so the bidi order holds.
      var html = text.replace(/^Zzz(\.\.\.)?/, '<span dir="ltr">Zzz$1</span>');
      showSleepBubble(html, ms || 4000);
      return;
    }
    if (!bubbleEl) bubbleEl = document.getElementById('speech-bubble');
    if (!bubbleEl) return;
    bubbleEl.textContent = text;
    bubbleEl.classList.add('show');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubbleEl.classList.remove('show'); }, ms || 4000);
  }

  // Hide the stage speech bubble immediately (e.g. a chat exchange starts —
  // the old line must not linger over the stage while chatting).
  function clearBubble() {
    if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
    if (!bubbleEl) bubbleEl = document.getElementById('speech-bubble');
    if (bubbleEl) bubbleEl.classList.remove('show');
    hideSleepBubble();
  }

  // ---------- coins ----------
  function addCoins(n, why) {
    state.coins += n;
    save(); render();
    // dir="ltr" on the delta: in the RTL page "+۲" would otherwise render
    // as "۲+" (the plus flips to the wrong side of the Persian digit).
    if (window.Rig) window.Rig.coinFloat('<span dir="ltr">+' + toFaDigits(n) + '</span> <img class="ic" src="assets/icons/coin.png" alt="">');
  }
  function spendCoins(n) {
    if (state.coins < n) return false;
    state.coins -= n;
    save(); render();
    return true;
  }

  // ---------- actions ----------
  var lastFeedAt = 0;
  var FOOD = {
    snack: { fa: 'اسنک', price: 5, hunger: 12, happiness: 3, energy: 0 },
    meal: { fa: 'غذای کامل', price: 15, hunger: 25, happiness: 5, energy: 0 },
    drink: { fa: 'نوشیدنی', price: 8, hunger: 8, happiness: 6, energy: 2 },
    cake: { fa: 'کیک', price: 0, hunger: 10, happiness: 15, energy: 0, inventory: true }
  };
  function feed(kind) {
    if (state.sleeping) { sayBubble('Zzz... خوابم... بعداً غذا می‌خورم.'); return false; }
    // fx3 (audit F6): same silent-cooldown trap as clean() — the old
    // success bubble stayed up and the refused feed looked like it worked.
    if (Date.now() - lastFeedAt < 2000) { sayBubble('یه لحظه صبر کن، هنوز دارم می‌جوم!'); return false; }
    var f = FOOD[kind];
    if (!f) return false;
    if (f.inventory) {
      if (state.cake <= 0) { sayBubble('کیک ندارم! اول از فروشگاه بخر.'); return false; }
      state.cake -= 1;
    } else if (!spendCoins(f.price)) {
      sayBubble('سکه‌م کمه! برو ستاره جمع کن یا باهام بازی کن.');
      return false;
    }
    lastFeedAt = Date.now();
    addStat('hunger', f.hunger); addStat('happiness', f.happiness); addStat('energy', f.energy);
    addXP(2);
    save(); render();
    if (window.Rig) window.Rig.eat();
    sayBubble(kind === 'cake' ? 'وای، کیک! بهترینی!' : 'ممنون! خوشمزه بود!');
    return true;
  }

  var lastCleanAt = 0;
  function clean() {
    if (state.sleeping) { sayBubble('Zzz...'); return false; }
    // fx3 (audit F5): a silent return left the stale success bubble
    // showing, so the user thought the second bath worked. Say so instead.
    if (Date.now() - lastCleanAt < 10000) { sayBubble('همین الان حموم کردم! یه کم صبر کن.'); return false; }
    lastCleanAt = Date.now();
    addStat('cleanliness', 22); addStat('happiness', 3);
    addXP(2);
    save(); render();
    if (window.Rig) window.Rig.bath();
    sayBubble('حموم! حباب‌ها! تمیز شدم!');
    return true;
  }

  function pet() {
    if (state.sleeping) { wake(); return; }
    addStat('happiness', 3);
    addXP(2);
    var now = Date.now();
    if (now - state.lastPetCoinAt > 10000) { state.lastPetCoinAt = now; addCoins(2, 'pet'); }
    save(); render();
    if (window.Rig) window.Rig.pet();
  }

  function toggleSleep() {
    if (state.sleeping) { wake(); return; }
    state.sleeping = true;
    save(); render();
    document.body.classList.add('sleeping');
    positionSleepFx();
    showSleepBubble('شب بخیر! <span dir="ltr">Zzz</span>', 6000);
    /* v9: Rig.sleep AFTER the bubble is shown — spawnZzz clamps each Z
       below the bubble, and the first two Zs spawn inside Rig.sleep, so
       the bubble must already carry .show when they spawn. */
    if (window.Rig) window.Rig.sleep(true);
  }
  function wake() {
    if (!state.sleeping) return;
    state.sleeping = false;
    save(); render();
    if (window.Rig) window.Rig.sleep(false);
    document.body.classList.remove('sleeping');
    hideSleepBubble();
    addStat('energy', 5);
    sayBubble('یاهو! خواب خوبی بود!');
  }

  // ---------- shop ----------
  var SHOP = [
    { id: 'starclips', fa: 'گیره‌ی ستاره آبی و صورتی', price: 50, level: 2, icon: 'star-pink.png' },
    { id: 'beanie', fa: 'کلاه بافتنی صورتی', price: 60, level: 3, icon: 'beanie.png' },
    { id: 'glasses', fa: 'عینک گرد', price: 80, level: 3, icon: 'glasses.png' },
    { id: 'cake', fa: 'کیک (خوراکی)', price: 25, level: 1, icon: 'cake.png', consumable: true }
  ];
  function buy(itemId) {
    var item = null;
    SHOP.forEach(function (it) { if (it.id === itemId) item = it; });
    if (!item) return false;
    if (state.level < item.level) { sayBubble('این آیتم از سطح ' + toFaDigits(item.level) + ' باز می‌شه!'); return false; }
    if (!item.consumable && state.owned.indexOf(item.id) !== -1) { equip(item.id); return true; }
    if (!spendCoins(item.price)) { sayBubble('سکه‌م کمه!'); return false; }
    if (item.consumable) {
      state.cake += 1;
      sayBubble('یه کیک خریدی! از منوی غذا می‌تونی بهم بدی.');
    } else {
      state.owned.push(item.id);
      equip(item.id);
      sayBubble('وای، ' + item.fa + '! خیلی بهم میاد؟');
      if (window.Rig) window.Rig.celebrate();
    }
    save(); render();
    return true;
  }
  function equip(itemId) {
    if (state.owned.indexOf(itemId) === -1 && itemId !== null) return false;
    state.equipped = itemId;
    save(); render();
    if (window.Rig) window.Rig.setAccessory(itemId);
    return true;
  }

  // ---------- mini-game: catch the falling stars ----------
  var miniGame = { active: false, score: 0, caught: 0, t0: 0, stars: [], timer: null, raf: 0, dpr: 1, bannerTimer: null };
  function startMiniGame() {
    if (state.sleeping) { sayBubble('Zzz... خوابم...'); return; }
    if (miniGame.active) return;
    miniGame.active = true; miniGame.score = 0; miniGame.caught = 0;
    miniGame.stars = []; miniGame.t0 = Date.now();
    var overlay = document.getElementById('minigame-overlay');
    overlay.classList.add('show');
    document.getElementById('minigame-score').textContent = '۰';
    document.getElementById('minigame-time').textContent = '۳۰';
    // Size the canvas backing SYNCHRONOUSLY before the first spawn: the
    // inline sizeMiniGame() only runs on load/resize/rAF, so the first
    // stars used to spawn against the stale 320x320 backing (dpr ~0.5)
    // while later ones used dpr 1 — the "mixed pixel scale" Gemini caught
    // in round 7. A resize dispatch runs the inline handler at once.
    window.dispatchEvent(new Event('resize'));
    var c0 = document.getElementById('minigame-canvas');
    var r0 = c0.getBoundingClientRect();
    // Snapshot the DPR once per game: every star in this game shares it,
    // so all sparkles sit on ONE consistent pixel step.
    miniGame.dpr = c0.width / Math.max(1, r0.width);
    // The instruction lives INSIDE the overlay now (see index.html) — the
    // old sayBubble() line sat behind the overlay's scrim and read as
    // barely-legible ghost-gray text. It auto-dismisses after ~2.5s so it
    // stops blocking the top drop zone for the whole 30s round; hiding it
    // frees the space, so the canvas backing is re-sized to match.
    var ins = document.getElementById('minigame-instructions');
    ins.classList.remove('gone');
    clearTimeout(miniGame.bannerTimer);
    miniGame.bannerTimer = setTimeout(function () {
      ins.classList.add('gone');
      window.dispatchEvent(new Event('resize'));
    }, 2500);
    spawnLoop();
    // (Re)start the rAF chain: endMiniGame used to cancel it, so a second
    // game in the same session never animated (latent bug, caught in v7).
    cancelAnimationFrame(miniGame.raf);
    miniGame.raf = requestAnimationFrame(function () { miniGameFrame(0.016); });
    miniGame.timer = setInterval(function () {
      var left = 30 - Math.floor((Date.now() - miniGame.t0) / 1000);
      document.getElementById('minigame-time').textContent = toFaDigits(Math.max(0, left));
      if (left <= 0) endMiniGame();
    }, 250);
  }
  function spawnLoop() {
    if (!miniGame.active) return;
    var c = document.getElementById('minigame-canvas');
    // One pixel step per game: r = 24 * dpr makes the star-grid cell
    // exactly 4*dpr backing px (r/6), an integer — no half-size sparkles.
    var dpr = miniGame.dpr || 1;
    var r = 24 * dpr;
    // Spawn fully inside the playfield (inset by the star half-width) so no
    // star is ever born clipped in half behind the timer/score pills.
    var x = r + 8 + Math.random() * Math.max(1, (c.width - 2 * (r + 8)));
    miniGame.stars.push({ x: x, y: -r - 4, vy: (120 + Math.random() * 90) * dpr, r: r });
    setTimeout(spawnLoop, 650 + Math.random() * 350);
  }
  function miniGameFrame(dt) {
    // Always reschedule: the loop must keep running while idle, otherwise the
    // chain dies on the first frame (active=false) and the game never animates.
    miniGame.raf = requestAnimationFrame(function (t) { miniGameFrame(0.016); });
    if (!miniGame.active) return;
    var c = document.getElementById('minigame-canvas');
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    for (var i = miniGame.stars.length - 1; i >= 0; i--) {
      var s = miniGame.stars[i];
      s.y += s.vy * dt;
      if (s.y > c.height + 30) { miniGame.stars.splice(i, 1); continue; }
      drawStar(ctx, s.x, s.y, s.r);
    }
  }
  // Pixel-grid 4-point sparkle — the game's own star language (matches the
  // sparkle icon). Axis-aligned filled rects on a grid, black outline +
  // gold fill. NO rotation and NO smooth curves: the old quadratic-curve
  // star was an anti-aliased vector shape that clashed with the chunky
  // pixel sprite, pixel icons and hard-edged UI.
  var STAR_ROWS = [1, 3, 3, 5, 5, 13, 13, 5, 5, 3, 3, 1];
  function drawPixelStarRows(ctx, x, y, r, rows) {
    var cell = r / 6;
    var y0 = y - (rows.length / 2) * cell;
    for (var j = 0; j < rows.length; j++) {
      var w = rows[j] * cell;
      ctx.fillRect(Math.round(x - w / 2), Math.round(y0 + j * cell), Math.round(w), Math.ceil(cell));
    }
  }
  function drawStar(ctx, x, y, r) {
    // Black outline: same shape, every row 2 cells wider, 1 cell taller
    // top and bottom — a 1-cell outline all around.
    var outlineRows = [3].concat(STAR_ROWS.map(function (w) { return w + 2; })).concat([3]);
    ctx.fillStyle = '#1a1a1a';
    drawPixelStarRows(ctx, x, y, r, outlineRows);
    ctx.fillStyle = '#ffd94a';
    drawPixelStarRows(ctx, x, y, r, STAR_ROWS);
  }
  function miniGameTap(cx, cy) {
    if (!miniGame.active) return;
    var c = document.getElementById('minigame-canvas');
    var rect = c.getBoundingClientRect();
    var x = (cx - rect.left) * (c.width / rect.width);
    var y = (cy - rect.top) * (c.height / rect.height);
    for (var i = miniGame.stars.length - 1; i >= 0; i--) {
      var s = miniGame.stars[i];
      var dx = x - s.x, dy = y - s.y;
      if (dx * dx + dy * dy < (s.r + 14) * (s.r + 14)) {
        miniGame.stars.splice(i, 1);
        miniGame.caught += 1;
        addCoins(2, 'star');
        document.getElementById('minigame-score').textContent = toFaDigits(miniGame.caught);
        if (window.Rig) window.Rig.blip();
        break;
      }
    }
  }
  function endMiniGame() {
    if (!miniGame.active) return;
    miniGame.active = false;
    clearInterval(miniGame.timer);
    clearTimeout(miniGame.bannerTimer);
    // Do NOT cancel the rAF chain here: miniGameFrame reschedules itself
    // and idles with an early return while inactive — cancelling it killed
    // the chain, so a second game in the same session never animated.
    document.getElementById('minigame-overlay').classList.remove('show');
    addStat('happiness', 6); addStat('energy', -6); addXP(4);
    save(); render();
    sayBubble('آفرین! ' + toFaDigits(miniGame.caught) + ' تا ستاره گرفتی! +' + toFaDigits(miniGame.caught * 2) + ' سکه!');
    if (window.Rig) window.Rig.celebrate();
  }
  // Quit early via the X button: no completion rewards, just a friendly line.
  function quitMiniGame() {
    if (!miniGame.active) return;
    miniGame.active = false;
    clearInterval(miniGame.timer);
    clearTimeout(miniGame.bannerTimer);
    document.getElementById('minigame-overlay').classList.remove('show');
    sayBubble('باشه، بعداً دوباره بازی می‌کنیم!');
  }

  // ---------- render HUD ----------
  function render() {
    var m = mood();
    // fx3 (audit F8): the sleepy face never showed — setSleepy() had zero
    // callers. The low-energy mood now drives head_sleepy.png.
    if (window.Rig) window.Rig.setSleepy(m === 'sleepy');
    var setBar = function (id, v) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.width = v + '%';
      el.parentElement.classList.toggle('low', v < 40);
    };
    setBar('bar-hunger', state.stats.hunger);
    setBar('bar-happiness', state.stats.happiness);
    setBar('bar-energy', state.stats.energy);
    setBar('bar-cleanliness', state.stats.cleanliness);
    var setVal = function (id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = toFaDigits(Math.round(v)) + '/' + toFaDigits(100);
    };
    setVal('val-hunger', state.stats.hunger);
    setVal('val-happiness', state.stats.happiness);
    setVal('val-energy', state.stats.energy);
    setVal('val-cleanliness', state.stats.cleanliness);
    var xpEl = document.getElementById('bar-affection');
    if (xpEl) xpEl.style.width = Math.round(100 * state.affectionXP / xpForNext()) + '%';
    var affVal = document.getElementById('val-affection');
    if (affVal) affVal.textContent = toFaDigits(state.affectionXP) + '/' + toFaDigits(xpForNext());
    var lvlBar = document.getElementById('bar-level');
    if (lvlBar) lvlBar.style.width = Math.round(100 * state.affectionXP / xpForNext()) + '%';
    var coinsEl = document.getElementById('coins-val');
    if (coinsEl) coinsEl.textContent = toFaDigits(state.coins);
    var lvlEl = document.getElementById('level-val');
    if (lvlEl) lvlEl.textContent = toFaDigits(state.level);
    var moodEl = document.getElementById('mood-val');
    if (moodEl) moodEl.innerHTML = '<img class="ic" src="assets/icons/' + MOOD_ICON[m] + '" alt=""> ' + MOOD_FA[m];
    var cakeEl = document.getElementById('cake-count');
    if (cakeEl) {
      cakeEl.innerHTML = state.cake > 0 ? '<img class="ic" src="assets/icons/cake.png" alt="">×' + toFaDigits(state.cake) : '';
      cakeEl.style.display = state.cake > 0 ? '' : 'none';
    }
    document.body.dataset.mood = m;
  }

  // ---------- init ----------
  applyOfflineDecay();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { applyOfflineDecay(); render(); } });
  // Keep the sleep UI glued to the stage if the viewport moves while asleep.
  window.addEventListener('resize', function () { if (state.sleeping) positionSleepFx(); });

  window.Game = {
    state: state, save: save, render: render, mood: mood, MOOD_FA: MOOD_FA,
    feed: feed, clean: clean, pet: pet, toggleSleep: toggleSleep, wake: wake,
    buy: buy, equip: equip, SHOP: SHOP, FOOD: FOOD,
    startMiniGame: startMiniGame, miniGameTap: miniGameTap, endMiniGame: endMiniGame, quitMiniGame: quitMiniGame,
    miniGameFrame: miniGameFrame, positionSleepFx: positionSleepFx, showSleepBubble: showSleepBubble,
    idleLine: idleLine, sayBubble: sayBubble, clearBubble: clearBubble, startIdleLines: startIdleLines,
    addCoins: addCoins, addXP: addXP, toFaDigits: toFaDigits, xpForNext: xpForNext
  };
})();
