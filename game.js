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
      owned: [],            // accessory/item ids
      equipped: null,       // head-slot accessory id or null (mirrors gear.head)
      gear: { head: null, neck: null, braid: null, outfit: null, room: null, decor: [] },
      cake: 0,              // cake treats owned
      tea: 0,               // v11: bubble-tea treats owned
      cookie: 0,            // v11: star-cookie treats owned
      milk: 0,              // strawberry-milk treats owned
      candy: 0,             // star-candy treats owned
      pudding: 0,           // pudding treats owned
      records: { starTop: [], memoryBest: null, timingBest: null, levelBest: 1, coinsTotal: 0, totalPets: 0, totalFeeds: 0, petStreak: { count: 0, last: '' }, feedStreak: { count: 0, last: '' }, petStreakBest: 0, feedStreakBest: 0, achievements: [] },
      lastPlushAt: 0,       // plush-hug cooldown
      lastWandAt: 0,        // wand-wave cooldown
      sleeping: false,
      lastSeen: Date.now(),
      chatCoinsDate: '',    // yyyy-mm-dd of last chat-coin day
      chatCoinsToday: 0,
      lastPetCoinAt: 0,
      lastBallAt: 0,        // v11: ball-toss cooldown
      lastGreetDate: '',    // v11: yyyy-mm-dd of last greeting line
      excitedUntil: 0,      // v11: timestamp — excited mood window
      settings: { autoRotate: true, reducedMotion: false, dayNight: 'auto' },
      counters: { pets: 0, feeds: 0, starsBest: 0, gamesPlayed: { star: 0, memory: 0, timing: 0, ball: 0 } },
      best: { star: 0, memory: 0, timing: 0 }, // v11: best scores (memory = fewest flips)
      quests: {},           // v11: { questId: { done: true, claimed: true } }
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
      s.gear = Object.assign({}, d.gear, s.gear || {});
      s.settings = Object.assign({}, d.settings, s.settings || {});
      s.counters = Object.assign({}, d.counters, s.counters || {});
      s.counters.gamesPlayed = Object.assign({}, d.counters.gamesPlayed, (s.counters.gamesPlayed || {}));
      s.best = Object.assign({}, d.best, s.best || {});
      s.quests = s.quests || {};
      // Records migration: merge defaults, keep streak objects intact,
      // and backfill what the old counters already know (level, pets, feeds).
      s.records = Object.assign({}, d.records, s.records || {});
      s.records.petStreak = Object.assign({}, d.records.petStreak, s.records.petStreak || {});
      s.records.feedStreak = Object.assign({}, d.records.feedStreak, s.records.feedStreak || {});
      if (!Array.isArray(s.records.starTop)) s.records.starTop = [];
      if (!Array.isArray(s.records.achievements)) s.records.achievements = [];
      if (!Array.isArray(s.gear.decor)) s.gear.decor = [];
      if (s.records.levelBest < s.level) s.records.levelBest = s.level;
      if (s.records.totalPets < (s.counters.pets || 0)) s.records.totalPets = s.counters.pets;
      if (s.records.totalFeeds < (s.counters.feeds || 0)) s.records.totalFeeds = s.counters.feeds;
      // v11 migration: the old single `equipped` string becomes gear.head.
      if (s.equipped && !s.gear.head) s.gear.head = s.equipped;
      if (!s.equipped) s.equipped = s.gear.head || null;
      return s;
    } catch (e) { return defaultState(); }
  }
  function save() {
    state.lastSeen = Date.now();
    state.equipped = state.gear.head || null; // keep the old field in sync
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
      // Sleep mask (head slot): +10 extra energy per tick on top of the +2.4.
      var restore = 2.4 + (state.gear.head === 'sleepmask' ? 10 : 0);
      state.stats.energy = clamp(state.stats.energy + restore, 0, 100); // per 60s tick while asleep
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

  // ---------- dialogue lines (v11: shuffle-bag pools in lines.js) ----------
  // L(pool, ctx, n): next line from the pool, with {n} replaced by n in
  // Persian digits. Falls back to a plain line if lines.js failed to load.
  function L(pool, ctx, n) {
    var line = null;
    if (window.Lines) line = window.Lines.next(pool, ctx || {});
    if (!line) line = 'یاهو!';
    if (n !== undefined && n !== null) line = line.split('{n}').join(toFaDigits(n));
    return line;
  }
  function hourNow() { return new Date().getHours(); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Persian (Jalali) date string for record rows, e.g. ۱۴۰۵/۹/۵.
  function faDate(d) {
    try { return (d || new Date()).toLocaleDateString('fa-IR'); } catch (e) { return todayStr(); }
  }
  function yesterdayStr() {
    var d = new Date(Date.now() - DAY_MS);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // Daily streak: same day keeps the count, yesterday bumps it, anything
  // older restarts at 1. Returns the new count.
  function bumpStreak(st) {
    var today = todayStr();
    if (st.last === today) return st.count;
    if (st.last === yesterdayStr()) st.count += 1;
    else st.count = 1;
    st.last = today;
    return st.count;
  }
  function totalGames() {
    var g = state.counters.gamesPlayed;
    return (g.star || 0) + (g.memory || 0) + (g.timing || 0) + (g.ball || 0);
  }

  // ---------- achievements (10) ----------
  var ACHIEVEMENTS = [
    { id: 'first-pet', fa: 'اولین ناز', desc: '۱ بار نازش کن', check: function () { return state.records.totalPets >= 1; } },
    { id: 'pets-100', fa: 'نوازشگر حرفه‌ای', desc: '۱۰۰ بار نازش کن', check: function () { return state.records.totalPets >= 100; } },
    { id: 'feeds-50', fa: 'آشپز آستولفو', desc: '۵۰ وعده غذا بده', check: function () { return state.records.totalFeeds >= 50; } },
    { id: 'level-3', fa: 'دوست صمیمی', desc: 'به سطح ۳ برس', check: function () { return state.level >= 3; } },
    { id: 'level-5', fa: 'بهترین دوست', desc: 'به سطح ۵ برس', check: function () { return state.level >= 5; } },
    { id: 'coins-1000', fa: 'گنجینه‌دار', desc: '۱۰۰۰ سکه در کل به دست بیار', check: function () { return state.records.coinsTotal >= 1000; } },
    { id: 'star-15', fa: 'شکارچی ستاره', desc: 'تو یه دور ۱۵ ستاره بگیر', check: function () { return state.counters.starsBest >= 15; } },
    { id: 'collector-10', fa: 'کلکسیونر', desc: '۱۰ آیتم داشته باش', check: function () { return state.owned.length >= 10; } },
    { id: 'streak-7', fa: 'وفادار', desc: '۷ روز پشت سر هم ناز کن یا غذا بده', check: function () { return state.records.petStreakBest >= 7 || state.records.feedStreakBest >= 7; } },
    { id: 'games-25', fa: 'بازی‌باز', desc: '۲۵ بار بازی کن', check: function () { return totalGames() >= 25; } }
  ];
  function hasAchievement(id) {
    if (!state.records) return false;
    for (var i = 0; i < state.records.achievements.length; i++) {
      if (state.records.achievements[i].id === id) return true;
    }
    return false;
  }
  function checkAchievements() {
    if (!state.records) return;
    var unlocked = false;
    ACHIEVEMENTS.forEach(function (a) {
      if (!hasAchievement(a.id) && a.check()) {
        state.records.achievements.push({ id: a.id, fa: a.fa, desc: a.desc, date: faDate() });
        unlocked = true;
      }
    });
    if (unlocked) {
      save();
      sayBubble(L('achievement', {}));
      if (window.Rig) window.Rig.blip();
    }
  }

  // ---------- affection / level ----------
  function xpForNext() { return 20 * state.level; } // L1->2: 20, L2->3: 40, ...
  function addXP(n) {
    state.affectionXP += n;
    var leveled = false;
    while (state.affectionXP >= xpForNext()) {
      state.affectionXP -= xpForNext();
      state.level += 1;
      addCoins(20, 'level');
      leveled = true;
    }
    if (leveled) {
      if (state.records && state.level > state.records.levelBest) state.records.levelBest = state.level;
      save(); render();
      if (window.Rig) window.Rig.celebrate();
      sayBubble(L('levelUp', {}, state.level));
      checkQuests();
      checkAchievements();
    }
    save(); render();
  }
  function toFaDigits(n) {
    return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[+d]; });
  }

  // ---------- mood ----------
  // Lowest stat drives mood. Sleeping overrides everything. Excited is a
  // timed window after big wins (v11). Bored (v11): happiness is the
  // lowest stat and low, but energy is fine — distinct from sad.
  function mood() {
    if (state.sleeping) return 'sleeping';
    if (Date.now() < state.excitedUntil) return 'excited';
    var s = state.stats;
    var low = 'hunger', lowV = s.hunger;
    ['happiness', 'energy', 'cleanliness'].forEach(function (k) {
      if (s[k] < lowV) { low = k; lowV = s[k]; }
    });
    if (lowV >= 40) return 'happy';
    if (low === 'hunger') return 'hungry';
    if (low === 'energy') return 'sleepy';
    if (low === 'cleanliness') return 'messy';
    if (low === 'happiness' && s.energy >= 50) return 'bored';
    return 'sad';
  }
  var MOOD_FA = { happy: 'شاد', hungry: 'گرسنه', sleepy: 'خواب‌آلود', messy: 'کثیف', sad: 'ناراحت', bored: 'حوصله‌سررفته', excited: 'هیجان‌زده', sleeping: 'خواب' };
  var MOOD_ICON = { happy: 'face-happy.png', hungry: 'drumstick.png', sleepy: 'moon.png', messy: 'duck.png', sad: 'face-sad.png', bored: 'face-bored.png', excited: 'face-excited.png', sleeping: 'moon.png' };

  // ---------- idle lines (v11: shuffle-bag pools in lines.js) ----------
  // A low stat (<30) sometimes warns instead of idling. Once a day, the
  // first idle line is a time-of-day greeting.
  var IDLE_POOL = { happy: 'idleHappy', hungry: 'idleHungry', sleepy: 'idleSleepy', messy: 'idleMessy', sad: 'idleSad', bored: 'idleBored', excited: 'idleExcited', sleeping: 'idleSleeping' };
  var WARN_POOL = { hunger: 'warnHunger', happiness: 'warnHappy', energy: 'warnEnergy', cleanliness: 'warnClean' };
  function idleLine() {
    var m = mood();
    if (state.lastGreetDate !== todayStr()) {
      state.lastGreetDate = todayStr();
      save();
      return L('greet', { hour: hourNow() });
    }
    var s = state.stats;
    var lowK = null, lowV = 100;
    ['hunger', 'happiness', 'energy', 'cleanliness'].forEach(function (k) {
      if (s[k] < lowV) { lowK = k; lowV = s[k]; }
    });
    if (lowV < 30 && Math.random() < 0.5) return L(WARN_POOL[lowK], {});
    return L(IDLE_POOL[m] || 'idleHappy', { hour: hourNow(), level: state.level });
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
    // v12: the note anchors to the stage BOTTOM (over the checker floor
    // band, below her feet — her shoes sit at ~82% height) instead of
    // the stage CENTRE, where it covered her chest/neck (gp-05/gp-06).
    // NOT below the stage itself: on the phone the action buttons sit
    // directly under the stage and on desktop the footer does, so the
    // note would cover live controls. CSS translate(-50%,-100%) makes
    // this top value the note's BOTTOM edge.
    note.style.top = Math.round(r.top + r.height - 8) + 'px';
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

  // ---------- coins (centralised: EVERY coin gain goes through here) ----------
  function addCoins(n, why) {
    state.coins += n;
    // Lifetime total for the leaderboard — exact because all gains funnel here.
    if (state.records) state.records.coinsTotal = (state.records.coinsTotal || 0) + n;
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
    cake: { fa: 'کیک', price: 0, hunger: 10, happiness: 15, energy: 0, inventory: true },
    tea: { fa: 'چای حبابی', price: 0, hunger: 8, happiness: 8, energy: 10, inventory: true, invKey: 'tea' },
    cookie: { fa: 'کوکی ستاره‌ای', price: 0, hunger: 10, happiness: 12, energy: 0, inventory: true, invKey: 'cookie' },
    milk: { fa: 'شیر توت‌فرنگی', price: 0, hunger: 10, happiness: 10, energy: 5, inventory: true, invKey: 'milk' },
    candy: { fa: 'آبنبات ستاره‌ای', price: 0, hunger: 6, happiness: 8, energy: 2, inventory: true, invKey: 'candy' },
    pudding: { fa: 'پودینگ', price: 0, hunger: 14, happiness: 10, energy: 4, inventory: true, invKey: 'pudding' }
  };
  var FEED_POOL = { snack: 'feedSnack', meal: 'feedMeal', drink: 'feedDrink', cake: 'feedCake', tea: 'feedTea', cookie: 'feedCookie', milk: 'feedMilk', candy: 'feedCandy', pudding: 'feedPudding' };
  function feed(kind) {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return false; }
    // fx3 (audit F6): same silent-cooldown trap as clean() — the old
    // success bubble stayed up and the refused feed looked like it worked.
    if (Date.now() - lastFeedAt < 2000) { sayBubble('یه لحظه صبر کن، هنوز دارم می‌جوم!'); return false; }
    var f = FOOD[kind];
    if (!f) return false;
    if (f.inventory) {
      var key = f.invKey || 'cake';
      if (state[key] <= 0) { sayBubble('اینو ندارم! اول از فروشگاه بخر.'); return false; }
      state[key] -= 1;
    } else if (!spendCoins(f.price)) {
      sayBubble(L('cantAfford', {}));
      return false;
    }
    lastFeedAt = Date.now();
    addStat('hunger', f.hunger); addStat('happiness', f.happiness); addStat('energy', f.energy);
    addXP(2);
    state.counters.feeds += 1;
    if (state.records) {
      state.records.totalFeeds += 1;
      var fs = bumpStreak(state.records.feedStreak);
      if (fs > state.records.feedStreakBest) state.records.feedStreakBest = fs;
    }
    save(); render();
    if (window.Rig) window.Rig.eat();
    sayBubble(L(FEED_POOL[kind] || 'feedSnack', {}));
    checkQuests();
    checkAchievements();
    return true;
  }

  var lastCleanAt = 0;
  function clean() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return false; }
    // fx3 (audit F5): a silent return left the stale success bubble
    // showing, so the user thought the second bath worked. Say so instead.
    if (Date.now() - lastCleanAt < 10000) { sayBubble('همین الان حموم کردم! یه کم صبر کن.'); return false; }
    lastCleanAt = Date.now();
    addStat('cleanliness', 22); addStat('happiness', 3);
    addXP(2);
    save(); render();
    if (window.Rig) window.Rig.bath();
    sayBubble(L('bath', {}));
    return true;
  }

  function pet() {
    if (state.sleeping) { wake(); return; }
    addStat('happiness', 3);
    addXP(2);
    state.counters.pets += 1;
    if (state.records) {
      state.records.totalPets += 1;
      var ps = bumpStreak(state.records.petStreak);
      if (ps > state.records.petStreakBest) state.records.petStreakBest = ps;
    }
    var now = Date.now();
    if (now - state.lastPetCoinAt > 10000) { state.lastPetCoinAt = now; addCoins(2, 'pet'); }
    save(); render();
    if (window.Rig) window.Rig.pet();
    checkQuests();
    checkAchievements();
  }

  // v11: poking the body — annoyed face + warning line (Rig.annoyed).
  function poke() {
    if (state.sleeping) { wake(); return; }
    if (window.Rig) window.Rig.annoyed();
    sayBubble(L('poke', {}));
  }

  function toggleSleep() {
    if (state.sleeping) { wake(); return; }
    // v10: the old speech bubble stayed dimmed behind the sleep bubble.
    clearBubble();
    state.sleeping = true;
    save(); render();
    document.body.classList.add('sleeping');
    positionSleepFx();
    showSleepBubble(L('sleep', {}) + ' <span dir="ltr">Zzz</span>', 6000);
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
    sayBubble(L('wake', { hour: hourNow() }));
  }

  // ---------- shop ----------
  // slot: head (beanie/glasses/starclips), neck (scarf), braid (bow),
  // consumable (cake/tea/cookie go to inventory), toy (ball unlocks toss).
  var SHOP = [
    { id: 'starclips', fa: 'گیره‌ی ستاره آبی و صورتی', price: 50, level: 2, icon: 'star-pink.png', slot: 'head' },
    { id: 'beanie', fa: 'کلاه بافتنی صورتی', price: 60, level: 3, icon: 'beanie.png', slot: 'head' },
    { id: 'glasses', fa: 'عینک گرد', price: 80, level: 3, icon: 'glasses.png', slot: 'head' },
    { id: 'crown', fa: 'تاج طلایی', price: 120, level: 4, icon: 'crown.png', slot: 'head' },
    { id: 'catears', fa: 'گوش گربه‌ای', price: 90, level: 3, icon: 'catears.png', slot: 'head' },
    { id: 'bunnyears', fa: 'گوش خرگوشی', price: 90, level: 3, icon: 'bunnyears.png', slot: 'head' },
    { id: 'flowercrown', fa: 'تاج گل', price: 75, level: 2, icon: 'flowercrown.png', slot: 'head' },
    { id: 'sleepmask', fa: 'چشم‌بند خواب', price: 40, level: 2, icon: 'sleepmask.png', slot: 'head' },
    { id: 'scarf', fa: 'شال صورتی', price: 70, level: 2, icon: 'drink.png', slot: 'neck' },
    { id: 'necklaceGold', fa: 'گردنبند طلایی ستاره', price: 100, level: 3, icon: 'necklace-gold.png', slot: 'neck' },
    { id: 'necklacePearl', fa: 'گردنبند مروارید', price: 85, level: 3, icon: 'necklace-pearl.png', slot: 'neck' },
    { id: 'bowtie', fa: 'پاپیون گردن', price: 45, level: 2, icon: 'bowtie.png', slot: 'neck' },
    { id: 'bow', fa: 'پاپیون صورتی', price: 55, level: 3, icon: 'heart.png', slot: 'braid' },
    { id: 'starties', fa: 'گیره‌های ستاره‌ای گیس', price: 40, level: 2, icon: 'starties.png', slot: 'braid' },
    { id: 'ribbonBlue', fa: 'روبان آبی گیس', price: 35, level: 2, icon: 'ribbon-blue.png', slot: 'braid' },
    { id: 'bell', fa: 'زنگوله‌ی گیس', price: 65, level: 3, icon: 'bell.png', slot: 'braid' },
    { id: 'cape', fa: 'شنل صورتی', price: 110, level: 4, icon: 'cape.png', slot: 'outfit' },
    { id: 'apron', fa: 'پیش‌بند', price: 50, level: 2, icon: 'apron.png', slot: 'outfit' },
    { id: 'sailor', fa: 'یقه‌ی ملوانی', price: 65, level: 3, icon: 'sailor.png', slot: 'outfit' },
    { id: 'vest', fa: 'جلیقه‌ی ستاره‌ای', price: 95, level: 4, icon: 'vest.png', slot: 'outfit' },
    { id: 'roomPink', fa: 'اتاق صورتی', price: 150, level: 3, icon: 'room-pink.png', slot: 'room' },
    { id: 'roomMint', fa: 'اتاق نعنایی', price: 150, level: 3, icon: 'room-mint.png', slot: 'room' },
    { id: 'roomLavender', fa: 'اتاق یاسی', price: 150, level: 4, icon: 'room-lavender.png', slot: 'room' },
    { id: 'roomNight', fa: 'اتاق شب', price: 180, level: 4, icon: 'room-night.png', slot: 'room' },
    { id: 'bookshelf', fa: 'قفسه‌ی کتاب', price: 80, level: 2, icon: 'bookshelf.png', slot: 'decor' },
    { id: 'plant', fa: 'گلدان', price: 60, level: 2, icon: 'plant.png', slot: 'decor' },
    { id: 'fairylights', fa: 'چراغ‌های ریسه‌ای', price: 70, level: 3, icon: 'fairylights.png', slot: 'decor' },
    { id: 'cake', fa: 'کیک (خوراکی)', price: 25, level: 1, icon: 'cake.png', consumable: true },
    { id: 'tea', fa: 'چای حبابی (خوراکی)', price: 12, level: 1, icon: 'tea.png', consumable: true, invKey: 'tea' },
    { id: 'cookie', fa: 'کوکی ستاره‌ای (خوراکی)', price: 10, level: 1, icon: 'starcookie.png', consumable: true, invKey: 'cookie' },
    { id: 'milk', fa: 'شیر توت‌فرنگی (خوراکی)', price: 15, level: 1, icon: 'milk.png', consumable: true, invKey: 'milk' },
    { id: 'candy', fa: 'آبنبات ستاره‌ای (خوراکی)', price: 8, level: 1, icon: 'candy.png', consumable: true, invKey: 'candy' },
    { id: 'pudding', fa: 'پودینگ (خوراکی)', price: 20, level: 1, icon: 'pudding.png', consumable: true, invKey: 'pudding' },
    { id: 'ball', fa: 'توپ بازی', price: 45, level: 2, icon: 'ball.png', toy: true },
    { id: 'plush', fa: 'عروسک خرگوشی', price: 70, level: 3, icon: 'plush.png', toy: true },
    { id: 'wand', fa: 'چوبدستی ستاره‌ای', price: 85, level: 3, icon: 'wand.png', toy: true }
  ];
  function buy(itemId) {
    var item = null;
    SHOP.forEach(function (it) { if (it.id === itemId) item = it; });
    if (!item) return false;
    if (state.level < item.level) { sayBubble(L('locked', {}, item.level)); return false; }
    if (!item.consumable && !item.toy && state.owned.indexOf(item.id) !== -1) { equip(item.id); return true; }
    if (item.toy && state.owned.indexOf(item.id) !== -1) {
      if (item.id === 'ball') sayBubble('توپ رو داری! از منوی بازی پرتش کن!');
      else if (item.id === 'plush') hugPlush();
      else if (item.id === 'wand') waveWand();
      else sayBubble('اینو داری! از منوی بازی باهاش بازی کن!');
      return true;
    }
    if (!spendCoins(item.price)) { sayBubble(L('cantAfford', {})); return false; }
    if (item.consumable) {
      var key = item.invKey || 'cake';
      state[key] += 1;
      sayBubble(L(item.id === 'cake' ? 'shopCake' : 'shopBuy', {}));
    } else if (item.toy) {
      state.owned.push(item.id);
      if (item.id === 'ball') sayBubble('یه توپ گرفتی! حالا از منوی بازی می‌تونیم باهاش بازی کنیم!');
      else if (item.id === 'plush') sayBubble('یه عروسک خرگوشی گرفتی! از منوی بازی بغلمش کن!');
      else if (item.id === 'wand') sayBubble('یه چوبدستی ستاره‌ای گرفتی! از منوی بازی تکونش بده!');
      else sayBubble(L('shopBuy', {}));
      if (window.Rig) window.Rig.celebrate();
    } else {
      state.owned.push(item.id);
      equip(item.id);
      sayBubble(L('shopBuy', {}));
      if (window.Rig) window.Rig.celebrate();
    }
    save(); render();
    checkAchievements();
    return true;
  }
  function equip(itemId) {
    // Toggles a wear slot. itemId null clears the head slot (old callers).
    if (itemId === null) {
      state.gear.head = null;
    } else {
      var item = null;
      SHOP.forEach(function (it) { if (it.id === itemId) item = it; });
      if (!item || !item.slot) return false;
      if (state.owned.indexOf(itemId) === -1) return false;
      if (item.slot === 'decor') {
        // Decor is a MULTI-toggle: owned items switch on/off, never re-bought.
        if (!Array.isArray(state.gear.decor)) state.gear.decor = [];
        var di = state.gear.decor.indexOf(itemId);
        if (di === -1) state.gear.decor.push(itemId);
        else state.gear.decor.splice(di, 1);
      } else {
        // Single-select slots (head/neck/braid/outfit/room): clicking the
        // worn item takes it off again.
        state.gear[item.slot] = (state.gear[item.slot] === itemId) ? null : itemId;
      }
    }
    save(); render();
    if (window.Rig && window.Rig.setGear) window.Rig.setGear(state.gear);
    return true;
  }

  // ---------- toys: plush hug + wand wave ----------
  function hugPlush() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return false; }
    if (state.owned.indexOf('plush') === -1) { sayBubble('عروسک خرگوشی ندارم! اول از فروشگاه بخر.'); return false; }
    if (Date.now() - state.lastPlushAt < 10000) { sayBubble('یه لحظه صبر کن، هنوز دارم خرگوشی رو بغل می‌کنم!'); return false; }
    state.lastPlushAt = Date.now();
    addStat('happiness', 6);
    addXP(1);
    save(); render();
    if (window.Rig && window.Rig.toyAction) window.Rig.toyAction('plush');
    else if (window.Rig) window.Rig.celebrate();
    sayBubble(L('plushHug', {}));
    return true;
  }
  function waveWand() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return false; }
    if (state.owned.indexOf('wand') === -1) { sayBubble('چوبدستی ستاره‌ای ندارم! اول از فروشگاه بخر.'); return false; }
    if (Date.now() - state.lastWandAt < 10000) { sayBubble('یه لحظه صبر کن، جادوی قبلی هنوز تو هواست!'); return false; }
    state.lastWandAt = Date.now();
    addXP(3);
    save(); render();
    if (window.Rig && window.Rig.toyAction) window.Rig.toyAction('wand');
    else if (window.Rig) window.Rig.celebrate();
    sayBubble(L('wandWave', {}));
    return true;
  }

  // ---------- mini-game: catch the falling stars ----------
  var miniGame = { active: false, score: 0, caught: 0, t0: 0, stars: [], timer: null, raf: 0, dpr: 1, bannerTimer: null };
  function startMiniGame() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return; }
    if (miniGame.active) return;
    miniGame.active = true; miniGame.score = 0; miniGame.caught = 0;
    miniGame.stars = []; miniGame.t0 = Date.now();
    state.counters.gamesPlayed.star += 1;
    save();
    var overlay = document.getElementById('minigame-overlay');
    overlay.classList.add('show');
    document.getElementById('minigame-score').textContent = '۰';
    document.getElementById('minigame-time').textContent = '۳۰';
    document.getElementById('minigame-instructions').textContent = L('starStart', {});
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
    // v10: born fully inside the canvas too (centre r+8) — the old y=-r-4
    // slid stars in from behind the HUD row, so on the phone a star's tip
    // was clipped under the score pill.
    var x = r + 8 + Math.random() * Math.max(1, (c.width - 2 * (r + 8)));
    miniGame.stars.push({ x: x, y: r + 8, vy: (120 + Math.random() * 90) * dpr, r: r });
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
    var caught = miniGame.caught;
    if (caught > state.best.star) state.best.star = caught;
    if (caught > state.counters.starsBest) state.counters.starsBest = caught;
    if (caught > 0 && state.records) {
      state.records.starTop.push({ score: caught, date: faDate() });
      state.records.starTop.sort(function (a, b) { return b.score - a.score; });
      state.records.starTop = state.records.starTop.slice(0, 5);
    }
    // A great round leaves Astolfo excited for a while (bigger bob +
    // sparkles + excited mood + its own idle lines).
    if (caught >= 10) state.excitedUntil = Date.now() + 20000;
    save(); render();
    sayBubble(caught >= 8 ? L('starWin', {}, caught) : L('starLow', {}, caught));
    if (window.Rig) window.Rig.celebrate();
    checkQuests();
    checkAchievements();
  }
  // Quit early via the X button: no completion rewards, just a friendly line.
  function quitMiniGame() {
    if (!miniGame.active) return;
    miniGame.active = false;
    clearInterval(miniGame.timer);
    clearTimeout(miniGame.bannerTimer);
    document.getElementById('minigame-overlay').classList.remove('show');
    sayBubble(L('starQuit', {}));
  }

  // ---------- v11 game 2: memory match (3 pairs, pixel icons) ----------
  var memoryGame = { active: false, cards: [], flipped: [], matched: 0, moves: 0, lock: false };
  var MEMORY_ICONS = [
    { id: 'star', icon: 'star.png' },
    { id: 'heart', icon: 'heart.png' },
    { id: 'moon', icon: 'moon.png' }
  ];
  function startMemoryGame() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return; }
    if (memoryGame.active) return;
    memoryGame.active = true;
    memoryGame.matched = 0; memoryGame.moves = 0; memoryGame.flipped = []; memoryGame.lock = false;
    state.counters.gamesPlayed.memory += 1;
    save();
    // Shuffle 6 cards (3 pairs) with the Fisher-Yates shuffle.
    var deck = MEMORY_ICONS.concat(MEMORY_ICONS).map(function (c, i) {
      return { key: c.id, icon: c.icon, uid: i };
    });
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    memoryGame.cards = deck;
    var grid = document.getElementById('memory-grid');
    grid.innerHTML = '';
    deck.forEach(function (card, idx) {
      var b = document.createElement('button');
      b.className = 'memory-card';
      b.setAttribute('data-idx', idx);
      b.innerHTML = '<span class="memory-back"><img class="ic" src="assets/icons/sparkle.png" alt=""></span>' +
        '<span class="memory-face"><img class="ic-lg" src="assets/icons/' + card.icon + '" alt=""></span>';
      b.addEventListener('click', function () { memoryFlip(idx); });
      grid.appendChild(b);
    });
    document.getElementById('memory-status').textContent = L('memoryStart', {});
    document.getElementById('memory-modal').classList.add('show');
  }
  function memoryFlip(idx) {
    if (!memoryGame.active || memoryGame.lock) return;
    var card = memoryGame.cards[idx];
    if (!card || card.done || memoryGame.flipped.indexOf(idx) !== -1) return;
    var el = document.querySelector('.memory-card[data-idx="' + idx + '"]');
    if (!el) return;
    el.classList.add('flipped');
    memoryGame.flipped.push(idx);
    if (window.Rig) window.Rig.blip();
    if (memoryGame.flipped.length < 2) return;
    memoryGame.moves += 1;
    var a = memoryGame.cards[memoryGame.flipped[0]], b = memoryGame.cards[memoryGame.flipped[1]];
    if (a.key === b.key) {
      a.done = b.done = true;
      memoryGame.matched += 1;
      addCoins(5, 'memory');
      document.getElementById('memory-status').textContent = 'یه جفت پیدا شد! +' + toFaDigits(5) + ' سکه';
      if (window.Rig) window.Rig.chatReact();
      memoryGame.flipped = [];
      if (memoryGame.matched === 3) endMemoryGame();
    } else {
      memoryGame.lock = true;
      var pair = memoryGame.flipped.slice();
      setTimeout(function () {
        pair.forEach(function (i) {
          var e2 = document.querySelector('.memory-card[data-idx="' + i + '"]');
          if (e2) e2.classList.remove('flipped');
        });
        memoryGame.flipped = [];
        memoryGame.lock = false;
      }, 800);
    }
  }
  function endMemoryGame() {
    if (!memoryGame.active) return;
    memoryGame.active = false;
    addStat('happiness', 5); addStat('energy', -3); addXP(4);
    if (!state.best.memory || memoryGame.moves < state.best.memory) state.best.memory = memoryGame.moves;
    if (state.records && (!state.records.memoryBest || memoryGame.moves < state.records.memoryBest.moves)) {
      state.records.memoryBest = { moves: memoryGame.moves, date: faDate() };
    }
    addCoins(10, 'memory-win');
    save(); render();
    document.getElementById('memory-status').textContent = L('memoryWin', {}, memoryGame.moves);
    sayBubble(L('memoryWin', {}, memoryGame.moves));
    if (window.Rig) window.Rig.celebrate();
    checkQuests();
    checkAchievements();
    setTimeout(function () { document.getElementById('memory-modal').classList.remove('show'); }, 2500);
  }
  function quitMemoryGame() {
    if (!memoryGame.active) return;
    memoryGame.active = false;
    document.getElementById('memory-modal').classList.remove('show');
    sayBubble(L('starQuit', {}));
  }

  // ---------- v11 game 3: timing tap (10 rounds, moving marker) ----------
  var timingGame = { active: false, round: 0, score: 0, pos: 0, dir: 1, timer: null };
  function startTimingGame() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return; }
    if (timingGame.active) return;
    timingGame.active = true;
    timingGame.round = 0; timingGame.score = 0;
    state.counters.gamesPlayed.timing += 1;
    save();
    document.getElementById('timing-status').textContent = L('timingStart', {});
    document.getElementById('timing-round').textContent = '۰/۱۰';
    document.getElementById('timing-score').textContent = '۰';
    document.getElementById('timing-modal').classList.add('show');
    timingNextRound();
  }
  function timingNextRound() {
    if (!timingGame.active) return;
    timingGame.round += 1;
    if (timingGame.round > 10) { endTimingGame(); return; }
    document.getElementById('timing-round').textContent = toFaDigits(timingGame.round) + '/۱۰';
    // Gold zone: random centre 30-70%, width 16%.
    var centre = 30 + Math.random() * 40;
    var zone = document.getElementById('timing-zone');
    zone.style.left = (centre - 8) + '%';
    zone.style.width = '16%';
    timingGame.pos = 0; timingGame.dir = 1;
    var marker = document.getElementById('timing-marker');
    clearInterval(timingGame.timer);
    timingGame.timer = setInterval(function () {
      timingGame.pos += timingGame.dir * 2.2;
      if (timingGame.pos >= 100) { timingGame.pos = 100; timingGame.dir = -1; }
      if (timingGame.pos <= 0) { timingGame.pos = 0; timingGame.dir = 1; }
      marker.style.left = timingGame.pos + '%';
    }, 16);
  }
  function timingTap() {
    if (!timingGame.active) return;
    clearInterval(timingGame.timer);
    var zone = document.getElementById('timing-zone');
    var zLeft = parseFloat(zone.style.left), zW = parseFloat(zone.style.width);
    var centre = zLeft + zW / 2;
    var dist = Math.abs(timingGame.pos - centre);
    var pts = dist <= 3 ? 100 : (dist <= 8 ? 70 : (dist <= 16 ? 40 : 10));
    timingGame.score += pts;
    document.getElementById('timing-score').textContent = toFaDigits(timingGame.score);
    document.getElementById('timing-status').textContent =
      pts === 100 ? 'دقیق وسط! ۱۰۰ امتیاز!' : (pts >= 70 ? 'خیلی خوب! ' + toFaDigits(pts) + ' امتیاز!' :
      (pts >= 40 ? 'خوب بود! ' + toFaDigits(pts) + ' امتیاز!' : 'آخ! فقط ' + toFaDigits(pts) + ' امتیاز...'));
    if (window.Rig) window.Rig.blip();
    setTimeout(timingNextRound, 700);
  }
  function endTimingGame() {
    if (!timingGame.active) return;
    timingGame.active = false;
    clearInterval(timingGame.timer);
    var coins = Math.floor(timingGame.score / 10);
    addStat('happiness', 5); addStat('energy', -3); addXP(4);
    if (timingGame.score > state.best.timing) state.best.timing = timingGame.score;
    if (state.records && (!state.records.timingBest || timingGame.score > state.records.timingBest.score)) {
      state.records.timingBest = { score: timingGame.score, date: faDate() };
    }
    if (coins > 0) addCoins(coins, 'timing');
    save(); render();
    document.getElementById('timing-status').textContent = L('timingWin', {}, timingGame.score);
    sayBubble(L('timingWin', {}, timingGame.score));
    if (window.Rig) window.Rig.celebrate();
    checkQuests();
    checkAchievements();
    setTimeout(function () { document.getElementById('timing-modal').classList.remove('show'); }, 2500);
  }
  function quitTimingGame() {
    if (!timingGame.active) return;
    timingGame.active = false;
    clearInterval(timingGame.timer);
    document.getElementById('timing-modal').classList.remove('show');
    sayBubble(L('starQuit', {}));
  }

  // ---------- v11: toy-ball toss (needs the ball from the shop) ----------
  function tossBall() {
    if (state.sleeping) { sayBubble(L('refuseSleep', {})); return false; }
    if (state.owned.indexOf('ball') === -1) { sayBubble('توپ ندارم! اول از فروشگاه بخر.'); return false; }
    if (Date.now() - state.lastBallAt < 5000) { sayBubble('یه لحظه صبر کن، توپ هنوز داره می‌چرخه!'); return false; }
    state.lastBallAt = Date.now();
    state.counters.gamesPlayed.ball += 1;
    addStat('happiness', 3); addStat('energy', -2); addXP(1);
    addCoins(2, 'ball');
    save(); render();
    if (window.Rig) window.Rig.tossBall();
    sayBubble(L('ballToss', {}));
    checkQuests();
    checkAchievements();
    return true;
  }

  // ---------- v11: quests (5 missions with coin rewards) ----------
  var QUESTS = [
    { id: 'pet10', fa: '۱۰ بار نازش کن', desc: 'سر آستولفو رو ۱۰ بار ناز کن', reward: 15,
      check: function () { return state.counters.pets >= 10; },
      progress: function () { return Math.min(10, state.counters.pets) + '/۱۰'; } },
    { id: 'stars10', fa: 'یه بازی ۱۰ ستاره بگیر', desc: 'تو یه دور ستاره‌بگیر ۱۰ تا ستاره بگیر', reward: 20,
      check: function () { return state.counters.starsBest >= 10; },
      progress: function () { return Math.min(10, state.counters.starsBest) + '/۱۰'; } },
    { id: 'feed3', fa: '۳ وعده غذا بده', desc: '۳ بار به آستولفو غذا بده', reward: 10,
      check: function () { return state.counters.feeds >= 3; },
      progress: function () { return Math.min(3, state.counters.feeds) + '/۳'; } },
    { id: 'level3', fa: 'به سطح ۳ برس', desc: 'محبت آستولفو رو تا سطح ۳ بالا ببر', reward: 25,
      check: function () { return state.level >= 3; },
      progress: function () { return 'سطح ' + toFaDigits(state.level) + '/۳'; } },
    { id: 'playAll', fa: 'هر سه بازی رو امتحان کن', desc: 'ستاره‌بگیر، حافظه و ضربه‌ی دقیق رو یک بار بازی کن', reward: 20,
      check: function () { var g = state.counters.gamesPlayed; return g.star >= 1 && g.memory >= 1 && g.timing >= 1; },
      progress: function () { var g = state.counters.gamesPlayed; return (g.star >= 1 ? 1 : 0) + (g.memory >= 1 ? 1 : 0) + (g.timing >= 1 ? 1 : 0) + '/۳'; } }
  ];
  function questState(id) {
    if (!state.quests[id]) state.quests[id] = { done: false, claimed: false };
    return state.quests[id];
  }
  function checkQuests() {
    var changed = false;
    QUESTS.forEach(function (q) {
      var qs = questState(q.id);
      if (!qs.done && q.check()) { qs.done = true; changed = true; }
    });
    if (changed) save();
  }
  function claimQuest(id) {
    var q = null;
    QUESTS.forEach(function (it) { if (it.id === id) q = it; });
    if (!q) return false;
    var qs = questState(id);
    if (!qs.done || qs.claimed) return false;
    qs.claimed = true;
    addCoins(q.reward, 'quest');
    save(); render();
    sayBubble(L('questDone', {}, q.reward));
    if (window.Rig) window.Rig.celebrate();
    return true;
  }

  // ---------- v11: settings (persisted, applied to the rig) ----------
  function applySettings() {
    if (!window.Rig) return;
    window.Rig.setReducedMotion(!!state.settings.reducedMotion);
    window.Rig.setAutoRotate(state.settings.autoRotate !== false);
  }
  function setSetting(key, value) {
    state.settings[key] = value;
    save();
    applySettings();
    render();
  }

  // ---------- render HUD ----------
  function render() {
    var m = mood();
    // fx3 (audit F8): the sleepy face never showed — setSleepy() had zero
    // callers. The low-energy mood now drives head_sleepy.png.
    // v11: bored also uses the half-lidded face; excited drives the rig's
    // bigger bob + sparkles.
    if (window.Rig) {
      window.Rig.setSleepy(m === 'sleepy' || m === 'bored');
      window.Rig.setExcited(m === 'excited');
    }
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
      // v11: the inventory chip shows every treat owned (cake/tea/cookie).
      var parts = [];
      if (state.cake > 0) parts.push('<img class="ic" src="assets/icons/cake.png" alt="">×' + toFaDigits(state.cake));
      if (state.tea > 0) parts.push('<img class="ic" src="assets/icons/tea.png" alt="">×' + toFaDigits(state.tea));
      if (state.cookie > 0) parts.push('<img class="ic" src="assets/icons/starcookie.png" alt="">×' + toFaDigits(state.cookie));
      if (state.milk > 0) parts.push('<img class="ic" src="assets/icons/milk.png" alt="">×' + toFaDigits(state.milk));
      if (state.candy > 0) parts.push('<img class="ic" src="assets/icons/candy.png" alt="">×' + toFaDigits(state.candy));
      if (state.pudding > 0) parts.push('<img class="ic" src="assets/icons/pudding.png" alt="">×' + toFaDigits(state.pudding));
      cakeEl.innerHTML = parts.join(' ');
      cakeEl.style.display = parts.length > 0 ? '' : 'none';
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
    records: state.records, ACHIEVEMENTS: ACHIEVEMENTS, hasAchievement: hasAchievement,
    checkAchievements: checkAchievements, faDate: faDate, totalGames: totalGames,
    feed: feed, clean: clean, pet: pet, poke: poke, toggleSleep: toggleSleep, wake: wake,
    buy: buy, equip: equip, SHOP: SHOP, FOOD: FOOD, hugPlush: hugPlush, waveWand: waveWand,
    startMiniGame: startMiniGame, miniGameTap: miniGameTap, endMiniGame: endMiniGame, quitMiniGame: quitMiniGame,
    miniGameFrame: miniGameFrame, positionSleepFx: positionSleepFx, showSleepBubble: showSleepBubble,
    idleLine: idleLine, sayBubble: sayBubble, clearBubble: clearBubble, startIdleLines: startIdleLines,
    addCoins: addCoins, addXP: addXP, toFaDigits: toFaDigits, xpForNext: xpForNext,
    startMemoryGame: startMemoryGame, memoryFlip: memoryFlip, quitMemoryGame: quitMemoryGame,
    startTimingGame: startTimingGame, timingTap: timingTap, quitTimingGame: quitTimingGame,
    tossBall: tossBall, QUESTS: QUESTS, questState: questState, checkQuests: checkQuests, claimQuest: claimQuest,
    applySettings: applySettings, setSetting: setSetting, L: L, hourNow: hourNow
  };
})();
