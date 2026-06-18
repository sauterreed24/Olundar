# Olundar: Deadwalker Strategy Prototype

A lightweight, turn-based exploration, survival, diplomacy, and war strategy game prototype set in **Olundar**. The player commands Olundar, a Roman-period-inspired civilization facing a spreading undead empire called the **Deadwalkers**.

The prototype is intentionally dependency-light: plain HTML, CSS, and modern JavaScript modules. It is designed to run in a browser, scale down to older phones, and remain easy to port later to a PWA or app-store shell.

## What is playable now

- Turn-based movement, attacking, training, construction, economy, diplomacy, and enemy AI.
- Campaign setup with named scenarios, editable seeds, and difficulty presets that change resources and Deadwalker pressure.
- A War Council panel that turns current campaign state into readable priorities, pressure indicators, and next-step guidance.
- A compact First Six Turns guide that teaches the opening scout, engineer, training, iron, diplomacy, and Deadwalker-front priorities from live campaign state.
- Siege Operations that track midgame victory work: onagers, survival pacts, Deadwalker strongholds, Vorgath, and the Bone Portal.
- Fog of war with visible and previously revealed states.
- Procedural topography: plains, forests, hills, mountains, rivers, marshes, ruins, roads, and grave-blight.
- Terrain effects: movement cost, sight bonuses/penalties, defense, resource logic, blight attrition, and road logistics.
- Player units: Pathfinder Scout, Shield Legionary, Spear Guard, Archer, Equite Cavalry, Field Engineer, and Onager Crew.
- Buildings: City Center, Farms, Lumber Camps, Mines, Barracks, Archery Yard, Stable, Workshop, Watchtower, Walls, Roads, Shrine, and Outpost.
- Building upgrades that increase durability, vision, income, training capacity, and city housing without adding tedious micromanagement.
- Deadwalker civilization: Bone Portal, Bone Pits, Grave Forges, Necropolises, Bone Thralls, Corpse Archers, Grave Knights, and Vorgath the Hollow Crown.
- Diplomacy with the Dawnward League, Veyr Dominion, and Mireclan Holds.
- Local save/load and exportable JSON save files.
- Canvas-rendered sprites plus a vector reference sprite sheet at `assets/sprites/olundar-sprite-sheet.svg`.
- `npm run quality:check` gate covering syntax, data integrity, map generation, campaign setup, onboarding guidance, advisor logic, pathing, training, construction, upgrades, combat, portal rules, and a 24-turn simulation.

## Run it locally

```bash
npm run quality:check
npm start
```

Then open the local URL printed by the server, usually `http://localhost:4173`.

No package install is required because this prototype has no third-party runtime dependencies.

## Controls

- Click an Olundaran unit, then click a tile to move.
- Click a visible hostile unit or building in range to attack.
- Select an engineer and choose a building order, then click the engineer’s tile or an adjacent valid tile.
- Select a city or military building to train units.
- Select an Olundaran building to upgrade it when resources allow.
- Press `N` or click **Next Unit** to cycle to the next ready unit.
- Press `E` to end the turn; if units are idle, press `E` again or use `Shift + E` to confirm.
- Click **New** to choose a scenario, difficulty, and seed.
- Press `Esc` to cancel build mode.
- Press `Ctrl/Cmd + S` to save locally.
- Press `Ctrl/Cmd + L` to load locally.

## Main objective

Explore through fog, survive the Deadwalker expansion, build a war economy, use diplomacy wisely, kill **Vorgath the Hollow Crown**, and then destroy the **Bone Portal**. The portal reforms if attacked before Vorgath is slain.

## Project structure

```text
olundar_game/
  index.html
  package.json
  README.md
  DESIGN.md
  assets/
    sprites/olundar-sprite-sheet.svg
  src/
    content.js       # units, buildings, terrain, factions, costs, objectives
    map.js           # deterministic world generation and topology helpers
    rules.js         # game state, fog, movement, combat, economy, AI, diplomacy
    render.js        # canvas terrain, sprites, fog, minimap, UI descriptions
    main.js          # browser UI/event loop
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
- The First Six Turns guide appears at campaign start and updates from real construction, training, iron, contact, and Deadwalker evidence.
- Siege Operations stay out of the first-turn opening, then track onagers, pacts, revealed strongholds, and stronghold destruction rewards.
- War Council and objective progress reflect early strategic pressure.
- Strategic path from Olundar toward the portal front exists.
- Training deducts resources and musters a unit.
- Construction validates placement and completes.
- Building upgrades spend resources and improve long-term planning.
- Combat damages units and enforces the boss-before-portal rule.
- A 24-turn simulation keeps state invariants stable.
- Source files contain no TODO/FIXME leftovers.

## Suggested next production steps

1. Convert the local save into named campaign slots.
2. Add sound effects and light music using compressed mobile-friendly assets.
3. Package as a PWA first, then wrap for mobile stores once balance and UI are polished.
