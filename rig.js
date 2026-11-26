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
    celebrate: ['v01_yahoo.mp3', 'v02_giggle.mp3'],
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
    accessory: null,      // null | 'beanie' | 'glasses' | 'starclips'
    sleeping: false,
    moodSleepy: false,    // game sets this from mood (tired)
    happyUntil: 0,        // timestamp: eyes closed happy
    bathUntil: 0,
    celebrateUntil: 0,
    squash: 0,            // 0..1 squash-and-stretch (pet/celebrate), decays fast
    blush: 0,             // 0..1 current blush alpha
    blushTarget: 0,
    muted: false,
    ready: false
  };

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
    for (var i = 0; i < n; i++) {
      particles.push({
        type: 'bubble', x: 100 + Math.random() * 520, y: 420 + Math.random() * 50,
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
  // Zzz as DOM spans inside #sleep-veil, ABOVE the veil (fx3, audit F7):
  // the canvas 'Z' particles were invisible — the stage is dimmed to 45%
  // AND the 55%-opaque veil sits on top, crushing a purple Z to near zero
  // contrast. A white bold Z with a black shadow on the dark veil reads.
  function spawnZzz() {
    var veil = document.getElementById('sleep-veil');
    if (!veil) return;
    var z = document.createElement('span');
    z.className = 'zzz-float';
    z.textContent = 'Z';
    z.style.left = (30 + Math.random() * 40) + '%';
    z.style.top = (24 + Math.random() * 12) + '%';
    veil.appendChild(z);
    setTimeout(function () { if (z.parentNode) z.parentNode.removeChild(z); }, 2800);
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
    speak('یاهو! ناز شدم!');
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

  function sleep(on) {
    state.sleeping = on;
    if (on) {
      if (zzzTimer) clearInterval(zzzTimer);
      zzzTimer = setInterval(function () { if (state.sleeping) spawnZzz(); }, 2200);
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

  function setAccessory(id) {
    state.accessory = id || null;
  }

  function setSleepy(on) { state.moodSleepy = !!on; }

  // ---------- the room: a real pixel stage, not a blank canvas ----------
  // Warm cream wall (clearly distinct from the pink page background),
  // dot wallpaper, a night window with a REAL crescent moon + sill,
  // a cream heart-emblem poster (distinct from the window) and a shelf
  // with books, and a high-contrast checker stage platform the sprite
  // stands behind (drawn AFTER the character so the mid-thigh cut edge
  // hides behind the platform front).
  function drawRoom() {
    ctx.fillStyle = '#ffe6c4'; ctx.fillRect(0, 0, W, H);
    // Dot wallpaper (12px dots on a 48px grid), wall only.
    ctx.fillStyle = '#f7c98d';
    for (var y = 24; y < 470; y += 48) {
      for (var x = 24; x < W; x += 48) {
        if (x < 200 && y < 200) continue; // window area
        ctx.fillRect(x, y, 12, 12);
      }
    }
    drawWindow();
    drawPoster();
    drawShelf();
    // Contact shadow on the platform top edge, behind the character.
    ctx.fillStyle = 'rgba(26,26,26,0.16)';
    ctx.beginPath(); ctx.ellipse(360, 474, 150, 9, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawWindow() {
    // Frame depth: black outer -> wood band -> night sky; sill below.
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(16, 16, 172, 172);
    ctx.fillStyle = '#b07a45'; ctx.fillRect(22, 22, 160, 160); // wood frame
    ctx.fillStyle = '#4a3670'; ctx.fillRect(30, 30, 144, 144); // night sky
    ctx.fillStyle = '#ffd94a'; // stars (kept clear of the moon + mullions)
    [[52, 52], [96, 44], [70, 100], [120, 110], [44, 130], [100, 140], [160, 120], [60, 150]]
      .forEach(function (s) { ctx.fillRect(s[0], s[1], 6, 6); });
    drawMoon(128, 40); // real crescent, top-right pane, clear of the cross
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
        ctx.fillStyle = ((row + col) % 2 === 0) ? '#ff5d8f' : '#ffffff';
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
    bobPhase += dt * (state.sleeping ? 0.7 : 1.4);
    var bobY = Math.sin(bobPhase) * (state.sleeping ? 2 : 3); // 1600-space px
    var sway = Math.sin(bobPhase * 0.65) * 0.012; // tiny head sway, radians

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
    state.squash = Math.max(0, state.squash - dt * 1.2);

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
      if (state.sleeping || state.moodSleepy) headImg = img.head_sleepy || headImg;
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
      // Accessories (head-parented).
      if (state.accessory === 'glasses' && img.glasses) {
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
      }
      ctx.restore();
    }

    // Stage platform in front of the sprite's lower thighs (grounds the cut edge).
    drawPlatform();

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
      else if (p.type === 'bubble') {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.35, 0, Math.PI * 2); ctx.fill();
      }
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
          speak(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)]);
          if (Math.random() < 0.5) playRandom(VOICE.poke);
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
      loadImage('assets/flat.webp')
    ]).then(function (imgs) {
      img.backhair = imgs[0]; img.body = imgs[1]; img.head = imgs[2];
      img.head_closed = imgs[3]; img.head_sleepy = imgs[4]; img.blush = imgs[5];
      img.beanie = imgs[6]; img.glasses = imgs[7]; img.star_blue = imgs[8]; img.star_pink = imgs[9];
      img.flat = imgs[10]; flatOk = !!imgs[10];
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
    setSleepy: setSleepy, speak: speak,
    _state: state, _spring: spring
  };
})();
