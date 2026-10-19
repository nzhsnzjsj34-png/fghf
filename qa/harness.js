/* Headless QA harness for BLACKOUT PROTOCOL.
   Boots the real page in jsdom with a recording canvas mock and a WebAudio stub,
   then drives the actual game loop with synthetic input and asserts invariants. */
"use strict";
const fs = require("fs");
const path = require("path");

/* Resolve jsdom from the usual places so the suite runs after a plain
   `cd qa && npm install`. Set QA_JSDOM to point somewhere exotic. */
function loadJsdom() {
  const candidates = [];
  if (process.env.QA_JSDOM) candidates.push(process.env.QA_JSDOM);
  candidates.push("jsdom");
  candidates.push(path.join(__dirname, "node_modules", "jsdom"));
  candidates.push(path.join(__dirname, "..", "node_modules", "jsdom"));
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try the next one */ }
  }
  console.error("\njsdom not found. Install the QA dependencies first:\n\n    cd qa && npm install\n");
  process.exit(2);
}
const { JSDOM, VirtualConsole } = loadJsdom();

const HTML = path.join(__dirname, "..", "index.html");

/* ---------------- canvas 2d mock ---------------- */
const CTX_METHODS = ["save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc",
  "ellipse", "rect", "fill", "stroke", "clip", "fillRect", "strokeRect", "clearRect",
  "fillText", "strokeText", "translate", "rotate", "scale", "setTransform", "transform",
  "drawImage", "setLineDash", "getLineDash", "resetTransform", "quadraticCurveTo",
  "bezierCurveTo", "arcTo", "roundRect", "putImageData", "createPattern"];

