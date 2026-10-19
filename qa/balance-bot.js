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

const NAV_CELL = 96;
const NAV_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function navPath(run, sx, sy, gx, gy) {
  const cols = Math.ceil(run.player ? BP_ARENA_W(run) / NAV_CELL : 1);
  const rows = Math.ceil(BP_ARENA_H(run) / NAV_CELL);
  const n = cols * rows;
  const blocked = new Uint8Array(n);
  const idx = (x,y) => y * cols + x;
  const clear = (x,y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const px = x * NAV_CELL + NAV_CELL * 0.5, py = y * NAV_CELL + NAV_CELL * 0.5;
    if (px < 56 || py < 56 || px > BP_ARENA_W(run) - 56 || py > BP_ARENA_H(run) - 56) return false;
    for (const r of run.pillars) if (px > r.x - 30 && px < r.x + r.w + 30 && py > r.y - 30 && py < r.y + r.h + 30) return false;
    for (const c of run.crates) if (!c.broken && Math.abs(px-c.x) < c.r + 30 && Math.abs(py-c.y) < c.r + 30) return false;
    return true;
  };
  for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) blocked[idx(x,y)] = clear(x,y) ? 0 : 1;
  let start = [Math.floor(sx/NAV_CELL), Math.floor(sy/NAV_CELL)];
  let goal = [Math.floor(gx/NAV_CELL), Math.floor(gy/NAV_CELL)];
  const nearestClear = cell => {
    if (clear(cell[0],cell[1])) return cell;
    for (let r=1;r<=5;r++) {
      let best=null,bd=1e9;
      for(let y=cell[1]-r;y<=cell[1]+r;y++) for(let x=cell[0]-r;x<=cell[0]+r;x++) {
        if(Math.max(Math.abs(x-cell[0]),Math.abs(y-cell[1]))!==r || !clear(x,y)) continue;
        const d=(x-cell[0])**2+(y-cell[1])**2; if(d<bd){bd=d;best=[x,y];}
      }
      if(best) return best;
    }
    return cell;
  };
  start=nearestClear(start); goal=nearestClear(goal);
  const si=idx(start[0],start[1]), gi=idx(goal[0],goal[1]);
  const prev=new Int32Array(n); prev.fill(-1);
  const queue=new Int32Array(n); let head=0,tail=0; queue[tail++]=si; prev[si]=si;
  while(head<tail && prev[gi]===-1) {
    const cur=queue[head++], x=cur%cols, y=(cur/cols)|0;
    for(const [dx,dy] of NAV_DIRS) {
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=cols||ny>=rows) continue;
      const ni=idx(nx,ny); if(blocked[ni]||prev[ni]!==-1) continue;
      if(dx&&dy&&(blocked[idx(x+dx,y)]||blocked[idx(x,y+dy)])) continue;
      prev[ni]=cur; queue[tail++]=ni;
    }
  }
  if(prev[gi]===-1) return [];
  const rev=[]; let at=gi;
  while(at!==si&&at!==prev[at]) { rev.push(at); at=prev[at]; }
  rev.reverse();
  return rev.map(i=>({x:(i%cols)*NAV_CELL+NAV_CELL*0.5,y:((i/cols)|0)*NAV_CELL+NAV_CELL*0.5}));
}
function BP_ARENA_W(run){ return 2560; }
function BP_ARENA_H(run){ return 1760; }
function navWaypoint(run, p, goal, state) {
  if (!goal) return null;
  const changed = !state.navGoal || state.navGoal !== goal;
  if (changed || state.f >= (state.navReplan || 0)) {
    state.navGoal = goal;
    state.navPath = navPath(run,p.x,p.y,goal.x,goal.y);
    state.navIndex = 0;
    state.navReplan = state.f + 14;
  }
  const path=state.navPath||[];
  while(state.navIndex<path.length-1 && Math.hypot(path[state.navIndex].x-p.x,path[state.navIndex].y-p.y)<34) state.navIndex++;
  return path[state.navIndex] || goal;
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
  const warden = threats.some(e => e.boss);
  const bigFoe = warden || threats.some(e => e.def.kind === "brood" || e.def.kind === "screamer");
  const nearestD = threats.reduce((m, e) => Math.min(m, Math.hypot(e.x - p.x, e.y - p.y)), 1e9);
  const want = warden ? "pulse" : (close > 2 || nearestD < 230) ? "scatter" : bigFoe ? "lance" : "pulse";
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

  /* --- movement: path around cover, keep a combat distance, dodge lunges --- */
  let mx = 0, my = 0;
  if (goal) {
    let target = goal;
    // A* is only needed for non-combat objectives; the combat policy already
    // strafes at range, while cores and the lift need reliable obstacle routing.
    if (goal !== foe) target = navWaypoint(run, p, goal, state);
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
    const keep = goal === foe ? (foe.boss ? 390 : foe.def.kind === "brood" ? 340 : 250) : 18;
    const dir = d > keep ? 1 : -1;
    mx = (dx / d) * dir; my = (dy / d) * dir;
    if (dir < 0) { mx *= 1.5; my *= 1.5; }
    const t = state.f * 0.03;
    mx += (-dy / d) * Math.sin(t) * 0.55;
    my += (dx / d) * Math.sin(t) * 0.55;
  }
  // hard-dodge anything winding up or lunging at us
  for (const e of threats) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < (e.boss ? 260 : 170) && (e.state === "wind" || e.state === "lunge" || e.state === "charge" || (e.boss && e.wind > 0))) {
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
  // Active hazards and temporary void pools remain dynamic soft obstacles.
  for (const h of run.hazards || []) {
    let radius = h.def.r || h.def.size || 0;
    let danger = h.def.id === "spore" || h.def.id === "tesla";
    if (h.def.id === "steam") danger = h.active > 0.1 || h.warn > 0.2;
    if (h.def.id === "crusher") danger = h.warn > 0.25;
    if (!danger) continue;
    const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1;
    const limit = radius + 52;
    if (d < limit) { const k = 1 + (1 - d / limit) * 2; mx += dx / d * k; my += dy / d * k; }
  }
  for (const pool of run.pools || []) {
    const dx = p.x - pool.x, dy = p.y - pool.y, d = Math.hypot(dx, dy) || 1;
    if (d < pool.r + 72) { mx += dx / d * 2.4; my += dy / d * 2.4; }
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
    // Energy alt-fire: overcharge the final boss, seed mines into a close pack,
    // or raise the Aegis while a major lunge / bolt pattern is telegraphed.
    I.altFiring = false;
    if (p.energy > 34 && warden && p.weapon === "pulse") I.altFiring = true;
    if (p.energy > 40 && p.weapon === "scatter" && close >= 3) I.altFiring = true;
    if (p.energy > 24 && p.weapon === "lance" && threats.some(e => e.boss && (e.wind > 0 || e.state === "charge"))) I.altFiring = true;
    // the Arc Lance is semi-auto: re-click on its own cadence
    if (p.weapon === "lance" && I.firing && state.f % 40 === 0) { I.firing = false; state.reclick = true; }
    else if (state.reclick) { I.firing = true; state.reclick = false; }
  } else { I.firing = false; I.altFiring = false; }

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
  // The bot uses the free starting bankroll on a sensible first permanent upgrade.
  BP.Profile.spend("hp");
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
  BP.Input.altFiring = false;
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
