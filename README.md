# BLACKOUT PROTOCOL

> **A light-phobic twin-stick survival shooter.** Ten sectors down in HADAL-9, an abandoned
> deep-earth research station. Your suit lamp is the only thing that hurts the wildlife —
> and your gunfire is a dinner bell that echoes through the entire sector.

Single file. Zero dependencies. Zero assets: every pixel is drawn procedurally on canvas and
every sound is synthesised with the Web Audio API.

---

## 1. Executive concept brief

**Genre.** Top-down twin-stick arena survival with roguelite drafting, wrapped in a
darkness-driven stealth/horror loop.

**Setting.** HADAL-9, a subterranean research station 4.2 km down, eleven days after total
power loss. Something came up through the vents. It does not like light.

**Why this concept.** Three reasons, all design-driven:

1. **It makes one system do three jobs.** Light is simultaneously your *vision*, your
   *weapon* (photophobic burn) and your *liability* (it reveals you and enrages what it
   touches). A single mechanic carrying that much weight is what makes a small game feel
   authored rather than assembled.
2. **It fixes the classic arena-shooter problem.** In most twin-stick games the optimal play
   is "hold the trigger and circle-strafe". Here, holding the trigger *summons more of the
   level at you* — every shot broadcasts a noise radius that wakes creatures across the
   sector. Aggression is taxed, so burst-fire, repositioning, running dark and the stun
   flare all become real options instead of flavour.
3. **It is cheap to make look and sound expensive.** A darkness mask with eroded light
   volumes turns simple vector creatures into silhouettes with glowing eyes, and gives the
   whole game a horror-atmosphere budget of exactly one offscreen canvas.

**Unique selling point.** *You are the light source.* The muzzle flash that saves your life
is also the thing that ends it, and the lamp that burns the nest is the same lamp that tells
the nest where you are. The `T` key — killing your own light to disappear — is the verb most
players discover in sector 2 and never stop using.

**Core loop.**

```
descend into a sector
  → survive 5 waves (each drops Signal Cores)
    → collect every core to unlock the north lift
      → ride the lift → draft 1 of 3 salvage modules
        → descend into a harder sector          ×10 → SURFACE BREAK
```

**Win / loss.** Clear sector 10 to win. Suit integrity reaching zero ends the run; score,
deepest sector, lifetime kills and a letter rank (E → S+) persist in `localStorage`.

**Scope discipline.** One screen, one arena template, four enemy archetypes, three weapons,
eighteen modules, one file. Everything is a system that recombines rather than bespoke
content — which is the only reason a game of this depth is deliverable as a single artifact.

---

## 2. Game architecture & controls

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| Mouse | Aim the lamp (the cone points where you look) |
| Left mouse / `Space` | Fire (hold for auto weapons, click for the Arc Lance) |
| Right mouse / `E` | **Flare** — 40 energy, stuns and reveals everything in 520px, alerts the whole sector |
| `Shift` | **Dash** — 26 energy, 0.2s of invulnerability frames |
| `Q` | **Radar pulse** — 20 energy, 5s of full map visibility |
| `T` | **Lamp on/off** — run dark: no burn, no visibility, no tracking |
| `R` | Reload (also automatic on an empty magazine) |
| `1` `2` `3` / `F` | Pulse SMG · Breach-12 shotgun · Arc Lance rifle |
| `Esc` / `P` | Pause (auto-pauses on tab blur) |
| `M` | Mute |
| `Enter` | Start / redeploy / confirm |
| Touch | Left half = move stick, right half = aim-and-fire stick, plus flare/dash buttons |

### Systems

**Lighting.** A half-resolution offscreen canvas is filled with near-black, then
`destination-out` gradients *erase* holes for the lamp cone (three feathered passes), muzzle
flashes, flares, explosions, tracers, pickups and the lift. That mask is composited over the
world, and an additive "glow pass" redraws eyes, tracer bloom and pickup halos *on top* of
the darkness — which is why creatures read as pairs of eyes in a black room but are never
unfairly invisible. The lamp flickers harder as energy runs low.

**Noise.** `alertEnemies(x, y, radius)` sets aggro and a last-known-position target on every
enemy in a grid query. The SMG broadcasts 290px, the shotgun 620px, the lance 760px, a flare
1500px. Aggro decays, so a quiet player fights a trickle and a loud player fights the map.

**Photophobia.** Anything inside the cone is `lit`: it becomes visible, takes continuous burn
damage (Lurkers, 26/s scaled by modules), and is revealed on the minimap. Lurkers respond to
being lit by *frenzying* — a 1.65× speed charge at the beam that is hurting them. The lamp is
a trade, not a free win.

**Enemies.**

| Type | Behaviour |
| --- | --- |
| **Lurker** | Stalks slowly in the dark; burns and frenzies in your beam. Unlocks S1. |
| **Skitterling** | Fast pack hunter with a telegraphed lunge (0.3s wind-up ring). Unlocks S2. |
| **Screamer** | Keeps its distance, then emits a shock ring after a long 0.78s inhale: damage, screen shake, and it alerts every enemy in 900px. Unlocks S4. |
| **Broodmother** | Armoured charger; on death splits into three juvenile Skitterlings. Unlocks S5. |

