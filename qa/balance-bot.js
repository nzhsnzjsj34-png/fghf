/* Balance bot: plays BLACKOUT PROTOCOL with a simple but competent policy and
   reports pacing data (clear times, damage taken, deaths per sector). */
"use strict";
const path = require("path");
const { boot, pump, press, release } = require(path.join(__dirname, "harness.js"));

const MAX_FRAMES = 60 * 60 * 7;           // 7 simulated minutes per life
const DT = 16.7;

function nearest(run, list, x, y, maxD) {
  let best = null, bd = (maxD || 1e9) * (maxD || 1e9);
  for (const o of list) {
    if (o.dead || o.broken || o.taken) continue;
    const dx = o.x - x, dy = o.y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function botFrame(run, BP, w, state) {
  const p = run.player;
  const I = BP.Input;

  /* --- pick a weapon for the situation --- */
  const threats = run.enemies.filter(e => !e.dead);
  const close = threats.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 190).length;
  // Default to the SMG; the shotgun is a panic button for point-blank crowds
  // and the lance is for armour. Choosing by *actual* range keeps the bot from
  // kiting at 300px with a weapon gated to 320px (which stalls it forever).
  const bigFoe = threats.some(e => e.def.kind === "brood" || e.def.kind === "screamer");
  const nearestD = threats.reduce((m, e) => Math.min(m, Math.hypot(e.x - p.x, e.y - p.y)), 1e9);
  const want = (close > 2 || nearestD < 230) ? "scatter" : bigFoe ? "lance" : "pulse";
  state.wantWep = want;
  if (want === state.wantPrev) state.wepStable = (state.wepStable || 0) + 1;
  else state.wepStable = 0;
  state.wantPrev = want;
  // never swap while the magazine is mid-reload, and only on a stable read
  if (p.weapon !== want && p.reloading <= 0 && state.wepStable > 45 && p.fireCd <= 0.05) {
    press(w, "Digit" + ({ pulse: 1, scatter: 2, lance: 3 })[want]);
    state.wepStable = -90;                     // ~1.5 s lockout, no flip-flop
  }

  /* --- primary target --- */
  const foe = nearest(run, threats, p.x, p.y, 1400);
  const core = nearest(run, run.pickups.filter(o => o.kind === "core"), p.x, p.y, 1e9);
  const hpKit = nearest(run, run.pickups.filter(o => o.kind === "hp"), p.x, p.y, 900);
  const loot = nearest(run, run.pickups.filter(o => o.kind !== "core"), p.x, p.y, 700);

  let goal = null;
  if (hpKit && p.hp < p.maxHp * (hpKit && threats.length === 0 ? 0.95 : 0.55)) goal = hpKit;
  else if (core) goal = core;
  else if (run.exit.open) goal = run.exit;
  else if (foe) goal = foe;
  else if (loot) goal = loot;

  /* --- movement: seek the goal, keep a combat distance, dodge lunges --- */
  let mx = 0, my = 0;
  if (goal) {
    const dx = goal.x - p.x, dy = goal.y - p.y, d = Math.hypot(dx, dy) || 1;
    const keep = goal === foe ? (foe.def.kind === "brood" ? 340 : 250) : 0;
    const dir = d > keep ? 1 : -1;
    mx = (dx / d) * dir; my = (dy / d) * dir;
    // backing off is urgent; advancing is not
    if (dir < 0) { mx *= 1.5; my *= 1.5; }
    // strafe so we are not a static target
    const t = state.f * 0.03;
    mx += (-dy / d) * Math.sin(t) * 0.55;
    my += (dx / d) * Math.sin(t) * 0.55;
  }
  // hard-dodge anything winding up or lunging at us
  for (const e of threats) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < 170 && (e.state === "wind" || e.state === "lunge" || e.state === "charge")) {
      mx += (p.x - e.x) / (d || 1) * 2.2; my += (p.y - e.y) / (d || 1) * 2.2;
      if (p.energy > 30 && p.dashCd <= 0 && Math.random() < 0.5) press(w, "ShiftLeft");
    }
  }
  // avoid shock rings
  for (const r of run.rings) {
    if (r.dmg <= 0) continue;
    const d = Math.hypot(r.x - p.x, r.y - p.y);
    if (Math.abs(d - r.r) < 90) {
      mx += (p.x - r.x) / (d || 1) * 1.6; my += (p.y - r.y) / (d || 1) * 1.6;
    }
  }
  const ml = Math.hypot(mx, my) || 1;
  setKey(w, "KeyW", my / ml < -0.35); setKey(w, "KeyS", my / ml > 0.35);
  setKey(w, "KeyA", mx / ml < -0.35); setKey(w, "KeyD", mx / ml > 0.35);

  /* --- aim + fire --- */
  if (foe) {
    // proper ballistic lead, solved iteratively against the real bullet speed
    const bs = BP.WEAPONS[p.weapon].speed;
    let t = Math.hypot(foe.x - p.x, foe.y - p.y) / bs;
    for (let k = 0; k < 3; k++) {
      const px = foe.x + foe.vx * t, py = foe.y + foe.vy * t;
      t = Math.hypot(px - p.x, py - p.y) / bs;
    }
    const ax = foe.x + foe.vx * t - p.x;
    const ay = foe.y + foe.vy * t - p.y;
    const al = Math.hypot(ax, ay) || 1;
    // plus a touch of human-like aim noise so it is not frame-perfect
    const jitter = 0.012;
    const jx = ax / al + (Math.random() - 0.5) * jitter;
    const jy = ay / al + (Math.random() - 0.5) * jitter;
    I.mx = 720 + jx * 300; I.my = 405 + jy * 300;
    const d = Math.hypot(foe.x - p.x, foe.y - p.y);
    const w2 = BP.WEAPONS[p.weapon];
    // burst discipline: conserve the shotgun, dump the SMG
    const gate = p.weapon === "scatter" ? 430 : p.weapon === "lance" ? 1200 : 950;
    I.firing = d < gate && amsOkay(p, BP);
    // the Arc Lance is semi-auto: re-click on its own cadence
    if (p.weapon === "lance" && I.firing && state.f % 40 === 0) { I.firing = false; state.reclick = true; }
    else if (state.reclick) { I.firing = true; state.reclick = false; }
  } else I.firing = false;

  /* --- abilities --- */
  if (threats.length >= 5 && p.energy >= 40 && p.flareCd <= 0 &&
      threats.filter(e => Math.hypot(e.x - p.x, e.y - p.y) < 300).length >= 3) press(w, "KeyE");
  if (p.reloading <= 0 && p.ammo[p.weapon].left < p.ammo[p.weapon].mag * 0.35 && threats.length === 0) press(w, "KeyR");
  if (run.radarT <= 0 && p.energy > 60 && !foe) press(w, "KeyQ");
  // lamp discipline: dark when repositioning with no contact
  if (!foe && p.lampOn && Math.random() < 0.02) press(w, "KeyT");
  if (foe && !p.lampOn) press(w, "KeyT");
}
function amsOkay(p, BP) { return p.ammo[p.weapon].left > 0; }
function setKey(w, code, down) {
  const H = require(path.join(__dirname, "harness.js"));
  if (down && !w.__BP.Input.down(code)) H.press(w, code);
  else if (!down && w.__BP.Input.down(code)) H.release(w, code);
}

