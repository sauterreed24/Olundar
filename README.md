# Olundar: Deadwalker Strategy Prototype

A lightweight, turn-based exploration, survival, diplomacy, and war strategy game prototype set in **Olundar**. The player commands Olundar, a Roman-period-inspired civilization facing a spreading undead empire called the **Deadwalkers**.

The prototype is intentionally dependency-light: plain HTML, CSS, and modern JavaScript modules. It is designed to run in a browser, scale down to older phones, and remain easy to port later to a PWA or app-store shell.

## What is playable now

- Turn-based movement, attacking, training, construction, economy, diplomacy, and enemy AI.
- Campaign setup with named scenarios, editable seeds, and difficulty presets that change resources and Deadwalker pressure.
- A War Council panel that turns current campaign state into readable priorities, pressure indicators, and next-step guidance.
- A compact First Six Turns guide that teaches the opening scout, engineer, training, iron, diplomacy, and Deadwalker-front priorities from live campaign state.
- Siege Operations that track midgame victory work: onagers, survival pacts, Deadwalker strongholds, Vorgath, and the Bone Portal.
- Campaign recap overlay for victory, defeat, and imported saves with stats, objective milestones, and practical next steps.
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
- `npm run quality:check` gate covering syntax, data integrity, map generation, campaign setup, named save slots, save-file import, audio cue budgets, player settings, PWA shell integrity, onboarding guidance, campaign recaps, advisor logic, pathing, training, construction, upgrades, combat forecasts, portal rules, and a 24-turn simulation.

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

1. Add richer faction war aims so living civilizations bargain, raid, and defend more visibly.
2. Add a dedicated diplomacy ledger so promises, pressure, aid, and grievances remain visible over a long campaign.
