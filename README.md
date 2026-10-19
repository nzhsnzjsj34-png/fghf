# BLACKOUT PROTOCOL — Arsenal Edition

A self-contained, top-down twin-stick survival shooter. Descend through HADAL-9, an abandoned research station 4.2 km below the surface. Your suit lamp is your only weapon against the photophobic wildlife; every gunshot tells the whole sector where you are.

**Play:** open `index.html`, or serve the repository with `python3 -m http.server 8000 --bind 0.0.0.0` and visit `/index.html`.
**Dependencies:** none for the game. All art is drawn in Canvas; all sound is synthesised using Web Audio.

---

## Upgrade changelog

This edition expands the original BLACKOUT PROTOCOL while retaining its complete combat/progression loop, procedural rendering, audio synthesis, touch controls, records, and pause/death/victory states.

- **Persistent HADAL Armory.** Salvage earned in each run buys 11 permanent upgrades: integrity plating, weapon damage, energy capacity, lamp performance, dash, flares, magazines, a starting sentry drone, score/salvage, a one-use defibrillator, and a selectable starting weapon. Purchases persist locally between descents.
- **Achievement citations.** 18 first-time achievements award more salvage, from a first kill and high combo to dark kills, hazard kills, elite kills, a defibrillator save, and defeating the Warden.
- **Three weapon-specific alternate fires.** Hold right mouse or `G`: the Pulse SMG channels an energy beam, the Breach-12 lays proximity mines, and the Arc Lance raises a frontal Aegis that intercepts projectiles. Touch has a dedicated Alt button.
- **Five sector biomes and live hazards.** Maintenance Spine, Hydroponic Bloom, Coolant Ring, Specimen Vault, and The Nest introduce cyclic steam jets, corrosive spore pools, arcing busbars, and readable hydraulic presses. Each sector also rolls one of nine rule-changing protocols, such as Swarm, Carapace, Brownout, Scarcity, Bounty, or Volatility.
- **Seven elite affixes.** Armoured, Swift, Volatile, Leech, Shroud, Matriarch, and Splitter hostiles add readable, stackable variations to standard enemies.
- **A three-phase sector-10 finale.** The Warden of the Core telegraphs radial and aimed volleys, charges, summons adds, and spirals a phase-three barrage. Its charge leaves temporary void pools and its proximity suppresses the lamp.
- **Juice and combat feedback.** Damage numbers, kill-streak callouts, capped decals, lightning chains, temporary Overdrive and Aegis pickups, boss hit/phase effects, and added procedural Web Audio voices. Screen shake, damage numbers, ambient music, and audio can be configured in the hangar.
- **Performance and integrity.** The fixed 1/120-second simulation, accumulator stall guard, 150px spatial hash, bounded effects/projectiles, and renderer/audio QA remain in place. There are no timer-based gameplay transitions.

---

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Aim |
| Left mouse / `Space` | Primary fire — hold for auto weapons, click for the Arc Lance |
| Right mouse / `G` | Hold for the current weapon's energy alternate fire |
| `Shift` | Dash with invulnerability frames |
| `E` | Flare: stun and reveal nearby hostiles; loud enough to alert the sector |
| `Q` | Radar pulse |
| `T` | Toggle the suit lamp: light burns, reveals, and enrages; darkness conceals you |
| `R` | Reload (also reloads automatically when empty) |
| `1` / `2` / `3` or `F` | Select / cycle Pulse SMG, Breach-12, Arc Lance |
| `Esc` / `P` | Pause; the game auto-pauses when the tab loses focus |
| `M` | Toggle audio |
| `Enter` | Start, redeploy, or confirm |
| Touch | Left stick moves; right stick aims/fires; Flare, Dash, and Alt buttons are provided |

### Alternate fires

- **Pulse SMG — Overcharge Beam:** continuous, piercing damage along the aim ray; drains energy and emits periodic noise.
- **Breach-12 — Proximity Mine:** place an armed mine that detonates when a hostile approaches.
- **Arc Lance — Aegis:** orbit a frontal barrier that absorbs hostile projectiles; energy sustains it.

### Run loop

Survive five waves, recover the Signal Cores, and stand in the north lift. Between sectors, draft one of three salvage modules. Sector 10 replaces its final wave with the Warden encounter. If the suit fails, the run ends; scores, rank, kills, citations, salvage, and upgrades are stored locally.

---

## Run, test, develop

```bash
# play locally, no install/build step required
python3 -m http.server 8000 --bind 0.0.0.0

# headless QA (development tooling only)
cd qa
npm install
npm test
npm run balance
npm run qa
```

The automated suite currently contains **26 passing test groups**. Its jsdom canvas mock records draw calls and checks non-finite geometry and invalid gradients; its Web Audio stub validates scheduled parameters. Coverage includes the original full game loop and refresh-rate regressions, plus a no-timer source check, armory purchases and persistence, all biomes/hazards, sector modifiers, all alternate fires, timed power-ups, elite damage/effects, the Warden's phases/projectiles, and a boss-gated full victory path.

`qa/balance-bot.js` runs an autonomous policy using range-aware weapon selection, ballistic leading, grid-routed pickup/lift movement, kiting, lunge/ring dodges, pickup priorities, and the new energy modes. It is a stress and pacing probe, not a victory guarantee; output includes per-sector elapsed time, damage taken, accuracy, and runtime errors.

Latest sample: 3 trials, average **sector 7.0**, deepest sector 8, 0/3 full clears, and **no runtime errors**. The bot's longest run reached sector 8 in 4.75 minutes; the campaign boss remains a genuine final challenge.

## Files

```text
index.html          Complete playable game: HTML, CSS, procedural art, Web Audio, game systems
qa/harness.js       Headless QA suite
qa/balance-bot.js   Autonomous gameplay/pacing probe
qa/package.json     jsdom dependency for QA only
README.md           This guide
```

The game is intentionally delivered as one `index.html` file. The `qa/` directory is optional development tooling and is not loaded by the game.
