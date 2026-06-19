# Olundar: Deadwalker Strategy Prototype

A lightweight, turn-based exploration, survival, diplomacy, and war strategy game prototype set in **Olundar**. The player commands Olundar, a Roman-period-inspired civilization facing a spreading undead empire called the **Deadwalkers**.

The prototype is intentionally dependency-light: plain HTML, CSS, and modern JavaScript modules. It is designed to run in a browser, scale down to older phones, and remain easy to port later to a PWA or app-store shell.

## What is playable now

- Turn-based movement, attacking, training, construction, economy, diplomacy, and enemy AI.
- Campaign setup with named scenarios, editable seeds, and difficulty presets that change resources and Deadwalker pressure.
- A War Council panel that turns current campaign state into readable priorities, pressure indicators, and next-step guidance.
- A compact First Six Turns guide that teaches the opening scout, engineer, training, iron, diplomacy, and Deadwalker-front priorities from live campaign state.
- Siege Operations that track midgame victory work: onagers, survival pacts, Deadwalker strongholds, Vorgath, and the Bone Portal.
- Crisis Council events for refugee caravans, thin granaries, night raids, and emergency councils, with rulings that change resources, morale, population, troops, fortifications, or relations.
- Chained crisis aftermaths that turn earlier hard rulings into delayed petitions, public strain, diplomatic memory, repairs, or battlefield opportunities.
- Aftermath Missions that place crisis follow-through tasks on the map, such as escort roads, repair scars, raider trails, and accord routes, with visible site art, focus controls, route previews, focused route overlays, dispatch actions, result banners, searchable, sortable, route/ruling-grouped, and type-filtered completed archives, map refocus, site receipts, route chains, origin-ruling labels, and terrain-specific rewards.
- Campaign recap overlay for victory, defeat, and imported saves with stats, objective milestones, and practical next steps.
- Diplomacy Ledger that keeps contacts, pacts, trade, aid, pressure, and rivalries visible over long campaigns.
- Diplomatic Memory that tracks promises, grievances, and fulfilled pact commitments so long wars have political continuity.
- Faction-specific promises for Dawnward wall guards, Veyr war caravans, and Mireclan marsh routes, each with distinct costs, effects, and delayed follow-through demands.
- Living-faction war aims that make Dawnward, Veyr, and Mireclan behavior visible before any Survival Pact.
- Pact-based allied field orders for defending Olundar roads, reinforcing the capital, or harassing Deadwalker structures.
- Compact strategic map lenses for blight, roads, supply reach, Survival Pact vision, and aftermath mission targets.
- Fog of war with visible and previously revealed states.
- Procedural topography: plains, forests, hills, mountains, rivers, marshes, ruins, roads, and grave-blight.
- Terrain effects: movement cost, sight bonuses/penalties, defense, resource logic, blight attrition, and road logistics.
- Attack forecasts that show damage, range, target HP, terrain/fortify defense, siege bonuses, and portal reformation before the player commits.
- Player units: Pathfinder Scout, Shield Legionary, Spear Guard, Archer, Equite Cavalry, Field Engineer, and Onager Crew.
- Buildings: City Center, Farms, Lumber Camps, Mines, Barracks, Archery Yard, Stable, Workshop, Watchtower, Walls, Roads, Shrine, and Outpost.
- Building upgrades that increase durability, vision, income, training capacity, and city housing without adding tedious micromanagement.
- Deadwalker civilization: Bone Portal, Bone Pits, Grave Forges, Necropolises, Bone Thralls, Corpse Archers, Grave Knights, and Vorgath the Hollow Crown.
- Diplomacy with the Dawnward League, Veyr Dominion, and Mireclan Holds.
- Named local campaign save slots, legacy quick-save loading, plus exportable and importable JSON save files.
- Optional procedural audio cues and a low-volume ambient bed, enabled only after the player turns audio on.
- Player settings for audio volume, reduced motion, and compact/standard/expanded map scale.
- Installable PWA shell with web app manifest, maskable icon, and service-worker app-shell caching for offline reloads.
- Canvas-rendered sprites plus a vector reference sprite sheet at `assets/sprites/olundar-sprite-sheet.svg`.
- `npm run quality:check` gate covering syntax, data integrity, map generation, campaign setup, named save slots, save-file import, audio cue budgets, player settings, PWA shell integrity, onboarding guidance, campaign recaps, diplomacy ledger behavior, diplomatic memory, faction-specific promises and follow-through demands, living-faction war aims, allied field orders, crisis rulings, aftermaths, aftermath mission chains, canvas site markers, focus controls, route previews, focused route overlays, mission dispatch actions, result banners, mission outcome archives, archive type filters, archive text search, archive sort controls, archive route and ruling grouping, archived-site map focus, completed-site receipts, terrain rewards, strategic map lenses, advisor logic, pathing, training, construction, upgrades, combat forecasts, portal rules, and a 24-turn simulation.

