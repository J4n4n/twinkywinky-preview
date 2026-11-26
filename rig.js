// twinkywinky.org rebuild — skeletal rig (canvas 2D, rigid parts, no skinning).
// Bone tree + pivots from rebuild/RIG-DATA.md (which supersedes SPECIALIST §2
// where they differ: braids AFTER arms BEFORE head; IK bind hips 1230).
// FK default; 2-bone IK ONLY for planted feet (walk / bend). Deterministic
// seeded idle (R31): no Math.random per frame. imageSmoothingEnabled=false,
// whole-degree rotation snapping.
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
  var PARTS = [
    'backhair', 'blush', 'head', 'head_closed', 'head_sleep', 'head_frown', 'head_happy',
    'braid_upper_L', 'braid_upper_R', 'braid_lower_L', 'braid_lower_R',
    'torso', 'upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R',
    'hand_open_L', 'hand_open_R', 'hand_holding_L', 'hand_holding_R', 'hand_fist_L', 'hand_fist_R',
    'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'boot_L', 'boot_R', 'book', 'sleep_lying'
  ];
  var SIDE_PARTS = [
    'side_head', 'side_braid', 'side_backhair', 'side_torso',
    'side_upperarm', 'side_upperarm_far', 'side_forearm', 'side_forearm_far',
    'side_hand_open', 'side_hand_open_far', 'side_thigh', 'side_thigh_far',
    'side_shin', 'side_shin_far', 'side_boot', 'side_boot_far'
  ];
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
    PARTS.forEach(function (n) { jobs.push(loadImg('assets/parts/' + n + '.png').then(function (im) { IMG[n] = im; })); });
    SIDE_PARTS.forEach(function (n) { jobs.push(loadImg('assets/parts-side/' + n + '.png').then(function (im) { IMG[n] = im; })); });
    // The carried object is the shelf stack itself (assets/props/books.png,
    // 50x30 natural) — the same image as #p-books / #falling-book, so the
    // stack that falls is pixel-identical to the stack she carries back.
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
    elbow_L:   { bind: [490, 1030], parent: 'shoulder_L' },
    wrist_L:   { bind: [410, 1425], parent: 'elbow_L' },
    shoulder_R:{ bind: [975, 640],  parent: 'chest' },
    elbow_R:   { bind: [1110, 1030],parent: 'shoulder_R' },
    wrist_R:   { bind: [1190, 1425],parent: 'elbow_R' },
    thigh_L:   { bind: [660, 1215], parent: 'hips' },
    knee_L:    { bind: [660, 1560], parent: 'thigh_L' },
    ankle_L:   { bind: [665, 1720], parent: 'knee_L' },
    thigh_R:   { bind: [940, 1215], parent: 'hips' },
    knee_R:    { bind: [940, 1560], parent: 'thigh_R' },
    ankle_R:   { bind: [935, 1720], parent: 'knee_R' },
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
    elbow_N:   { bind: [860, 1030], parent: 'shoulder_N' },
    wrist_N:   { bind: [860, 1425], parent: 'elbow_N' },
    shoulder_F:{ bind: [800, 640],  parent: 'chest' },
    elbow_F:   { bind: [810, 1030], parent: 'shoulder_F' },
    wrist_F:   { bind: [810, 1425], parent: 'elbow_F' },
    thigh_N:   { bind: [820, 1215], parent: 'hips' },
    knee_N:    { bind: [830, 1560], parent: 'thigh_N' },
    ankle_N:   { bind: [830, 1720], parent: 'knee_N' },
    thigh_F:   { bind: [815, 1215], parent: 'hips' },
    knee_F:    { bind: [825, 1560], parent: 'thigh_F' },
    ankle_F:   { bind: [825, 1720], parent: 'knee_F' },
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
  var IK_HIPS_Y = 1230, THIGH_LEN = 345, SHIN_LEN = 160;

  // ---------------- state ----------------
  var canvas = null, ctx = null, dpr = 1;
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
      handL: 'open', handR: 'open', swapArms: false, scaleX: 1, scaleY: 1, braidA: 0, headDy: 0 };
  }

  // ---------------- keyframe helpers ----------------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t) { return t * t * t; }
  // keys: [{t:0..1, v:pose, e:'inOut'|'out'|'in'|'lin'}]; step fields (face/hand) snap.
  var NUM_FIELDS = ['rootDx', 'rootDy', 'hipsDy', 'chestSY', 'scaleX', 'scaleY', 'braidA', 'headDy'];
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
    if (dancing) {
      p.ang.hips = Math.sin(t * 2 * Math.PI / 0.9) * 4;
      p.ang.chest = Math.sin(t * 2 * Math.PI / 0.9) * 5;
      p.ang.head = Math.sin(t * 2 * Math.PI / 0.9 + 0.5) * 6;
      p.braidA = Math.sin(t * 2 * Math.PI / 0.9 - 0.6) * 8;
    }
    if (sitting) {
      p.hipsDy = 110;
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
      var ankle = { x: fl.x - 70, y: 1720 + (f.y - GROUND_Y) / SCALE };
      var ik = solveIK(hipLocal, ankle, THIGH_LEN, SHIN_LEN);
      // Bind angles: thigh bind hip->knee ~88.3deg (side), shin bind knee->ankle ~90deg.
      var thighBind = Math.atan2(1560 - 1215, 830 - 820) / DEG;
      var shinBind = Math.atan2(1720 - 1560, 830 - 830) / DEG;
      // Boot rotation is ABSOLUTE (drawPartAt rotates the image in composite
      // space, it does not compose with the leg chain): planted = sole flat
      // (0deg), swing = toes point down (+25deg).
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
    p.ang.elbow_N = 12 + Math.sin(cyc) * 4;
    p.ang.elbow_F = 12 - Math.sin(cyc) * 4;
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
    // Backhair is a child of root: give it a small lagged sway so it never
    // floats in mid-air where the head used to be (bend) or lags the body.
    p.ang.backhair = Math.sin(cyc - 0.6) * 4;
    p.hipsDy = bobC;
    p.braidA = Math.sin(cyc - 0.6) * (ws.carrying ? 5 : 8);
    p._legs = legs; p._hipY = hipY;
    return p;
  }

  // ---------------- drawing ----------------
  function drawPart(im, pivot, world, extra) {
    if (!im) return;
    ctx.save();
    ctx.translate(world.x, world.y);
    ctx.rotate(Math.round(world.a) * DEG);
    if (extra && (extra.sx !== 1 || extra.sy !== 1)) ctx.scale(extra.sx || 1, extra.sy || 1);
    ctx.translate(-pivot[0], -pivot[1]);
    ctx.drawImage(im, 0, 0, 1600, 1850);
    ctx.restore();
  }
  // Draw a full-canvas part rotated about an explicit pivot point (for IK legs).
  function drawPartAt(im, px, py, angleDeg, sx, sy) {
    if (!im) return;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.round(angleDeg) * DEG);
    if (sx !== undefined && (sx !== 1 || sy !== 1)) ctx.scale(sx, sy);
    ctx.translate(-px, -py);
    ctx.drawImage(im, 0, 0, 1600, 1850);
    ctx.restore();
  }

  function renderFront(pose) {
    var world = solveFK(BONES_F, ORDER_F, pose);
    // chest breathing scale about the chest pivot
    var chestSY = pose.chestSY || 1;
    var face = pose.face || 'head';
    if (faceOverride && Date.now() < faceOverride.until) face = faceOverride.face;
    else if (faceOverride) faceOverride = null;
    var handL = pose.handL || 'open', handR = pose.handR || 'open';
    var arms = pose.swapArms;
    function armSet(first) {
      if (first === 'R') {
        drawPart(IMG.upperarm_R, BONES_F.shoulder_R.bind, world.shoulder_R);
        drawPart(IMG.forearm_R, BONES_F.elbow_R.bind, world.elbow_R);
        drawPart(IMG['hand_' + handR + '_R'], BONES_F.wrist_R.bind, world.wrist_R);
      } else {
        drawPart(IMG.upperarm_L, BONES_F.shoulder_L.bind, world.shoulder_L);
        drawPart(IMG.forearm_L, BONES_F.elbow_L.bind, world.elbow_L);
        drawPart(IMG['hand_' + handL + '_L'], BONES_F.wrist_L.bind, world.wrist_L);
      }
    }
    // RIG-DATA §4 corrected draw order: backhair -> R leg -> L leg -> torso ->
    // R arm -> L arm -> braids -> head -> blush -> book.
    drawPart(IMG.backhair, BONES_F.backhair.bind, world.backhair);
    drawPart(IMG.thigh_R, BONES_F.thigh_R.bind, world.thigh_R);
    drawPart(IMG.shin_R, BONES_F.knee_R.bind, world.knee_R);
    drawPart(IMG.boot_R, BONES_F.ankle_R.bind, world.ankle_R);
    drawPart(IMG.thigh_L, BONES_F.thigh_L.bind, world.thigh_L);
    drawPart(IMG.shin_L, BONES_F.knee_L.bind, world.knee_L);
    drawPart(IMG.boot_L, BONES_F.ankle_L.bind, world.ankle_L);
    // torso with breathing scale
    drawPart(IMG.torso, BONES_F.chest.bind, world.chest, { sx: 1, sy: chestSY });
    drawEquipped('outfit');
    if (arms) { armSet('L'); armSet('R'); } else { armSet('R'); armSet('L'); }
    // braids: upper/lower chains, lag angle applied to lower segment
    var bA = pose.braidA || 0;
    drawPart(IMG.braid_upper_R, BONES_F.braidUR.bind, world.braidUR);
    drawPart(IMG.braid_lower_R, BONES_F.braidLR.bind, { x: world.braidLR.x, y: world.braidLR.y, a: world.braidLR.a + bA });
    drawPart(IMG.braid_upper_L, BONES_F.braidUL.bind, world.braidUL);
    drawPart(IMG.braid_lower_L, BONES_F.braidLL.bind, { x: world.braidLL.x, y: world.braidLL.y, a: world.braidLL.a + bA });
    drawEquipped('braid');
    drawPart(IMG[face] || IMG.head, BONES_F.head.bind, { x: world.head.x, y: world.head.y + (pose.headDy || 0), a: world.head.a });
    drawPart(IMG.blush, BONES_F.head.bind, { x: world.head.x, y: world.head.y + (pose.headDy || 0), a: world.head.a });
    drawEquipped('head');
    drawEquipped('neck');
    if (carriedBook) drawCarriedStack(world.wrist_N || world.wrist_L, world.chest.a);
    handWorld = { x: world.wrist_L.x, y: world.wrist_L.y, a: world.wrist_L.a };
    return world;
  }

  function renderSide(pose) {
    var world = solveFK(BONES_S, ORDER_S, pose);
    var legs = pose._legs;
    // far leg (IK), far arm, torso, near leg (IK), near arm, braid, head
    drawPart(IMG.side_backhair, BONES_S.backhair.bind, world.backhair);
    if (legs) {
      var f = legs.far;
      drawPartAt(IMG.side_thigh_far, f.hip.x, f.hip.y, f.thighA);
      drawPartAt(IMG.side_shin_far, f.knee.x, f.knee.y, f.shinA);
      drawPartAt(IMG.side_boot_far, f.ankle.x, f.ankle.y, f.bootA);
    }
    drawPart(IMG.side_upperarm_far, BONES_S.shoulder_F.bind, world.shoulder_F);
    drawPart(IMG.side_forearm_far, BONES_S.elbow_F.bind, world.elbow_F);
    drawPart(IMG.side_hand_open_far, BONES_S.wrist_F.bind, world.wrist_F);
    drawPart(IMG.side_torso, BONES_S.chest.bind, world.chest, { sx: 1, sy: pose.chestSY || 1 });
    if (legs) {
      var n = legs.near;
      drawPartAt(IMG.side_thigh, n.hip.x, n.hip.y, n.thighA);
      drawPartAt(IMG.side_shin, n.knee.x, n.knee.y, n.shinA);
      drawPartAt(IMG.side_boot, n.ankle.x, n.ankle.y, n.bootA);
    }
    drawPart(IMG.side_upperarm, BONES_S.shoulder_N.bind, world.shoulder_N);
    drawPart(IMG.side_forearm, BONES_S.elbow_N.bind, world.elbow_N);
    drawPart(IMG.side_hand_open, BONES_S.wrist_N.bind, world.wrist_N);
    drawPart(IMG.side_braid, BONES_S.braid.bind, { x: world.braid.x, y: world.braid.y, a: world.braid.a + (pose.braidA || 0) });
    drawPart(IMG.side_head, BONES_S.head.bind, { x: world.head.x, y: world.head.y + (pose.headDy || 0), a: world.head.a });
    if (carriedBook) drawCarriedStack(world.wrist_N, world.chest.a);
    handWorld = { x: world.wrist_N.x, y: world.wrist_N.y, a: world.wrist_N.a };
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
  function drawEquipped(slot) {
    var id = gear[slot];
    if (!id || !EQUIP_DRAW[slot] || !EQUIP_DRAW[slot][id]) return;
    var im = ITEM_IMG[id];
    if (!im) return;
    EQUIP_DRAW[slot][id].forEach(function (d) {
      ctx.drawImage(im, d.x - d.s / 2, d.y - d.s / 2, d.s, d.s);
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
    var dw = 300, dh = dw * 260 / 1280;
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
    ctx.imageSmoothingEnabled = false;
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
    clearHold();
    var keys = [
      { t: 0.00, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.10, v: { face: 'head', ang: { head: -8, chest: 4 }, hipsDy: 12 }, e: 'out' },       // anticipation
      // Deep squat pick-up, REVISED x2 (fix round 2, 2026-11-27): torso pitch
      // 18deg (spine 18 + chest 0) + hips 278. The old 60deg pitch made
      // the black shorts — painted on the side_torso image below the chest
      // pivot — swing out horizontally behind her like a black plank
      // (verified: the slab's buckle/stripe match side_torso.png's shorts,
      // and its draw-log quad lands exactly on the slab; it was never the
      // far shin). 40deg still left a 45deg black bar and 30deg a 65deg
      // one, so the pitch dropped to 25deg. Fix round 2 softened it further
      // to 18deg + head 10deg (world 28deg, not 45deg): at 45deg the side
      // face/eye rotated away under the hair and the head read as a
      // featureless pink slab in the frozen frame. The shoulder_N angle
      // deepens to -30 so the arm still reaches forward-down to the book
      // (world arm angle -12deg) after the shoulder moves back with the
      // smaller pitch. The far arm tucks (shoulder_F 5, not 25) so it never
      // reads as a detached limb, and backhairDy drops 745 -> 300 so the
      // backhair stays attached to the head instead of swinging out as a
      // separate pink slab. Fix round 2b: the slab STILL floated ~25 screen
      // px behind the head (verified in the frozen bend frame) because Dy
      // only drops it — the head also swings ~120 composite px forward,
      // which Dy cannot follow. So backhairDx +120 shifts it forward in
      // facing coords (toward the book, whichever way she faces) and the
      // rise key lerps Dx back to 70 (not 0 — the head is still pitched
      // ~14deg at the rise, so the hair must stay ~70px forward to touch
      // it) and to 0 at the settle, instead of snapping. The far
      // forearm is pinned too: elbow_F was missing from the bend/grasp
      // keys, and sampleKeys gives a bone that is only in the NEXT key
      // that key's value for the whole segment — so elbow_F snapped to the
      // rise key's -115 at the grasp, swinging the far forearm out
      // horizontal at waist height like a detached grey plank. elbow_F -5
      // in the bend/grasp keys keeps the far arm hanging down, and it
      // lerps to -115 during the rise. The deeper squat (hips 278) keeps
      // the shoulder low; the near knee ends ~12px above the rug.
      { t: 0.35, v: { face: 'head', ang: { spine: 18, chest: 0, head: 10, shoulder_N: -30, elbow_N: -5, shoulder_F: 5, elbow_F: -5, backhair: 25 }, hipsDy: 278, backhairDy: 300, backhairDx: 120 }, e: 'in' }, // bend
      { t: 0.45, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 18, chest: 0, head: 10, shoulder_N: -30, elbow_N: -5, shoulder_F: 5, elbow_F: -5, backhair: 25 }, hipsDy: 278, backhairDy: 300, backhairDx: 120 }, e: 'lin' }, // grasp
      { t: 0.80, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 6, chest: 8, head: -4, shoulder_N: -12, elbow_N: -125, shoulder_F: -10, elbow_F: -115 }, hipsDy: 10, backhairDy: 0, backhairDx: 70 }, e: 'out' },  // rise, stack to chest (same angles as the carry walk — no snap)
      { t: 1.00, v: { face: 'head', handL: 'holding', handR: 'holding', ang: { spine: 0, chest: 6, head: 0, shoulder_N: -12, elbow_N: -125, shoulder_F: -10, elbow_F: -115 }, hipsDy: 0 }, e: 'out' }   // settle
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
    mode = 'front'; clearHold();
    var keys = [
      { t: 0.00, v: { face: 'head', ang: {} }, e: 'lin' },
      { t: 0.12, v: { face: 'head_frown', ang: { head: -6, chest: 2 } }, e: 'out' },
      { t: 0.33, v: { face: 'head_frown', swapArms: true, ang: { head: -14, chest: 4, shoulder_L: -49, elbow_L: -42, shoulder_R: 49, elbow_R: 42 }, rootDx: -10, handL: 'fist', handR: 'fist' }, e: 'out' },
      { t: 0.50, v: { face: 'head_frown', swapArms: true, ang: { head: -14, chest: 4, shoulder_L: -49, elbow_L: -42, shoulder_R: 49, elbow_R: 42, thigh_R: -14, knee_R: 30 }, rootDx: -10, handL: 'fist', handR: 'fist', scaleY: 0.96, scaleX: 1.03 }, e: 'in' }, // stomp down
      { t: 0.58, v: { face: 'head_frown', swapArms: true, ang: { head: -14, chest: 4, shoulder_L: -49, elbow_L: -42, shoulder_R: 49, elbow_R: 42 }, rootDx: -10, handL: 'fist', handR: 'fist' }, e: 'out' },
      { t: 1.00, v: { face: 'head_frown', swapArms: true, ang: { head: -20, chest: 10, shoulder_L: -49, elbow_L: -42, shoulder_R: 49, elbow_R: 42 }, rootDx: -16, handL: 'fist', handR: 'fist' }, e: 'inOut' }
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
      { t: 0.3, v: { face: 'head', ang: { chest: 12, head: 10, shoulder_R: 30, elbow_R: 60 } }, e: 'out' },
      { t: 0.6, v: { face: 'head_closed', ang: { chest: 14, head: 12, shoulder_R: 32, elbow_R: 62 } }, e: 'lin' },
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
    dpr = Math.min(2, window.devicePixelRatio || 1);
    function fit() {
      var r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    fit();
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
    init: init, ready: loadAll,
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
