# BLACKOUT PROTOCOL — The Branching Descent

A self-contained, top-down twin-stick survival shooter. Descend through HADAL-9, an abandoned research station 4.2 km below the surface. Your suit lamp is your only weapon against photophobic wildlife; every gunshot tells the whole sector where you are.

**Play:** open `index.html`, or run `python3 -m http.server 8000 --bind 0.0.0.0` and visit `/index.html`.
**Game dependencies:** none. Art is drawn with Canvas and every sound is synthesized with Web Audio. There are no remote fonts, images, libraries, or CDNs.

---

## Changelog

### Visual and choice redesign

- The hangar, branch drafts, route archive, and end screens use a crisp system-sans display face, clearer contrast, rounded glass panels, restrained motion, and keyboard-focus styling. Reduced-motion preferences are respected.
- Sector drafts now show **three distinct, color-coded doctrines** at a time: red **Assault**, green **Survival**, cyan **Engineering**, violet **Ghost**, and gold **Signal**. Each choice has an icon, a short practical effect, and mouse, touch, keyboard, and screen-reader support.
- Every pick is saved in a route history. The ending is shaped by the doctrine used most often; a balanced route has its own outcome. Five distinct epilogues and an ending archive make alternate outcomes discoverable.
- Five earned palettes recolor the interface, suit, lamp, minimap, and in-game HUD: Cryo Glass (default), Reactor Ember (reach sector 3), Spore Bloom (reach sector 5), Deep Signal (defeat the Warden), and Daybreak (complete a career run). Equip them in **HADAL Armory → Visual themes**.

### Post-game and progression

- Victory and defeat reports now include run statistics, the chosen branch history, a projected or discovered ending, newly earned citations, and any palette unlocks.
- **New Game+** unlocks after a career victory. Each clear unlocks the next tier; persistent Armory perks carry over while enemy health, damage, speed, wave pressure, and the Warden scale upward.
- **Sector Archive** lets you revisit any sector reached in a career run and launch one of five branch starter modules. Archive runs can reveal alternate endings, but do not change ranked records or bank run salvage. First-time citations and ending discoveries persist.
- Profile data—career records, salvage, upgrades, citations, New Game+ tier, palettes, route endings, and the last run report—loads and saves locally.

### Campaign and combat

- **Persistent HADAL Armory:** 11 permanent upgrades, including integrity, weapon damage, energy, lamp, dash, flares, magazines, drone, score/salvage, a one-use defibrillator, and starting weapon.
- **19 citations:** first-time achievements award salvage for kills, combos, deep sectors, special weapons, hazards, elites, the Warden, and all five endings.
- **Three alternate weapon modes:** Pulse SMG overcharge beam, Breach-12 proximity mines, and Arc Lance Aegis.
- **Five biomes and four hazards:** Maintenance Spine, Hydroponic Bloom, Coolant Ring, Specimen Vault, and The Nest; steam, spore, Tesla, and crusher hazards; nine sector protocols; seven elite affixes.
- **Sector-10 finale:** the three-phase Warden of the Core telegraphs volleys, charges, summons, and a spiral barrage. Its defeat is required for a career victory.
- Desktop runs capture the pointer for relative-mouse aiming; Escape pauses and releases it, and resuming attempts to recapture. Unsupported browsers and touch devices retain ordinary mouse/touch controls.
- Damage numbers, kill-streak callouts, lightning chains, temporary Overdrive/Aegis pickups, boss phase effects, synthesized audio, touch controls, pause, records, and performance safeguards remain part of the single-file game.

---

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Aim; on desktop, the pointer captures to the game at run start and relative movement aims |
| Left mouse / `Space` | Primary fire — hold for auto weapons, click for the Arc Lance |
| Right mouse / `G` | Hold for the current weapon's alternate fire |
| `Shift` | Dash with invulnerability frames |
| `E` | Flare: stun and reveal nearby hostiles; noisy enough to alert the sector |
| `Q` | Radar pulse |
| `T` | Toggle suit lamp: light burns, reveals, and enrages; darkness conceals you |
| `R` | Reload (also reloads automatically when empty) |
| `1` / `2` / `3` or `F` | Select / cycle Pulse SMG, Breach-12, Arc Lance |
| `Esc` / `P` | Pause and release the mouse; resuming attempts to recapture it. The game also auto-pauses when the tab loses focus. |
| `A` (title screen) | Open Sector Archive |
| `N` (after unlock) | Start the latest New Game+ tier |
| `M` | Toggle audio |
| `Enter` | Start or redeploy a standard run |
| Touch | Left stick moves; right stick aims/fires; Flare, Dash, and Alt buttons are provided |

### Branches and endings

Between sectors, pick one module from three offers drawn from different branches. Each module changes the next fight and records a doctrine choice. The most-selected branch determines the final route: **Purge Protocol** (Assault), **Lifeline Protocol** (Survival), **Open Channel** (Engineering), **Ghost Current** (Ghost), or **Echo Archive** (Signal). An even split yields a balanced ending. Route decisions are shown on both the victory report and the Sector Archive.

### Run loop

Survive five waves, recover Signal Cores, and stand in the north lift. Between sectors, draft a module. Sector 10 replaces its final wave with the Warden. When the suit fails, the report records your run; scores, citations, salvage, upgrades, cosmetics, and endings are saved on this device.

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

The automated suite has **32 passing test groups**. The jsdom Canvas mock records draw calls and checks non-finite geometry and gradients; a Web Audio stub validates scheduled parameters. Tests cover the complete campaign loop, persistence and veteran-profile migration, refresh-rate regressions, biomes and hazards, all three alternate fires, the Warden, career victory, branch choice/history/endings, the five-ending reward, New Game+ scaling, cosmetic persistence, non-ranked archive replays, and the desktop pointer-lock lifecycle with relative mouse aiming.

`qa/balance-bot.js` is a stress/pacing probe using weapon selection, ballistic leading, route planning, dodges, pickup priorities, and energy modes. It is not a victory guarantee. Latest sample: 3 trials, 0 victories, average sector 3.0, deepest sector 5, and no runtime errors.

## Files

```text
index.html          Complete playable game: HTML, CSS, procedural art, Web Audio, and all game systems
qa/harness.js       32-group headless QA suite
qa/balance-bot.js   Autonomous gameplay/pacing probe
qa/package.json     jsdom dependency for QA only
README.md           This guide and changelog
```

The complete game is the single self-contained `index.html` file. The optional `qa/` tooling is not loaded by the game.