## Run it locally

```bash
npm run quality:check
npm start
```

Then open the local URL printed by the server, usually `http://localhost:4173`.

No package install is required because this prototype has no third-party runtime dependencies.
Browsers that support installation will expose an **Install** button after the app is eligible; the service worker keeps the app shell available for offline reloads after the first visit.

## Controls

- Click an Olundaran unit, then click a tile to move.
- Select an Olundaran unit and hover or click a visible hostile target to preview damage, range, and target HP.
- Click a visible hostile unit or building in range to attack.
- Select an engineer and choose a building order, then click the engineer’s tile or an adjacent valid tile.
- Select a city or military building to train units.
- Select an Olundaran building to upgrade it when resources allow.
- Press `N` or click **Next Unit** to cycle to the next ready unit.
- Press `E` to end the turn; if units are idle, press `E` again or use `Shift + E` to confirm.
- Click **New** to choose a scenario, difficulty, and seed.
- Press `Esc` to cancel build mode.
- Click **Save** or **Load** to manage named campaign slots.
- Click **Import save file** or **Import JSON** in the save manager to load an exported campaign on the current device.
- Imported campaigns open a recap with the current status, milestones, and best next moves.
- Use the **Map lens** controls above the canvas to inspect normal terrain, blight, roads, supply reach, alliance vision, and active aftermath missions.
- When the **Crisis Council** appears, choose one ruling per event; some rulings create delayed aftermath cards a few turns later, unaffordable choices are disabled, and recent rulings stay visible for a few turns.
- When **Aftermath Missions** appear, use **Focus** on a mission card or the Missions lens to inspect the marked site; route previews name the recommended unit, whether it can complete the task this turn, **Unit** jumps to that unit, and **Dispatch** moves it immediately when the route is reachable; focused missions draw a revealed map route from the unit to the target; completed dispatches show a compact result banner with the reward and follow-up marker when one opens; the completed list can switch between recent outcomes and older archived outcomes, archive outcomes can be filtered by repair, escort, raid, or accord site type, searched by text/turn/reward, sorted newest-first or oldest-first, and grouped by route chain or origin ruling, **Site** refocuses a completed outcome on the Missions lens, and the tile panel shows the completed-site receipt; camps, raider sites, accord waystations, and repair scars have distinct map art, some routes reveal a second waypoint, and each site pays a terrain-specific reward.
- The Diplomacy Ledger shows relation posture, war aims, active accords, recent diplomatic outcomes, and action availability for every living civilization.
- Diplomatic Memory inside the ledger shows promises, grievances, and fulfilled pact commitments that affect advice.
- Faction Promises inside the ledger let Olundar make one-time civilization-specific commitments: guard Dawnward walls, fund Veyr caravans, or scout Mireclan marsh routes.
- Promise Demands can appear a few turns after a faction promise; answer them to deepen trust and gain practical help, or ignore them to save resources and accept a recorded grievance.
- Survival Pacts unlock field orders that steer allied AI without direct unit micromanagement.
- Press `Ctrl/Cmd + S` to quick-save into the active named slot.
- Press `Ctrl/Cmd + L` to open the load slots panel.
- Click **Audio Off/On** to opt into lightweight audio feedback.
- Click **Settings** to adjust volume, motion, and map scale for the current device.
- Click **Install** when your browser offers it to add Olundar to the device.

## Main objective

Explore through fog, survive the Deadwalker expansion, build a war economy, use diplomacy wisely, kill **Vorgath the Hollow Crown**, and then destroy the **Bone Portal**. The portal reforms if attacked before Vorgath is slain.