**Difficulty.** Wave size = `5 + ⌊sector × 1.5⌋ + wave × 1.8` (capped at 46, max 26 alive at
once). Enemy HP scales `+17%/sector`, speed `+4.5%/sector`, damage `+7%/sector`. Sector 1
wave 1 is deliberately a handshake: five Lurkers and nothing else. Each sector's total hostile
count is strictly greater than the last (asserted by the test suite).

**Scoring.** `enemy.score × (1 + (combo − 1) × 0.35) × scoreMul`. The combo climbs on every
kill inside a 3.4s window, caps at ×25, and resets when you take damage. Sector clear pays
`400 + sector × 220 + hp × 12`; finishing the game pays a 5,000-point surface bonus.

**Drafting.** Between sectors you install one of three modules drawn from a pool of eighteen
(damage, ricochet, frag tips, lifesteal, a sentry drone, chrono-dampener bullet time, necrotic
corpse explosions, and so on). Modules stack multiplicatively where it matters and the pool
filters itself (max three drones).

**Simulation.** Fixed 1/120s timestep with an accumulator, decoupled from the render rate, so
physics are identical at 30, 60 and 144Hz and a stalled tab can never cause a death spiral.
Broad-phase collisions use a uniform 150px hash grid rebuilt each tick.

---

## 3. Running it

```bash
# option A — just open it
open index.html

# option B — serve it (needed for some browsers' storage/audio policies)
python3 -m http.server 8000 --bind 0.0.0.0
# then visit http://localhost:8000/index.html
```

No build step, no bundler, no network requests. Works offline from `file://`.

---

## 4. Repository layout

```
index.html          the entire game (HTML + CSS + JS, ~3.9k lines, self-contained)
qa/harness.js       headless test suite: jsdom + a recording canvas mock + WebAudio stub
qa/balance-bot.js   an autonomous bot that actually plays the game and reports pacing data
qa/package.json     QA-only dev dependency (jsdom)
README.md           this document
```

The game itself has **no** dependencies. `qa/` is development tooling only.

---

## 5. Quality assurance

```bash
cd qa && npm install
npm test          # 19 assertions suites, headless
npm run balance   # plays the game with a bot and reports the difficulty curve
npm run qa        # both
```

The harness boots the real `index.html` in jsdom with a canvas mock that **records every
argument passed to every draw call** and a WebAudio stub that validates every audio
parameter. That means the tests catch non-finite geometry, negative gradient radii, invalid
`addColorStop` offsets and out-of-range audio automation — not just logic errors.

### What the suite covers

| # | Area |
| --- | --- |
| 1 | Clean boot, menu render, no console/jsdom errors |
| 2 | Sector generation: vents, cover, lift, spawn point never inside geometry |
| 3 | Wave start, enemy spawn, every simulated value finite and inside the arena |
| 4 | All three weapons: fire, magazine consumption, auto-reload, manual `R` reload, swaps |
| 5 | Dash / flare / radar: energy costs, cooldowns, regen never exceeding max |
| 6 | Contact damage, i-frames, death cinematic, game-over panel, record submission |
| 7 | Pause truly freezes the simulation; resume continues it |
| 8 | Full progression: wave clear → cores → lift → module draft → next sector |
| 9 | All 18 modules applied to a live player without breaking any invariant |
| 10 | All four enemy archetypes move, attack, telegraph and die |
| 11 | Soak: thousands of frames of randomised input across many sectors — no leaks, no NaN |
| 12 | Sector 10 triggers the victory screen with complete stats |
| 13 | Renderer hygiene at 1080p@2x, 720p@1x and 414×896@3x |
| 14 | Blur-pause, mid-run window resize, `localStorage` persistence |
| 15 | Touch controls bind sticks and fire |
| 16 | **Regression:** simulation runs at 1.0× wall clock at 30/60/144Hz |
| 17 | **Regression:** Arc Lance fires exactly once per click; SMG fires ~10 rounds/s |
| 18 | **Regression:** lamp toggle disables burn, beam, minimap cone and enemy lighting |
| 19 | Difficulty curve is monotonic per sector; morphology unlocks land on S1/S2/S4/S5 |

### Bugs found and fixed during QA

1. **The entire game ran at ~22% speed.** The fixed-step accumulator allowed only 8 steps of
   1/120s per frame — 66ms of simulation for every 16.7ms of wall clock. Every animation,
   cooldown and reload was roughly 4× too slow. Fixed by sizing the step budget to the frame
   (`MAX_STEPS = 16`) and adding a stall guard that drops the backlog instead of spiralling.
   Now regression-tested at four refresh rates (T16).
