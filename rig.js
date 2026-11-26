/* Rigged 2D pixel character — Spine/Live2D-style, hand-built on canvas.
   Layers (1600x1600 source space): body -> head group (backhair under head,
   then head, blush, accessories). The backhair IS head-parented: it is the
   bob flare behind the head, so it must rotate/lean with the head — drawn
   in body space it stayed behind while the head leaned away, opening a
   cream gap and leaving a detached pink chunk (fx2).
   Bone hierarchy: body root -> neck pivot (800,515) -> head (+braids).
   Head motion: spring-damped physics. Idle bob = translate only, never stretch.
   Pixel style: imageSmoothingEnabled=false, integer draw positions, no recoloring. */
(function () {
  'use strict';

  // v5: the stage is 720x560 (not square) so the phone stage can span the
  // FULL column width and still fit the resting viewport. Smaller sprite
  // (0.25) + lower OY (112) so the head clears the speech bubble even on
  // the short phone stage: hair top (source y=0) sits at canvas y=112,
  // i.e. 20% of stage height; the bubble bottom is ~11%.
  // Beanie is taller (brim above the head), so it gets more OY.
  var S_NORMAL = 0.25, OX_NORMAL = 160, OY_NORMAL = 112;
  var S_BEANIE = 0.236, OX_BEANIE = 171, OY_BEANIE = 168;
  var PIVOT = { x: 800, y: 515 };

  // Measured accessory transforms (head space, 1600 units). See build notes.
  var GLASSES = { scale: 0.287, x: 589, y: 259, w: 435, h: 150 }; // lens centres (452,261)/(1062,261) -> eyes (719,334)/(894,332)
  var STAR_PINK = { scale: 0.113, cx: 657, cy: 195 }; // over left gold clip
  var STAR_BLUE = { scale: 0.113, cx: 962, cy: 182 }; // over right gold clip
  var BEANIE = { scale: 0.622, x: 450, y: -255, w: 700, h: 545 }; // beanie_short.png, brim bottom at y=290

  var VOICE = {
    pet: ['v03_pet.mp3', 'v12_tickle.mp3', 'v10_cute.mp3', 'v11_love.mp3', 'v01_yahoo.mp3'],
    eat: ['v06_best.mp3', 'v01_yahoo.mp3'],
    celebrate: ['v01_yahoo.mp3', 'v02_giggle.mp3', 'v09_knight.mp3'],
    chat: ['v02_giggle.mp3', 'v08_adventure.mp3'],
    poke: ['v07_huh.mp3']
  };

  var POKE_LINES = [
    'هی! قلقلک نده! «هه، قلقلکم میاد!»',
    'اون‌جا نه! دستت رو بکش!',
    'آی! مواظب باش، من یه آدمم نه بالش!',
    'هی هی، دوباره؟ خیلی شیطونی!'
  ];

  var canvas, ctx, W = 720, H = 560;
  var img = {};           // layer images
  var flatOk = false;     // fallback flat avatar loaded?
  var audioCache = {};
  var blipAudio = null;

  var state = {
    accessory: null,      // null | 'beanie' | 'glasses' | 'starclips' (head slot)
    gear: { head: null, neck: null, braid: null, outfit: null, room: null, decor: [] }, // v11: six wear slots (head/neck/braid single, outfit single, room theme single, decor multi)
    sleeping: false,
    moodSleepy: false,    // game sets this from mood (tired)
    excited: false,       // v11: game sets this from mood (excited) — bigger bob + sparkles
    happyUntil: 0,        // timestamp: eyes closed happy
    bathUntil: 0,
    celebrateUntil: 0,
    annoyedUntil: 0,      // v11: timestamp: angry brows + vein (body-touch warning)
    squash: 0,            // 0..1 squash-and-stretch (pet/celebrate), decays fast
    blush: 0,             // 0..1 current blush alpha
    blushTarget: 0,
    muted: false,
    reducedMotion: false, // v11: settings — no bob/squash/particles
    autoRotate: true,     // v11: settings — drag look-at on/off
    ready: false
  };

  // Day/night bird (v11): a pixel bird crosses the window pane every
  // 40–90s during the day. State lives outside `state` (not persisted).
  var bird = { active: false, x: -30, y: 70, nextAt: 0 };

  // Spring physics (head), in canvas px / radians.
  var spring = {
    angle: 0, angVel: 0, angTarget: 0,
    dx: 0, dxVel: 0, dxTarget: 0,
    dy: 0, dyVel: 0, dyTarget: 0
  };
  var bobPhase = 0;
  var lastT = 0;

  // Blink cycle.
  var blinkAt = 0, blinkUntil = 0;

  // Particles: {type:'heart'|'bubble'|'spark', x,y,vx,vy,life,maxLife,size,rot,vr}
  var particles = [];
  var zzzTimer = null, bathTimer = null;
  // v11: toy-ball toss — one ball at a time, gravity + one platform bounce.
  var ball = { active: false, x: 0, y: 0, vx: 0, vy: 0, t0: 0 };
  // v11: toy actions — plush bunny / star wand held at the chest for 4s.
  var toy = { kind: null, until: 0 };

  // Pointer tracking.
  var ptr = { down: false, sx: 0, sy: 0, cx: 0, cy: 0, t: 0, dragging: false };

  function layout() {
    if (state.accessory === 'beanie') return { s: S_BEANIE, ox: OX_BEANIE, oy: OY_BEANIE };
    return { s: S_NORMAL, ox: OX_NORMAL, oy: OY_NORMAL };
  }
  function toCanvasX(x) { var L = layout(); return L.ox + x * L.s; }
  function toCanvasY(y) { var L = layout(); return L.oy + y * L.s; }
  function toSrcX(cx) { var L = layout(); return (cx - L.ox) / L.s; }
  function toSrcY(cy) { var L = layout(); return (cy - L.oy) / L.s; }

  // v11: day/night cycle. Hour source, in order: the test override
  // window.ASTOLFO_HOUR (verify only), the user's settings dayNight
  // ('day'/'night' force a fixed hour), else the real clock.
  function dayPart() {
    var h;
    if (typeof window.ASTOLFO_HOUR === 'number') h = window.ASTOLFO_HOUR;
    else if (window.Game && window.Game.state && window.Game.state.settings) {
      var dn = window.Game.state.settings.dayNight;
      if (dn === 'day') h = 12;
      else if (dn === 'night') h = 22;
      else h = new Date().getHours();
    } else h = new Date().getHours();
    if (h >= 7 && h < 17) return 'day';
    if (h >= 17 && h < 19) return 'dusk';
    return 'night';
  }

  function loadImage(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function loadVoice(name) {
    var a = new Audio('assets/voice/' + name);
    a.preload = 'auto';
    a.load();
    audioCache[name] = a;
    return a;
  }

  function playVoice(name) {
    if (state.muted) return;
    var a = audioCache[name];
    if (!a) return;
    try { a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function playRandom(pool) {
    if (!pool || !pool.length) return;
    playVoice(pool[Math.floor(Math.random() * pool.length)]);
  }

  function speak(text) {
    // Use the game's bubble (speech-bubble, 4s auto-hide) so timing stays consistent.
    if (window.Game && window.Game.sayBubble) { window.Game.sayBubble(text); return; }
    var b = document.getElementById('speech-bubble');
    if (b) { b.textContent = text; b.classList.add('show'); }
  }

  function inHead(x, y) {
    var ex = (x - 800) / 330, ey = (y - 300) / 300;
    if (ex * ex + ey * ey <= 1) return true;
    if (x >= 588 && x <= 703 && y >= 506 && y <= 721) return true;  // left braid
    if (x >= 898 && x <= 1012 && y >= 506 && y <= 721) return true; // right braid
    return false;
  }
  function inBody(x, y) {
    // Two boxes from the measured body.png silhouette (fx3, audit F11):
    // the old single box (x 303-1296, y 0-1599) had a vacuous y >= 0, so
    // taps on the window, poster, shelf, checker floor and the empty wall
    // beside the torso all poked him. Torso core + arms/hips flare, both
    // cut off at the platform top (source y 1448) so floor taps don't poke.
    if (x >= 460 && x <= 1140 && y >= 490 && y <= 1448) return true; // torso core
    if (x >= 330 && x <= 1270 && y >= 1050 && y <= 1448) return true; // arms + hips flare
    return false;
  }

  // ---------- particles ----------
  function spawnHeart(n, cx, cy) {
    // High-contrast hearts (white / hot pink / gold, all black-outlined) so they
    // read on pink hair AND on the wall — never pale pink on pink.
    // Hearts fade: full opacity for the first 70% of life, then a quick
    // fade — no long semi-transparent smudge phase on the cream wall.
    for (var i = 0; i < n; i++) {
      var r = Math.random();
      var color = r < 0.4 ? '#ffffff' : (r < 0.75 ? '#ff5d8f' : '#ffd94a');
      particles.push({
        type: 'heart', x: cx + (Math.random() - 0.5) * 90, y: cy + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 14, vy: -(26 + Math.random() * 30),
        life: 0, maxLife: 1.2 + Math.random() * 0.5, size: 12 + Math.random() * 10,
        rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 1.2,
        color: color
      });
    }
  }
  function spawnBubble(n) {
    // v11: bubbles spread over the WHOLE body (shoulders and head too) —
    // the old y 420-470 band clustered them all at the waist/shorts
    // (Gemini round 10). Canvas coords: body spans y ~112-490.
    for (var i = 0; i < n; i++) {
      particles.push({
        type: 'bubble', x: 110 + Math.random() * 500, y: 150 + Math.random() * 320,
        vx: (Math.random() - 0.5) * 10, vy: -(20 + Math.random() * 26),
        life: 0, maxLife: 2.2 + Math.random(), size: 8 + Math.random() * 16,
        rot: 0, vr: 0, color: '#ffffff'
      });
    }
  }
  function spawnSpark(n, cx, cy) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 70;
      particles.push({
        type: 'spark', x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: 0, maxLife: 0.9 + Math.random() * 0.5, size: 8 + Math.random() * 10,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 4, color: '#ffd94a'
      });
    }
  }
  // v10: soap bubbles as PIXEL art — a stepped circle with a dark-blue
  // outline and a light-blue fill, so they read on the cream wall and the
  // white hoodie. The old smooth white ring was nearly invisible there.
  function drawPixelBubble(x, y, r) {
    var cell = Math.max(2, Math.round(r / 5));
    var rows = Math.ceil((2 * r) / cell), i, dy, hw;
    ctx.fillStyle = '#1e5f8a'; // outline: same stepped shape, 1 cell larger
    for (i = -1; i <= rows; i++) {
      dy = (i + 0.5) * cell - r;
      hw = Math.sqrt(Math.max(0, (r + cell) * (r + cell) - dy * dy));
      ctx.fillRect(Math.round(x - hw), Math.round(y - r + i * cell), Math.round(2 * hw), cell);
    }
    ctx.fillStyle = '#a8d8f0'; // light-blue fill
    for (i = 0; i < rows; i++) {
      dy = (i + 0.5) * cell - r;
      hw = Math.sqrt(Math.max(0, r * r - dy * dy));
      ctx.fillRect(Math.round(x - hw), Math.round(y - r + i * cell), Math.round(2 * hw), cell);
    }
    ctx.fillStyle = '#ffffff'; // white pixel highlight, upper-left
    ctx.fillRect(Math.round(x - r * 0.45), Math.round(y - r * 0.55), Math.max(2, cell), Math.max(2, cell));
  }
  // Zzz as DOM canvases inside #sleep-fx, ABOVE the veil (fx3, audit F7; v9):
  // the canvas 'Z' particles were invisible — the stage is dimmed to 45%
  // AND the 55%-opaque veil sits on top, crushing a purple Z to near zero
  // contrast. A white bold Z with a black shadow on the dark veil reads.
  // v9: the old spans lived in #sleep-veil at %-of-viewport positions and
  // were fully opaque for only ~0.4s of a 2.6s life with 2.2s spawns, so
  // screenshots kept catching zero visible Zs. Now they spawn into
  // #sleep-fx at the head's screen position (from the stage rect) and
  // stay fully opaque until 60% of the animation (see style.css).
  // v10: the Z is a PIXEL Z, not a smooth font glyph — a 6x5 box-shadow
  // grid (white cells, 1-cell black outline), so it matches the pixel art
  // instead of clashing with it. The span itself is one 6px cell; every
  // other cell is a box-shadow offset from it.
  // v11: the box-shadow outline was a full 6px cell thick, so the Zs read
  // as heavy black-and-white tiles on the hair, and two still overlapped
  // on the phone (Gemini round 10). The Z is now PAINTED on a tiny canvas
  // (pixel rects) so the black outline is exactly 1px, and Zs spawn ONLY
  // in the top-right corner OUTSIDE the hair frame (never mid-forehead).
  var ZGRID = ['11111', '00001', '00010', '00100', '01000', '11111'];
  function paintPixelZ(cv) {
    var cell = +cv.dataset.cell || 5;
    var c = cv.getContext('2d');
    cv.width = 5 * cell + 2; cv.height = 6 * cell + 2;
    var r, col;
    // black outline: every filled cell expanded by 1px, then white on top
    c.fillStyle = '#1a1a1a';
    for (r = 0; r < 6; r++) for (col = 0; col < 5; col++) {
      if (ZGRID[r].charAt(col) !== '1') continue;
      c.fillRect(1 + col * cell - 1, 1 + r * cell - 1, cell + 2, cell + 2);
    }
    c.fillStyle = '#ffffff';
    for (r = 0; r < 6; r++) for (col = 0; col < 5; col++) {
      if (ZGRID[r].charAt(col) !== '1') continue;
      c.fillRect(1 + col * cell, 1 + r * cell, cell, cell);
    }
  }
  var lastZzzX = null; // v10: consecutive Zs must not land on top of each other
  function spawnZzz() {
    var fx = document.getElementById('sleep-fx');
    var wrap = document.getElementById('stage-wrap');
    if (!fx || !wrap) return;
    var r = wrap.getBoundingClientRect();
    var narrow = r.width < 500;
    var cell = narrow ? 4 : 5; // 22px / 27px wide Z — smaller on the phone
    var z = document.createElement('canvas');
    z.className = 'zzz-float';
    z.dataset.cell = cell;
    paintPixelZ(z);
    // Top strip BETWEEN the window and the framed poster, above the hair:
    // the window ends at ~26% of the stage width and the poster (canvas
    // x 556-684 = 77-95%, y 28-124) starts at ~77%, while the hair top
    // sits ~24% down — so Zs live in the 30-72% band, 10-16% down.
    // v12: the old 78-95% band sat EXACTLY on the poster — every Z
    // overlapped its right edge (desktop gp-06, phone gp-11) and the
    // widest Z clipped at the stage's top-right corner (gp-11).
    var top = Math.round(r.top + r.height * (0.10 + Math.random() * 0.06));
    // v11: spawn at 10-16% of stage height (was 4-10%) and cap the rise
    // at 50px AND at the distance to the stage top, so a Z never leaves
    // the stage: the old 70px rise carried a Z half off the top edge
    // (gp-05-sleep-desktop). `top` is viewport-absolute (#sleep-fx is
    // position:fixed), so the stage-top distance is top - r.top — a bare
    // `top - 4` would be hundreds of px and would not cap anything on
    // the phone, where the spawn sits only ~28-45px below the stage top.
    var rise = Math.max(0, Math.min(50, top - r.top - 4));
    /* v9: while the sleep bubble is shown it sits at the stage top, and on
       short phone stages the head (hence the Z spawn band) is right under
       it — a rising Z used to drift up through the bubble text. Clamp the
       spawn below the bubble's bottom edge and cap the rise so a Z never
       crosses it. Once the bubble hides, the full 70px rise applies. */
    var bub = document.getElementById('sleep-bubble');
    if (bub && bub.classList.contains('show')) {
      var floor = bub.getBoundingClientRect().bottom + 6;
      if (top < floor + 4) top = Math.round(floor + 4);
      rise = Math.max(0, Math.min(50, top - floor, top - r.top - 4));
    }
    // v11: the gap must exceed the Z's own width (22px narrow / 27px wide).
    // Check against ALL live Zs, not just the last one: with a 1400ms spawn
    // interval and a 3000ms life, up to 3 Zs coexist, so a new Z can land
    // on top of an older one that is not the most recent. If every
    // candidate is too close, skip this round rather than overlap.
    var minGap = narrow ? 32 : 40;
    var liveX = [];
    var kids = fx.querySelectorAll('.zzz-float');
    for (var k = 0; k < kids.length; k++) {
      var lx = parseFloat(kids[k].style.left);
      if (!isNaN(lx)) liveX.push(lx);
    }
    var zx = Math.round(r.left + r.width * (0.30 + Math.random() * 0.42));
    var okSpot = false;
    for (var t = 0; t < 10; t++) {
      okSpot = true;
      for (var j = 0; j < liveX.length; j++) {
        if (Math.abs(zx - liveX[j]) < minGap) { okSpot = false; break; }
      }
      if (okSpot) break;
      zx = Math.round(r.left + r.width * (0.30 + Math.random() * 0.42));
    }
    if (!okSpot) return;
    lastZzzX = zx;
    z.style.left = zx + 'px';
    z.style.top = top + 'px';
    z.style.setProperty('--zzz-rise', (-rise) + 'px');
    fx.appendChild(z);
    setTimeout(function () { if (z.parentNode) z.parentNode.removeChild(z); }, 3000);
  }

  function drawHeart(x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s * 0.6, -s * 0.25, -s * 0.3, -s * 0.8, 0, -s * 0.3);
    ctx.bezierCurveTo(s * 0.3, -s * 0.8, s * 0.6, -s * 0.25, 0, s * 0.35);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawSpark(x, y, s, color, rot) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -s); ctx.quadraticCurveTo(0, 0, s, 0); ctx.quadraticCurveTo(0, 0, 0, s);
    ctx.quadraticCurveTo(0, 0, -s, 0); ctx.quadraticCurveTo(0, 0, 0, -s);
    ctx.fill();
    ctx.restore();
  }

  // ---------- animation triggers (called by game.js / chat.js) ----------
  function pet(cx, cy) { // canvas coords of the touch point (or null = centre of head)
    var hx = cx != null ? cx : toCanvasX(800);
    var hy = cy != null ? cy : toCanvasY(300);
    var now = performance.now();
    state.happyUntil = now + 1500; // long enough to read (and to survive screenshot latency)
    state.squash = 1; // squash-and-stretch: visible in a still frame
    state.blushTarget = 1;
    setTimeout(function () { state.blushTarget = 0; }, 1600);
    // Spring impulse: lean toward the touch point.
    var dirx = Math.max(-1, Math.min(1, (hx - toCanvasX(800)) / 200));
    spring.angVel += dirx * 1.6 + (Math.random() - 0.5) * 0.2;
    spring.dxVel += dirx * 60;
    spring.dyVel += -70;
    // Hearts fly BESIDE the head, over the wall — never on the pink hair.
    spawnHeart(4, hx - 110, hy - 20);
    spawnHeart(3, hx + 110, hy - 20);
    playRandom(VOICE.pet);
    // v11: pet lines come from the shuffle-bag pools (Lines.next) — the
    // single hardcoded line was the owner's core complaint.
    speak(window.Lines ? window.Lines.next('pet') : 'یاهو! ناز شدم!');
  }

  function eat() {
    var now = performance.now();
    state.happyUntil = now + 700;
    spring.dyVel += -60; spring.dxVel += (Math.random() - 0.5) * 30;
    spawnHeart(4, toCanvasX(800), toCanvasY(420));
    playRandom(VOICE.eat);
  }

  function bath() {
    var now = performance.now();
    state.bathUntil = now + 4000;
    state.happyUntil = now + 1200;
    spawnBubble(10); spawnSpark(5, toCanvasX(800), toCanvasY(700));
    if (bathTimer) clearInterval(bathTimer);
    bathTimer = setInterval(function () {
      if (performance.now() > state.bathUntil) { clearInterval(bathTimer); bathTimer = null; return; }
      spawnBubble(3); spawnSpark(1, toCanvasX(700 + Math.random() * 200), toCanvasY(500 + Math.random() * 400));
    }, 450);
  }

  // v11: toy-ball toss — a pixel ball arcs across the stage, bounces once
  // on the platform, and Astolfo jumps for it. Ball state is integrated in
  // frame(); the draw is a stepped pixel disc (gold with a pink band).
  function tossBall() {
    var now = performance.now();
    ball.active = true;
    ball.x = 120; ball.y = 430; ball.vx = 340; ball.vy = -560; ball.t0 = now; // v11: stronger arc (was -420) — the old toss barely left the hand
    state.happyUntil = now + 1200;
    state.squash = 1;
    state.blushTarget = 1;
    setTimeout(function () { state.blushTarget = 0; }, 1600);
    spring.dyVel += -140;
    spawnHeart(3, toCanvasX(800), toCanvasY(300));
  }
  function drawPixelDisc(x, y, r, color) {
    var cell = Math.max(2, Math.round(r / 5));
    var rows = Math.ceil((2 * r) / cell), i, dy, hw;
    ctx.fillStyle = color;
    for (i = 0; i < rows; i++) {
      dy = (i + 0.5) * cell - r;
      hw = Math.sqrt(Math.max(0, r * r - dy * dy));
      ctx.fillRect(Math.round(x - hw), Math.round(y - r + i * cell), Math.round(2 * hw), cell);
    }
  }
  function drawBall(x, y, r) {
    // Gold ball, black stepped outline, pink band across the middle.
    drawPixelDisc(x, y, r + 2, '#1a1a1a');
    drawPixelDisc(x, y, r, '#ffd94a');
    ctx.fillStyle = '#ff5d8f';
    ctx.fillRect(Math.round(x - r * 0.8), Math.round(y - 3), Math.round(r * 1.6), 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(x - r * 0.5), Math.round(y - r * 0.6), 5, 5);
  }

  // v11: annoyed face for the body-touch warning — angry brows slanting
  // down toward the nose + a pink anger vein at the right temple. Drawn
  // in head space (inside the head group) so it moves with the head.
  // Source coords: eyes at (719,334) / (894,332); brows sit on the skin
  // above them (y 282-304); vein at the right temple (985,255).
  function drawAnnoyed(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    // Left brow: steps descending toward the nose (inner end lower).
    R(668, 282, 30, 10); R(696, 286, 30, 10); R(724, 290, 30, 10); R(750, 294, 22, 10);
    // Right brow: mirrored.
    R(850, 294, 22, 10); R(872, 290, 30, 10); R(902, 286, 30, 10); R(930, 282, 30, 10);
    // Anger vein: black outline cross, pink inner cross, right temple.
    ctx.fillStyle = '#1a1a1a';
    R(981, 241, 12, 34); R(970, 252, 34, 12);
    ctx.fillStyle = '#ff5d8f';
    R(984, 244, 6, 28); R(973, 255, 28, 6);
  }
  function annoyed() {
    var now = performance.now();
    state.annoyedUntil = now + 1600;
    spring.angVel += (Math.random() - 0.5) * 0.4;
    playRandom(VOICE.poke);
  }
  // v11: procedural pixel scarf (neck slot) — pink band with a gold stripe,
  // a knot at the right, two tails down the chest. Body space (source px).
  function drawScarf(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(636, 474, 328, 72); R(876, 540, 48, 130); R(924, 540, 44, 92); // outlines
    ctx.fillStyle = '#ff5d8f';
    R(642, 480, 316, 60); R(882, 546, 36, 118); R(930, 546, 32, 80); // pink band + tails
    ctx.fillStyle = '#ffd94a';
    R(642, 502, 316, 12); R(882, 640, 36, 8); R(930, 604, 32, 8); // gold stripe + tail tips
    ctx.fillStyle = '#1a1a1a';
    R(900, 496, 44, 44); // knot outline
    ctx.fillStyle = '#ff8fb3';
    R(906, 502, 32, 32); // knot
  }
  // v11: procedural pixel bow (braid slot) — two wings + knot on the upper
  // right braid. Head space (source px), moves with the head.
  // v11: procedural pixel bow (braid slot) — two wings + knot on the upper
  // right braid. Head space (source px), moves with the head. The braid
  // runs x 898-1012, y 506-721 (see the hit-test regions), so the bow sits
  // centred on it at its very top (x 897-1013, y 505-545): high enough to
  // read as a hair bow, not a bow tie at the neck.
  function drawBow(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(897, 505, 56, 40); R(957, 505, 56, 40); R(941, 511, 22, 28); // outlines
    ctx.fillStyle = '#ff5d8f';
    R(901, 509, 48, 32); R(961, 509, 48, 32); // pink wings
    ctx.fillStyle = '#ff8fb3';
    R(944, 512, 16, 22); // knot
  }

  // ---------- v11 shop expansion: head slot (head group, after head image) ----------
  // Gold crown on the hair top (x 680-940, y 235-310): three stepped
  // points + pink gems on the band. The band bottom (y 310) overlaps the
  // hair fringe, so the crown sits ON the hair, never floating above it.
  function drawCrown(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(688, 268, 44, 18); R(696, 254, 28, 14); R(704, 242, 12, 12); // left point
    R(782, 262, 56, 24); R(792, 248, 36, 14); R(802, 236, 16, 12); // middle point
    R(888, 268, 44, 18); R(896, 254, 28, 14); R(904, 242, 12, 12); // right point
    R(680, 284, 260, 26); // band outline
    ctx.fillStyle = '#ffd94a';
    R(692, 272, 36, 14); R(700, 258, 20, 14); R(707, 246, 6, 12);
    R(786, 266, 48, 20); R(796, 252, 28, 14); R(805, 240, 10, 12);
    R(892, 272, 36, 14); R(900, 258, 20, 14); R(907, 246, 6, 12);
    R(686, 290, 248, 14); // band
    ctx.fillStyle = '#ff5d8f'; // pink gems on the band
    R(716, 292, 10, 10); R(795, 292, 10, 10); R(874, 292, 10, 10);
  }
  // Pink cat ears at the hair top sides: stepped triangles, pink outside,
  // lighter-pink inner ear. Left x 600-700, right x 900-1000, y 210-310.
  // Cat ears: BIG stepped triangles whose tips poke ABOVE the hair
  // silhouette at the upper corners (hair top at x 552-578 is y ~150-185,
  // so the tip band y 95-115 clears it by 35-90px). The first version sat
  // at y 214-310, fully inside the pink hair mass, and read as a hair
  // tuft. Thick black outline + light-pink inner so the ears read at
  // full-stage size, not only at zoom.
  function drawCatEars(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a'; // outline, left
    R(552, 95, 26, 20); R(542, 115, 50, 25); R(532, 140, 76, 30); R(522, 170, 100, 30);
    R(512, 200, 126, 40); R(502, 240, 150, 35); R(492, 275, 170, 25);
    ctx.fillStyle = '#1a1a1a'; // outline, right (mirror about x=800)
    R(1022, 95, 26, 20); R(1008, 115, 50, 25); R(992, 140, 76, 30); R(978, 170, 100, 30);
    R(962, 200, 126, 40); R(948, 240, 150, 35); R(938, 275, 170, 25);
    ctx.fillStyle = '#ff5d8f'; // fill, left
    R(560, 101, 10, 14); R(550, 121, 34, 19); R(540, 146, 60, 24); R(530, 176, 84, 24);
    R(520, 206, 110, 34); R(510, 246, 134, 29); R(500, 281, 154, 19);
    ctx.fillStyle = '#ff5d8f'; // fill, right
    R(1030, 101, 10, 14); R(1016, 121, 34, 19); R(1000, 146, 60, 24); R(986, 176, 84, 24);
    R(970, 206, 110, 34); R(956, 246, 134, 29); R(946, 281, 154, 19);
    ctx.fillStyle = '#ff8fb3'; // inner ear, left + right
    R(540, 176, 40, 24); R(534, 206, 52, 34); R(528, 246, 64, 29);
    R(1020, 176, 40, 24); R(1014, 206, 52, 34); R(1008, 246, 64, 29);
  }
  // Long bunny ears: white outside, pink inner. The tips reach source
  // y -60 — the hair top at x 640-670 is y 25-51, so the ears break the
  // silhouette by ~20 stage px and read as LONG bunny ears, not white
  // clips. (The y 10 version only cleared the hair by ~4px and still
  // read as tabs sitting on the fringe.)
  function drawBunnyEars(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(645, -60, 20, 30); R(638, -30, 34, 40); R(632, 10, 46, 35); R(620, 45, 70, 265);
    R(935, -60, 20, 30); R(928, -30, 34, 40); R(922, 10, 46, 35); R(910, 45, 70, 265);
    ctx.fillStyle = '#ffffff';
    R(649, -55, 12, 25); R(642, -25, 26, 35); R(637, 15, 36, 30); R(626, 50, 58, 255);
    R(939, -55, 12, 25); R(932, -25, 26, 35); R(927, 15, 36, 30); R(916, 50, 58, 255);
    ctx.fillStyle = '#ff8fb3'; // pink inner
    R(644, 60, 22, 240); R(934, 60, 22, 240);
  }
  // Flower crown: 5 small plus-petal flowers across the hairline.
  // Petals are WHITE and GOLD only — the first version's pink petals
  // vanished into the pink hair. Slightly bigger (26px) so the crown
  // reads at full-stage size.
  function drawFlowerCrown(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    var flowers = [
      { cx: 650, cy: 312, c: '#ffffff', dot: '#ff5d8f' },
      { cx: 730, cy: 306, c: '#ffd94a', dot: '#ff5d8f' },
      { cx: 810, cy: 302, c: '#ffffff', dot: '#ffd94a' },
      { cx: 890, cy: 306, c: '#ffd94a', dot: '#ff5d8f' },
      { cx: 960, cy: 312, c: '#ffffff', dot: '#ff5d8f' }
    ];
    for (var i = 0; i < flowers.length; i++) {
      var f = flowers[i], cx = f.cx, cy = f.cy;
      ctx.fillStyle = '#1a1a1a';
      R(cx - 13, cy - 6, 26, 12); R(cx - 6, cy - 13, 12, 26); // plus outline
      ctx.fillStyle = f.c;
      R(cx - 10, cy - 4, 20, 8); R(cx - 4, cy - 10, 8, 20); // petals
      ctx.fillStyle = f.dot;
      R(cx - 4, cy - 4, 8, 8); // centre dot
    }
  }
  // Pink sleep mask band (x 660-950, y 295-365) covering BOTH eyes fully
  // (eyes 686-932, y 306-354), black outline, small gold star at the
  // right end. Unlike glasses it MUST still show while sleeping — it is a
  // sleep aid — so it is never gated by state.sleeping.
  function drawSleepMask(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(660, 295, 290, 70); // outline
    ctx.fillStyle = '#ff5d8f';
    R(666, 301, 278, 58); // pink band
    ctx.fillStyle = '#ff8fb3';
    R(666, 301, 278, 10); // light-pink top stripe
    ctx.fillStyle = '#1a1a1a'; // gold star at the right end (4-point)
    R(913, 312, 26, 36); R(907, 321, 38, 18);
    ctx.fillStyle = '#ffd94a';
    R(916, 315, 20, 30); R(910, 324, 32, 12);
    ctx.fillStyle = '#ffffff';
    R(922, 324, 8, 8);
  }

  // ---------- v11 shop expansion: neck slot (head group, after head image) ----------
  // Thin gold chain in a V (700,600)->(800,680)->(900,600) with a gold
  // star pendant at (800,680-720). Drawn in the head group so it moves
  // with the head; it lies on the chest, over the body image.
  function drawNecklaceGold(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    function chain(x0, y0, x1, y1) {
      var n = 12, i, t, x, y;
      ctx.fillStyle = '#1a1a1a';
      for (i = 0; i <= n; i++) {
        t = i / n; x = Math.round(x0 + (x1 - x0) * t); y = Math.round(y0 + (y1 - y0) * t);
        R(x - 4, y - 3, 8, 6);
      }
      ctx.fillStyle = '#ffd94a';
      for (i = 0; i <= n; i++) {
        t = i / n; x = Math.round(x0 + (x1 - x0) * t); y = Math.round(y0 + (y1 - y0) * t);
        R(x - 2, y - 1, 4, 3);
      }
    }
    chain(700, 600, 800, 680);
    chain(800, 680, 900, 600);
    ctx.fillStyle = '#1a1a1a'; // connector loop
    R(794, 672, 12, 12);
    ctx.fillStyle = '#ffd94a';
    R(797, 675, 6, 6);
    ctx.fillStyle = '#1a1a1a'; // star pendant (4-point)
    R(792, 682, 16, 40); R(780, 694, 40, 16);
    ctx.fillStyle = '#ffd94a';
    R(795, 685, 10, 34); R(783, 697, 34, 10);
    ctx.fillStyle = '#ffffff';
    R(797, 699, 6, 6);
  }
  // White pearl dots along the same V path + a slightly bigger pearl
  // pendant at the bottom (800,688). White-on-white is unreadable on
  // the hoodie, so the pearls sit on a thin gold chain (the V reads
  // even where a pearl blends in) and the pendant has a gold ring.
  function drawNecklacePearl(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    function chain(x0, y0, x1, y1) {
      var n = 12, i, t, x, y;
      ctx.fillStyle = '#e8a91c';
      for (i = 0; i <= n; i++) {
        t = i / n; x = Math.round(x0 + (x1 - x0) * t); y = Math.round(y0 + (y1 - y0) * t);
        R(x - 3, y - 2, 6, 4);
      }
    }
    chain(700, 600, 800, 680);
    chain(800, 680, 900, 600);
    function pearls(x0, y0, x1, y1) {
      var n = 7, i, t, x, y;
      for (i = 0; i <= n; i++) {
        t = i / n; x = Math.round(x0 + (x1 - x0) * t); y = Math.round(y0 + (y1 - y0) * t);
        ctx.fillStyle = '#1a1a1a'; R(x - 7, y - 7, 14, 14);
        ctx.fillStyle = '#ffffff'; R(x - 5, y - 5, 10, 10);
        ctx.fillStyle = '#a8d8f0'; R(x - 4, y - 4, 3, 3); // tiny blue shine
      }
    }
    pearls(700, 600, 800, 680);
    pearls(800, 680, 900, 600);
    ctx.fillStyle = '#ffd94a'; // gold ring around the pendant pearl
    R(788, 680, 24, 24);
    ctx.fillStyle = '#1a1a1a';
    R(790, 682, 20, 20);
    ctx.fillStyle = '#ffffff';
    R(793, 685, 14, 14);
    ctx.fillStyle = '#a8d8f0';
    R(795, 687, 4, 4);
  }
  // Pink bow tie at the neck centre (800,545): wide wings x 740-860,
  // y 530-575 + knot. Distinct from the braid bow (smaller, on the hair).
  function drawBowtie(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a'; // wings: trapezoids, wide at the outer edge
    R(744, 530, 48, 8); R(740, 538, 54, 28); R(744, 566, 48, 9);
    R(808, 530, 48, 8); R(806, 538, 54, 28); R(808, 566, 48, 9);
    ctx.fillStyle = '#ff5d8f';
    R(748, 534, 40, 4); R(745, 542, 46, 20); R(748, 566, 40, 5);
    R(812, 534, 40, 4); R(809, 542, 46, 20); R(812, 566, 40, 5);
    ctx.fillStyle = '#1a1a1a'; // knot
    R(788, 536, 24, 34);
    ctx.fillStyle = '#ff8fb3';
    R(792, 540, 16, 26);
    ctx.fillStyle = '#ffd94a'; // gold centre dot
    R(797, 549, 6, 8);
  }

  // ---------- v11 shop expansion: braid slot (head group) ----------
  // Gold stars (36x36) at BOTH braid ends, over the sprite's own pink
  // ties: left centre (645,708), right centre (955,708).
  function drawStarTies(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    function star(cx, cy) {
      ctx.fillStyle = '#1a1a1a';
      R(cx - 5, cy - 18, 10, 36); R(cx - 18, cy - 5, 36, 10);
      ctx.fillStyle = '#ffd94a';
      R(cx - 3, cy - 15, 6, 30); R(cx - 15, cy - 3, 30, 6);
      ctx.fillStyle = '#ffffff';
      R(cx - 2, cy - 2, 4, 4);
    }
    star(645, 708); star(955, 708);
  }
  // Small blue ribbons (two loops + knot, 48x32) at both braid ends.
  function drawRibbonBlue(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    function ribbon(cx, cy) {
      ctx.fillStyle = '#1a1a1a';
      R(cx - 24, cy - 14, 20, 28); R(cx + 4, cy - 14, 20, 28); R(cx - 6, cy - 8, 12, 16);
      ctx.fillStyle = '#7ec8ff';
      R(cx - 20, cy - 10, 14, 20); R(cx + 7, cy - 10, 14, 20);
      ctx.fillStyle = '#a8d8f0';
      R(cx - 3, cy - 5, 6, 10);
    }
    ribbon(645, 708); ribbon(955, 708);
  }
  // Gold bell (dome + bottom band + slit + highlight) on the right braid
  // top, centred ~(955,520).
  // Gold bell on the right braid top, centred (955,520). Enlarged to
  // 72x64 (was 42x44 — a gold speck at full-stage size) with a clear
  // dome, dark band, clapper slit and highlight.
  function drawBell(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(927, 492, 56, 12); R(923, 504, 64, 12); R(921, 516, 68, 14); R(919, 530, 72, 12); // dome
    R(919, 542, 72, 14); // bottom band
    ctx.fillStyle = '#ffd94a';
    R(932, 496, 46, 8); R(928, 508, 54, 8); R(926, 520, 58, 10);
    R(924, 534, 62, 4); R(924, 546, 62, 6);
    ctx.fillStyle = '#1a1a1a'; // slit
    R(951, 536, 8, 14);
    ctx.fillStyle = '#ffffff'; // highlight
    R(936, 500, 10, 8);
  }

  // ---------- v11 shop expansion: outfit slot (body space, AFTER body image) ----------
  // Flowing pink cape: TWO panels hanging from the shoulders, flaring
  // wider toward the hem. v12 rewrite — the v11 panels read as two flat
  // pink columns (gp-32): only 4 big steps, so the outer edge was three
  // horizontal shelves; the fold lines were near-vertical (reinforcing
  // "column"); the fill was one flat pink. Now: 8 small steps per panel
  // so the outer edge reads as ONE smooth diagonal; a darker shade strip
  // down the outer edge + a light highlight strip down the inner edge
  // (the panel curls, it is not a flat board); TWO clearly diagonal folds
  // per panel (upper-inner -> lower-outer), dark #c22e5f; a darker hem
  // band; the collar band is a distinctly darker pink with a big gold
  // clasp. v12b: the per-step full-rect outline left a black seam at
  // every step boundary (visible as stacked blocks at 3x zoom) — the
  // outline is now only on the vertical edges + one top/bottom band.
  // The panels keep the old x-ranges, so the checkered sleeves stay
  // visible at the sides and the white hoodie shows through the middle gap.
  function drawCape(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    // [yTop, xOuter, xInner] per step, left panel; the right panel is the
    // mirror around x=800. Outer edge: 600 -> 430 (smooth diagonal flare);
    // inner edge stays ~668-684 (the hoodie gap stays open).
    var steps = [
      [620, 600, 668], [710, 580, 670], [800, 560, 672], [890, 540, 674],
      [980, 518, 676], [1070, 496, 678], [1160, 474, 680], [1250, 452, 682],
      [1340, 430, 684]
    ];
    var mirror = function (x) { return 1600 - x; };
    var panel = function (flip) {
      var i, y0, y1, xo, xi;
      var X = function (x) { return flip ? mirror(x) : x; };
      for (i = 0; i < steps.length; i++) {
        y0 = steps[i][0];
        y1 = (i + 1 < steps.length) ? steps[i + 1][0] : 1350;
        xo = steps[i][1]; xi = steps[i][2];
        var x0 = Math.min(X(xo), X(xi)), x1 = Math.max(X(xo), X(xi));
        // v12b: outline ONLY the vertical edges of each step. The v12
        // outline (a full rect expanded 6px per step) left a black seam
        // at every step boundary, so the panel read as stacked blocks.
        ctx.fillStyle = '#1a1a1a';
        R(x0 - 6, y0, 6, y1 - y0);
        R(x1, y0, 6, y1 - y0);
        // panel fill
        ctx.fillStyle = '#ff5d8f';
        R(x0, y0, x1 - x0, y1 - y0);
        // outer-edge shade (the panel curls away from the light) + inner
        // highlight (the edge catching the light) — the drape cue.
        ctx.fillStyle = '#e84a7f';
        if (flip) R(x1 - 24, y0, 24, y1 - y0); else R(x0, y0, 24, y1 - y0);
        ctx.fillStyle = '#ff8fb3';
        if (flip) R(x0, y0, 14, y1 - y0); else R(x1 - 14, y0, 14, y1 - y0);
      }
      // top + bottom edge outlines (single bands, not per-step).
      var tx0 = Math.min(X(steps[0][1]), X(steps[0][2])), tx1 = Math.max(X(steps[0][1]), X(steps[0][2]));
      var bx0 = Math.min(X(steps[8][1]), X(steps[8][2])), bx1 = Math.max(X(steps[8][1]), X(steps[8][2]));
      ctx.fillStyle = '#1a1a1a';
      R(tx0 - 6, 614, (tx1 - tx0) + 12, 6);
      R(bx0 - 6, 1344, (bx1 - bx0) + 12, 6);
      // TWO diagonal folds per panel (upper-inner -> lower-outer, ~15 deg
      // off vertical), v12b: the single 10px #e84a7f fold was too subtle
      // to read at screen scale — now 16px wide, DARK #c22e5f, doubled.
      var fold = function (a0, a1) {
        var f0 = flip ? X(a0) : a0, f1 = flip ? X(a1) : a1;
        for (var k = 0; k <= 6; k++) {
          var fx = f0 + (f1 - f0) * (k / 6), fy = 700 + k * 90;
          R(fx - 8, fy, 16, 95);
        }
      };
      ctx.fillStyle = '#c22e5f';
      fold(628, 478);
      fold(664, 540);
      // hem band (darker) on the last step.
      ctx.fillStyle = '#e84a7f';
      R(bx0, 1310, bx1 - bx0, 34);
    };
    panel(false);
    panel(true);
    // Collar band across the shoulders — distinctly DARKER pink than the
    // panels so it reads as a separate piece, not more panel.
    ctx.fillStyle = '#1a1a1a';
    R(560, 625, 480, 40);
    ctx.fillStyle = '#c22e5f';
    R(566, 631, 468, 28);
    ctx.fillStyle = '#ff8fb3'; // light stripe on the collar
    R(566, 631, 468, 8);
    // Gold clasp at the neck centre — bigger, with a white glint.
    ctx.fillStyle = '#1a1a1a';
    R(772, 612, 56, 48);
    ctx.fillStyle = '#ffd94a';
    R(778, 618, 44, 36);
    ctx.fillStyle = '#ffffff';
    R(792, 626, 12, 12);
  }
  // White apron panel (x 660-940, y 720-1080) with a pocket (x 750-850,
  // y 850-950) and straps from the shoulders (y 650-720).
  function drawApron(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a'; // straps
    R(676, 650, 16, 76); R(908, 650, 16, 76);
    ctx.fillStyle = '#ffffff';
    R(679, 653, 10, 70); R(911, 653, 10, 70);
    ctx.fillStyle = '#1a1a1a'; // panel outline
    R(660, 720, 280, 360);
    ctx.fillStyle = '#ffffff';
    R(666, 726, 268, 348);
    ctx.fillStyle = '#ff8fb3'; // hem stripe
    R(666, 1060, 268, 14);
    ctx.fillStyle = '#1a1a1a'; // pocket
    R(750, 850, 100, 100);
    ctx.fillStyle = '#ffffff';
    R(756, 856, 88, 88);
    ctx.fillStyle = '#1a1a1a'; // pink button on the pocket
    R(790, 888, 20, 20);
    ctx.fillStyle = '#ff5d8f';
    R(793, 891, 14, 14);
  }
  // Navy sailor collar: a WIDE V (600,620)->(800,790)->(1000,620) with
  // a 48px navy band and white pinstripes flanking it, and a bigger red
  // tie knot with long tails. The first version's 22px band with white
  // stripes ON it read as a thin dark line on the white hoodie.
  function drawSailor(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    var i, cx, cy;
    for (i = 0; i <= 11; i++) { // left arm of the V: (600,620) -> (800,790)
      cx = 600 + i * 16.7; cy = 620 + i * 14.2;
      ctx.fillStyle = '#1a1a1a'; R(cx - 28, cy - 28, 56, 56);
      ctx.fillStyle = '#2b3a67'; R(cx - 24, cy - 24, 48, 48);
      ctx.fillStyle = '#ffffff'; // pinstripes flanking the navy band
      R(cx + 9, cy - 19, 10, 10); R(cx - 19, cy + 9, 10, 10);
    }
    for (i = 0; i <= 11; i++) { // right arm of the V: (1000,620) -> (800,790)
      cx = 1000 - i * 16.7; cy = 620 + i * 14.2;
      ctx.fillStyle = '#1a1a1a'; R(cx - 28, cy - 28, 56, 56);
      ctx.fillStyle = '#2b3a67'; R(cx - 24, cy - 24, 48, 48);
      ctx.fillStyle = '#ffffff';
      R(cx - 19, cy - 19, 10, 10); R(cx + 9, cy + 9, 10, 10);
    }
    ctx.fillStyle = '#1a1a1a'; // red tie knot + long tails
    R(778, 706, 44, 36); R(786, 742, 12, 50); R(802, 742, 12, 50);
    ctx.fillStyle = '#e63950';
    R(782, 710, 36, 28); R(789, 745, 6, 44); R(805, 745, 6, 44);
  }
  // Open gold-trimmed vest: left panel x 600-740, right panel x 860-1000,
  // y 680-1080 — the white hoodie shows through the middle gap.
  function drawVest(S, ox, oy) {
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + y * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    ctx.fillStyle = '#1a1a1a';
    R(600, 680, 140, 400); R(860, 680, 140, 400);
    ctx.fillStyle = '#ff8fb3';
    R(606, 686, 128, 388); R(866, 686, 128, 388);
    ctx.fillStyle = '#ffd94a'; // gold trim on the inner edges + buttons
    R(724, 686, 10, 388); R(866, 686, 10, 388);
    ctx.fillStyle = '#1a1a1a';
    R(697, 777, 18, 18); R(697, 877, 18, 18); R(885, 777, 18, 18); R(885, 877, 18, 18);
    ctx.fillStyle = '#ffd94a';
    R(700, 780, 12, 12); R(700, 880, 12, 12); R(888, 780, 12, 12); R(888, 880, 12, 12);
  }

  // ---------- v11 shop expansion: toy actions ----------
  // Plush bunny held at the chest (white body, pink ears, ~140px wide);
  // star wand in her right hand with a sparkle burst at its tip.
  // Drawn in body space (not the head group) with a gentle bob.
  function drawToy(S, ox, oy, kind, now) {
    var bob = Math.round(Math.sin(now / 300) * 6);
    var R = function (x, y, w, h) {
      ctx.fillRect(Math.round(ox + x * S), Math.round(oy + (y + bob) * S), Math.max(2, Math.round(w * S)), Math.max(2, Math.round(h * S)));
    };
    if (kind === 'plush') {
      // Bigger (was 140px wide, read as a white smudge on the white
      // hoodie) + pink bow + pink belly + pink feet so it reads as a bunny.
      ctx.fillStyle = '#1a1a1a'; // ears
      R(742, 790, 22, 72); R(836, 790, 22, 72);
      ctx.fillStyle = '#ffffff';
      R(745, 793, 16, 66); R(839, 793, 16, 66);
      ctx.fillStyle = '#ff8fb3'; // pink inner ears
      R(749, 800, 8, 52); R(843, 800, 8, 52);
      ctx.fillStyle = '#1a1a1a'; // pink bow between the ears
      R(772, 838, 56, 22);
      ctx.fillStyle = '#ff5d8f';
      R(776, 842, 48, 14);
      ctx.fillStyle = '#1a1a1a';
      R(794, 840, 12, 18);
      ctx.fillStyle = '#ff8fb3';
      R(797, 843, 6, 12);
      ctx.fillStyle = '#1a1a1a'; // head + body
      R(722, 850, 156, 88); R(710, 926, 180, 100);
      ctx.fillStyle = '#ffffff';
      R(726, 854, 148, 80); R(714, 930, 172, 92);
      ctx.fillStyle = '#ff8fb3'; // belly patch
      R(758, 956, 84, 58);
      ctx.fillStyle = '#1a1a1a'; // eyes + nose
      R(752, 878, 12, 14); R(836, 878, 12, 14); R(793, 904, 14, 10);
      ctx.fillStyle = '#1a1a1a'; // feet
      R(716, 1004, 38, 22); R(846, 1004, 38, 22);
      ctx.fillStyle = '#ff5d8f';
      R(719, 1007, 32, 16); R(849, 1007, 32, 16);
    } else if (kind === 'wand') {
      var i; // diagonal gold stick, hand (1090,1150) -> tip (1330,930),
      // held up and OUT to the right so the stick + star clear the
      // checkered sleeve — the v11 wand (20px core, 80px star, tip at
      // x 1180) sat ON the sleeve and read as a tiny gold squiggle
      // (gp-31). v12: 32px solid gold core in a 40px black sleeve,
      // 120px star tip out in the free wall space, sparkle burst.
      ctx.fillStyle = '#1a1a1a';
      for (i = 0; i <= 11; i++) R(1090 + i * 21.8 - 20, 1150 - i * 20 - 20, 40, 40);
      ctx.fillStyle = '#ffd94a';
      for (i = 0; i <= 11; i++) R(1090 + i * 21.8 - 16, 1150 - i * 20 - 16, 32, 32);
      ctx.fillStyle = '#1a1a1a'; // star at the tip (4-point, 120px)
      R(1300, 845, 80, 120); R(1280, 880, 120, 40);
      ctx.fillStyle = '#ffd94a';
      R(1308, 853, 64, 104); R(1288, 888, 104, 26);
      ctx.fillStyle = '#ffffff';
      R(1332, 880, 12, 12);
      ctx.fillStyle = '#1a1a1a'; // sparkle burst around the tip
      R(1252, 822, 6, 18); R(1246, 828, 18, 6);
      R(1402, 822, 6, 18); R(1396, 828, 18, 6);
      R(1412, 962, 6, 18); R(1406, 968, 18, 6);
      ctx.fillStyle = '#ffd94a';
      R(1254, 824, 2, 14); R(1248, 830, 14, 2);
      R(1404, 824, 2, 14); R(1398, 830, 14, 2);
      R(1414, 964, 2, 14); R(1408, 970, 14, 2);
    }
  }
  function toyAction(kind) {
    var now = performance.now();
    if (kind === 'plush') {
      toy.kind = 'plush'; toy.until = now + 4000;
      state.happyUntil = now + 1200; state.squash = 1;
      spawnHeart(3, toCanvasX(800), toCanvasY(800));
      playRandom(VOICE.pet);
    } else if (kind === 'wand') {
      toy.kind = 'wand'; toy.until = now + 4000;
      state.happyUntil = now + 1200; state.squash = 1;
      spawnSpark(12, toCanvasX(1340), toCanvasY(905)); // wand star tip, v12
      playRandom(VOICE.celebrate);
    }
  }

  // ---------- v11 shop expansion: room themes + decor (canvas coords) ----------
  // Bookshelf on the right wall: 3 shelves + colourful book spines,
  // x 530-680, y 118-276. Below the poster (ends y 124) and clear of the
  // window (x 16-188), so it covers neither.
  function drawBookshelf() {
    var i, x;
    var cols = ['#ff5d8f', '#7ec8ff', '#ffd94a', '#58c98b', '#8b7fd4', '#ffffff'];
    ctx.fillStyle = '#1a1a1a'; // side boards
    ctx.fillRect(528, 118, 8, 160); ctx.fillRect(672, 118, 8, 160);
    ctx.fillStyle = '#b07a45';
    ctx.fillRect(530, 120, 4, 156); ctx.fillRect(674, 120, 4, 156);
    var shelves = [
      { plank: 160, books: [[536, 30], [552, 34], [568, 26], [584, 32], [600, 28], [616, 30], [632, 24], [648, 30], [664, 26]] },
      { plank: 214, books: [[536, 28], [552, 32], [568, 24], [584, 34], [600, 26], [616, 30], [632, 28], [648, 24]] },
      { plank: 268, books: [[536, 30], [552, 26], [568, 32], [584, 28], [600, 30]] }
    ];
    for (var s = 0; s < shelves.length; s++) {
      var sh = shelves[s];
      for (i = 0; i < sh.books.length; i++) {
        x = sh.books[i][0];
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(x, sh.plank - sh.books[i][1], 14, sh.books[i][1]);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x, sh.plank - sh.books[i][1], 14, 3); // black top edge
      }
      ctx.fillStyle = '#1a1a1a'; // plank
      ctx.fillRect(530, sh.plank, 150, 8);
      ctx.fillStyle = '#b07a45';
      ctx.fillRect(533, sh.plank + 2, 144, 4);
    }
    ctx.fillStyle = '#ffd94a'; // tiny gold sparkle on the bottom shelf
    ctx.fillRect(648, 240, 3, 3); ctx.fillRect(645, 243, 9, 3);
    ctx.fillRect(642, 246, 15, 3); ctx.fillRect(645, 249, 9, 3); ctx.fillRect(648, 252, 3, 3);
  }
  // Floor plant, left: pot + green leaves, x 40-116, y 388-474 — the pot
  // bottom sits on the platform top edge (y 474), like the character.
  function drawPlant() {
    ctx.fillStyle = '#1a1a1a'; // leaves (3 blades)
    ctx.fillRect(52, 400, 12, 40); ctx.fillRect(46, 420, 12, 30);
    ctx.fillRect(70, 388, 12, 62);
    ctx.fillRect(88, 400, 12, 40); ctx.fillRect(94, 420, 12, 30);
    ctx.fillStyle = '#58c98b';
    ctx.fillRect(55, 403, 6, 34); ctx.fillRect(49, 423, 6, 24);
    ctx.fillRect(73, 391, 6, 56);
    ctx.fillRect(91, 403, 6, 34); ctx.fillRect(97, 423, 6, 24);
    ctx.fillStyle = '#1a1a1a'; // pot + rim
    ctx.fillRect(44, 440, 72, 10); ctx.fillRect(48, 446, 64, 28);
    ctx.fillStyle = '#ff9f43';
    ctx.fillRect(47, 442, 66, 6); ctx.fillRect(51, 449, 58, 22);
    ctx.fillStyle = '#1a1a1a'; // soil line
    ctx.fillRect(51, 449, 58, 4);
  }
  // Fairy lights: a gently sagging string across the top with warm
  // gold / pink bulbs every ~60px, hanging just below the string.
  function drawFairyLights() {
    var x, y;
    ctx.fillStyle = '#1a1a1a'; // string
    for (x = 0; x < W; x += 8) {
      y = Math.round(12 + 12 * Math.sin(Math.PI * x / W));
      ctx.fillRect(x, y, 8, 2);
    }
    for (x = 30; x <= 690; x += 60) {
      y = Math.round(12 + 12 * Math.sin(Math.PI * x / W)) + 6;
      var gold = ((x / 60) | 0) % 2 === 0;
      ctx.fillStyle = gold ? '#ffe98a' : '#ffb3c8'; // glow halo
      ctx.fillRect(x - 6, y - 4, 12, 12);
      ctx.fillStyle = gold ? '#ffd94a' : '#ff5d8f'; // bulb
      ctx.fillRect(x - 4, y - 2, 8, 8);
    }
  }

  function sleep(on) {
    state.sleeping = on;
    if (on) {
      // v9: two Zs at once + 1.4s spawns against a 2.8s life, so at least
      // one fully-opaque Z is always on screen (the old 2.2s spawns left
      // gaps where no Z was visible at all).
      spawnZzz(); spawnZzz();
      if (zzzTimer) clearInterval(zzzTimer);
      zzzTimer = setInterval(function () { if (state.sleeping) spawnZzz(); }, 1400);
    } else if (zzzTimer) { clearInterval(zzzTimer); zzzTimer = null; }
  }

  function celebrate() {
    var now = performance.now();
    state.celebrateUntil = now + 1500;
    state.happyUntil = now + 1500;
    state.squash = 1;
    state.blushTarget = 1;
    setTimeout(function () { state.blushTarget = 0; }, 2000);
    spring.dyVel += -140;
    spawnHeart(5, toCanvasX(800) - 120, toCanvasY(250));
    spawnHeart(5, toCanvasX(800) + 120, toCanvasY(250));
    spawnSpark(12, toCanvasX(800), toCanvasY(300));
    playRandom(VOICE.celebrate);
  }

  function chatReact() {
    var now = performance.now();
    state.happyUntil = now + 600;
    spring.angVel += (Math.random() - 0.5) * 0.5;
    if (Math.random() < 0.4) playRandom(VOICE.chat);
  }

  function blip() {
    if (state.muted || !blipAudio) return;
    try { blipAudio.currentTime = 0; var p = blipAudio.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  function coinFloat(html) {
    var el = document.getElementById('coin-float');
    if (!el) return;
    el.innerHTML = html;
    el.classList.remove('show');
    void el.offsetWidth; // restart animation
    // v7: snap to display:none once the fade is done — the 0.3s opacity
    // transition left a faint ~5% ghost rectangle lingering on the wall.
    if (el._hideTimer) { clearTimeout(el._hideTimer); el._hideTimer = null; }
    el.style.display = '';
    el.classList.add('show');
    clearTimeout(el._floatTimer);
    el._floatTimer = setTimeout(function () {
      el.classList.remove('show');
      el._hideTimer = setTimeout(function () { el.style.display = 'none'; }, 400);
    }, 1200);
  }

  function busy() {
    var now = performance.now();
    return now < state.happyUntil || now < state.bathUntil || now < state.celebrateUntil;
  }

  function setGear(gear) {
    // v11: six wear slots — head (beanie/glasses/starclips + crown/catears/
    // bunnyears/flowercrown/sleepmask), neck (scarf + necklaces/bowtie),
    // braid (bow + starties/ribbonBlue/bell), outfit (cape/apron/sailor/
    // vest), room (theme), decor (array, multi). state.accessory stays
    // synced to the head slot (layout + the head-slot draws read it).
    // Keys the caller does not pass keep their current value (game.js
    // still sends 3-key gear), so a partial update never wipes the room
    // theme, decor or outfit; an explicit null clears the slot.
    if (!gear) gear = {};
    var g = state.gear;
    state.gear = {
      head: gear.head !== undefined ? gear.head : g.head,
      neck: gear.neck !== undefined ? gear.neck : g.neck,
      braid: gear.braid !== undefined ? gear.braid : g.braid,
      outfit: gear.outfit !== undefined ? gear.outfit : g.outfit,
      room: gear.room !== undefined ? gear.room : g.room,
      decor: gear.decor !== undefined ? gear.decor : g.decor
    };
    if (!state.gear.decor) state.gear.decor = [];
    state.accessory = state.gear.head;
  }
  function setAccessory(id) {
    setGear({ head: id || null, neck: state.gear.neck, braid: state.gear.braid });
  }

  function setSleepy(on) { state.moodSleepy = !!on; }
  function setExcited(on) { state.excited = !!on; }
  function setReducedMotion(on) { state.reducedMotion = !!on; }
  function setAutoRotate(on) { state.autoRotate = !!on; }

  // ---------- the room: a real pixel stage, not a blank canvas ----------
  // Warm cream wall (clearly distinct from the pink page background),
  // dot wallpaper, a night window with a REAL crescent moon + sill,
  // a cream heart-emblem poster (distinct from the window) and a shelf
  // with books, and a high-contrast checker stage platform the sprite
  // stands behind (drawn AFTER the character so the mid-thigh cut edge
  // hides behind the platform front).
  function drawRoom() {
    // v11: room themes (state.gear.room) recolour the wall + dot
    // wallpaper; null = the current cream wall. The day/night WINDOW sky
    // is drawn on top of any theme by drawWindow(), so it keeps working.
    var walls = {
      roomPink: ['#ffd6e8', '#f0a8c8'],
      roomMint: ['#c8f0dd', '#8fd8b4'],
      roomLavender: ['#ddd6f5', '#b3a8e0'],
      roomNight: ['#2c2350', '#3d3268']
    };
    var theme = walls[state.gear.room] || ['#ffe6c4', '#f7c98d'];
    ctx.fillStyle = theme[0]; ctx.fillRect(0, 0, W, H);
    // Dot wallpaper (12px dots on a 48px grid), wall only.
    ctx.fillStyle = theme[1];
    for (var y = 24; y < 470; y += 48) {
      for (var x = 24; x < W; x += 48) {
        if (x < 200 && y < 200) continue; // window area
        ctx.fillRect(x, y, 12, 12);
      }
    }
    drawWindow();
    drawPoster();
    drawShelf();
    // v11: decor (state.gear.decor, multi) — bookshelf and plant sit on
    // the wall/floor; fairy lights hang last so they read over everything.
    if (state.gear.decor) {
      if (state.gear.decor.indexOf('bookshelf') !== -1) drawBookshelf();
      if (state.gear.decor.indexOf('plant') !== -1) drawPlant();
      if (state.gear.decor.indexOf('fairylights') !== -1) drawFairyLights();
    }
    // Contact shadow on the platform top edge, behind the character.
    ctx.fillStyle = 'rgba(26,26,26,0.16)';
    ctx.beginPath(); ctx.ellipse(360, 474, 150, 9, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawWindow() {
    // v11: the window follows the day/night cycle — blue sky + sun by day,
    // orange dusk sun at 17-19, purple night + moon + stars after dark.
    var part = dayPart();
    var sky = part === 'day' ? '#7ec8ff' : (part === 'dusk' ? '#f2a35e' : '#4a3670');
    // Frame depth: black outer -> wood band -> sky; sill below.
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(16, 16, 172, 172);
    ctx.fillStyle = '#b07a45'; ctx.fillRect(22, 22, 160, 160); // wood frame
    ctx.fillStyle = sky; ctx.fillRect(30, 30, 144, 144); // sky
    if (part === 'night') {
      ctx.fillStyle = '#ffd94a'; // stars (kept clear of the moon + mullions)
      [[52, 52], [96, 44], [70, 100], [120, 110], [44, 130], [100, 140], [160, 120], [60, 150]]
        .forEach(function (s) { ctx.fillRect(s[0], s[1], 6, 6); });
      drawMoon(128, 40); // real crescent, top-right pane, clear of the cross
    } else if (part === 'day') {
      drawPixelDisc(132, 66, 18, '#ffd94a'); // sun
      drawPixelDisc(132, 66, 14, '#ffe98a');
      // Two small white pixel clouds.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(44, 56, 30, 8); ctx.fillRect(50, 50, 18, 6);
      ctx.fillRect(120, 130, 34, 8); ctx.fillRect(128, 124, 18, 6);
      // The day bird flies BEHIND the mullions (inside the pane).
      if (bird.active) {
        var flap = Math.round(Math.sin(performance.now() / 90) * 3);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(Math.round(bird.x), Math.round(bird.y + flap), 8, 3);
        ctx.fillRect(Math.round(bird.x + 10), Math.round(bird.y + flap), 8, 3);
        ctx.fillRect(Math.round(bird.x + 7), Math.round(bird.y + 2), 5, 3);
      }
    } else { // dusk: low orange sun near the horizon
      drawPixelDisc(132, 128, 18, '#ff9f43');
      drawPixelDisc(132, 128, 13, '#ffc46b');
    }
    ctx.fillStyle = '#1a1a1a'; // mullions
    ctx.fillRect(99, 30, 6, 144); ctx.fillRect(30, 99, 144, 6);
    // Sill: white ledge with black outline + shadow underneath.
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(8, 188, 188, 14);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(11, 190, 182, 9);
    ctx.fillStyle = 'rgba(26,26,26,0.20)'; ctx.fillRect(8, 202, 188, 4);
  }
  // Real pixel crescent: a gold disc with a sky-coloured bite taken out
  // of its right side, so the crescent is thick on the LEFT with horns
  // pointing right — the classic moon shape, like the خواب button icon.
  // v6: 14x14 cells of 3px (same 42px footprint) so the curve is smooth,
  // not a blocky bar with a flat foot.
  function drawMoon(x0, y0) {
    var cell = 3;
    for (var j = 0; j < 14; j++) {
      for (var i = 0; i < 14; i++) {
        var cx = i + 0.5, cy = j + 0.5;
        var inDisc = Math.hypot(cx - 5.8, cy - 7.0) <= 6.2;
        var inBite = Math.hypot(cx - 9.2, cy - 7.0) <= 5.9;
        if (inDisc && !inBite) {
          ctx.fillStyle = '#ffd94a';
          ctx.fillRect(x0 + i * cell, y0 + j * cell, cell, cell);
        }
      }
    }
  }
  function drawPoster() {
    // A warm pastel/cream poster — visually DISTINCT from the night window:
    // cream paper, a big pink heart emblem, a gold sparkle and small
    // stars. No night sky, no moon, no horizontal line (the old pink
    // ground line read as a video scrub bar on a tiny monitor).
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(556, 28, 128, 96); // frame
    ctx.fillStyle = '#fff0d6'; ctx.fillRect(562, 34, 116, 84); // cream paper
    ctx.fillStyle = '#ffd94a'; // gold sparkle, top-left
    ctx.fillRect(578, 44, 3, 3); ctx.fillRect(575, 47, 9, 3);
    ctx.fillRect(572, 50, 15, 3); ctx.fillRect(575, 53, 9, 3); ctx.fillRect(578, 56, 3, 3);
    ctx.fillStyle = '#ff5d8f'; // small pink star, top-right
    ctx.fillRect(656, 44, 4, 4); ctx.fillRect(650, 50, 4, 4);
    drawHeart(620, 76, 26, '#ff5d8f'); // big pink heart emblem, centre
    drawHeart(652, 102, 9, '#ff8fb3'); // small light-pink heart, bottom-right
    ctx.fillStyle = '#ffd94a'; // tiny gold dot, bottom-left
    ctx.fillRect(576, 102, 5, 5);
  }
  function drawShelf() {
    // Wooden shelf under the window with three tiny books + a star.
    ctx.fillStyle = '#ff5d8f'; ctx.fillRect(36, 214, 14, 22); // red book
    ctx.fillStyle = '#7ec8ff'; ctx.fillRect(52, 208, 14, 28); // blue book
    ctx.fillStyle = '#ffd94a'; ctx.fillRect(68, 218, 12, 18); // gold book
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(36, 214, 14, 3); ctx.fillRect(52, 208, 14, 3); ctx.fillRect(68, 218, 12, 3);
    ctx.fillStyle = '#ffd94a'; // tiny 4-point sparkle on the shelf
    ctx.fillRect(125, 220, 3, 3); ctx.fillRect(122, 223, 9, 3);
    ctx.fillRect(119, 226, 15, 3); ctx.fillRect(122, 229, 9, 3); ctx.fillRect(125, 232, 3, 3);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(28, 236, 140, 10); // shelf plank
    ctx.fillStyle = '#b07a45'; ctx.fillRect(31, 238, 134, 6);
  }
  function drawPlatform() {
    // Skirting board (white strip WITH black edges top and bottom, so it
    // reads as intentional — the unbordered white strip looked like a
    // rendering seam), then a HIGH-CONTRAST checker face (35px cells,
    // hot pink vs white — exactly two rows to the bottom).
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 474, W, 4);
    ctx.fillStyle = '#fff5f9'; ctx.fillRect(0, 478, W, 8);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 486, W, 4);
    for (var y = 490, row = 0; y < H; y += 35, row++) {
      for (var x = 0, col = 0; x < W; x += 35, col++) {
        // v11: roomNight theme gets a darker checker floor.
        var night = state.gear.room === 'roomNight';
        ctx.fillStyle = ((row + col) % 2 === 0) ? (night ? '#4a3f7d' : '#ff5d8f') : (night ? '#332a5e' : '#ffffff');
        ctx.fillRect(x, y, 35, 35);
      }
    }
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, H - 4, W, 4);
  }

  // ---------- render loop ----------
  function frame(t) {
    requestAnimationFrame(frame);
    if (!state.ready) return;
    var dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;

    var now = performance.now();
    var L = layout();
    var S = L.s;

    // Idle bob: translate only, never stretch. Slower + smaller when sleeping.
    // v11: reduced-motion setting kills the bob; excited mood doubles it.
    bobPhase += dt * (state.sleeping ? 0.7 : 1.4);
    var bobAmp = state.reducedMotion ? 0 : (state.sleeping ? 2 : (state.excited ? 5 : 3));
    var bobY = Math.sin(bobPhase) * bobAmp; // 1600-space px
    var sway = state.reducedMotion ? 0 : Math.sin(bobPhase * 0.65) * 0.012; // tiny head sway, radians
    // v11: excited sparkles — a spark every ~0.5s while excited.
    if (state.excited && Math.random() < dt * 2) {
      spawnSpark(1, toCanvasX(600 + Math.random() * 400), toCanvasY(200 + Math.random() * 300));
    }
    // v11: day bird — launch every 40-90s in daylight, fly across the pane.
    var now0 = performance.now();
    if (dayPart() === 'day' && !bird.active && !state.reducedMotion) {
      if (!bird.nextAt) bird.nextAt = now0 + 20000 + Math.random() * 30000;
      if (now0 >= bird.nextAt) {
        bird.active = true; bird.x = 30; bird.y = 55 + Math.random() * 60;
      }
    }
    if (bird.active) {
      bird.x += 55 * dt;
      if (bird.x > 185) { bird.active = false; bird.nextAt = now0 + 40000 + Math.random() * 50000; }
    }

    // Blink scheduling.
    if (now >= blinkAt && now >= blinkUntil) {
      blinkUntil = now + 130;
      blinkAt = now + 2800 + Math.random() * 2200;
    }
    var eyesClosed = now < blinkUntil || now < state.happyUntil;

    // Spring integration (semi-implicit Euler, slightly underdamped).
    var k = 180, c = 15;
    spring.angVel += (-k * (spring.angle - spring.angTarget) - c * spring.angVel) * dt;
    spring.angle += spring.angVel * dt;
    spring.dxVel += (-k * (spring.dx - spring.dxTarget) - c * spring.dxVel) * dt;
    spring.dx += spring.dxVel * dt;
    spring.dyVel += (-k * (spring.dy - spring.dyTarget) - c * spring.dyVel) * dt;
    spring.dy += spring.dyVel * dt;
    // Clamp the lean so the head never over-rotates.
    spring.angle = Math.max(-0.10, Math.min(0.10, spring.angle));
    spring.dx = Math.max(-14, Math.min(14, spring.dx));
    spring.dy = Math.max(-10, Math.min(12, spring.dy));

    // Blush easing.
    state.blush += (state.blushTarget - state.blush) * Math.min(1, dt * 6);
    // Squash-and-stretch decay (slow enough that the squash reads in a still).
    // v11: reduced motion kills the squash.
    state.squash = state.reducedMotion ? 0 : Math.max(0, state.squash - dt * 1.2);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    drawRoom();

    var ox = L.ox, oy = L.oy + bobY * S;
    var px = ox + PIVOT.x * S, py = oy + PIVOT.y * S; // pivot, canvas px

    if (flatOk && (!img.body || !img.head)) {
      // Fallback: flat avatar, still bobs + blinks via overlay only.
      ctx.drawImage(img.flat, Math.round(ox), Math.round(oy), Math.round(1600 * S), Math.round(1600 * S));
    } else {
      // Body (torso + arms + shorts).
      if (img.body) ctx.drawImage(img.body, Math.round(ox), Math.round(oy), Math.round(1600 * S), Math.round(1600 * S));
      // v11: neck-slot scarf (procedural pixel scarf on the torso).
      if (state.gear.neck === 'scarf') drawScarf(S, ox, oy);
      // v11: outfit slot (single-select) — drawn after the body image.
      if (state.gear.outfit === 'cape') drawCape(S, ox, oy);
      else if (state.gear.outfit === 'apron') drawApron(S, ox, oy);
      else if (state.gear.outfit === 'sailor') drawSailor(S, ox, oy);
      else if (state.gear.outfit === 'vest') drawVest(S, ox, oy);

      // Head group: rotate + spring + squash around the neck pivot.
      ctx.save();
      ctx.translate(Math.round(px + spring.dx * S), Math.round(py + spring.dy * S));
      ctx.rotate(spring.angle + sway);
      var sq = state.squash;
      if (sq > 0.01) ctx.scale(1 + 0.09 * sq, 1 - 0.10 * sq);
      ctx.translate(-Math.round(px), -Math.round(py));
      // Backhair (head-parented, under the head): the bob flare must move
      // with the head. In body space it stayed put while the head leaned,
      // opening a cream wedge and leaving a detached pink chunk (fx2).
      // At rest its overlap with the body is 0px, so drawing it after the
      // body changes nothing there; at full lean only a few px of its tip
      // can fall on the shoulder, reading as hair in front of the hoodie,
      // exactly like the braids already do.
      if (img.backhair) ctx.drawImage(img.backhair, Math.round(ox), Math.round(oy), Math.round(1600 * S), Math.round(1600 * S));
      var headImg = img.head;
      // v11: truly asleep = the NEW head_sleep sprite (relaxed downward
      // arcs ︶ ︶). The happy upward arcs (^ ^) of head_closed are only
      // for petting/blinking now — Gemini round 10 caught the reuse.
      // The half-open sleepy face stays for the low-energy mood while awake.
      if (state.sleeping) headImg = img.head_sleep || img.head_closed || headImg;
      else if (state.moodSleepy) headImg = img.head_sleepy || headImg;
      else if (eyesClosed) headImg = img.head_closed || headImg;
      if (headImg) ctx.drawImage(headImg, Math.round(ox), Math.round(oy), Math.round(1600 * S), Math.round(1600 * S));
      // Blush (head-parented, fades). v7: the asset is now small PIXELATED
      // hash marks (///) per cheek — drawn ONCE at the eased alpha. v6
      // drew the old oval asset THREE times at 1.2x alpha, which at peak
      // rendered as two giant opaque hot-pink clown ovals over the cheeks.
      if (img.blush && state.blush > 0.02) {
        ctx.globalAlpha = Math.min(1, state.blush);
        ctx.drawImage(img.blush, Math.round(ox), Math.round(oy), Math.round(1600 * S), Math.round(1600 * S));
        ctx.globalAlpha = 1;
      }
      // Accessories (head-parented). v9: glasses hide while sleeping —
      // the old opaque-white lenses sat on the closed eyes and the
      // sleepy face was unreadable (the new pixel glasses are transparent,
      // but the frames still cross the closed eyes, so they stay off).
      if (state.accessory === 'glasses' && img.glasses && !state.sleeping) {
        ctx.drawImage(img.glasses,
          Math.round(ox + GLASSES.x * S), Math.round(oy + GLASSES.y * S),
          Math.round(GLASSES.w * S), Math.round(GLASSES.h * S));
      } else if (state.accessory === 'starclips') {
        if (img.star_pink) ctx.drawImage(img.star_pink,
          Math.round(ox + (STAR_PINK.cx - 680 * STAR_PINK.scale / 2) * S),
          Math.round(oy + (STAR_PINK.cy - 706 * STAR_PINK.scale / 2) * S),
          Math.round(680 * STAR_PINK.scale * S), Math.round(706 * STAR_PINK.scale * S));
        if (img.star_blue) ctx.drawImage(img.star_blue,
          Math.round(ox + (STAR_BLUE.cx - 680 * STAR_BLUE.scale / 2) * S),
          Math.round(oy + (STAR_BLUE.cy - 706 * STAR_BLUE.scale / 2) * S),
          Math.round(680 * STAR_BLUE.scale * S), Math.round(706 * STAR_BLUE.scale * S));
      } else if (state.accessory === 'beanie' && img.beanie) {
        ctx.drawImage(img.beanie,
          Math.round(ox + BEANIE.x * S), Math.round(oy + BEANIE.y * S),
          Math.round(BEANIE.w * S), Math.round(BEANIE.h * S));
      } else if (state.accessory === 'crown') drawCrown(S, ox, oy);
      else if (state.accessory === 'catears') drawCatEars(S, ox, oy);
      else if (state.accessory === 'bunnyears') drawBunnyEars(S, ox, oy);
      else if (state.accessory === 'flowercrown') drawFlowerCrown(S, ox, oy);
      else if (state.accessory === 'sleepmask') drawSleepMask(S, ox, oy); // NOT gated by sleeping — it is a sleep aid
      // v11: neck-slot jewellery (head group so it moves with the head;
      // the scarf stays body-space, above).
      if (state.gear.neck === 'necklaceGold') drawNecklaceGold(S, ox, oy);
      else if (state.gear.neck === 'necklacePearl') drawNecklacePearl(S, ox, oy);
      else if (state.gear.neck === 'bowtie') drawBowtie(S, ox, oy);
      // v11: braid-slot bow (procedural pixel bow on the right braid).
      if (state.gear.braid === 'bow') drawBow(S, ox, oy);
      else if (state.gear.braid === 'starties') drawStarTies(S, ox, oy);
      else if (state.gear.braid === 'ribbonBlue') drawRibbonBlue(S, ox, oy);
      else if (state.gear.braid === 'bell') drawBell(S, ox, oy);
      // v11: annoyed face (body-touch warning) — angry brows + vein,
      // drawn last so nothing covers them.
      if (now < state.annoyedUntil) drawAnnoyed(S, ox, oy);
      ctx.restore();
    }

    // v11: toy actions — plush bunny / star wand held at the chest for 4s.
    if (toy.kind && now < toy.until) drawToy(S, ox, oy, toy.kind, now);
    else if (toy.kind) toy.kind = null;

    // Stage platform in front of the sprite's lower thighs (grounds the cut edge).
    drawPlatform();

    // v11: toy ball — gravity + one platform bounce, then it rests and fades.
    if (ball.active) {
      ball.vy += 900 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.y > 468 && ball.vy > 0) {
        ball.y = 468;
        ball.vy = -ball.vy * 0.45;
        ball.vx *= 0.8;
        if (Math.abs(ball.vy) < 70) ball.active = false;
      }
      if (performance.now() - ball.t0 > 3500) ball.active = false;
      if (ball.active) drawBall(ball.x, ball.y, 22); // v11: radius 22 (was 15) — the old ball read as a tiny gold dot in flight
    }

    // Particles.
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      var a;
      if (p.type === 'heart') {
        // Hearts stay fully opaque for the first 70% of life, then fade
        // fast — a long semi-transparent tail reads as a dirty smudge.
        var frac = p.life / p.maxLife;
        a = frac < 0.7 ? 1 : Math.max(0, 1 - (frac - 0.7) / 0.3);
      } else {
        a = 1 - p.life / p.maxLife;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, a * 1.5);
      if (p.type === 'heart') { ctx.translate(p.x, p.y); ctx.rotate(p.rot); drawHeart(0, 0, p.size, p.color); }
      else if (p.type === 'bubble') { drawPixelBubble(p.x, p.y, p.size); }
      else if (p.type === 'spark') { drawSpark(p.x, p.y, p.size, p.color, p.rot); }
      ctx.restore();
    }
  }

  // ---------- pointer handling ----------
  function canvasPos(e) {
    var r = canvas.getBoundingClientRect();
    var cx = (e.clientX - r.left) * (W / r.width);
    var cy = (e.clientY - r.top) * (H / r.height);
    return { x: cx, y: cy };
  }

  function bindPointer() {
    canvas.addEventListener('pointerdown', function (e) {
      var p = canvasPos(e);
      ptr.down = true; ptr.dragging = false;
      ptr.sx = p.x; ptr.sy = p.y; ptr.cx = p.x; ptr.cy = p.y; ptr.t = performance.now();
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!ptr.down) return;
      var p = canvasPos(e);
      ptr.cx = p.x; ptr.cy = p.y;
      var d = Math.hypot(p.x - ptr.sx, p.y - ptr.sy);
      if (d >= 8) {
        ptr.dragging = true;
        // Drag: head looks toward the pointer (capped, small).
        // v11: the auto-rotate setting disables the look-at.
        if (!state.autoRotate) return;
        var sx = toSrcX(p.x), sy = toSrcY(p.y);
        spring.angTarget = Math.max(-0.06, Math.min(0.06, (sx - 800) / 800 * 0.08));
        spring.dxTarget = Math.max(-8, Math.min(8, (sx - 800) * 0.01));
      }
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!ptr.down) return;
      ptr.down = false;
      var p = canvasPos(e);
      var d = Math.hypot(p.x - ptr.sx, p.y - ptr.sy);
      spring.angTarget = 0; spring.dxTarget = 0; spring.dyTarget = 0;
      if (ptr.dragging || d >= 8 || performance.now() - ptr.t > 600) return; // drag, not a tap
      var sx = toSrcX(p.x), sy = toSrcY(p.y);
      if (inHead(sx, sy)) {
        if (window.Game && window.Game.pet) window.Game.pet(p.x, p.y);
        else pet(p.x, p.y);
      } else if (inBody(sx, sy)) {
        if (window.Game && window.Game.poke) window.Game.poke();
        else {
          // v11: the annoyed face (brows + vein) shows with the warning.
          annoyed();
          speak(window.Lines ? window.Lines.next('poke') : POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)]);
        }
      }
    });
    canvas.addEventListener('pointercancel', function () {
      ptr.down = false; ptr.dragging = false;
      spring.angTarget = 0; spring.dxTarget = 0; spring.dyTarget = 0;
    });
  }

  // ---------- init ----------
  function init() {
    canvas = document.getElementById('stage');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Mute toggle chip in the HUD chips group (desktop: clustered with the
    // other chips, title on the other side; phone: same tight row as v5).
    var hud = document.getElementById('hud');
    var chips = document.getElementById('hud-chips') || hud;
    if (hud) {
      var b = document.createElement('button');
      b.className = 'chip mute-btn';
      b.title = 'صدا';
      // fx3 (audit F3): restore the saved mute state — init used to
      // hardcode the speaker icon, so a reload always un-muted even
      // though Game.state.muted was still true in storage.
      if (window.Game && window.Game.state && window.Game.state.muted) state.muted = true;
      b.innerHTML = state.muted
        ? '<img class="ic" src="assets/icons/speaker-off.png" alt="">'
        : '<img class="ic" src="assets/icons/speaker.png" alt="">';
      b.addEventListener('click', function () {
        state.muted = !state.muted;
        b.innerHTML = state.muted
          ? '<img class="ic" src="assets/icons/speaker-off.png" alt="">'
          : '<img class="ic" src="assets/icons/speaker.png" alt="">';
        if (window.Game && window.Game.state) {
          window.Game.state.muted = state.muted;
          if (window.Game.save) window.Game.save();
        }
      });
      chips.appendChild(b);
    }

    Promise.all([
      loadImage('assets/backhair.png'), loadImage('assets/body.png'),
      loadImage('assets/head.png'), loadImage('assets/head_closed.png'),
      loadImage('assets/head_sleepy.png'), loadImage('assets/blush.png'),
      loadImage('assets/accessories/beanie_short.png'), loadImage('assets/accessories/glasses.png'),
      loadImage('assets/accessories/star_blue.png'), loadImage('assets/accessories/star_pink.png'),
      loadImage('assets/flat.webp'), loadImage('assets/head_sleep.png')
    ]).then(function (imgs) {
      img.backhair = imgs[0]; img.body = imgs[1]; img.head = imgs[2];
      img.head_closed = imgs[3]; img.head_sleepy = imgs[4]; img.blush = imgs[5];
      img.beanie = imgs[6]; img.glasses = imgs[7]; img.star_blue = imgs[8]; img.star_pink = imgs[9];
      img.flat = imgs[10]; flatOk = !!imgs[10]; img.head_sleep = imgs[11];
      // Preload voice clips (gesture-safe playback needs them warm).
      Object.keys(VOICE).forEach(function (k) { VOICE[k].forEach(loadVoice); });
      blipAudio = loadVoice('blip.mp3');
      blinkAt = performance.now() + 2500;
      bindPointer();
      state.ready = true;
      requestAnimationFrame(frame);
    });
  }

  window.Rig = {
    init: init, pet: pet, eat: eat, bath: bath, sleep: sleep,
    celebrate: celebrate, chatReact: chatReact, blip: blip,
    coinFloat: coinFloat, busy: busy, setAccessory: setAccessory,
    setGear: setGear, setSleepy: setSleepy, setExcited: setExcited,
    setReducedMotion: setReducedMotion, setAutoRotate: setAutoRotate,
    speak: speak, annoyed: annoyed, tossBall: tossBall, toyAction: toyAction, dayPart: dayPart,
    _state: state, _spring: spring, _ball: ball, _toy: toy
  };
})();
