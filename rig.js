// twinkywinky.org rebuild — SMOOTH VECTOR character on a real bone skeleton
// (canvas 2D). The body is drawn as bezier vector art (rounded organic
// shapes, gradients, soft shading) anchored to bone world positions — no
// pixel-art textures, no rigid PNG parts. The torso is a bezier shape built
// from the hips->spine->chest->neck joint curve, so a bend curves the spine;
// limbs are tapered paths through hip->knee->ankle / shoulder->elbow->wrist.
// FK default; 2-bone IK ONLY for planted feet (walk / bend). Deterministic
// seeded idle (R31): no Math.random per frame. imageSmoothingEnabled=true
// (vector art needs smoothing, not nearest-neighbour).
(function () {
  'use strict';

  var SCALE = 380 / 1850;          // character 380px tall on screen
  var GROUND_Y = 552;              // boots on the rug (room coords)
  var HOME_X = 195;
  var DEG = Math.PI / 180;

  // ---------------- seeded PRNG (deterministic idle) ----------------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(20261127);
  // Precomputed deterministic blink schedule: cycle lengths 2.1–3.9s.
  var BLINK_CYCLES = [];
  (function () { for (var i = 0; i < 64; i++) BLINK_CYCLES.push(2.1 + rng() * 1.8); })();
  var FIDGET_KINDS = [];
  (function () { for (var i = 0; i < 32; i++) FIDGET_KINDS.push(Math.floor(rng() * 3)); })();

  // ---------------- voice ----------------
  var VOICE = {
    pet: ['v03_pet.mp3', 'v12_tickle.mp3', 'v10_cute.mp3', 'v11_love.mp3', 'v01_yahoo.mp3'],
    eat: ['v06_best.mp3', 'v01_yahoo.mp3'],
    celebrate: ['v01_yahoo.mp3', 'v02_giggle.mp3', 'v09_knight.mp3'],
    chat: ['v02_giggle.mp3', 'v08_adventure.mp3'],
    poke: ['v07_huh.mp3'],
    upset: ['v07_huh.mp3', 'v09_knight.mp3'],
    giggle: ['v02_giggle.mp3']
  };
  var voiceCache = {};
  var muted = false;
  function loadVoice(name) {
    if (voiceCache[name]) return voiceCache[name];
    var a = new Audio('assets/voice/' + name);
    a.preload = 'auto';
    voiceCache[name] = a;
    return a;
  }
  function playVoice(pool) {
    if (muted) return;
    var list = VOICE[pool] || VOICE.pet;
    var name = list[Math.floor(Math.random() * list.length)];
    try { var a = loadVoice(name); a.currentTime = 0; a.play().catch(function () {}); } catch (e) {}
  }
  var blipAudio = null;
  function blip() {
    if (muted) return;
    try {
      if (!blipAudio) blipAudio = loadVoice('blip.mp3');
      blipAudio.currentTime = 0; blipAudio.play().catch(function () {});
    } catch (e) {}
  }

  // ---------------- images ----------------
  // VECTOR character: no body part PNGs any more. Only the lying sleep
  // illustration (renderSleep) and the carried book stack (a DOM prop image
  // reused so the fallen stack and the carried stack are identical).
  var IMG = {};
  var ITEM_IMG = {};
  var readyPromise = null;

  function loadImg(path) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = path;
    });
  }
  function loadAll() {
    if (readyPromise) return readyPromise;
    var jobs = [];
    jobs.push(loadImg('assets/parts/sleep_lying.png').then(function (im) { IMG.sleep_lying = im; }));
    jobs.push(loadImg('assets/props/books.png').then(function (im) { IMG.booksStack = im; }));
    readyPromise = Promise.all(jobs);
    return readyPromise;
  }

  // ---------------- bone tree (front pivots, RIG-DATA §2/§3) ----------------
  // bind: [x, y], parent name. L/R = viewer's left/right.
  var BONES_F = {
    root:      { bind: [800, 1850], parent: null },
    hips:      { bind: [800, 1215], parent: 'root' },
    spine:     { bind: [800, 1090], parent: 'hips' },
    chest:     { bind: [800, 800],  parent: 'spine' },
    neck:      { bind: [800, 560],  parent: 'chest' },
    head:      { bind: [800, 520],  parent: 'neck' },
    shoulder_L:{ bind: [625, 640],  parent: 'chest' },
    elbow_L:   { bind: [500, 990], parent: 'shoulder_L' },
    wrist_L:   { bind: [430, 1330], parent: 'elbow_L' },
    shoulder_R:{ bind: [975, 640],  parent: 'chest' },
    elbow_R:   { bind: [1100, 990], parent: 'shoulder_R' },
    wrist_R:   { bind: [1170, 1330],parent: 'elbow_R' },
    thigh_L:   { bind: [660, 1215], parent: 'hips' },
    knee_L:    { bind: [660, 1560], parent: 'thigh_L' },
    ankle_L:   { bind: [665, 1780], parent: 'knee_L' },
    thigh_R:   { bind: [940, 1215], parent: 'hips' },
    knee_R:    { bind: [940, 1560], parent: 'thigh_R' },
    ankle_R:   { bind: [935, 1780], parent: 'knee_R' },
    braidUL:   { bind: [660, 430],  parent: 'head' },
    braidLL:   { bind: [660, 580],  parent: 'braidUL' },
    braidUR:   { bind: [940, 430],  parent: 'head' },
    braidLR:   { bind: [940, 580],  parent: 'braidUR' },
    backhair:  { bind: [800, 300],  parent: 'root' }
  };
  // Side-view pivots (RIG-DATA §5). Near arm/shoulder (850,640); far (800,640).
  var BONES_S = {
    root:      { bind: [800, 1850], parent: null },
    hips:      { bind: [810, 1215], parent: 'root' },
    spine:     { bind: [810, 1090], parent: 'hips' },
    chest:     { bind: [810, 800],  parent: 'spine' },
    neck:      { bind: [810, 560],  parent: 'chest' },
    head:      { bind: [810, 520],  parent: 'neck' },
    shoulder_N:{ bind: [850, 640],  parent: 'chest' },
    elbow_N:   { bind: [860, 990], parent: 'shoulder_N' },
    wrist_N:   { bind: [860, 1330], parent: 'elbow_N' },
    shoulder_F:{ bind: [800, 640],  parent: 'chest' },
    elbow_F:   { bind: [810, 990], parent: 'shoulder_F' },
    wrist_F:   { bind: [810, 1330], parent: 'elbow_F' },
    thigh_N:   { bind: [820, 1215], parent: 'hips' },
    knee_N:    { bind: [830, 1560], parent: 'thigh_N' },
    ankle_N:   { bind: [830, 1780], parent: 'knee_N' },
    thigh_F:   { bind: [815, 1215], parent: 'hips' },
    knee_F:    { bind: [825, 1560], parent: 'thigh_F' },
    ankle_F:   { bind: [825, 1780], parent: 'knee_F' },
    braid:     { bind: [700, 430],  parent: 'head' },
    backhair:  { bind: [715, 300],  parent: 'root' }
  };
  var ORDER_F = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
    'shoulder_L', 'elbow_L', 'wrist_L', 'shoulder_R', 'elbow_R', 'wrist_R',
    'thigh_L', 'knee_L', 'ankle_L', 'thigh_R', 'knee_R', 'ankle_R',
    'braidUL', 'braidLL', 'braidUR', 'braidLR', 'backhair'];
  var ORDER_S = ['root', 'hips', 'spine', 'chest', 'neck', 'head',
    'shoulder_N', 'elbow_N', 'wrist_N', 'shoulder_F', 'elbow_F', 'wrist_F',
    'thigh_N', 'knee_N', 'ankle_N', 'thigh_F', 'knee_F', 'ankle_F', 'braid', 'backhair'];

  // IK bind pose (RIG-DATA §3): hips 15px lower -> hip->ankle 490px, ~9.4deg knee bend.
  var IK_HIPS_Y = 1230, THIGH_LEN = 345, SHIN_LEN = 220;

  // ---------------- state ----------------
  var canvas = null, ctx = null, dpr = 1, fitCanvas = null;
  var mode = 'front';           // 'front' | 'side' | 'sleep'
  var facing = 1;               // side view: +1 facing right, -1 facing left
  var charX = HOME_X, groundY = GROUND_Y;
  var anim = null;              // {t0, dur, sample(t01)->patch, done, hold}
  var holdPose = null;          // pose held after an animation (e.g. upset)
  var busy = false;
  var reducedMotion = false;
  var dancing = false;
  var sitting = false;
  var sleeping = false;
  var sleepT0 = 0;
  var faceOverride = null;      // {face, until}
  var excitedUntil = 0;
  var gear = { head: null, neck: null, braid: null, outfit: null, room: null, decor: [] };
  var carriedBook = false;      // book parented to hands
  var handWorld = { x: 0, y: 0, a: 0 }; // last computed near-hand world pos (composite)
  var lastRender = { mode: 'front', charX: HOME_X, face: 'head' };

  // Pose patch: { ang:{bone:deg}, rootDx, rootDy, hipsDy, chestSY, face, handL, handR,
  //   swapArms, scaleX, scaleY, braidA, headDy }
  function basePose() {
    return { ang: {}, rootDx: 0, rootDy: 0, hipsDy: 0, chestSY: 1, face: 'head',
      handL: 'open', handR: 'open', swapArms: false, scaleX: 1, scaleY: 1, braidA: 0, headDy: 0, headScale: 1 };
  }

  // ---------------- keyframe helpers ----------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t * t; }
  // keys: [{t:0..1, v:pose, e:'inOut'|'out'|'in'|'lin'}]; step fields (face/hand) snap.
  var NUM_FIELDS = ['rootDx', 'rootDy', 'hipsDy', 'chestSY', 'scaleX', 'scaleY', 'braidA', 'headDy', 'headScale', 'backhairDy', 'backhairDx'];
  function sampleKeys(keys, t01) {
    var out = basePose();
    if (!keys || !keys.length) return out;
    var i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t01) i++;
    var k0 = keys[i], k1 = keys[Math.min(i + 1, keys.length - 1)];
    var span = (k1.t - k0.t) || 1;
    var lt = clamp01((t01 - k0.t) / span);
    var e = k0.e || 'inOut';
    var et = e === 'lin' ? lt : (e === 'out' ? easeOut(lt) : (e === 'in' ? easeIn(lt) : easeInOut(lt)));
    function mixV(a, b) {
      if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, et);
      return lt < 0.5 ? a : b;
    }
    var allKeys = {};
    [k0.v, k1.v].forEach(function (v) { for (var k in v) allKeys[k] = 1; });
    Object.keys(allKeys).forEach(function (k) {
      if (k === 'ang') {
        out.ang = {};
        var bones = {};
        [k0.v.ang || {}, k1.v.ang || {}].forEach(function (a) { for (var b in a) bones[b] = 1; });
        Object.keys(bones).forEach(function (b) {
          var a0 = (k0.v.ang || {})[b], a1 = (k1.v.ang || {})[b];
          if (a0 === undefined) a0 = a1; if (a1 === undefined) a1 = a0;
          out.ang[b] = mixV(a0, a1);
        });
      } else if (NUM_FIELDS.indexOf(k) !== -1) {
        var n0 = k0.v[k], n1 = k1.v[k];
        if (n0 === undefined) n0 = n1; if (n1 === undefined) n1 = n0;
        out[k] = mixV(n0, n1);
      } else {
        out[k] = lt < 0.5 ? (k0.v[k] !== undefined ? k0.v[k] : k1.v[k]) : (k1.v[k] !== undefined ? k1.v[k] : k0.v[k]);
      }
    });
    // carry forward fields present only in k0
    return out;
  }

  // ---------------- FK solve ----------------
  // pose: {ang, rootDx, rootDy, hipsDy} ; bones: BONES_F or BONES_S.
  // Returns world {bone:{x,y,a}} in composite coords. hipsDy shifts hips+children down.
  function solveFK(bones, order, pose) {
    var world = {};
    var ang = pose.ang || {};
    order.forEach(function (name) {
      var b = bones[name];
      var parent = b.parent ? world[b.parent] : null;
      var localA = (ang[name] || 0);
      var a = parent ? parent.a + localA : localA;
      var x, y;
      if (!parent) {
        x = b.bind[0] + (pose.rootDx || 0);
        y = b.bind[1] + (pose.rootDy || 0);
      } else {
        var pb = bones[b.parent].bind;
        var dx = b.bind[0] - pb[0], dy = b.bind[1] - pb[1];
        var ca = Math.cos(parent.a * DEG), sa = Math.sin(parent.a * DEG);
        x = parent.x + dx * ca - dy * sa;
        y = parent.y + dx * sa + dy * ca;
      }
      // hipsDy: whole body below hips sags (breath / crouch) — apply to hips and descendants.
      if (name === 'hips' && pose.hipsDy) y += pose.hipsDy;
      // backhairDy/Dx: the backhair is parented to root, so in a deep bend
      // its pivot stays at the upright neck and the hair floats in mid-air.
      // Shift it down (Dy) and forward toward the book (Dx, +x in facing
      // coords = toward the head, whichever way she faces) so it stays
      // attached to the head instead of swinging out as a separate slab.
      if (name === 'backhair') {
        if (pose.backhairDy) y += pose.backhairDy;
        if (pose.backhairDx) x += pose.backhairDx;
      }
      else if (parent && world.__hipsDy && name !== 'hips') {
        // descendants inherit the hips offset through parent's position already
      }
      world[name] = { x: x, y: y, a: a };
    });
    return world;
  }

  // 2-bone IK: hip H, ankle target A, lengths L1/L2, knee forward (+x in facing coords).
  // Returns {knee:{x,y}, thighA, shinA} where angles are absolute (deg, 0 = +x, 90 = down).
  function solveIK(H, A, L1, L2) {
    var dx = A.x - H.x, dy = A.y - H.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var maxD = L1 + L2 - 15;              // never full extension (R16)
    if (d > maxD) { var s = maxD / d; A = { x: H.x + dx * s, y: H.y + dy * s }; d = maxD; }
    if (d < 40) d = 40;
    var phi = Math.atan2(dy, dx);
    var cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    cosA = Math.max(-1, Math.min(1, cosA));
    var alpha = Math.acos(cosA);
    // knee forward: rotate phi toward +x (decreasing angle in y-down coords)
    var kA = phi - alpha;
    var K = { x: H.x + L1 * Math.cos(kA), y: H.y + L1 * Math.sin(kA) };
    var thighA = Math.atan2(K.y - H.y, K.x - H.x) / DEG;
    var shinA = Math.atan2(A.y - K.y, A.x - K.x) / DEG;
    return { knee: K, thighA: thighA, shinA: shinA, ankle: A };
  }

  // Front-view squat IK: like solveIK, but the knee splays SIDEWAYS
  // (dir=+1: knee to +x for the right leg; dir=-1: knee to -x for the
  // left leg) so a front-view sit reads as a squat with planted feet
  // instead of two straight legs. Returns {knee, ankle}.
  function solveIKFront(H, A, L1, L2, dir) {
    var dx = A.x - H.x, dy = A.y - H.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var maxD = L1 + L2 - 15;
    if (d > maxD) { var sc = maxD / d; A = { x: H.x + dx * sc, y: H.y + dy * sc }; d = maxD; }
    if (d < 40) d = 40;
    var phi = Math.atan2(dy, dx);
    var cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    cosA = Math.max(-1, Math.min(1, cosA));
    var alpha = Math.acos(cosA);
    var kA = phi - dir * alpha;
    var K = { x: H.x + L1 * Math.cos(kA), y: H.y + L1 * Math.sin(kA) };
    return { knee: K, ankle: A };
  }

  // ---------------- smooth vector character ----------------
  // The character is drawn as smooth vector art (bezier paths, gradients,
  // rounded organic shapes) in composite space (1600x1850). NO pixel-art
  // textures for the body: no chunky edges, no flat PNG parts. Every shape
  // is anchored to bone world positions from solveFK / the walk IK legs, so
  // the skeleton drives everything; nothing moves by rotation alone.
  // Limbs are tapered filled paths through hip->knee->ankle /
  // shoulder->elbow->wrist, so a knee or elbow bend is a smooth curve
  // through the joints, never a hinged plank. The torso is a closed bezier
  // shape built from the hips->spine->chest->neck joint curve, so a bend
  // curves the whole spine.
  var COL = {
    skin: '#FDEBE6', skinShade: '#F2CFC7', skinHi: '#F8DDD6',
    hair: '#F6A3C2', hairDeep: '#E87AA8', hairDark: '#D65E93', hairHi: '#F9BCD4',
    hoodie: '#FFFFFF', hoodieShade: '#F0E5EB', hoodieLine: 'rgba(90,60,80,0.30)',
    plum: '#4A3B47',
    shorts: '#232529', shortsDeep: '#101114',
    sock: '#FDF6EC', sockHi: '#FFF6E8', cuff: '#F27EA9',
    boot: '#26282D', bootFar: '#1B1C20', sole: '#5A5B63',
    eye: '#7B5EA7', eyeDark: '#4A3B47', blush: 'rgba(242,126,169,0.55)',
    gold: '#F2B705'
  };
  function vgrad(x0, y0, x1, y1, c0, c1) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    return g;
  }
  function ell(cx, cy, rx, ry, rot, fill) {
    ctx.save(); ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot * DEG);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  }
  function star5(cx, cy, r, fill) {
    ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = (i % 2) ? r * 0.45 : r;
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
  }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Smooth curve through pts. move=false continues the current path.
  function traceSmooth(pts, move) {
    if (move !== false) ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }
  // Tapered outline through pts with per-point full widths. Builds the
  // current path (fill / stroke / clip by caller).
  function limbPath(pts, widths) {
    var L = [], R = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len, hw = widths[i] / 2;
      L.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
      R.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
    }
    ctx.beginPath();
    traceSmooth(L);
    ctx.lineTo(R[R.length - 1].x, R[R.length - 1].y);
    R.reverse(); traceSmooth(R, false);
    ctx.closePath();
  }
  // Filled tapered limb with round caps, a soft highlight along the upper
  // side, and a soft outline. Base is a solid colour (gradients across a
  // tapered limb would band at the caps).
  function limb(pts, widths, base, light) {
    limbPath(pts, widths);
    ctx.fillStyle = base; ctx.fill();
    ell(pts[0].x, pts[0].y, widths[0] / 2, widths[0] / 2, 0, base);
    ell(pts[pts.length - 1].x, pts[pts.length - 1].y,
      widths[widths.length - 1] / 2, widths[widths.length - 1] / 2, 0, base);
    if (light) {
      var hp = pts.map(function (p, i) { return { x: p.x - widths[i] * 0.16, y: p.y - widths[i] * 0.10 }; });
      var hw = widths.map(function (w) { return w * 0.42; });
      limbPath(hp, hw);
      ctx.fillStyle = light; ctx.fill();
      ell(hp[0].x, hp[0].y, hw[0] / 2, hw[0] / 2, 0, light);
      ell(hp[hp.length - 1].x, hp[hp.length - 1].y, hw[hw.length - 1] / 2, hw[hw.length - 1] / 2, 0, light);
    }
    limbPath(pts, widths);
    ctx.strokeStyle = 'rgba(74,59,71,0.28)'; ctx.lineWidth = 5; ctx.stroke();
  }
  // Hoodie sleeve: white tapered limb with soft plum checker diamonds
  // clipped inside it (the checker identity, without the harlequin look).
  function sleeve(pts, widths, base, diamondAlpha) {
    limbPath(pts, widths);
    ctx.save(); ctx.clip();
    ctx.fillStyle = base || COL.hoodie;
    ctx.fillRect(0, 0, 1600, 1850);
    ctx.fillStyle = COL.plum;
    ctx.globalAlpha = (diamondAlpha === undefined) ? 0.85 : diamondAlpha;
    for (var s = 0; s < pts.length - 1; s++) {
      var a = pts[s], b = pts[s + 1];
      var segLen = Math.hypot(b.x - a.x, b.y - a.y);
      var n = Math.max(1, Math.floor(segLen / 85));
      for (var k = 0; k <= n; k++) {
        var t = (k + 0.5) / (n + 1);
        var cx = a.x + (b.x - a.x) * t, cy = a.y + (b.y - a.y) * t;
        var ang = Math.atan2(b.y - a.y, b.x - a.x), r = 30;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    limbPath(pts, widths);
    ctx.strokeStyle = COL.hoodieLine; ctx.lineWidth = 5; ctx.stroke();
  }
  // Hand at the end of a forearm (el -> wrist gives the direction).
  function handAt(wr, el, variant) {
    var dx = wr.x - el.x, dy = wr.y - el.y, len = Math.hypot(dx, dy) || 1;
    var ux = dx / len, uy = dy / len;
    var cx = wr.x + ux * 52, cy = wr.y + uy * 52;
    var ang = Math.atan2(dy, dx);
    if (variant === 'fist') {
      ell(cx, cy, 54, 54, 0, COL.skin);
      ell(cx - ux * 8, cy - uy * 8, 30, 30, 0, COL.skinShade);
      return;
    }
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.fillStyle = COL.skin;
    ctx.beginPath(); ctx.ellipse(0, 0, 66, 48, 0, 0, Math.PI * 2); ctx.fill();
    [-20, 0, 20].forEach(function (o) {
      ctx.beginPath(); ctx.ellipse(58, o, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  function cuffAt(wr) {
    ctx.save(); ctx.translate(wr.x, wr.y); ctx.rotate(wr.a * DEG);
    ctx.fillStyle = COL.cuff;
    ctx.beginPath(); ctx.ellipse(0, 0, 50, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------------- faces (head-local coords, head joint = origin) ----------------
  function faceKind(face) {
    return face === 'head_closed' ? 'closed' : face === 'head_sleep' ? 'sleep' :
      face === 'head_frown' ? 'frown' : face === 'head_happy' ? 'happy' : 'open';
  }
  function eyeFront(cx, cy, kind) {
    if (kind === 'closed' || kind === 'sleep' || kind === 'happy') {
      ctx.strokeStyle = COL.eyeDark; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath();
      if (kind === 'happy') { ctx.moveTo(cx - 34, cy - 6); ctx.quadraticCurveTo(cx, cy + 26, cx + 34, cy - 6); }
      else { ctx.moveTo(cx - 34, cy); ctx.quadraticCurveTo(cx, cy + 16, cx + 34, cy); }
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx + 28, cy - 2); ctx.lineTo(cx + 40, cy - 12);
      ctx.moveTo(cx + 16, cy + 4); ctx.lineTo(cx + 26, cy - 6);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy);
    ctx.quadraticCurveTo(cx, cy - 30, cx + 40, cy);
    ctx.quadraticCurveTo(cx, cy + 24, cx - 40, cy);
    ctx.closePath(); ctx.fill();
    var irisR = (kind === 'frown') ? 13 : 19, iy = (kind === 'frown') ? cy + 6 : cy + 2;
    ctx.fillStyle = COL.eye;
    ctx.beginPath(); ctx.ellipse(cx, iy, 17, irisR, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A2430';
    ctx.beginPath(); ctx.arc(cx, iy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx - 6, iy - 8, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COL.eyeDark; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy - 2); ctx.quadraticCurveTo(cx, cy - 32, cx + 42, cy - 2);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 38, cy - 6); ctx.lineTo(cx - 50, cy - 18);
    ctx.moveTo(cx + 38, cy - 6); ctx.lineTo(cx + 50, cy - 18);
    ctx.stroke();
    if (kind === 'frown') {
      ctx.strokeStyle = COL.skin; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.moveTo(cx - 42, cy - 14); ctx.lineTo(cx + 42, cy - 14); ctx.stroke();
    }
  }
  function browFront(cx, cy, kind, dir) {
    ctx.strokeStyle = COL.eyeDark; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath();
    if (kind === 'frown') { ctx.moveTo(cx - dir * 40, cy - 78); ctx.lineTo(cx + dir * 40, cy - 52); }
    else if (kind === 'happy') { ctx.moveTo(cx - 38, cy - 72); ctx.quadraticCurveTo(cx, cy - 92, cx + 38, cy - 72); }
    else { ctx.moveTo(cx - 38, cy - 66); ctx.quadraticCurveTo(cx, cy - 84, cx + 38, cy - 66); }
    ctx.stroke();
  }
  function mouthFront(kind) {
    ctx.strokeStyle = '#B34A6B'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    if (kind === 'happy') {
      ctx.fillStyle = '#A34A63';
      ctx.beginPath();
      ctx.moveTo(-36, -58); ctx.quadraticCurveTo(0, -8, 36, -58); ctx.closePath(); ctx.fill();
      rr(-28, -58, 56, 13, 6); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    } else if (kind === 'frown') {
      ctx.beginPath(); ctx.moveTo(-28, -38); ctx.quadraticCurveTo(0, -72, 28, -38); ctx.stroke();
    } else if (kind === 'closed' || kind === 'sleep') {
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-14, -52); ctx.lineTo(14, -52); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-26, -58); ctx.quadraticCurveTo(0, -34, 26, -58); ctx.stroke();
    }
  }
  // Front face. Head joint (chin) at (0,0); face centre (0,-230).
  function drawFaceFront(face) {
    ell(-252, -205, 32, 50, 0, COL.skin);
    ell(252, -205, 32, 50, 0, COL.skin);
    ctx.fillStyle = vgrad(-255, -500, 255, 40, '#FDEBE6', '#F5D5CE');
    ctx.beginPath(); ctx.ellipse(0, -230, 255, 265, 0, 0, Math.PI * 2); ctx.fill();
    // Hair crown + fringe (scalloped edge sits high so the eyes stay open).
    ctx.fillStyle = vgrad(-300, -560, 300, 120, COL.hair, COL.hairDeep);
    ctx.beginPath();
    ctx.moveTo(-288, -150);
    ctx.bezierCurveTo(-312, -420, -185, -545, 0, -548);
    ctx.bezierCurveTo(185, -545, 312, -420, 288, -150);
    ctx.bezierCurveTo(235, -280, 195, -255, 145, -295);
    ctx.bezierCurveTo(95, -335, 45, -262, 0, -300);
    ctx.bezierCurveTo(-45, -262, -95, -335, -145, -295);
    ctx.bezierCurveTo(-195, -255, -235, -280, -288, -150);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-180, -420); ctx.quadraticCurveTo(-120, -300, -150, -180);
    ctx.moveTo(150, -430); ctx.quadraticCurveTo(200, -320, 170, -200);
    ctx.stroke();
    // Side locks framing the face.
    limb([{ x: -262, y: -280 }, { x: -292, y: -60 }, { x: -282, y: 80 }], [92, 78, 52], COL.hair, COL.hairHi);
    limb([{ x: 262, y: -280 }, { x: 292, y: -60 }, { x: 282, y: 80 }], [92, 78, 52], COL.hair, COL.hairHi);
    star5(-152, -368, 36, COL.gold);
    star5(152, -368, 36, COL.gold);
    ell(-188, -105, 36, 20, 0, COL.blush);
    ell(188, -105, 36, 20, 0, COL.blush);
    ctx.strokeStyle = 'rgba(120,70,80,0.5)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -150); ctx.lineTo(0, -128); ctx.stroke();
    var kind = faceKind(face);
    eyeFront(-115, -185, kind);
    eyeFront(115, -185, kind);
    browFront(-115, -185, kind, 1);
    browFront(115, -185, kind, -1);
    mouthFront(kind);
  }
  function eyeSide(cx, cy, kind) {
    if (kind === 'closed' || kind === 'sleep' || kind === 'happy') {
      ctx.strokeStyle = COL.eyeDark; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath();
      if (kind === 'happy') { ctx.moveTo(cx - 30, cy - 4); ctx.quadraticCurveTo(cx, cy + 22, cx + 30, cy - 4); }
      else { ctx.moveTo(cx - 30, cy); ctx.quadraticCurveTo(cx, cy + 14, cx + 30, cy); }
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.ellipse(cx, cy, 38, 22, 0, 0, Math.PI * 2); ctx.fill();
    var irisR = (kind === 'frown') ? 12 : 19;
    ctx.fillStyle = COL.eye;
    ctx.beginPath(); ctx.ellipse(cx + 4, cy + 2, 16, irisR, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2A2430';
    ctx.beginPath(); ctx.arc(cx + 4, cy + 2, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(cx - 2, cy - 7, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COL.eyeDark; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 36, cy - 6); ctx.quadraticCurveTo(cx, cy - 30, cx + 38, cy - 6); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx + 30, cy - 10); ctx.lineTo(cx + 44, cy - 22);
    ctx.moveTo(cx + 18, cy - 12); ctx.lineTo(cx + 28, cy - 26);
    ctx.stroke();
  }
  // Side face, facing +x (the frame mirrors it for facing -1).
  function drawFaceSide(face) {
    // Hair back mass + tail.
    limb([{ x: -140, y: -420 }, { x: -250, y: -160 }, { x: -280, y: 60 }], [300, 220, 120], COL.hair, COL.hairHi);
    ell(-90, -280, 230, 280, 0, COL.hair);
    // Face profile: forehead -> nose bump -> lips -> chin -> jaw.
    ctx.fillStyle = vgrad(-140, -500, 160, 0, '#FDEBE6', '#F5D5CE');
    ctx.beginPath();
    ctx.moveTo(-150, -480);
    ctx.bezierCurveTo(-40, -520, 60, -480, 95, -420);
    ctx.bezierCurveTo(115, -380, 120, -350, 132, -330);
    ctx.bezierCurveTo(158, -300, 162, -278, 140, -258);
    ctx.bezierCurveTo(128, -244, 138, -228, 132, -214);
    ctx.bezierCurveTo(140, -196, 128, -182, 118, -168);
    ctx.bezierCurveTo(128, -140, 110, -118, 80, -100);
    ctx.bezierCurveTo(20, -60, -40, -30, -55, 0);
    ctx.lineTo(-150, 0);
    ctx.closePath(); ctx.fill();
    // Fringe over the forehead.
    ctx.fillStyle = vgrad(-300, -560, 160, -200, COL.hair, COL.hairDeep);
    ctx.beginPath();
    ctx.moveTo(-260, -360);
    ctx.bezierCurveTo(-240, -500, -80, -545, 40, -500);
    ctx.bezierCurveTo(90, -480, 115, -440, 108, -400);
    ctx.bezierCurveTo(60, -420, 20, -380, -30, -400);
    ctx.bezierCurveTo(-90, -420, -160, -380, -260, -360);
    ctx.closePath(); ctx.fill();
    star5(-150, -440, 32, COL.gold);
    star5(-60, -480, 28, COL.gold);
    var kind = faceKind(face);
    eyeSide(45, -315, kind);
    ctx.strokeStyle = COL.eyeDark; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -368); ctx.quadraticCurveTo(45, -388, 92, -366); ctx.stroke();
    ell(55, -255, 30, 16, 0, COL.blush);
    ctx.strokeStyle = '#B34A6B'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(105, -205); ctx.quadraticCurveTo(122, -196, 108, -184); ctx.stroke();
  }

  // ---------------- body parts (world-space, bone-anchored) ----------------
  function legFront(hip, knee, ankle, toeDir, far) {
    var skin = far ? '#EFD8D2' : COL.skin;
    var sockC = far ? '#EFE3D6' : COL.sock;
    var bootC = far ? COL.bootFar : COL.boot;
    limb([hip, knee], [150, 112], skin, far ? null : COL.skinHi);
    limb([knee, ankle], [112, 92], sockC, far ? null : COL.sockHi);
    ell(knee.x, knee.y + 24, 58, 16, 0, COL.cuff);
    limb([ankle, { x: ankle.x, y: 1822 }], [118, 130], bootC, null);
    ell(ankle.x + toeDir * 55, 1821, 125, 46, 0, bootC);
    ell(ankle.x + toeDir * 55, 1850, 128, 16, 0, COL.sole);
  }
  function legSide(hip, knee, ankle, far) {
    var skin = far ? '#EFD8D2' : COL.skin;
    var sockC = far ? '#EFE3D6' : COL.sock;
    var bootC = far ? COL.bootFar : COL.boot;
    limb([hip, knee], [140, 108], skin, far ? null : COL.skinHi);
    limb([knee, ankle], [105, 88], sockC, far ? null : COL.sockHi);
    ell(knee.x, knee.y + 22, 56, 15, 0, COL.cuff);
    limb([ankle, { x: ankle.x, y: 1822 }], [112, 122], bootC, null);
    ell(ankle.x + 115, 1821, 150, 46, 0, bootC);
    ell(ankle.x + 115, 1850, 152, 16, 0, COL.sole);
  }
  function armFront(W, side, hand) {
    var S = (side === 'L')
      ? { sh: W.shoulder_L, el: W.elbow_L, wr: W.wrist_L }
      : { sh: W.shoulder_R, el: W.elbow_R, wr: W.wrist_R };
    sleeve([S.sh, S.el, S.wr], [126, 100, 86]);
    cuffAt(S.wr);
    handAt(S.wr, S.el, hand);
  }
  function armSide(W, near, hand) {
    var S = near
      ? { sh: W.shoulder_N, el: W.elbow_N, wr: W.wrist_N }
      : { sh: W.shoulder_F, el: W.elbow_F, wr: W.wrist_F };
    if (near) sleeve([S.sh, S.el, S.wr], [112, 92, 80]);
    else sleeve([S.sh, S.el, S.wr], [112, 92, 80], '#E4D9DE', 0.6);
    cuffAt(S.wr);
    handAt(S.wr, S.el, hand);
  }
  function torsoFront(W, chestSY) {
    var pts = [W.neck, W.chest, W.spine, W.hips];
    var hw = [150, 235, 175, 215];
    var s = 1 + (chestSY - 1) * 3;
    hw[1] *= s; hw[2] *= s;
    var L = [], R = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len;
      L.push({ x: pts[i].x + nx * hw[i], y: pts[i].y + ny * hw[i] });
      R.push({ x: pts[i].x - nx * hw[i], y: pts[i].y - ny * hw[i] });
    }
    ctx.beginPath();
    traceSmooth(L);
    ctx.quadraticCurveTo((L[3].x + R[3].x) / 2, Math.max(L[3].y, R[3].y) + 30, R[3].x, R[3].y);
    R.reverse(); traceSmooth(R, false);
    ctx.quadraticCurveTo((L[0].x + R[0].x) / 2, Math.min(L[0].y, R[0].y) - 25, L[0].x, L[0].y);
    ctx.closePath();
    ctx.fillStyle = vgrad(W.neck.x, W.neck.y - 40, W.hips.x, W.hips.y + 40, '#FFFFFF', COL.hoodieShade);
    ctx.fill();
    ctx.strokeStyle = COL.hoodieLine; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,80,0.35)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(W.neck.x, W.neck.y + 28, 118, 42, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.strokeStyle = '#D9CBD4'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W.neck.x - 38, W.neck.y + 50); ctx.lineTo(W.neck.x - 48, W.neck.y + 185);
    ctx.moveTo(W.neck.x + 38, W.neck.y + 50); ctx.lineTo(W.neck.x + 48, W.neck.y + 185);
    ctx.stroke();
    ell(W.neck.x - 48, W.neck.y + 190, 10, 13, 0, '#D9CBD4');
    ell(W.neck.x + 48, W.neck.y + 190, 10, 13, 0, '#D9CBD4');
    rr(W.chest.x - 130, W.chest.y + 150, 260, 150, 42);
    ctx.fillStyle = '#EFE6EA'; ctx.fill();
    ctx.strokeStyle = COL.hoodieLine; ctx.lineWidth = 5; ctx.stroke();
  }
  function shortsFront(W) {
    var hx = W.hips.x, hy = W.hips.y;
    ctx.fillStyle = vgrad(hx - 210, hy - 60, hx + 210, hy + 260, COL.shorts, COL.shortsDeep);
    ctx.beginPath();
    ctx.moveTo(hx - 178, hy - 70);
    ctx.quadraticCurveTo(hx, hy - 58, hx + 178, hy - 70);
    ctx.lineTo(hx + 178, hy + 170);
    ctx.quadraticCurveTo(hx + 178, hy + 228, hx + 120, hy + 232);
    ctx.quadraticCurveTo(hx + 75, hy + 198, hx + 30, hy + 232);
    ctx.quadraticCurveTo(hx, hy + 187, hx - 30, hy + 232);
    ctx.quadraticCurveTo(hx - 75, hy + 198, hx - 120, hy + 232);
    ctx.quadraticCurveTo(hx - 178, hy + 228, hx - 178, hy + 170);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(hx - 168, hy - 50); ctx.quadraticCurveTo(hx, hy - 38, hx + 168, hy - 50); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(hx - 160, hy + 210);
    ctx.quadraticCurveTo(hx - 75, hy + 182, hx - 30, hy + 216);
    ctx.quadraticCurveTo(hx, hy + 176, hx + 30, hy + 216);
    ctx.quadraticCurveTo(hx + 75, hy + 182, hx + 160, hy + 210);
    ctx.stroke();
    rr(hx - 18, hy - 64, 36, 26, 6); ctx.fillStyle = COL.gold; ctx.fill();
  }
  function torsoSide(W, chestSY) {
    var pts = [W.neck, W.chest, W.spine, W.hips];
    var fw = [95, 160, 72, 140], bw = [100, 128, 82, 135];
    var s = 1 + (chestSY - 1) * 3;
    fw[1] *= s;
    var F = [], B = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len;
      if (nx > 0) { nx = -nx; ny = -ny; } // n must point backward (-x in bind)
      F.push({ x: pts[i].x - nx * fw[i], y: pts[i].y - ny * fw[i] });
      B.push({ x: pts[i].x + nx * bw[i], y: pts[i].y + ny * bw[i] });
    }
    ctx.beginPath();
    traceSmooth(F);
    ctx.quadraticCurveTo((F[3].x + B[3].x) / 2, Math.max(F[3].y, B[3].y) + 30, B[3].x, B[3].y);
    B.reverse(); traceSmooth(B, false);
    ctx.quadraticCurveTo((F[0].x + B[0].x) / 2, Math.min(F[0].y, B[0].y) - 25, F[0].x, F[0].y);
    ctx.closePath();
    ctx.fillStyle = vgrad(W.neck.x - 100, W.neck.y, W.hips.x + 130, W.hips.y, '#FFFFFF', COL.hoodieShade);
    ctx.fill();
    ctx.strokeStyle = COL.hoodieLine; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,80,0.35)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(W.neck.x, W.neck.y + 25, 90, 38, 0, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
    ctx.strokeStyle = '#D9CBD4'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    var fx = W.chest.x + 105;
    ctx.beginPath();
    ctx.moveTo(fx, W.chest.y - 40); ctx.lineTo(fx + 12, W.chest.y + 110);
    ctx.moveTo(fx - 28, W.chest.y - 30); ctx.lineTo(fx - 16, W.chest.y + 120);
    ctx.stroke();
    ctx.strokeStyle = COL.hoodieLine; ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(W.chest.x + 42, W.chest.y + 170);
    ctx.quadraticCurveTo(W.chest.x + 72, W.chest.y + 200, W.chest.x + 78, W.chest.y + 250);
    ctx.stroke();
  }
  function shortsSide(W) {
    var hx = W.hips.x, hy = W.hips.y;
    ctx.fillStyle = vgrad(hx - 125, hy - 60, hx + 130, hy + 250, COL.shorts, COL.shortsDeep);
    ctx.beginPath();
    ctx.moveTo(hx - 118, hy - 70);
    ctx.quadraticCurveTo(hx, hy - 58, hx + 120, hy - 70);
    ctx.lineTo(hx + 120, hy + 180);
    ctx.quadraticCurveTo(hx + 120, hy + 228, hx + 72, hy + 232);
    ctx.quadraticCurveTo(hx + 20, hy + 196, hx - 55, hy + 232);
    ctx.quadraticCurveTo(hx - 118, hy + 228, hx - 118, hy + 180);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(hx - 110, hy - 50); ctx.quadraticCurveTo(hx, hy - 38, hx + 112, hy - 50); ctx.stroke();
    rr(hx + 84, hy - 60, 34, 26, 6); ctx.fillStyle = COL.gold; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(hx + 52, hy + 8); ctx.lineTo(hx + 105, hy + 26); ctx.stroke();
  }
  function braidFront(W, side, lag) {
    var U = W['braidU' + side], L = W['braidL' + side];
    if (!U || !L) return;
    var dx = L.x - U.x, dy = L.y - U.y;
    var a = Math.atan2(dy, dx) + (lag || 0) * DEG;
    var tip = { x: L.x + Math.cos(a) * 150, y: L.y + Math.sin(a) * 150 };
    limb([U, L, tip], [78, 62, 38], COL.hair, COL.hairHi);
    ctx.strokeStyle = COL.hairDark; ctx.lineWidth = 7; ctx.lineCap = 'round';
    [0.35, 0.6, 0.85].forEach(function (t) {
      var px = U.x + (tip.x - U.x) * t, py = U.y + (tip.y - U.y) * t;
      var nx = -Math.sin(a), ny = Math.cos(a), w = 30 * (1 - t * 0.4);
      ctx.beginPath(); ctx.moveTo(px - nx * w, py - ny * w); ctx.lineTo(px + nx * w, py + ny * w); ctx.stroke();
    });
    ell(tip.x, tip.y, 26, 20, 0, COL.cuff);
  }

  // ---------------- idle (front, procedural, deterministic) ----------------
  function idlePose(t) {
    var p = basePose();
    if (sleeping) return p;
    // Breath 3.0s loop: rest 800ms -> fall 250 -> low 800 -> rise 250 -> rest ~900.
    var bt = (t % 3.0);
    var breath; // 0 rest, 1 low
    if (bt < 0.8) breath = 0;
    else if (bt < 1.05) breath = (bt - 0.8) / 0.25;
    else if (bt < 1.85) breath = 1;
    else if (bt < 2.1) breath = 1 - (bt - 1.85) / 0.25;
    else breath = 0;
    var amp = reducedMotion ? 0 : 1;
    p.hipsDy = breath * 6 * amp;                 // torso +3px screen ~ 15 composite; hips carry part
    p.chestSY = 1 + breath * 0.015 * amp;
    p.headDy = breath * 4 * amp;
    // Blink: deterministic cycle schedule.
    var cyc = 0, idx = 0, acc = 0;
    while (acc + BLINK_CYCLES[idx % BLINK_CYCLES.length] < t) { acc += BLINK_CYCLES[idx % BLINK_CYCLES.length]; idx++; }
    var into = t - acc;
    if (into < 0.15 && !faceOverride) p.face = 'head_closed';
    // Weight shift every ~15s: hips +/- 4px screen over 1.2s.
    var ws = Math.sin(t * 2 * Math.PI / 15) * 12 * amp;
    p.rootDx = ws * 0.3;
    p.ang.hips = ws * 0.02;
    // Idle arms: slightly bent at the elbow and angled a touch inward, so
    // they hang relaxed at mid-thigh instead of reading as straight tubes.
    // (Placed before the fidgets so the hair-tuck can still override elbow_R.)
    p.ang.elbow_L = -10;
    p.ang.elbow_R = 10;
    // Fidgets: one per ~15s block, deterministic kind.
    var block = Math.floor(t / 15);
    var kind = FIDGET_KINDS[block % FIDGET_KINDS.length];
    var ft = t % 15;
    if (kind === 0 && ft > 4 && ft < 5.6) {          // look around
      var lt = (ft - 4) / 1.6;
      p.ang.head = Math.sin(lt * Math.PI) * 12 * amp;
    } else if (kind === 1 && ft > 6 && ft < 7.2) {  // small stretch
      var st = (ft - 6) / 1.2;
      p.ang.shoulder_L = -Math.sin(st * Math.PI) * 18 * amp;
      p.ang.shoulder_R = -Math.sin(st * Math.PI) * 18 * amp;
      p.chestSY = 1 + Math.sin(st * Math.PI) * 0.03 * amp;
    } else if (kind === 2 && ft > 8 && ft < 9.4) {  // hair tuck
      var ht = (ft - 8) / 1.4;
      p.ang.shoulder_R = -Math.sin(ht * Math.PI) * 22 * amp;
      p.ang.elbow_R = Math.sin(ht * Math.PI) * 45 * amp;
      p.ang.head = Math.sin(ht * Math.PI) * 5 * amp;
    }
    // Braid lag: follows head with a delay (phase-shifted sine of breath).
    p.braidA = Math.sin(t * 2 * Math.PI / 3.0 - 0.6) * 2 * amp;
    // Torso sway with the breath (rig v2): the chest rolls a touch and the
    // arms hang looser, so the idle is a body breathing, not a static cutout.
    p.ang.chest = breath * 2 * amp;
    p.ang.shoulder_L = -8 + breath * 2 * amp;
    p.ang.shoulder_R = 8 - breath * 2 * amp;
    if (dancing) {
      p.ang.hips = Math.sin(t * 2 * Math.PI / 0.9) * 4;
      p.ang.chest = Math.sin(t * 2 * Math.PI / 0.9) * 5;
      p.ang.head = Math.sin(t * 2 * Math.PI / 0.9 + 0.5) * 6;
      p.braidA = Math.sin(t * 2 * Math.PI / 0.9 - 0.6) * 8;
    }
    if (sitting) {
      p.hipsDy = 150;
      p.ang.thigh_L = -18; p.ang.thigh_R = 18;
      p.ang.knee_L = 25; p.ang.knee_R = -25;
      p.ang.chest = 8;
    }
    if (Date.now() < excitedUntil) { p.chestSY = 1.02; p.braidA += 2; }
    return p;
  }

  // ---------------- walk (side view, IK legs) ----------------
  // walk state, driven by anim sampler; stored here so render() can draw legs.
  var walkState = null; // {fromX,toX,dir,speed,stepPx,carrying,elapsed,dur}
  var walkCheck = null; // the active walkTo interval; only ONE walk drives
  // charX at a time (fix round 2): a new walkTo cancels the previous
  // interval, otherwise the old interval keeps writing charX toward its
  // stale target and fires its done() mid-walk, hijacking the new walk.
  function walkPose(elapsed, ws) {
    var p = basePose();
    var d = ws.speed * elapsed;                    // px travelled along dir
    var total = Math.abs(ws.toX - ws.fromX);
    if (d > total) d = total;
    var step = ws.stepPx;                          // 30 walk / 22 carry
    var u = d % step;                              // px into current step
    var stepIdx = Math.floor(d / step);
    var stepFrac = u / step;
    // Bob (SPECIALIST §3 phasing): contact 0, down +8px, passing ~-2, up -8px.
    // Keyframes at u fractions: 0 -> 0, 8/30 -> +8, 15/30 -> -2, 23/30 -> -8, 30 -> 0.
    var bobKeys = [[0, 0], [0.267, 8], [0.5, -2], [0.767, -8], [1, 0]];
    var bob = 0;
    for (var i = 0; i < bobKeys.length - 1; i++) {
      if (stepFrac >= bobKeys[i][0] && stepFrac <= bobKeys[i + 1][0]) {
        var f = (stepFrac - bobKeys[i][0]) / (bobKeys[i + 1][0] - bobKeys[i][0]);
        bob = lerp(bobKeys[i][1], bobKeys[i + 1][1], f);
        break;
      }
    }
    if (reducedMotion) bob = 0;
    var bobC = bob / SCALE;                        // composite px
    var hipX = 810, hipY = IK_HIPS_Y + bobC;
    // Foot world positions (screen coords, facing coords: dir folded in).
    // Planted foot: fixed in world during the step.
    var q0 = ws.fromX + ws.dir * (Math.floor(d / step) * step); // hip screen x at step start
    var plantedX = q0 + ws.dir * (step / 2);
    var swingFromX = q0 - ws.dir * (step / 2);
    var swingToX = q0 + ws.dir * (step * 1.5);
    var e = stepFrac * stepFrac * (3 - 2 * stepFrac); // smoothstep
    var swingX = lerp(swingFromX, swingToX, e);
    var lift = Math.sin(stepFrac * Math.PI) * 10;  // px screen, max at passing
    if (reducedMotion) lift *= 0.4;
    // Which leg is planted alternates each step.
    var plantedIsNear = (stepIdx % 2 === 0);
    var feet = {
      near: plantedIsNear ? { x: plantedX, y: GROUND_Y, planted: true }
                          : { x: swingX, y: GROUND_Y - lift, planted: false },
      far: plantedIsNear ? { x: swingX, y: GROUND_Y - lift, planted: false }
                         : { x: plantedX, y: GROUND_Y, planted: true }
    };
    // Convert to local composite coords (facing +x).
    function toLocal(fx, fy) {
      return { x: 800 + ws.dir * (fx - charX) / SCALE, y: 1850 + (fy - GROUND_Y) / SCALE };
    }
    var hipLocal = { x: hipX, y: hipY };
    var legs = {};
    ['near', 'far'].forEach(function (side) {
      var f = feet[side];
      var fl = toLocal(f.x, f.y);
      // Ankle sits 70 composite behind the ball of the foot, 130 above ground.
      var ankle = { x: fl.x - 70, y: 1780 + (f.y - GROUND_Y) / SCALE };
      var ik = solveIK(hipLocal, ankle, THIGH_LEN, SHIN_LEN);
      // Bind angles: thigh bind hip->knee ~88.3deg (side), shin bind knee->ankle ~90deg.
      var thighBind = Math.atan2(1560 - 1215, 830 - 820) / DEG;
      var shinBind = Math.atan2(1780 - 1560, 830 - 830) / DEG;
      // Boot rotation is ABSOLUTE (the boot bone matrix rotates about the
      // ankle in composite space, it does not compose with the leg chain):
      // planted = sole flat (0deg), swing = toes point down (+25deg).
      var bootWorld = f.planted ? 0 : 25;
      legs[side] = {
        thighA: ik.thighA - thighBind, shinA: ik.shinA - shinBind,
        bootA: bootWorld,
        hip: hipLocal, knee: ik.knee, ankle: ik.ankle, foot: f
      };
    });
    // Arms swing opposite legs, +-18-22deg, 1-2f lag (phase shift).
    // At contact the near leg is planted ahead, so the near arm is BACK (+).
    var cyc = (d / (step * 2)) * 2 * Math.PI;
    var swing = ws.carrying ? 0 : 20;
    p.ang.shoulder_N = Math.cos(cyc) * swing;
    p.ang.shoulder_F = -Math.cos(cyc) * swing * 0.7;
    // Elbow stays visibly bent (20-30deg) so the arm never reads as one
    // straight plank at the back of the swing: the old 12deg was too
    // subtle at phone scale and the sleeve rendered as a rigid white bar.
    p.ang.elbow_N = 25 + Math.sin(cyc) * 5;
    p.ang.elbow_F = 25 - Math.sin(cyc) * 5;
    if (ws.carrying) {
      // Carry: elbows bent, stack clutched to the chest. The old pose
      // (shoulder -35 / elbow -78) held the arm nearly straight forward, so
      // the wrist sat ~132px screen ahead of the body and the book slid
      // behind the right-rail circles. shoulder -12 / elbow -125 puts the
      // near wrist ~83px ahead of the body centre at chest height; the stack
      // (centre 31px screen behind the wrist, see GRASP_DX) then sits ~52px
      // ahead of the chest, its far edge ~66px clear of the rail (x>=338).
      p.ang.shoulder_N = -12; p.ang.elbow_N = -125;
      p.ang.shoulder_F = -10; p.ang.elbow_F = -115;
    }
    p.ang.chest = ws.carrying ? 6 : 3;
    p.ang.head = -2;
    // Secondary motion (rig v2) — a body, not a sliding cutout:
    // hips sway with the stride, chest counter-rotates, head stabilises
    // against the chest, and the whole body squashes at foot contact and
    // stretches at the passing step (volume-preserving, about the ground).
    var sway = Math.sin(cyc);
    p.ang.hips = sway * 4;
    p.ang.chest = (ws.carrying ? 6 : 3) - sway * 3;
    p.ang.head = -2 - sway * 2;
    var sq = Math.sin(stepFrac * Math.PI);            // 0 contact, 1 passing
    var ct = Math.cos(stepFrac * Math.PI);
    p.scaleY = 1 + 0.05 * sq - 0.06 * ct * ct;
    p.scaleX = 1 - (p.scaleY - 1) * 0.7;
    // Backhair is a child of root: give it a small lagged sway so it never
    // floats in mid-air where the head used to be (bend) or lags the body.
    p.ang.backhair = Math.sin(cyc - 0.6) * 4;
    p.hipsDy = bobC;
    p.braidA = Math.sin(cyc - 0.6) * (ws.carrying ? 5 : 8);
    p._legs = legs; p._hipY = hipY;
    return p;
  }

  // ---------------- drawing ----------------
  // Vector renderers below (renderFront / renderSide): smooth bezier art
  // anchored to bone world positions. No PNG part is ever rotated.

  function renderFront(pose) {
    var world = solveFK(BONES_F, ORDER_F, pose);
    if (pose.headDy) world.head.y += pose.headDy;
    var face = pose.face || 'head';
    if (faceOverride && Date.now() < faceOverride.until) face = faceOverride.face;
    else if (faceOverride) faceOverride = null;
    var W = world;
    // Backhair mass behind everything: drapes from the head toward the
    // backhair bone (in a bend its Dy/Dx pull it down-forward).
    var bh = W.backhair;
    limb([{ x: W.head.x, y: W.head.y - 260 }, { x: bh.x, y: bh.y },
      { x: bh.x + (bh.x - W.head.x) * 0.5, y: bh.y + 260 }], [560, 470, 240], COL.hair, COL.hairHi);
    ell(W.head.x, W.head.y - 190, 300, 300, 0, COL.hair);
    // Legs (behind torso/shorts so the thigh tops stay covered).
    // Sitting: planted-feet squat IK (hips lowered, knees splayed sideways,
    // feet stay on the rug) — the old FK sit read as standing, because the
    // thighs were hidden behind the shorts and only the shins showed.
    var legR = { hip: W.thigh_R, knee: W.knee_R, ankle: W.ankle_R };
    var legL = { hip: W.thigh_L, knee: W.knee_L, ankle: W.ankle_L };
    if (sitting) {
      var hipY = IK_HIPS_Y + (pose.hipsDy || 0);
      var ikR = solveIKFront({ x: W.thigh_R.x, y: hipY },
        { x: BONES_F.ankle_R.bind[0], y: BONES_F.ankle_R.bind[1] }, THIGH_LEN, SHIN_LEN, 1);
      var ikL = solveIKFront({ x: W.thigh_L.x, y: hipY },
        { x: BONES_F.ankle_L.bind[0], y: BONES_F.ankle_L.bind[1] }, THIGH_LEN, SHIN_LEN, -1);
      legR = { hip: { x: W.thigh_R.x, y: hipY }, knee: ikR.knee, ankle: ikR.ankle };
      legL = { hip: { x: W.thigh_L.x, y: hipY }, knee: ikL.knee, ankle: ikL.ankle };
    }
    legFront(legR.hip, legR.knee, legR.ankle, 1, true);
    legFront(legL.hip, legL.knee, legL.ankle, -1, false);
    torsoFront(W, pose.chestSY || 1);
    shortsFront(W);
    drawEquipped('outfit', W, BONES_F);
    // Arms: viewer-left arm in front by default, swapped when crossed.
    if (pose.swapArms) { armFront(W, 'L', pose.handL || 'open'); armFront(W, 'R', pose.handR || 'open'); }
    else { armFront(W, 'R', pose.handR || 'open'); armFront(W, 'L', pose.handL || 'open'); }
    // Braids hang in front of the shoulders.
    braidFront(W, 'L', pose.braidA || 0);
    braidFront(W, 'R', pose.braidA || 0);
    drawEquipped('braid', W, BONES_F);
    ctx.save();
    ctx.translate(W.head.x, W.head.y);
    ctx.rotate(W.head.a * DEG);
    var hsF = pose.headScale || 1;
    if (hsF !== 1) ctx.scale(hsF, hsF);
    drawFaceFront(face);
    ctx.restore();
    drawEquipped('head', W, BONES_F);
    drawEquipped('neck', W, BONES_F);
    if (carriedBook) drawCarriedStack(W.wrist_L, W.chest.a);
    handWorld = { x: W.wrist_L.x, y: W.wrist_L.y, a: W.wrist_L.a };
    return world;
  }

  function renderSide(pose) {
    var world = solveFK(BONES_S, ORDER_S, pose);
    if (pose.headDy) world.head.y += pose.headDy;
    var W = world;
    var legs = pose._legs;
    function legJ(side) {
      if (legs && legs[side]) return { hip: legs[side].hip, knee: legs[side].knee, ankle: legs[side].ankle };
      var s = (side === 'near') ? '_N' : '_F';
      return { hip: W['thigh' + s], knee: W['knee' + s], ankle: W['ankle' + s] };
    }
    // Backhair mass behind the head/shoulders; drapes in the bend.
    var bh = W.backhair;
    limb([{ x: W.head.x - 40, y: W.head.y - 300 }, { x: bh.x, y: bh.y },
      { x: bh.x - 60, y: bh.y + 240 }], [300, 240, 140], COL.hair, COL.hairHi);
    var fL = legJ('far'), nL = legJ('near');
    legSide(fL.hip, fL.knee, fL.ankle, true);
    legSide(nL.hip, nL.knee, nL.ankle, false);
    torsoSide(W, pose.chestSY || 1);
    shortsSide(W);
    armSide(W, false, pose.handR || 'open');
    armSide(W, true, pose.handL || 'open');
    // Single braid down the back.
    var B = W.braid;
    if (B) {
      limb([B, { x: B.x - 30, y: B.y + 150 }, { x: B.x - 50, y: B.y + 290 }], [70, 55, 36], COL.hair, COL.hairHi);
      ell(B.x - 50, B.y + 290, 24, 18, 0, COL.cuff);
    }
    ctx.save();
    ctx.translate(W.head.x, W.head.y);
    ctx.rotate(W.head.a * DEG);
    var hsS = pose.headScale || 1;
    if (hsS !== 1) ctx.scale(hsS, hsS);
    drawFaceSide(pose.face || 'head');
    ctx.restore();
    drawEquipped('head', W, BONES_S);
    if (carriedBook) drawCarriedStack(W.wrist_N, W.chest.a);
    handWorld = { x: W.wrist_N.x, y: W.wrist_N.y, a: W.wrist_N.a };
    return world;
  }

  // Carried object: THE stack that fell (assets/props/books.png), not the
  // single pink book (parts/book.png) — one object through fall, lie, carry
  // and put-back, so nothing pops or swaps mid-sequence.
  // Drawn at the shelf stack's on-screen size (50x30 screen = 243x146
  // composite). GRASP_OFFSET centres the stack behind-below the wrist in
  // facing coords: measured at the grasp frame, the wrist sits at screen
  // (104,539) while the lying stack's centre is (135,555) — +31px right,
  // +16px down on screen = -151/+78 composite in facing coords. With that
  // offset the carried stack lands exactly on the lying stack at the grasp
  // frame (zero jump when the DOM stack hides), and during the carry it
  // sits between the hands and the chest instead of out at arm's length.
  var STACK_W = 243, STACK_H = 146;   // composite px (= 50x30 screen)
  var GRASP_DX = -151, GRASP_DY = 78; // facing coords, behind-below wrist
  function drawCarriedStack(wrist, chestA) {
    if (!IMG.booksStack || !wrist) return;
    ctx.save();
    ctx.translate(wrist.x + GRASP_DX, wrist.y + GRASP_DY);
    ctx.rotate(Math.round((chestA || 0) * 0.25) * DEG);
    ctx.drawImage(IMG.booksStack, -STACK_W / 2, -STACK_H / 2, STACK_W, STACK_H);
    ctx.restore();
  }

  // Equipped shop items drawn on the character (front view; side view: head items only).
  var EQUIP_DRAW = {
    head: {
      starclip: [{ x: 700, y: 200, s: 130 }, { x: 905, y: 200, s: 130 }],
      beanie: [{ x: 800, y: 150, s: 420 }],
      glasses: [{ x: 800, y: 345, s: 330 }],
      crown: [{ x: 800, y: 70, s: 280 }],
      flowercrown: [{ x: 800, y: 95, s: 380 }],
      catears: [{ x: 800, y: 60, s: 320 }],
      bunnyears: [{ x: 800, y: 45, s: 330 }],
      sleepmask: [{ x: 800, y: 345, s: 320 }]
    },
    neck: {
      bowtie: [{ x: 800, y: 580, s: 130 }],
      scarf: [{ x: 800, y: 640, s: 300 }],
      necklacePearl: [{ x: 800, y: 660, s: 180 }],
      necklaceGold: [{ x: 800, y: 660, s: 180 }]
    },
    braid: {
      ribbonBlue: [{ x: 660, y: 520, s: 100 }, { x: 940, y: 520, s: 100 }],
      bow: [{ x: 660, y: 500, s: 110 }, { x: 940, y: 500, s: 110 }],
      starties: [{ x: 660, y: 470, s: 90 }, { x: 940, y: 470, s: 90 }],
      bell: [{ x: 660, y: 690, s: 80 }, { x: 940, y: 690, s: 80 }]
    },
    outfit: {
      apron: [{ x: 800, y: 950, s: 520 }],
      sailor: [{ x: 800, y: 700, s: 420 }],
      vest: [{ x: 800, y: 900, s: 480 }],
      cape: [{ x: 800, y: 800, s: 560 }]
    }
  };
  // Equipped shop items ride their bone: the item's bind-pose centre is
  // transformed by the bone matrix and the item rotates with the bone, so a
  // starclip stays on the hair and an apron stays on the torso through a bend.
  // (The old code drew them at fixed composite positions, so they floated off
  // the body whenever it moved.) Braid items: first position = left braid,
  // second = right braid.
  // Equipped shop items ride their bone: the item's bind-pose centre is
  // rotated by the bone's world angle about the bone's bind origin and
  // translated to the bone's world position, so a starclip stays on the
  // hair and an apron stays on the torso through a bend.
  function drawEquipped(slot, world, bones) {
    var id = gear[slot];
    if (!id || !EQUIP_DRAW[slot] || !EQUIP_DRAW[slot][id]) return;
    var im = ITEM_IMG[id];
    if (!im) return;
    EQUIP_DRAW[slot][id].forEach(function (d, idx) {
      var bone = slot === 'head' ? 'head' : slot === 'neck' ? 'neck' :
        slot === 'outfit' ? 'chest' :
        (bones === BONES_S ? 'braid' : (idx === 0 ? 'braidUL' : 'braidUR'));
      if (bones === BONES_S && slot === 'braid' && idx > 0) return;
      var w = world[bone];
      if (!w || !bones[bone]) return;
      var bb = bones[bone].bind;
      var dx = d.x - bb[0], dy = d.y - bb[1];
      var a = w.a * DEG, ca = Math.cos(a), sa = Math.sin(a);
      var cx = w.x + dx * ca - dy * sa, cy = w.y + dx * sa + dy * ca;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.round(w.a) * DEG);
      ctx.drawImage(im, -d.s / 2, -d.s / 2, d.s, d.s);
      ctx.restore();
    });
  }
  function loadItemImage(id, file) {
    if (ITEM_IMG[id]) return Promise.resolve();
    return loadImg('assets/items/' + file).then(function (im) { ITEM_IMG[id] = im; });
  }

  // ---------------- sleep ----------------
  function renderSleep(t) {
    // Lying figure: draw just the figure region of sleep_lying.png
    // (x 220-1500, y 1560-1820) in SCREEN space, 300px wide on the rug.
    var im = IMG.sleep_lying;
    if (!im) return;
    var breath = Math.sin((t % 4.0) / 4.0 * 2 * Math.PI); // 4.0s breathing loop
    var sy = 1 + breath * 0.008;
    var dw = 340, dh = dw * 260 / 1280;
    var dx = 195 - dw / 2, dy = 566 - dh;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(195, 566);
    ctx.scale(1, sy);
    ctx.translate(-195, -566);
    ctx.drawImage(im, 220, 1560, 1280, 260, dx, dy, dw, dh);
    ctx.restore();
  }

  // ---------------- main loop ----------------
  var t0 = performance.now();
  var lastFrame = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastFrame < 16) return; // cap ~60fps
    lastFrame = now;
    if (!ctx) return;
    var t = (now - t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    // Clip all character drawing to the canvas (room) bounds: no part may
    // poke below the floor — in the deep squat the far shin overshoots the
    // boot by ~20px and its end is cut by the room edge (fix round 3).
    // The clip is set in device space, so later setTransform calls keep it.
    // Nothing legitimate is drawn outside the canvas: rug/floor are DOM.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.clip();
    // Base transform: composite -> screen, origin at (charX, groundY).
    ctx.setTransform(dpr * SCALE, 0, 0, dpr * SCALE, dpr * charX - dpr * SCALE * 800, dpr * groundY - dpr * SCALE * 1850);
    var pose;
    if (sleeping) {
      renderSleep(t);
      lastRender = { mode: 'sleep', charX: charX, face: 'head_sleep' };
      ctx.restore(); // release the room-bounds clip
      return;
    }
    if (anim) {
      var el = (now - anim.t0) / 1000;
      var t01 = Math.min(1, el / anim.dur);
      if (anim.sample) pose = anim.sample(t01, el);
      else pose = basePose();
      if (t01 >= 1) {
        var done = anim.done, hold = anim.hold;
        anim = null; busy = false;
        if (hold) holdPose = hold;
        if (done) done();
      }
    } else if (holdPose) {
      pose = holdPose;
    } else if (mode === 'side' && walkState) {
      pose = walkPose((now - walkState.t0) / 1000, walkState);
    } else {
      pose = idlePose(t);
    }
    if (!pose) pose = idlePose(t);
    // Whole-body squash/stretch about the ground point.
    if (pose.scaleX !== 1 || pose.scaleY !== 1) {
      ctx.setTransform(dpr * SCALE * (pose.scaleX || 1), 0, 0, dpr * SCALE * (pose.scaleY || 1),
        dpr * charX - dpr * SCALE * (pose.scaleX || 1) * 800,
        dpr * groundY - dpr * SCALE * (pose.scaleY || 1) * 1850);
    }
    if (mode === 'side') {
      if (facing === -1) { ctx.translate(800, 0); ctx.scale(-1, 1); ctx.translate(-800, 0); }
      renderSide(pose);
    } else {
      renderFront(pose);
    }
    lastRender = { mode: mode, charX: charX, face: pose.face || 'head' };
    ctx.restore(); // release the room-bounds clip
  }

  function runAnim(animDef, done) {
    anim = { t0: performance.now(), dur: animDef.dur, sample: animDef.sample, done: done || null, hold: animDef.hold || null };
    busy = true;
  }
  function clearHold() { holdPose = null; }

  // ---------------- public actions ----------------
  function walkTo(targetX, opts, done) {
    opts = opts || {};
    var speed = opts.carrying ? 37 : 60;      // px/s (derived from cycle)
    var stepPx = opts.carrying ? 22 : 30;
    var dist = Math.abs(targetX - charX);
    if (dist < 4) { if (done) done(); return; }
    if (walkCheck) { clearInterval(walkCheck); walkCheck = null; }
    mode = 'side';
    facing = targetX >= charX ? 1 : -1;
    clearHold();
    var ws = { fromX: charX, toX: targetX, dir: facing, speed: speed, stepPx: stepPx,
      carrying: !!opts.carrying, t0: performance.now(), dur: dist / speed };
    walkState = ws;
    busy = true;
    var check = setInterval(function () {
      var el = (performance.now() - ws.t0) / 1000;
      charX = ws.fromX + ws.dir * Math.min(el * speed, dist);
      if (el * speed >= dist) {
        clearInterval(check);
        if (walkCheck === check) walkCheck = null;
        charX = targetX;
        walkState = null; busy = false;
        mode = 'front';
        if (done) done();
      }
    }, 16);
    walkCheck = check;
  }

  function bendPickup(bookScreen, done, onGrasp) {
    // Side-view bend + reach + pick-up, ~2.0s (SPECIALIST §3).
    // onGrasp fires once at the hand-close moment (t=0.45), the exact frame
    // the stack leaves the rug — the caller hides the DOM stack and swaps
    // the bubble line there, so the two stacks never coexist on screen.
    mode = 'side';
    facing = bookScreen.x < charX ? -1 : 1;
    charX -= facing * 50; // bend clearance: keep the bowed head in the room, clear of the shelf/plant
    clearHold();
    var keys = [
      { t: 0.00, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.10, v: { face: 'head', ang: { head: -8, chest: 4 }, hipsDy: 12, backhairDy: 0, backhairDx: 0, headScale: 1, scaleY: 1.04, scaleX: 0.97 }, e: 'out' },       // anticipation
      // Deep bend, RE-SOLVED for the vector rig (2026-11-27): the head is
      // shrunk (headScale 0.70) and the torso folds 78deg — spine 38 +
      // chest 40 — with the squat deepened to hipsDy 240, so the head joint
      // lands at screen (123,403), the face at (89,388) looking down at the
      // book, and the hair top at (43,368) — inside the room, BELOW the
      // shelf (bottom 362) and the plant (bottom 344), clear of both.
      // The near arm is re-solved by 2-bone IK for the shorter
      // arm binds (elbow 990 / wrist 1330): shoulder_N -59, elbow_N -60
      // puts the wrist on the book (screen 101,524 — verified by FK).
      // Head -14 (64deg total) pitches the face down toward the book.
      // Far arm hangs straight down (shoulder_F -77, elbow_F -1).
      // Backhair Dy/Dx 850/480 drapes the hair down from the bowed head
      // toward the book instead of piling it on the shelf. scaleX 1.02 /
      // scaleY 0.90 replaces the old 1.10/0.86 squash that fattened the head.
      // step-back 50 (charX 220) keeps the bowed head right of the shelf
      // AND right of the plant pot, so the eye stays visible.
      { t: 0.35, v: { face: 'head', ang: { spine: 38, chest: 40, head: -14, shoulder_N: -59, elbow_N: -60, shoulder_F: -77, elbow_F: -1, backhair: 0 }, hipsDy: 240, backhairDy: 850, backhairDx: 480, headScale: 0.70, scaleY: 0.90, scaleX: 1.02 }, e: 'in' }, // bend: fold + shrink head
      { t: 0.45, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 38, chest: 40, head: -14, shoulder_N: -59, elbow_N: -60, shoulder_F: -77, elbow_F: -1, backhair: 0 }, hipsDy: 240, backhairDy: 850, backhairDx: 480, headScale: 0.70, scaleY: 0.90, scaleX: 1.02 }, e: 'lin' }, // grasp
      // RIG: hair snap-back — the drape offset (650,650) is in world coords, so
      // if it lingers while the head returns upright it reads as a horizontal
      // pink slab sticking out in front of the face (mesh-bend-b.png). The hair
      // must swing back onto the head right after the grasp, while the head is
      // still bowed (so the return is masked by the pitch), not trail behind it.
      { t: 0.55, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 30, chest: 30, head: -9, shoulder_N: -40, elbow_N: -60, shoulder_F: -50, elbow_F: -30, backhair: 0 }, hipsDy: 150, backhairDy: 120, backhairDx: 120, headScale: 0.9, scaleY: 0.92, scaleX: 1.08 }, e: 'out' }, // hair back
      { t: 0.80, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 6, chest: 8, head: -4, shoulder_N: -12, elbow_N: -125, shoulder_F: -10, elbow_F: -115 }, hipsDy: 10, backhairDy: 0, backhairDx: 0, headScale: 1, scaleY: 1.07, scaleX: 0.95 }, e: 'out' },  // rise, stack to chest (stretch) (same angles as the carry walk — no snap)
      { t: 1.00, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 2, chest: 6, head: 0, shoulder_N: -12, elbow_N: -125, shoulder_F: -10, elbow_F: -115 }, hipsDy: 0, headScale: 1 }, e: 'out' }   // settle
    ];
    // During the bend the feet stay planted: emulate with a static walk pose
    // (legs at contact, hips lowered by hipsDy via the FK hips offset).
    var graspFired = false;
    runAnim({ dur: 2.0, sample: function (t01) {
      var p = sampleKeys(keys, t01);
      // Keep side legs planted: fake a zero-step walk pose for the legs.
      var ws = { fromX: charX, toX: charX, dir: facing, speed: 60, stepPx: 30, carrying: false, t0: performance.now(), dur: 1 };
      var wp = walkPose(0, ws);
      p._legs = wp._legs;
      p._hipY = wp._hipY;
      // Bend lowers hips: shift leg hip target down by hipsDy.
      if (p.hipsDy) {
        var hipY = IK_HIPS_Y + p.hipsDy;
        ['near', 'far'].forEach(function (side) {
          var leg = p._legs[side];
          var H = { x: 810, y: hipY };
          var ik = solveIK(H, leg.ankle, THIGH_LEN, SHIN_LEN);
          var thighBind = Math.atan2(1560 - 1215, 830 - 820) / DEG;
          var shinBind = 90;
          leg.knee = ik.knee;
          leg.thighA = ik.thighA - thighBind;
          leg.shinA = ik.shinA - shinBind;
          leg.bootA = 0; // absolute: sole flat on the floor
        });
      }
      if (t01 >= 0.45) {
        carriedBook = true;
        if (!graspFired) { graspFired = true; if (onGrasp) onGrasp(); }
      }
      return p;
    }, hold: null }, function () {
      mode = 'front';
      if (done) done();
    });
  }

  function upsetPose(done) {
    // ~2.4s: turn -> cross arms -> stomp -> hold + turn-away. Ends in a hold.
    // Crossed arms (rig v2, 2026-11-27): shoulder ±30 / elbow ∓28, so the
    // forearms angle DOWN-INWARD ~45deg and the fists tuck at the opposite
    // waist, INSIDE the torso silhouette. The old ±49/±42 (and my first
    // ±38/±70) put the forearms nearly horizontal across the chest, so the
    // fists poked out past the body's sides and the pose read as arms jutting
    // out instead of arms wrapped around the torso (verified in v2-seq-05).
    mode = 'front'; clearHold();
    var keys = [
      { t: 0.00, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.12, v: { face: 'head_frown', ang: { head: -6, chest: 2 } }, e: 'out' },
      { t: 0.33, v: { face: 'head_frown', swapArms: true, ang: { head: -14, chest: 4, shoulder_L: -30, elbow_L: -28, shoulder_R: 30, elbow_R: 28 }, rootDx: -10, handL: 'fist', handR: 'fist' }, e: 'out' },
      { t: 0.50, v: { face: 'head_frown', swapArms: true, ang: { head: -14, chest: 4, shoulder_L: -30, elbow_L: -28, shoulder_R: 30, elbow_R: 28, thigh_R: -14, knee_R: 30 }, rootDx: -10, handL: 'fist', handR: 'fist', scaleY: 0.93, scaleX: 1.06 }, e: 'in' }, // stomp down
      { t: 0.58, v: { face: 'head_frown', swapArms: true, ang: { head: -14, chest: 4, shoulder_L: -30, elbow_L: -28, shoulder_R: 30, elbow_R: 28 }, rootDx: -10, handL: 'fist', handR: 'fist' }, e: 'out' },
      { t: 1.00, v: { face: 'head_frown', swapArms: true, ang: { head: -20, chest: 10, shoulder_L: -30, elbow_L: -28, shoulder_R: 30, elbow_R: 28 }, rootDx: -16, handL: 'fist', handR: 'fist' }, e: 'inOut' }
    ];
    runAnim({ dur: 2.4, sample: function (t01) { return sampleKeys(keys, t01); },
      hold: sampleKeys(keys, 1) }, function () { if (done) done(); });
  }

  function happyPose(done) {
    // ~1.6s: squash -> bounce up -> settle -> lean. Ends back at idle.
    mode = 'front'; clearHold();
    var keys = [
      { t: 0.00, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.125, v: { face: 'head_happy', ang: { head: 10 }, scaleY: 0.94, scaleX: 1.05, hipsDy: 12, braidA: -4 }, e: 'in' },
      { t: 0.3125, v: { face: 'head_happy', ang: { head: -8, shoulder_L: 25, shoulder_R: -25 }, scaleY: 1.06, scaleX: 0.96, hipsDy: -24, braidA: 12 }, e: 'out' },
      { t: 0.50, v: { face: 'head_happy', ang: { head: 8 }, scaleY: 0.94, scaleX: 1.04, hipsDy: 6, braidA: -5 }, e: 'in' },
      { t: 0.75, v: { face: 'head_happy', ang: { head: 8, chest: 8 }, scaleY: 1.0, scaleX: 1.0, hipsDy: 0, braidA: 2 }, e: 'out' },
      { t: 1.00, v: { face: 'head', ang: {} }, e: 'out' }
    ];
    runAnim({ dur: 1.6, sample: function (t01) { return sampleKeys(keys, t01); } }, function () { if (done) done(); });
  }

  function lookPose(dirDeg, dur, done) {
    mode = 'front'; clearHold();
    var keys = [
      { t: 0, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.25, v: { face: 'head', ang: { head: dirDeg, chest: dirDeg * 0.3 } }, e: 'out' },
      { t: 0.75, v: { face: 'head', ang: { head: dirDeg, chest: dirDeg * 0.3 } }, e: 'lin' },
      { t: 1, v: { face: 'head', ang: {} }, e: 'inOut' }
    ];
    runAnim({ dur: dur || 2.0, sample: function (t01) { return sampleKeys(keys, t01); } }, done);
  }

  function eatPose(done) {
    mode = 'front'; clearHold();
    var keys = [
      { t: 0, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.3, v: { face: 'head', ang: { chest: 12, head: 10, shoulder_R: 30, elbow_R: 72 } }, e: 'out' },
      { t: 0.6, v: { face: 'head_closed', ang: { chest: 14, head: 12, shoulder_R: 32, elbow_R: 74 } }, e: 'lin' },
      { t: 1, v: { face: 'head', ang: {} }, e: 'out' }
    ];
    runAnim({ dur: 1.4, sample: function (t01) { return sampleKeys(keys, t01); } }, done);
  }

  function bathPose(done) {
    mode = 'front'; clearHold();
    var keys = [
      { t: 0, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.4, v: { face: 'head_happy', ang: { head: -10, shoulder_L: -30, shoulder_R: 30, elbow_L: 40, elbow_R: 40 } }, e: 'out' },
      { t: 0.7, v: { face: 'head_happy', ang: { head: 10, shoulder_L: -20, shoulder_R: 20, elbow_L: 50, elbow_R: 50 } }, e: 'inOut' },
      { t: 1, v: { face: 'head', ang: {} }, e: 'out' }
    ];
    runAnim({ dur: 2.0, sample: function (t01) { return sampleKeys(keys, t01); } }, done);
  }

  // ---------------- init / API ----------------
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    dpr = Math.min(3, window.devicePixelRatio || 1);
    function fit() {
      var r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    fit();
    fitCanvas = fit; // game.js fitRoom() calls Rig.refit() after scaling the room
    window.addEventListener('resize', fit);
    Object.keys(VOICE).forEach(function (k) { VOICE[k].forEach(loadVoice); });
    blipAudio = loadVoice('blip.mp3');
    return loadAll().then(function () {
      requestAnimationFrame(frame);
      return true;
    });
  }

  function setGear(g) { gear = g || gear; }
  function setMuted(m) { muted = !!m; }
  function setReducedMotion(v) { reducedMotion = !!v; }
  function setDancing(v) { dancing = !!v; }
  function setSitting(v) { sitting = !!v; clearHold(); }
  function setSleepy(v) { faceOverride = v ? { face: 'head_sleep', until: Date.now() + 100000000 } : null; if (!v) faceOverride = null; }
  function setExcited(v) { excitedUntil = v ? Date.now() + 10000 : 0; }
  function setSleep(on) {
    sleeping = !!on;
    if (on) { sleepT0 = performance.now(); clearHold(); anim = null; mode = 'sleep'; charX = HOME_X; }
    else { mode = 'front'; }
  }
  function chatReact() { faceOverride = { face: 'head_happy', until: Date.now() + 900 }; playVoice('chat'); }
  function celebrate() { happyPose(); playVoice('celebrate'); }
  function pet() { happyPose(); playVoice('pet'); }
  function annoyed() {
    faceOverride = { face: 'head_frown', until: Date.now() + 1600 };
    playVoice('poke');
  }
  function eat() { eatPose(); playVoice('eat'); }
  function bath() { bathPose(); playVoice('giggle'); }
  function tossBall() { happyPose(); playVoice('giggle'); }
  function glare() {
    faceOverride = { face: 'head_frown', until: Date.now() + 2200 };
    playVoice('upset');
  }
  function isBusy() { return busy || !!anim || !!walkState; }
  function getCharX() { return charX; }
  function getHandWorld() { return handWorld; }
  function getLastRender() { return lastRender; }

  window.Rig = {
    init: init, ready: loadAll, refit: function () { if (fitCanvas) fitCanvas(); },
    setGear: setGear, loadItemImage: loadItemImage, setMuted: setMuted,
    setReducedMotion: setReducedMotion, setDancing: setDancing, setSitting: setSitting,
    setSleepy: setSleepy, setExcited: setExcited, setSleep: setSleep,
    chatReact: chatReact, celebrate: celebrate, pet: pet, annoyed: annoyed,
    eat: eat, bath: bath, tossBall: tossBall, glare: glare,
    walkTo: walkTo, bendPickup: bendPickup, upsetPose: upsetPose, happyPose: happyPose,
    lookPose: lookPose, eatPose: eatPose, bathPose: bathPose,
    isBusy: isBusy, getCharX: getCharX, getHandWorld: getHandWorld, getLastRender: getLastRender,
    playVoice: playVoice, blip: blip,
    setCarriedBook: function (v) { carriedBook = !!v; },
    get carriedBook() { return carriedBook; },
    HOME_X: HOME_X, GROUND_Y: GROUND_Y
  };
})();