2. **The Arc Lance was effectively full-auto.** Semi-auto fire was gated on a flag that was
   re-set every frame the trigger was held. Now it triggers on the *rising edge* of the
   trigger, verified by T17.
3. **Death and victory panels depended on `setTimeout`.** Real timers never fire under a
   throttled or backgrounded tab, so the game could end with no panel. Replaced with an
   in-world death cinematic driven by the simulation clock — there is now no `setTimeout`
   anywhere in the codebase.
4. **The gun stayed dry.** An empty magazine only reloaded if you pulled the trigger or
   pressed `R`. The suit now auto-feeds.
5. **A held number key leaked across states.** Selecting module "2" left `Digit2` latched, so
   the next sector started by swapping your weapon. Module selection now swallows the
   keystroke.
6. **Lurkers fled the light** — i.e. they ran away from your only source of damage, which
   taught players that the core mechanic didn't work. Replaced with a *light frenzy*: lit
   Lurkers burn and charge at 1.65× speed, making the lamp a genuine risk/reward decision.
7. **Unlit enemies were unreadable.** Global alpha as low as 0.16 made silhouettes invisible
   even with glowing eyes. Added a rim light so every creature has a faint outline at all
   times — atmosphere without unfairness.
8. **Accuracy could display as 121%.** Shotgun pellets and piercing rounds register more hits
   than trigger pulls. The stat now shows raw hits landed alongside a capped ratio.
9. **Sector 4 introduced two new enemy types at once** on top of a +51% HP step. Screamer and
   Broodmother are now staggered across sectors 4 and 5.
10. **Screamer rings were near-undodgeable.** Longer 0.78s telegraph, thinner 26px damage
    band, slower ring, 30% less damage, and a smaller radius.
11. `startRun` re-initialised run fields that `newRun` already owned, so several were
    duplicated and one (`muzzleLights`) could be `undefined` mid-frame. Consolidated.
12. An unreachable `m0()` helper produced non-deterministic vent placement; vent fallbacks are
    now generated from the seeded RNG like everything else.
13. The bot also reported >100% "accuracy" (106% on one trial) before the stat was capped —
    useful confirmation that the pellet/pierce accounting behind it is honest rather than a
    display artifact hiding a double-count.

### Balance measurements

`qa/balance-bot.js` plays the shipped game with a competent-but-not-perfect policy: iterative
ballistic lead, kiting at a preferred engagement distance, hard dodges against telegraphed
lunges and shock rings, medkit priority when hurt, weapon choice by *actual* range, and flare
usage when three or more hostiles are inside 300px.

Latest measurement — 5 trials, no runtime errors in any of them:

```
trial 1: DEATH  sector 6  wave 2  score 35,798  kills  86  max combo ×13   4.59 min
trial 2: DEATH  sector 5  wave 1  score 16,364  kills  48  max combo ×8    3.14 min
trial 3: DEATH  sector 5  wave 1  score 18,634  kills  54  max combo ×10   3.19 min
trial 4: DEATH  sector 3  wave 1  score  7,235  kills  18  max combo ×9    1.15 min
trial 5: DEATH  sector 6  wave 1  score 24,185  kills  65  max combo ×10   3.98 min

average sector reached: 5.0        average score: 20,443
```

Sector pacing from the deepest trial (time / damage taken):

```
S1 20.1s  -0hp     S2 20.4s  -0hp     S3 22.1s  -0hp
S4 44.4s  -8hp     S5 89.6s  -9hp     (died in S6 wave 2)
```

Readings: sectors 1–3 are a clean on-ramp (frequently zero damage), the Screamer and
Broodmother sectors are the intended wall, and a bot that cannot strafe-and-shoot as well as
a human tops out around sector 6. A full 10-sector run lands around 8–12 minutes, so a
competent human should be able to finish it — but only by using the lamp toggle, the dash
i-frames and the flare rather than by holding the trigger.

---

## 6. Technical notes

* **Deterministic runs.** Each run gets a seed; sector geometry is generated with a
  mulberry32 PRNG derived from `seed ^ sector`, so a seed reproduces its station layout.
* **Performance.** One uniform hash grid serves bullet hits, AI neighbour separation, noise
  propagation, explosion falloff and the pickup magnet. The darkness mask renders at
  0.45–0.7× resolution depending on viewport area. Particles, bullets and pickup lists are
  hard-capped. Frame cost is dominated by gradient fills, which is why the mask is downsampled.
* **Robustness.** Auto-pause on `blur` and `visibilitychange`; delta-time clamped with a
  stall guard; `localStorage` wrapped in `try/catch` so private-mode browsing still plays;
  WebAudio context created lazily on first gesture and resumed on every interaction;
  all DOM IDs referenced by the script are asserted present by the boot test.
* **Accessibility of information.** Enemy rim lights, always-visible glowing eyes, telegraph
  rings for every charge and lunge, a directional damage indicator, a low-health pulse, a
  minimap that mirrors the lamp cone, and an off-screen arrow pointing at the open lift.