function runTrial(opts) {
  const env = boot({ w: 1440, h: 810 });
  const w = env.window, BP = w.__BP;
  BP.api.startRun();
  pump(w, 5, DT);
  const state = { f: 0 };
  const sectorLog = [];
  let cur = { sector: 1, t0: 0, dmg0: 0, deaths: 0 };
  let result = "timeout";

  for (let f = 0; f < MAX_FRAMES; f++) {
    state.f = f;
    const run = BP.G.run;
    if (BP.G.mode === "playing" && run && !run.dying) botFrame(run, BP, w, state);
    if (BP.G.mode === "modules") press(w, "Digit" + (1 + (f % 3)));
    if (BP.G.mode === "over") { result = "death"; break; }
    if (BP.G.mode === "win") { result = "victory"; break; }
    pump(w, 1, DT);
    const r2 = BP.G.run;
    if (r2 && r2.sector !== cur.sector) {
      sectorLog.push({
        sector: cur.sector,
        secs: +((r2.time - cur.t0)).toFixed(1),
        dmg: Math.round(r2.damageTaken - cur.dmg0),
        hpLeft: Math.round(r2.player.hp),
        modules: r2.player.modules.length
      });
      cur = { sector: r2.sector, t0: r2.time, dmg0: r2.damageTaken };
    }
    if (f % 3000 === 0 && env.errors.length) break;
  }
  const run = BP.G.run;
  const out = {
    result,
    sector: run ? run.sector : 0,
    wave: run ? run.wave : 0,
    score: run ? Math.round(run.score) : 0,
    kills: run ? run.kills : 0,
    shots: run ? run.shots : 0,
    hits: run ? run.hits : 0,
    maxCombo: run ? run.maxCombo : 0,
    minutes: run ? +(run.time / 60).toFixed(2) : 0,
    hp: run ? Math.round(run.player.hp) : 0,
    modules: run ? run.player.modules.slice() : [],
    sectorLog,
    errors: env.errors.slice(0, 3)
  };
  w.close();
  return out;
}

if (require.main === module) {
  const trials = Number(process.argv[2] || 3);
  console.log("\n=== BALANCE BOT — " + trials + " trial(s) ===\n");
  const all = [];
  for (let i = 0; i < trials; i++) {
    const r = runTrial();
    all.push(r);
    console.log("trial " + (i + 1) + ": " + r.result.toUpperCase() +
      "  sector " + r.sector + " wave " + r.wave +
      "  score " + r.score.toLocaleString() +
      "  kills " + r.kills +
      "  acc " + (r.shots ? Math.round(r.hits / r.shots * 100) : 0) + "%" +
      "  maxCombo x" + r.maxCombo +
      "  " + r.minutes + " min  hp " + r.hp);
    if (r.errors.length) console.log("   ERRORS: " + r.errors.join(" | "));
    console.log("   sector pacing: " + r.sectorLog.map(s =>
      "S" + s.sector + " " + s.secs + "s/-" + s.dmg + "hp").join("  "));
  }
  const wins = all.filter(r => r.result === "victory").length;
  const avgSector = all.reduce((a, r) => a + r.sector, 0) / all.length;
  const avgScore = Math.round(all.reduce((a, r) => a + r.score, 0) / all.length);
  console.log("\nsummary: " + wins + "/" + all.length + " victories · avg sector " +
    avgSector.toFixed(1) + " · avg score " + avgScore.toLocaleString());
  const hard = all.flatMap(r => r.sectorLog).filter(s => s.dmg > 190);
  if (hard.length) console.log("brutal sectors (>190 dmg): " + hard.map(s => "S" + s.sector + " -" + s.dmg).join(", "));
  const slow = all.flatMap(r => r.sectorLog).filter(s => s.secs > 150);
  if (slow.length) console.log("slow sectors (>150s): " + slow.map(s => "S" + s.sector + " " + s.secs + "s").join(", "));
  const errs = all.filter(r => r.errors.length);
  console.log(errs.length ? "\nRUNTIME ERRORS PRESENT" : "\nno runtime errors in any trial");
  process.exit(errs.length ? 1 : 0);
}
module.exports = { runTrial };