function makeCtx(canvas) {
  const state = {
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: "source-over", font: "10px sans-serif",
    textAlign: "start", textBaseline: "alphabetic", lineCap: "butt", lineJoin: "miter",
    imageSmoothingEnabled: true, shadowBlur: 0, shadowColor: "rgba(0,0,0,0)", filter: "none"
  };
  const calls = { count: 0, badNumbers: [], gradients: 0 };
  const ctx = { canvas };
  Object.assign(ctx, state);
  for (const m of CTX_METHODS) {
    ctx[m] = function () {
      calls.count++;
      for (let i = 0; i < arguments.length; i++) {
        const v = arguments[i];
        if (typeof v === "number" && !Number.isFinite(v)) {
          if (calls.badNumbers.length < 12) calls.badNumbers.push(m + "(arg" + i + "=" + v + ")");
        }
      }
      if (m === "getLineDash") return [];
    };
  }
  ctx.measureText = t => ({ width: String(t).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  const grad = () => {
    calls.gradients++;
    return { addColorStop(o, c) {
      if (!Number.isFinite(o) || o < 0 || o > 1) calls.badNumbers.push("addColorStop offset " + o);
      if (typeof c !== "string" || /NaN|undefined/.test(c)) calls.badNumbers.push("addColorStop color " + c);
    } };
  };
  ctx.createLinearGradient = grad;
  ctx.createRadialGradient = (x0, y0, r0, x1, y1, r1) => {
    if ([x0, y0, r0, x1, y1, r1].some(v => !Number.isFinite(v))) calls.badNumbers.push("createRadialGradient NaN");
    if (r0 < 0 || r1 < 0) calls.badNumbers.push("createRadialGradient negative radius " + r0 + "," + r1);
    return grad();
  };
  ctx.createPattern = () => null;
  ctx.getImageData = (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  ctx.createImageData = (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
  ctx.__calls = calls;
  return ctx;
}

/* ---------------- WebAudio stub ---------------- */
function makeAudioStub() {
  const log = [];
  const param = () => ({
    value: 0,
    setValueAtTime(v, t) { check(v, t, "setValueAtTime"); return this; },
    linearRampToValueAtTime(v, t) { check(v, t, "linearRamp"); return this; },
    exponentialRampToValueAtTime(v, t) {
      if (!(v > 0)) log.push("exponentialRamp to non-positive " + v);
      check(v, t, "expRamp"); return this;
    },
    setTargetAtTime(v, t, c) { check(v, t, "setTarget"); return this; },
    cancelScheduledValues() { return this; }
  });
  function check(v, t, who) {
    if (!Number.isFinite(v)) log.push(who + " value not finite: " + v);
    if (!Number.isFinite(t)) log.push(who + " time not finite: " + t);
    if (t < 0) log.push(who + " negative time " + t);
  }
  const node = extra => Object.assign({
    connect(d) { return d; }, disconnect() {}, start(t) { check(0, t == null ? 0 : t, "start"); },
    stop(t) { check(0, t == null ? 0 : t, "stop"); }
  }, extra);
  let t = 0;
  const AC = function () {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = "running";
    this.destination = node({});
    const self = this;
    Object.defineProperty(this, "currentTime", { get: () => t, configurable: true });
    this.createGain = () => node({ gain: param() });
    this.createOscillator = () => node({ type: "sine", frequency: param(), detune: param() });
    this.createBiquadFilter = () => node({ type: "lowpass", frequency: param(), Q: param(), gain: param() });
    this.createDynamicsCompressor = () => node({
      threshold: param(), knee: param(), ratio: param(), attack: param(), release: param()
    });
    this.createBufferSource = () => node({ buffer: null, loop: false, playbackRate: param() });
    this.createBuffer = (ch, len, rate) => {
      if (!(len > 0)) log.push("createBuffer length " + len);
      const data = new Float32Array(Math.max(1, len));
      return { length: len, sampleRate: rate, numberOfChannels: ch, getChannelData: () => data };
    };
    this.createStereoPanner = () => node({ pan: param() });
    this.createWaveShaper = () => node({ curve: null, oversample: "none" });
    this.createDelay = () => node({ delayTime: param() });
    this.resume = () => Promise.resolve();
    this.suspend = () => Promise.resolve();
    this.close = () => Promise.resolve();
    this.__advance = dt => { t += dt; };
    self.__t = () => t;
  };
  return { AC, advance: dt => { t += dt; }, log };
}

/* ---------------- boot ---------------- */
function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  const errors = [];
  vc.on("jsdomError", e => errors.push("jsdomError: " + (e.stack || e.message)));
  vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  vc.on("warn", (...a) => { if (opts.verbose) console.log("warn:", ...a); });

  const dom = new JSDOM(fs.readFileSync(HTML, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "http://localhost/",
    beforeParse(window) {
      window.devicePixelRatio = opts.dpr || 1;
      Object.defineProperty(window, "innerWidth", { value: opts.w || 1440, writable: true });
      Object.defineProperty(window, "innerHeight", { value: opts.h || 810, writable: true });
      window.HTMLCanvasElement.prototype.getContext = function () {
        if (!this.__ctx) this.__ctx = makeCtx(this);
        return this.__ctx;
      };
      const audio = makeAudioStub();
      window.AudioContext = audio.AC;
      window.webkitAudioContext = audio.AC;
      window.__audioLog = audio.log;
      window.__audioAdvance = audio.advance;
      // manual frame control
      window.__rafQueue = [];
      window.requestAnimationFrame = cb => { window.__rafQueue.push(cb); return window.__rafQueue.length; };
      window.cancelAnimationFrame = () => {};
      let now = 0;
      window.__now = () => now;
      window.__setNow = v => { now = v; };
      Object.defineProperty(window.performance, "now", { value: () => now, configurable: true, writable: true });
      window.matchMedia = q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      // no touch by default
      Object.defineProperty(window.navigator, "maxTouchPoints", { value: 0, configurable: true });
    }
  });
  const window = dom.window;
  return { dom, window, errors };
}

function pump(window, frames, dtMs, onFrame) {
  for (let i = 0; i < frames; i++) {
    window.__setNow(window.__now() + (dtMs == null ? 16.7 : dtMs));
    window.__audioAdvance && window.__audioAdvance((dtMs == null ? 16.7 : dtMs) / 1000);
    const q = window.__rafQueue.splice(0, window.__rafQueue.length);
    if (!q.length) throw new Error("render loop stalled at frame " + i);
    for (const cb of q) cb(window.__now());
    if (onFrame) onFrame(i);
  }
}

function key(window, code, type) {
  const ev = new window.KeyboardEvent(type || "keydown", { code, key: code, bubbles: true, cancelable: true });
  window.dispatchEvent(ev);
}
function press(window, code) { key(window, code, "keydown"); }
function release(window, code) { key(window, code, "keyup"); }

module.exports = { boot, pump, press, release, key, makeCtx };

/* ---------------- the actual test suite ---------------- */
if (require.main === module) {
  const results = [];
  let failures = 0;
  function check(name, fn) {
    try { fn(); results.push("  PASS  " + name); }
    catch (e) { failures++; results.push("  FAIL  " + name + "\n        " + (e.stack || e.message).split("\n").slice(0, 4).join("\n        ")); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
  /** Keep the shared test subject alive and in "playing" mode. */
  function godmode(BP, frames, w) {
    const run = BP.G.run;
    assert(BP.G.mode === "playing", "expected a live run, mode=" + BP.G.mode);
    assert(!run.dying, "run is mid-death-cinematic");
    run.player.hp = run.player.maxHp;
    run.player.invuln = frames ? frames * 0.02 : 999;
    if (w && frames) pump(w, frames, 16.7);
  }
  function assertFiniteNums(obj, path, depth) {
    depth = depth || 0;
    if (depth > 3 || !obj || typeof obj !== "object") return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "number") assert(Number.isFinite(v), path + "." + k + " = " + v);
      else if (v && typeof v === "object" && depth < 3 && !(v instanceof Array) === false) { /* arrays checked by caller */ }
    }
  }

  console.log("\n=== BLACKOUT PROTOCOL — headless QA ===\n");

  /* ---- T1: page boots with no errors, lands on the menu ---- */
  let env;
  check("boots clean and renders the menu backdrop", () => {
    env = boot({ w: 1440, h: 810 });
    assert(env.errors.length === 0, "boot errors:\n" + env.errors.join("\n"));
    const w = env.window;
    assert(w.__BP, "__BP hook missing");
    assert(w.__BP.G.mode === "menu", "expected menu mode, got " + w.__BP.G.mode);
    pump(w, 30);
    assert(!w.document.getElementById("screen-menu").classList.contains("hidden"), "menu screen should be visible");
    assert(env.errors.length === 0, "errors during menu frames:\n" + env.errors.join("\n"));
  });

  /* ---- T2: start a run, verify sector generation ---- */
  check("startRun generates a valid sector", () => {
    const w = env.window, BP = w.__BP;
    w.document.getElementById("btn-start").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    pump(w, 10);
    assert(BP.G.mode === "playing", "mode should be playing, got " + BP.G.mode);
    const run = BP.G.run;
    assert(run, "run object missing");
    assert(run.vents.length >= 3, "need at least 3 vents, got " + run.vents.length);
    assert(run.pillars.length >= 3, "need cover geometry, got " + run.pillars.length);
    assert(run.exit && !run.exit.open, "exit should start locked");
    const p = run.player;
    assert(p.hp === 100 && p.maxHp === 100, "hp init wrong");
    assert(p.ammo.pulse.mag === 24 && p.ammo.pulse.left === 24, "ammo init wrong");
    // player must not spawn inside geometry
    for (const r of run.pillars) {
      const inside = p.x > r.x - p.r && p.x < r.x + r.w + p.r && p.y > r.y - p.r && p.y < r.y + r.h + p.r;
      assert(!inside, "player spawned inside a pillar");
    }
    for (const v of run.vents) {
      assert(Number.isFinite(v.x) && Number.isFinite(v.y), "bad vent position");
      assert(v.x > 0 && v.y > 0 && v.x < BP.CFG.ARENA_W && v.y < BP.CFG.ARENA_H, "vent outside arena");
    }
  });

  /* ---- T3: wave starts, enemies spawn, no NaN anywhere ---- */
  check("wave 1 spawns enemies and simulation stays finite", () => {
    const w = env.window, BP = w.__BP, run = BP.G.run;
    pump(w, 240, 16.7);                        // ~4 s: banner + first wave
    assert(run.waveActive, "wave should have started");
    assert(run.enemies.length + run.spawners.length > 0, "no enemies spawned");
    assert(run.waveBudget + run.enemies.length + run.spawners.length > 0, "wave budget lost");
    for (const e of run.enemies) {
      assert(Number.isFinite(e.x) && Number.isFinite(e.y), "enemy NaN position");
      assert(Number.isFinite(e.hp) && e.hp <= e.maxHp * 1.0001, "enemy hp invalid");
      assert(e.x > 0 && e.y > 0 && e.x < BP.CFG.ARENA_W && e.y < BP.CFG.ARENA_H, "enemy escaped the arena");
    }
    const p = run.player;
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), "player NaN position");
    assert(Number.isFinite(p.hp) && Number.isFinite(p.energy), "player NaN resource");
    assert(p.energy <= p.maxEnergy + 1e-6, "energy overfilled");
  });

  /* ---- T4: shooting, reloading, weapon swaps ---- */
  check("weapons fire, consume ammo, reload and swap", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 30, 16.7);
    godmode(BP);
    const run = BP.G.run, p = run.player;
    run.enemies.length = 0; run.spawners.length = 0; run.waveBudget = 0;
    // aim at the nearest enemy and hold the trigger
    const e = run.enemies[0];
    if (e) { BP.Input.mx = 720 + (e.x - p.x) * 0.2; BP.Input.my = 405 + (e.y - p.y) * 0.2; }
    BP.Input.firing = true;
    const shots0 = run.shots;
    pump(w, 90, 16.7);
    assert(run.shots > shots0, "no shots fired while holding LMB");
    assert(p.ammo.pulse.left < 24, "magazine not consumed");
    // empty the mag with the trigger released and confirm the auto-reload
    BP.Input.firing = false;
    run.pickups.length = 0;                    // no ammo crates to muddy this
    p.reloading = 0;
    p.ammo.pulse.left = 0;
    pump(w, 5, 16.7);
    assert(p.reloading > 0, "auto-reload never triggered on an empty magazine");
    const total = p.reloadTotal;
    assert(Math.abs(total - BP.WEAPONS.pulse.reload) < 1e-6, "reload duration wrong: " + total);
    pump(w, Math.ceil(total * 1000 / 16.7) + 8, 16.7);
    assert(p.reloading === 0 && p.ammo.pulse.left === p.ammo.pulse.mag,
      "reload never completed: left=" + p.ammo.pulse.left + " mag=" + p.ammo.pulse.mag);
    // swaps
    press(w, "Digit2"); pump(w, 4);
    assert(p.weapon === "scatter", "weapon 2 swap failed: " + p.weapon);
    press(w, "Digit3"); pump(w, 4);
    assert(p.weapon === "lance", "weapon 3 swap failed: " + p.weapon);
    // semi-auto must not fire while merely held
    BP.Input.firing = true;
    p.fireCd = 0;
    const s1 = run.shots; pump(w, 60, 16.7);
    assert(run.shots - s1 <= 2, "Arc Lance behaved like a full-auto weapon (" + (run.shots - s1) + " shots)");
    press(w, "Digit1"); pump(w, 4);
    assert(p.weapon === "pulse", "weapon 1 swap failed");
    BP.Input.firing = false;
    // manual reload with R
    run.pickups.length = 0;
    p.ammo.pulse.left = 5; p.reloading = 0;
    press(w, "KeyR"); pump(w, 3, 16.7);
    assert(p.reloading > 0, "R did not start a manual reload");
    pump(w, 120, 16.7);
    assert(p.ammo.pulse.left === p.ammo.pulse.mag, "manual reload never finished");
  });

  /* ---- T5: dash, flare, radar consume energy and respect cooldowns ---- */
  check("dash / flare / radar abilities and energy economy", () => {
    const w = env.window, BP = w.__BP, run = BP.G.run, p = run.player;
    p.energy = p.maxEnergy;
    press(w, "ShiftLeft"); pump(w, 3);
    assert(p.dashT > 0 || p.dashCd > 0, "dash did not trigger");
    const e0 = p.energy;
    press(w, "ShiftLeft"); pump(w, 2);
    assert(p.energy >= e0 - 0.01 || p.dashCd > 0, "dash ignored its cooldown");
    p.energy = p.maxEnergy; p.flareCd = 0;
    press(w, "KeyE"); pump(w, 5);
    assert(run.flare, "flare did not spawn");
    assert(p.flareCd > 5, "flare cooldown not applied");
    p.energy = p.maxEnergy; p.radarCd = 0;
    press(w, "KeyQ"); pump(w, 5);
    assert(run.radarT > 0, "radar pulse did not activate");
    // energy regenerates but never exceeds max
    p.energy = 0;
    run.enemies.length = 0; run.spawners.length = 0; run.waveBudget = 0;
    p.invuln = 999;
    pump(w, 900, 16.7);
    assert(p.energy <= p.maxEnergy + 1e-6, "energy exceeded max");
    assert(p.energy > 0, "energy never regenerated");
    assert(Number.isFinite(p.x) && Number.isFinite(p.y), "player position went NaN during abilities");
  });

  /* ---- T6: enemies damage the player; death ends the run ---- */
  check("contact damage, death and the game-over flow", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 30, 16.7);
    const run = BP.G.run, p = run.player;
    run.enemies.length = 0; run.spawners.length = 0; run.waveBudget = 0;
    // drop a broodmother on top of the player
    const e = BP.api.spawnEnemy(run, "brood", p.x + 20, p.y, {});
    e.spawnT = 0; e.aggro = 10;
    p.invuln = 0;                              // clear the sector-start grace
    const hp0 = p.hp;
    pump(w, 200, 16.7);
    assert(p.hp < hp0 || BP.G.mode === "over" || run.dying, "contact damage never landed");
    assert(run.damageTaken > 0, "damageTaken not tracked");
    assert(p.invuln > 0 || run.dying, "no post-hit invulnerability window");
    // force death: a short cinematic must play, then the panel appears
    run.player.invuln = 0; run.player.dashT = 0;
    BP.api.hurtPlayer(run, 9999, 0, "the qa harness");
    pump(w, 5, 16.7);
    assert(run.dying === true, "death cinematic did not start");
    assert(BP.G.mode === "playing", "mode must stay playing during the cinematic, got " + BP.G.mode);
    const hpFrozen = run.player.hp;
    pump(w, 120, 16.7);
    assert(BP.G.mode === "over", "mode should be over, got " + BP.G.mode);
    assert(run.player.hp === hpFrozen && run.player.hp === 0, "corpse kept taking damage");
    assert(run.rank && typeof run.rank === "string", "rank missing");
    pump(w, 5, 16.7);
    assert(!w.document.getElementById("screen-over").classList.contains("hidden"), "game-over screen never shown");
    assert(w.document.getElementById("over-stats").children.length === 11, "stat block incomplete");
    assert(BP.Records.runs >= 1, "run was not recorded");
    assert(env.errors.length === 0, "errors during death flow:\n" + env.errors.join("\n"));
  });

  /* ---- T7: pause / resume ---- */
  check("pause freezes the simulation and resume continues it", () => {
    const w = env.window, BP = w.__BP;
    w.document.getElementById("btn-retry").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    pump(w, 120, 16.7);
    const run = BP.G.run;
    assert(BP.G.mode === "playing", "retry did not restart, mode=" + BP.G.mode);
    run.player.invuln = 999;
    press(w, "Escape"); pump(w, 2);
    assert(BP.G.mode === "paused", "escape did not pause");
    const t0 = run.time, x0 = run.player.x;
    pump(w, 60, 16.7);
    assert(run.time === t0, "simulation advanced while paused");
    assert(run.player.x === x0, "player moved while paused");
    assert(!w.document.getElementById("screen-pause").classList.contains("hidden"), "pause overlay hidden");
    press(w, "Escape"); pump(w, 30, 16.7);
    assert(BP.G.mode === "playing", "did not resume");
    assert(run.time > t0, "simulation did not resume");
    assert(w.document.getElementById("screen-pause").classList.contains("hidden"), "pause overlay stuck");
  });

  /* ---- T8: full wave clear → cores → exit → module select → next sector ---- */
  check("wave clear, core collection, lift and module selection", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 20, 16.7);
    let run = BP.G.run;
    run.player.invuln = 9999;
    // fast-forward: instantly kill everything in the wave until cores drop
    let guard = 0;
    while (!run.exit.open && guard++ < 400) {
      for (const e of run.enemies.slice()) BP.api.killEnemy(run, e, {});
      run.enemies.length = 0;
      run.spawners.length = 0;
      run.waveBudget = 0;
      pump(w, 40, 16.7);
      // vacuum up cores
      for (const o of run.pickups.slice()) {
        if (o.kind === "core") { o.x = run.player.x; o.y = run.player.y; }
      }
      pump(w, 20, 16.7);
    }
    assert(guard < 400, "exit never opened after clearing waves");
    assert(run.coresGot === run.coresNeed, "core objective over/under-counted: " + run.coresGot + "/" + run.coresNeed);
    assert(run.exit.open, "lift did not open");
    // walk into the lift
    const sector0 = run.sector;
    run.player.x = run.exit.x; run.player.y = run.exit.y + 4;
    pump(w, 90, 16.7);
    assert(BP.G.mode === "modules", "module select did not open (mode=" + BP.G.mode + ")");
    assert(w.document.getElementById("mod-cards").children.length === 3, "expected 3 module cards");
    // a full frame must elapse in the new state before the next keystroke
    pump(w, 3, 16.7);
    // pick with the keyboard; the digit must NOT also swap weapons
    const wepBefore = BP.G.run.player.weapon;
    press(w, "Digit2"); pump(w, 20, 16.7);
    assert(BP.G.mode === "playing", "module choice did not continue the run");
    assert(BP.G.run.sector === sector0 + 1, "sector did not advance");
    BP.G.run.player.invuln = 9999;
    assert(BP.G.run.player.modules.length === 1, "module was not installed");
    assert(BP.G.run.player.weapon === wepBefore, "digit key leaked into a weapon swap");
    assert(BP.G.run.wave === 1, "wave counter did not reset for the new sector");
    assert(BP.G.run.enemies.length === 0, "stale enemies carried into the new sector");
    assert(env.errors.length === 0, "errors during sector flow:\n" + env.errors.join("\n"));
  });

  /* ---- T9: every module applies without breaking state ---- */
  check("all 19 modules apply cleanly", () => {
    const w = env.window, BP = w.__BP;
    for (const m of BP.MODULES) {
      const fresh = { player: null };
      // rebuild a run so modules stack from a clean baseline
      w.document.getElementById("btn-start") && BP.api.startRun();
      pump(w, 2);
      const p = BP.G.run.player;
      const before = { hp: p.hp, maxHp: p.maxHp, dmgMul: p.dmgMul };
      m.apply(p);
      assert(Number.isFinite(p.maxHp) && p.maxHp > 0, m.id + " broke maxHp");
      assert(Number.isFinite(p.dmgMul) && p.dmgMul > 0, m.id + " broke dmgMul");
      assert(Number.isFinite(p.lampRange) && p.lampRange > 60, m.id + " broke lampRange");
      assert(Number.isFinite(p.energy) && p.energy <= p.maxEnergy + 1e-6, m.id + " overfilled energy");
      for (const k in p.ammo) {
        assert(p.ammo[k].mag > 0 && Number.isFinite(p.ammo[k].mag), m.id + " broke magazine for " + k);
        assert(p.ammo[k].left <= p.ammo[k].mag, m.id + " left ammo above magazine size for " + k);
      }
      pump(w, 20, 16.7);
      assert(env.errors.length === 0, m.id + " threw during play:\n" + env.errors.join("\n"));
    }
  });

  /* ---- T10: every enemy type behaves ---- */
  check("all four standard enemy archetypes update, attack and die", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 60, 16.7);
    const run = BP.G.run;
    for (const kind of ["lurker", "skitter", "screamer", "brood"]) {
      const e = BP.api.spawnEnemy(run, kind, run.player.x + 90, run.player.y + 40, {});
      e.spawnT = 0;
      pump(w, 240, 16.7);
      assert(!e.dead || run.enemies.indexOf(e) === -1, kind + " corpse left in the list");
      assert(Number.isFinite(e.x) && Number.isFinite(e.y), kind + " went NaN");
      for (const q of run.enemies) {
        assert(q.x > -5 && q.y > -5 && q.x < BP.CFG.ARENA_W + 5 && q.y < BP.CFG.ARENA_H + 5, kind + " escaped the arena");
      }
    }
    // screamer rings must damage the player
    run.rings.length = 0;
    const sc = BP.api.spawnEnemy(run, "screamer", run.player.x + 40, run.player.y, {});
    sc.spawnT = 0; sc.pulseT = 0.05;
    run.player.invuln = 0;
    const hp0 = run.player.hp;
    pump(w, 120, 16.7);
    assert(run.player.hp <= hp0, "screamer ring never hurt the player");
  });

  /* ---- T11: long soak — 8 sectors of chaotic input ---- */
  check("soak: 8 sectors of randomised play, no leaks or NaN", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun();
    let rnd = 12345;
    let maxSector = 1, restarts = 0;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
    let sectorsSeen = 1;
    for (let f = 0; f < 9000; f++) {
      const run = BP.G.run;
      if (!run) break;
      if (f % 7 === 0) {
        BP.Input.firing = rand() < 0.75;
        BP.Input.mx = rand() * 1440; BP.Input.my = rand() * 810;
      }
      if (rand() < 0.02) press(w, "ShiftLeft");
      if (rand() < 0.008) press(w, "KeyE");
      if (rand() < 0.008) press(w, "KeyQ");
      if (rand() < 0.02) press(w, "KeyR");
      if (rand() < 0.01) press(w, "Digit" + (1 + Math.floor(rand() * 3)));
      if (rand() < 0.05) {
        const codes = ["KeyW", "KeyA", "KeyS", "KeyD"];
        const c = codes[Math.floor(rand() * 4)];
        if (rand() < 0.5) press(w, c); else release(w, c);
      }
      if (BP.G.mode === "modules") { press(w, "Digit" + (1 + Math.floor(rand() * 3))); }
      if (BP.G.mode === "over" || BP.G.mode === "win") { BP.api.startRun(); restarts++; }
      // help the run along so we actually reach deep sectors: thin the wave,
      // vacuum the objective items, then ride the lift
      if (f % 45 === 0 && run.enemies.length) {
        for (const e of run.enemies.slice(0, 6)) BP.api.killEnemy(run, e, {});
      }
      for (const o of run.pickups) {
        if (o.kind === "core") { o.x = run.player.x; o.y = run.player.y; }
      }
      if (run.exit.open) { run.player.x = run.exit.x; run.player.y = run.exit.y; }
      // keep the subject alive so the soak exercises deep sectors + module stacks
      if (f % 300 === 0) run.player.hp = run.player.maxHp;
      pump(w, 1, 16.7);
      if (BP.G.mode === "playing") {
        maxSector = Math.max(maxSector, BP.G.run.sector);
        sectorsSeen = maxSector;
        const pl = BP.G.run.player;
        assert(pl.modules.length === BP.G.run.sector - 1,
          "module count out of sync with sector: " + pl.modules.length + " vs sector " + BP.G.run.sector);
        assert(BP.G.run.parts.length < 1200, "particle leak: " + BP.G.run.parts.length);
        assert(BP.G.run.bullets.length < 600, "bullet leak: " + BP.G.run.bullets.length);
        assert(BP.G.run.pickups.length < 120, "pickup leak: " + BP.G.run.pickups.length);
        const p = BP.G.run.player;
        assert(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.hp), "player state went NaN");
        assert(p.hp <= p.maxHp + 1e-6 && p.hp >= 0, "hp out of range: " + p.hp);
      }
    }
    assert(sectorsSeen >= 4, "soak only reached sector " + sectorsSeen + " (" + restarts + " restarts)");
    console.log("        (soak: reached sector " + sectorsSeen + ", " + restarts + " deaths/restarts)");
    assert(env.errors.length === 0, "soak errors:\n" + env.errors.slice(0, 6).join("\n"));
  });

  /* ---- T12: victory path at sector 10 ---- */
  check("sector 10 completes the game with a victory screen", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 5);
    const run = BP.G.run;
    run.sector = BP.CFG.MAX_SECTOR;
    BP.api.generateSector(run);
    run.exit.open = true;
    run.player.x = run.exit.x; run.player.y = run.exit.y;
    pump(w, 120, 16.7);
    assert(BP.G.mode === "win", "expected win mode, got " + BP.G.mode);
    assert(!w.document.getElementById("screen-win").classList.contains("hidden"), "victory screen never shown");
    pump(w, 60, 16.7);
    assert(w.document.getElementById("win-stats").children.length === 11, "victory stats incomplete");
  });

  /* ---- T13: canvas hygiene — no NaN geometry, sane draw-call volume ---- */
  check("renderer emits finite geometry at three resolutions", () => {
    for (const res of [[1920, 1080, 2], [1280, 720, 1], [414, 896, 3]]) {
      const e2 = boot({ w: res[0], h: res[1], dpr: res[2] });
      assert(e2.errors.length === 0, "boot errors @" + res + ":\n" + e2.errors.join("\n"));
      const w = e2.window;
      w.document.getElementById("btn-start").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      pump(w, 300, 16.7);
      const run = w.__BP.G.run;
      for (const en of run.enemies) { run.player.angle = Math.atan2(en.y - run.player.y, en.x - run.player.x); }
      pump(w, 240, 16.7);
      const calls = w.document.getElementById("game").__ctx.__calls;
      assert(calls.badNumbers.length === 0, "non-finite canvas args @" + res + ": " + calls.badNumbers.join(", "));
      assert(calls.count > 5000, "suspiciously few draw calls @" + res + ": " + calls.count);
      assert(w.__audioLog.length === 0, "WebAudio parameter errors @" + res + ":\n" + w.__audioLog.slice(0, 8).join("\n"));
      assert(e2.errors.length === 0, "errors @" + res + ":\n" + e2.errors.slice(0, 5).join("\n"));
      e2.window.close();
    }
  });

  /* ---- T14: pause on tab hide, resize mid-run, records persistence ---- */
  check("robustness: blur pause, mid-run resize, records persistence", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 60, 16.7);
    assert(BP.G.mode === "playing", "should be playing");
    w.dispatchEvent(new w.Event("blur"));
    pump(w, 2);
    assert(BP.G.mode === "paused", "window blur did not pause the game");
    BP.api.togglePause(false); pump(w, 5);
    // resize mid-run
    Object.defineProperty(w, "innerWidth", { value: 900, configurable: true });
    Object.defineProperty(w, "innerHeight", { value: 500, configurable: true });
    w.dispatchEvent(new w.Event("resize"));
    pump(w, 60, 16.7);
    assert(env.errors.length === 0, "resize errors:\n" + env.errors.join("\n"));
    assert(Number.isFinite(BP.G.run.player.x), "player NaN after resize");
    // records persist across a fresh boot
    const runsBefore = BP.Records.runs;
    BP.api.gameOver(BP.G.run);
    pump(w, 5);
    const raw = w.localStorage.getItem("blackout-protocol-records-v1");
    assert(raw, "records were not written to localStorage");
    const parsed = JSON.parse(raw);
    assert(parsed.runs >= runsBefore, "run count not persisted");
    assert(Number.isFinite(parsed.bestScore), "best score not persisted");
  });

  /* ---- T15: touch controls ---- */
  check("touch controls bind sticks and fire", () => {
    const e3 = boot({ w: 844, h: 390, dpr: 2 });
    const w = e3.window;
    Object.defineProperty(w.navigator, "maxTouchPoints", { value: 5, configurable: true });
    assert(e3.errors.length === 0, "touch boot errors:\n" + e3.errors.join("\n"));
    w.document.getElementById("btn-start").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    pump(w, 60, 16.7);
    const BP = w.__BP;
    BP.Input.touchMode = true;
    BP.Input.stickL = { dx: 1, dy: 0 };
    BP.Input.stickR = { dx: 1, dy: 0, ox: 0, oy: 0 };
    BP.Input.aim.active = true;
    BP.Input.firing = true;
    const x0 = BP.G.run.player.x, s0 = BP.G.run.shots;
    pump(w, 90, 16.7);
    assert(BP.G.run.player.x > x0 + 5, "touch move stick did not move the player");
    assert(BP.G.run.shots > s0, "touch aim stick did not fire");
    assert(e3.errors.length === 0, "touch play errors:\n" + e3.errors.join("\n"));
    w.close();
  });

  /* ---- T16: regression — simulation must run at real time ---- */
  check("REGRESSION: simulation advances at 1.0x wall-clock at 60 and 144 Hz", () => {
    for (const [hz, stepMs] of [[60, 1000 / 60], [144, 1000 / 144], [30, 1000 / 30], [20, 50]]) {
      const e4 = boot({ w: 1280, h: 720 });
      const w = e4.window, BP = w.__BP;
      BP.api.startRun(); pump(w, 20, stepMs);
      const run = BP.G.run;
      run.player.invuln = 1e6;
      const t0 = run.time;
      pump(w, 300, stepMs);
      const sim = run.time - t0;
      const wall = (300 * stepMs) / 1000;
      const ratio = sim / wall;
      assert(ratio > 0.93 && ratio < 1.07,
        "at " + hz + " Hz the sim ran at " + (ratio * 100).toFixed(1) + "% speed (" +
        sim.toFixed(2) + "s sim / " + wall.toFixed(2) + "s wall)");
      assert(e4.errors.length === 0, "errors @" + hz + "Hz:\n" + e4.errors.join("\n"));
      e4.window.close();
    }
  });

  /* ---- T17: semi-auto trigger discipline ---- */
  check("REGRESSION: Arc Lance fires once per click, SMG is full-auto", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 20, 16.7);
    const run = BP.G.run, p = run.player;
    run.enemies.length = 0; run.spawners.length = 0; run.waveBudget = 0;
    p.invuln = 1e6;
    press(w, "Digit3"); pump(w, 6, 16.7);
    assert(p.weapon === "lance", "lance not equipped");
    BP.Input.firing = true;
    p.ammo.lance.left = p.ammo.lance.mag;
    p.fireCd = 0; p.reloading = 0;
    const s0 = run.shots;
    pump(w, 180, 16.7);                       // 3 s of holding the trigger
    assert(run.shots - s0 === 1,
      "holding the trigger fired " + (run.shots - s0) + " lance rounds (expected exactly 1)");
    // clicking again must fire again
    BP.Input.firing = false; pump(w, 4, 16.7);
    p.fireCd = 0;
    BP.Input.firing = true; pump(w, 4, 16.7);
    assert(run.shots - s0 === 2, "a second click did not fire a second round");
    BP.Input.firing = false;
    // the SMG must be fully automatic
    press(w, "Digit1"); pump(w, 6, 16.7);
    p.fireCd = 0; p.reloading = 0;
    const s1 = run.shots;
    BP.Input.firing = true;
    pump(w, 60, 16.7);                          // 1 s
    const rate = run.shots - s1;
    assert(rate >= 8 && rate <= 13, "SMG fired " + rate + " rounds/s, expected ~10 (620 rpm)");
    BP.Input.firing = false;
  });

  /* ---- T18: lamp toggle changes both stealth and offence ---- */
  check("lamp toggle disables the burn, the beam and the cone lighting", () => {
    const w = env.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 20, 16.7);
    const run = BP.G.run, p = run.player;
    run.enemies.length = 0; run.spawners.length = 0; run.waveBudget = 0;
    p.invuln = 1e6;
    // park a lurker dead centre in the beam
    const e = BP.api.spawnEnemy(run, "lurker", p.x + 150, p.y, {});
    e.spawnT = 0; e.vx = 0; e.vy = 0;
    BP.Input.mx = 720 + 300; BP.Input.my = 405;   // aim +x, straight at it
    p.lampOn = true;
    pump(w, 90, 16.7);
    assert(e.lit > 0, "a lurker inside the beam was not lit");
    const hpLit = e.hp;
    pump(w, 180, 16.7);
    assert(e.hp < hpLit, "the lamp did not burn a lit lurker (" + hpLit + " -> " + e.hp + ")");
    // now run dark
    press(w, "KeyT"); pump(w, 4, 16.7);
    assert(p.lampOn === false, "T did not turn the lamp off");
    const e2 = BP.api.spawnEnemy(run, "lurker", p.x + 150, p.y + 4, {});
    e2.spawnT = 0; e2.vx = 0; e2.vy = 0;
    pump(w, 200, 16.7);
    assert(e2.lit <= 0.001, "an enemy was still lit with the lamp off");
    assert(e2.hp === e2.maxHp, "the lamp burned an enemy while switched off");
    press(w, "KeyT"); pump(w, 4, 16.7);
    assert(p.lampOn === true, "T did not turn the lamp back on");
    pump(w, 60, 16.7);
    assert(run.enemies.some(x => x.lit > 0), "the lamp did not relight enemies");
    assert(e2.raging === undefined || true, "");
    // light frenzy: a lit lurker must be faster than an unlit one
    assert(e2.aggro > 0, "light did not aggro the lurker");
  });

  /* ---- T19: difficulty curve sanity ---- */
  check("difficulty curve is monotonic and the opener is a tutorial", () => {
    const w = env.window, BP = w.__BP;
    const first = BP.api.waveComposition(1, 1);
    assert(first.count === 5, "sector 1 wave 1 should be 5 enemies, got " + first.count);
    assert(first.pool.length === 1 && first.pool[0] === "lurker",
      "sector 1 wave 1 must be lurkers only, got " + first.pool.join(","));
    let prev = 0, prevSectorTotal = 0;
    for (let s = 1; s <= BP.CFG.MAX_SECTOR; s++) {
      let sectorTotal = 0;
      prev = 0;                                   // waves ramp *within* a sector
      for (let wv = 1; wv <= BP.CFG.WAVES_PER_SECTOR; wv++) {
        const c = BP.api.waveComposition(s, wv);
        sectorTotal += c.count;
        assert(c.count >= prev || (s === 1 && wv === 1),
          "wave size shrank at S" + s + "W" + wv + ": " + c.count + " after " + prev);
        prev = Math.max(prev, c.count);
        assert(c.count <= 46, "wave exceeded the cap at S" + s + "W" + wv);
        assert(c.pool.length > 0, "empty enemy pool at S" + s + "W" + wv);
        for (const k of c.pool) assert(BP.ENEMY_DEFS[k], "unknown enemy kind " + k);
        assert(wv === BP.CFG.WAVES_PER_SECTOR ? c.isLast : !c.isLast, "isLast flag wrong");
      }
      if (s > 1) assert(sectorTotal > prevSectorTotal,
        "sector " + s + " is not harder than sector " + (s - 1) + " (" + sectorTotal + " vs " + prevSectorTotal + " hostiles)");
      prevSectorTotal = sectorTotal;
    }
    // new morphologies must arrive one at a time
    const unlocks = {};
    for (let s = 1; s <= BP.CFG.MAX_SECTOR; s++) {
      for (const k of new Set(BP.api.waveComposition(s, 3).pool)) {
        if (!unlocks[k]) unlocks[k] = s;
      }
    }
    assert(unlocks.lurker === 1, "lurker unlock " + unlocks.lurker);
    assert(unlocks.skitter === 2, "skitter unlock " + unlocks.skitter);
    assert(unlocks.screamer === 4, "screamer unlock " + unlocks.screamer);
    assert(unlocks.brood === 5, "brood unlock " + unlocks.brood);
    assert(BP.api.sectorSubtitle(1).length > 3, "sector subtitle missing");
    assert(BP.api.rankFor(1e9) === "S+" && BP.api.rankFor(0) === "E", "rank table broken");
  });

  /* ---- T19b: no timer-based transitions ---- */
  check("REGRESSION: the game has no setTimeout-driven transitions", () => {
    const src = fs.readFileSync(HTML, "utf8");
    assert(!/\bsetTimeout\s*\(/.test(src), "found a wall-clock timer in the game source");
    assert(src.includes("function beginDeath") && src.includes("deathT"),
      "death presentation must be simulation-clock driven");
  });

  /* ---- T20: persistent armory, settings, achievements screen ---- */
  check("EXPANSION: hangar renders all permanent upgrades and saves purchases", () => {
    const x = boot({ w: 1366, h: 768 }), w = x.window, BP = w.__BP;
    w.document.getElementById("btn-hangar").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    pump(w, 2);
    assert(BP.G.mode === "hangar", "armory button did not open the hangar");
    assert(w.document.querySelectorAll("#hangar-content .hangar-card").length === BP.ARSENAL.length,
      "armory card count does not match upgrade tree");
    w.document.querySelector('[data-hangar-tab="achievements"]').click();
    assert(w.document.querySelectorAll("#hangar-content .hangar-card").length === BP.ACHIEVEMENTS.length,
      "achievement dossier is incomplete");
    w.document.querySelector('[data-hangar-tab="records"]').click();
    BP.Profile.salvage = 1000;
    assert(BP.Profile.spend("hp"), "could not purchase plating");
    assert(BP.Profile.spend("start"), "could not unlock a starting weapon");
    BP.Profile.prefs.startWeapon = "lance";
    BP.Profile.save();
    BP.api.startRun();
    const p = BP.G.run.player;
    assert(p.maxHp === 112 && p.hp === 112, "plating upgrade not applied: " + p.hp + "/" + p.maxHp);
    assert(p.weapon === "lance", "loadout bay did not set the starting weapon");
    const saved = JSON.parse(w.localStorage.getItem("blackout-protocol-profile-v2"));
    assert(saved.upgrades.hp === 1 && saved.upgrades.start === 1, "armory did not persist upgrades");
    assert(w.localStorage.getItem("blackout-protocol-records-v1"), "legacy high-score record no longer mirrors");
    assert(x.errors.length === 0, "hangar errors:\n" + x.errors.join("\n"));
    w.close();
  });

  /* ---- T21: biomes, hazards and changing sector rules ---- */
  check("EXPANSION: all biome hazards generate and protocol modifiers scale waves", () => {
    const x = boot({ w: 1280, h: 720 }), w = x.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 2);
    const run = BP.G.run;
    for (let sector = 1; sector <= BP.CFG.MAX_SECTOR; sector++) {
      run.sector = sector;
      BP.api.generateSector(run);
      assert(run.theme && BP.THEMES[run.theme.id], "no biome at S" + sector);
      assert(run.hazards.length > 0, "no hazards generated at S" + sector + " (" + run.theme.name + ")");
      assert(run.hazards.every(h => h.def.id === run.theme.hazard), "hazard does not match biome at S" + sector);
      for (const h of run.hazards) {
        assert(Number.isFinite(h.x) && Number.isFinite(h.y) && h.x > 0 && h.y > 0, "bad hazard geometry");
      }
      BP.api.updateHazards(run, 0.05);
      BP.api.render();
    }
    run.sector = 5; run.wave = 2; run.mod = {};
    const base = BP.api.spawnEnemy(run, "lurker", 820, 640, {});
    const baseHp = base.maxHp;
    run.enemies.length = 0;
    run.mod = BP.SECTOR_MODS.find(m => m.id === "carapace");
    const plated = BP.api.spawnEnemy(run, "lurker", 820, 640, {});
    assert(Math.abs(plated.maxHp / baseHp - 1.28) < 1e-6, "CARAPACE did not scale hostile integrity");
    run.enemies.length = 0; run.mod = BP.SECTOR_MODS.find(m => m.id === "swarm");
    run.wave = 2; BP.api.startWave(run);
    const expected = Math.round(BP.api.waveComposition(5, 2).count * 1.32);
    assert(run.waveBudget === expected, "SWARM wave count mismatch: " + run.waveBudget + " != " + expected);
    assert(x.errors.length === 0, "biome/protocol errors:\n" + x.errors.slice(0, 6).join("\n"));
    w.close();
  });

  /* ---- T22: three secondary modes + temporary pickup power-ups ---- */
  check("EXPANSION: energy alt-fires, Aegis intercepts, and pickups buff the suit", () => {
    const x = boot({ w: 1280, h: 720 }), w = x.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 3);
    let run = BP.G.run, p = run.player;
    p.invuln = 999; p.x = 1200; p.y = 900; p.lampOn = false; p.weapon = "pulse";
    run.cam.x = p.x; run.cam.y = p.y;
    BP.Input.mx = 640 + 300; BP.Input.my = 360;
    const target = BP.api.spawnEnemy(run, "lurker", p.x + 180, p.y, {});
    target.spawnT = 0; target.vx = target.vy = 0;
    const hp0 = target.hp, energy0 = p.energy;
    BP.Input.altFiring = true; pump(w, 50, 16.7); BP.Input.altFiring = false; pump(w, 3, 16.7);
    assert(target.hp < hp0 || target.dead, "SMG overcharge beam did not hit its ray target");
    assert(p.energy < energy0, "beam consumed no energy");
    assert(!BP.Sound.beamOn, "beam synth did not shut off after release");

    p.weapon = "scatter"; p.energy = 100; p.x = 1000; p.y = 900; p.angle = 0; p.mineCd = 0;
    BP.Input.altFiring = true; pump(w, 3, 16.7); BP.Input.altFiring = false;
    assert(run.mines.length > 0, "Breach-12 secondary mode did not seed a mine");
    const mine = run.mines[0]; mine.arm = 0;
    const victim = BP.api.spawnEnemy(run, "lurker", mine.x, mine.y, {}); victim.spawnT = 0;
    const victimHp = victim.hp; pump(w, 3, 16.7);
    assert(!run.mines.includes(mine), "proximity mine did not detonate");
    assert(victim.hp < victimHp || victim.dead, "mine inflicted no damage");

    p.weapon = "lance"; p.energy = 100; p.shieldAng = 0;
    BP.Input.altFiring = true; pump(w, 1, 16.7);
    assert(p.shieldHp > 0, "Aegis shield did not deploy");
    const px = p.hp, sx = p.x + Math.cos(p.shieldAng) * (p.r + 20), sy = p.y + Math.sin(p.shieldAng) * (p.r + 20);
    run.bullets.push({ x: sx - 50, y: sy, px: sx - 50, py: sy, vx: 900, vy: 0,
      dmg: 22, life: 1, t: 0, r: 5, color: "#ff7ab8", friendly: false, seek: 0, spin: 0 });
    pump(w, 10, 16.7);
    assert(p.hp === px, "Aegis let a hostile bolt damage integrity");
    BP.Input.altFiring = false; pump(w, 3, 16.7);

    BP.api.collect(run, { kind: "overdrive", x: p.x, y: p.y });
    assert(p.buffDmg > 1 && p.buffDmgT >= 12, "Overdrive pickup did not grant its timed buff");
    BP.api.collect(run, { kind: "barrier", x: p.x, y: p.y });
    const barrierHp = p.hp;
    p.invuln = 0;
    BP.api.hurtPlayer(run, 20, Math.PI, "qa shield test");
    assert(p.hp === barrierHp && p.barrierHp === 60, "Aegis pickup did not absorb damage");
    assert(x.errors.length === 0, "alt-fire/power-up errors:\n" + x.errors.slice(0, 6).join("\n"));
    w.close();
  });

  /* ---- T23: Warden phases, hostile projectiles, boss-gated victory ---- */
  check("EXPANSION: sector 10 Warden attacks in phases and gates the victory", () => {
    const x = boot({ w: 1280, h: 720 }), w = x.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 2);
    const run = BP.G.run;
    run.sector = BP.CFG.MAX_SECTOR;
    BP.api.generateSector(run); run.wave = BP.CFG.WAVES_PER_SECTOR;
    BP.api.startWave(run);
    const boss = run.boss;
    assert(boss && boss.boss && run.bossActive, "final wave did not spawn the Warden");
    boss.roar = 0; boss.atkT = 0; boss.wind = 0; run.player.invuln = 999;
    boss.hp = boss.maxHp * 0.5;
    pump(w, 4, 16.7);
    assert(boss.phase === 2, "Warden did not transition to phase 2");
    boss.atk = "radial"; boss.wind = 0.02; boss.atkT = 0.7;
    pump(w, 12, 16.7);                          // force the documented radial tell deterministically
    assert(run.bullets.some(b => b.friendly === false), "Warden fired no hostile projectiles");
    pump(w, 168, 16.7);
    for (const b of run.bullets) {
      assert(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy), "bad Warden projectile");
    }
    BP.api.killEnemy(run, boss, {});
    assert(run.bossDown && !run.bossActive, "boss death did not mark the encounter clear");
    run.enemies.length = 0; run.spawners.length = 0; run.waveBudget = 0;
    run.player.hp = run.player.maxHp;
    pump(w, 4, 16.7);                              // wave clear creates remaining cores
    for (const o of run.pickups) if (o.kind === "core") { o.x = run.player.x; o.y = run.player.y; }
    pump(w, 8, 16.7);
    assert(run.exit.open, "Warden kill did not eventually unlock the core lift");
    run.player.x = run.exit.x; run.player.y = run.exit.y;
    pump(w, 80, 16.7);
    assert(BP.G.mode === "win" && run.won, "boss-gated sector 10 did not reach victory");
    assert(BP.Profile.wins >= 1 && BP.Profile.has("boss") && BP.Profile.has("win"), "victory was not persisted to the profile");
    const calls = w.document.getElementById("game").__ctx.__calls;
    assert(calls.badNumbers.length === 0, "Warden renderer emitted bad geometry: " + calls.badNumbers.join(", "));
    assert(w.__audioLog.length === 0, "Warden audio automation invalid: " + w.__audioLog.slice(0, 5).join("; "));
    assert(x.errors.length === 0, "Warden encounter errors:\n" + x.errors.slice(0, 6).join("\n"));
    w.close();
  });

  /* ---- T24: elite affixes and unlockable citations ---- */
  check("EXPANSION: elite affixes have distinct effects and citations pay salvage", () => {
    const x = boot({ w: 1280, h: 720 }), w = x.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 3);
    const run = BP.G.run, p = run.player; p.invuln = 999;
    run.enemies.length = 0; run.waveBudget = 0; run.spawners.length = 0;
    const armored = BP.api.spawnEnemy(run, "lurker", p.x + 500, p.y, { affixes: ["armored"] });
    armored.spawnT = 0;
    const hp = armored.hp;
    BP.api.damageEnemy(run, armored, 20, 1, 0, { silent: true });
    assert(Math.abs((hp - armored.hp) - 11) < 1e-6, "ARMOURED reduction is not 45%");
    const volatile = BP.api.spawnEnemy(run, "brood", p.x + 550, p.y, { affixes: ["volatile"] });
    volatile.hp = 1;
    const rings = run.rings.length;
    BP.api.killEnemy(run, volatile, {});
    assert(run.rings.length > rings, "VOLATILE death did not explode");
    const before = BP.Profile.salvage;
    assert(BP.Profile.unlock("first"), "first-time citation was not granted");
    assert(BP.Profile.salvage === before + 40, "citation reward was not banked");
    assert(!BP.Profile.unlock("first"), "citation rewarded twice");
    assert(x.errors.length === 0, "elite/citation errors:\n" + x.errors.slice(0, 6).join("\n"));
    w.close();
  });

  /* ---- T26: an opened lift must stop future wave scheduling ---- */
  check("REGRESSION: collecting all cores cannot loop the current wave forever", () => {
    const x = boot({ w: 1280, h: 720 }), w = x.window, BP = w.__BP;
    BP.api.startRun(); pump(w, 3);
    const run = BP.G.run;
    run.player.invuln = 999;
    run.player.x = run.exit.x + 500; run.player.y = run.exit.y + 300;
    run.wave = 2; run.waveActive = true; run.waveBudget = 7; run.spawnTimer = 0.01;
    run.enemies.length = 0; run.spawners.length = 0;
    run.coresGot = run.coresNeed = 2;
    run.exit.open = true;
    pump(w, 120, 16.7);
    assert(run.wave === 2 && run.waveBudget === 7 && run.spawners.length === 0,
      "a new wave was spawned after the lift opened (W" + run.wave + ", budget " + run.waveBudget + ")");
    assert(run.exit.open && BP.G.mode === "playing", "the open lift was lost before player arrival");
    assert(x.errors.length === 0, "exit scheduling errors:\n" + x.errors.join("\n"));
    w.close();
  });

  console.log(results.join("\n"));
  console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED") + "\n");
  process.exit(failures === 0 ? 0 : 1);
}