## Project structure

```text
olundar_game/
  index.html
  manifest.webmanifest
  package.json
  README.md
  DESIGN.md
  sw.js
  assets/
    icons/olundar-icon.svg
    sprites/olundar-sprite-sheet.svg
  src/
    content.js       # units, buildings, terrain, factions, costs, objectives
    audio.js         # opt-in procedural cues and ambient audio
    map.js           # deterministic world generation and topology helpers
    rules.js         # game state, fog, movement, combat, economy, AI, diplomacy
    render.js        # canvas terrain, sprites, fog, minimap, UI descriptions
    main.js          # browser UI/event loop
    pwa.js           # install prompt and service-worker registration
    saveTransfer.js  # exported JSON save import helpers
    settings.js      # player comfort settings and map-scale presets
    style.css
  tools/
    serve.mjs
    quality-check.mjs
```

## Quality gate

`npm run quality:check` is deliberately more than a syntax check. It validates that the game is structurally playable before changes are accepted:

- JavaScript syntax parse check.
- Content table consistency.
- Campaign essentials exist.
- Scenario and difficulty presets apply resources, metadata, starting units, and Deadwalker cadence.
- Named save slots sanitize names, preserve campaign metadata, sort by save time, update existing slots, and ignore corrupt storage.
- Exported JSON save files import into named save slots and reject incompatible versions.
- Procedural audio cues stay browser-safe, distinct, and lightweight.
- Player settings normalize audio volume, motion, and map-scale choices.
- PWA manifest, icon, install prompt wiring, service worker, and app-shell cache reference real files.
- The First Six Turns guide appears at campaign start and updates from real construction, training, iron, contact, and Deadwalker evidence.
- Campaign recaps summarize active imports, victories, defeats, objective milestones, and after-action advice from live state.
- Diplomacy ledger entries track uncontacted civilizations, active pacts/trade, aid or pressure history, duplicate accord prevention, and rivalries.
- Diplomatic memory must survive old saves, summarize promises and grievances, and record fulfilled field-order commitments.
- Faction-specific promises must be one-time, affordable-only commitments with distinct Dawnward, Veyr, and Mireclan campaign effects, delayed demand choices, and grievance follow-through.
- Living-faction war aims must appear in diplomacy and steer pre-pact AI defense, raiding, or scouting.
- Allied field orders must be pact-gated and steer allied AI toward reinforcement or Deadwalker harassment.
- Crisis Council events stay out of the first-turn opening, then trigger from live famine, contact, Deadwalker, and coalition pressure; rulings must spend costs once, create real campaign consequences, and schedule delayed aftermaths that resolve only once.
- Aftermath missions must be generated by selected aftermath rulings, appear on the Missions lens with distinct canvas site markers and card-level focus controls, preview the recommended eligible unit and same-turn reachability, draw a focused route overlay from revealed path data, dispatch reachable missions through the normal movement rule path, show a compact result banner after dispatch, keep aged-out completed outcomes reviewable through archive, site-type filters, text search, newest/oldest sorting, route-chain grouping, and origin-ruling grouping, refocus completed archive sites on the map with a tile-panel receipt, complete through unit movement, expose spawned sites and route-chain steps, preserve the ruling that created each field task, and pay terrain-specific rewards.
- Strategic map lenses must expose revealed blight, roads, Olundar supply reach, and pact ally vision without breaking fog of war.
- Siege Operations stay out of the first-turn opening, then track onagers, pacts, revealed strongholds, and stronghold destruction rewards.
- War Council and objective progress reflect early strategic pressure.
- Strategic path from Olundar toward the portal front exists.
- Training deducts resources and musters a unit.
- Construction validates placement and completes.
- Building upgrades spend resources and improve long-term planning.
- Combat forecasts match real attack damage without mutating state.
- Combat damages units and enforces the boss-before-portal rule.
- A 24-turn simulation keeps state invariants stable.
- Source files contain no TODO/FIXME leftovers.

## Suggested next production steps

1. Add a compact archive summary row for each ruling group that totals rewards earned and follow-up markers spawned.
2. Add longer promise-demand chains where answered obligations unlock joint war plans, tribute bargains, or hostage diplomacy.
