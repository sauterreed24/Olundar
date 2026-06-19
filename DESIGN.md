# Olundar Game Design Bible

## High concept

**Olundar** is a turn-based exploration, survival, diplomacy, and war strategy game set in a Roman-period-inspired world where living civilizations have been weakened by ambition, rivalry, and a long struggle for supreme diplomatic control. That old political game is interrupted by an existential enemy: the **Deadwalkers**, an undead skeleton civilization expanding from a central Bone Portal under the command of **Vorgath the Hollow Crown**.

The player leads Olundar. The goal is not just to turtle and survive. The player must explore through fog, read the geography, build an economy, raise armies, decide which civilizations can be trusted, contain the Deadwalker blight, kill the boss, and destroy the portal.

## Target feel

The tone is romantic catastrophe: ancient banners, desperate alliances, roads through hostile forests, frontier towers glowing in the dark, selfish kings bargaining while skeleton armies march, and the player trying to turn a fractured world into a final living coalition.

The intended difficulty is moderate: challenging enough that poor scouting or poor economy hurts, but not so punishing that casual players are locked out.

## Core pillars

### 1. Explore the unknown

The map begins under fog of war. The player only sees terrain, units, and buildings inside active vision. Previously explored areas remain dimmed but do not show current enemy positions. Scouts, watchtowers, hills, outposts, and allied survival pacts all matter because information is survival. Strategic map lenses help players read revealed blight, roads, supply reach, and pact vision without exposing hidden territory.

### 2. Build plans, not chores

Population and economy exist to create interesting choices, not spreadsheet tedium. The player manages food, wood, stone, iron, gold, influence, and morale. Buildings create straightforward income and strategic capabilities. The player chooses expansion direction and military timing rather than micromanaging citizens.

### 3. Fight with Roman-period tactical clarity

Units use sword, shield, spear, bow, cavalry, engineers, and onagers. The fun comes from movement, terrain, formation logic, range, chokepoints, attrition, and siege pressure rather than modern tech trees.

### 4. Diplomacy under annihilation

Other civilizations are neither generic allies nor simple enemies. Some are honorable, some opportunistic, some suspicious. They pursue their own war aims before any pact: Dawnward forces shield hillforts, Veyr raiders chase leverage, and Mireclan scouts shadow the blight. The player can trade, request aid, offer survival pacts, or pressure them for supplies. Bad diplomacy can create rivals while the Deadwalkers grow.

### 5. The enemy is a civilization

Deadwalkers do not merely spawn waves. They raise Bone Pits, Grave Forges, and Necropolises. Their blight changes terrain, damages living units, and heals undead. Their expansion must be scouted and contained.

## Current civilizations

### Olundar

Balanced and disciplined. Strong citizen infantry, practical engineers, good road-building, and morale-based resilience. The player controls Olundar directly.

### Dawnward League

Honorable hill-fort republics. Defensive, oath-bound, slow to gamble, but reliable if trust is earned. Strong spear guards and watchtower logic.

### Veyr Dominion

Merchant-prince civilization with cavalry, coin, and ambition. Useful for trade and emergency resources, but selfish and capable of becoming a rival if pressured too often.

### Mireclan Holds

Suspicious marsh clans with scouts and ambush archers. They know the bogs, distrust empires, and can become valuable guides.

### Deadwalkers

An undead skeleton empire. They spread grave-blight, build military structures, raise units for free, and pursue living targets. Their invasion ends only when Vorgath dies and the Bone Portal is destroyed.

## Terrain and topography

Terrain has gameplay weight:

- **Plains:** fast movement, food, good farms.
- **Forest:** slower movement, wood, defensive cover, scout value.
- **Hills:** slower movement, defense, sight bonus, mines, strong towers and archers.
- **Mountains:** block movement and shape chokepoints.
- **River:** fertile but costly to cross; weak defensive tile.
- **Marsh:** slow and awkward for heavy forces; good for Mireclan identity.
- **Ruins:** exploration rewards and lore fragments.
- **Grave-blight:** Deadwalker terrain. Living units suffer attrition; undead regenerate.

The map generator creates elevation and moisture, then stamps key regions and corridors so the campaign is readable and winnable while still feeling organic.

## Player loop

1. Scout and reveal safe expansion paths.
2. Build farms, lumber, mines, roads, towers, and military production.
3. Train units based on resource constraints and terrain threats.
4. Discover factions and choose diplomacy.
5. Hold against Deadwalker expansion.
6. Push into blight with siege and support.
7. Kill Vorgath.
8. Destroy the Bone Portal.

## Combat model

The prototype uses a simple readable model:

- Units act once per turn.
- Units have HP, attack, range, move, sight, armor, upkeep, and tags.
- Hills improve ranged attacks.
- Forests and hills improve defense.
- Spears punish cavalry.
- Shrines improve anti-undead fighting nearby.
- Onagers deal extra structure damage.
- Selecting an Olundaran unit and targeting a visible enemy previews damage, range, HP outcome, defensive modifiers, siege bonuses, and portal reformation risk.
- The portal cannot be permanently destroyed until Vorgath is dead.

## Units

### Olundaran/living roster

- **Pathfinder Scout:** fast fog-breaker and ruin surveyor.
- **Shield Legionary:** core sword-and-shield infantry.
- **Spear Guard:** cheap defensive infantry and anti-cavalry unit.
- **Olundaran Archer:** ranged pressure, especially strong on hills and behind walls.
- **Equite Cavalry:** fast response and raiding unit.
- **Field Engineer:** builds infrastructure, roads, outposts, towers, walls, and economy.
- **Onager Crew:** slow siege unit for necropolises and the portal.

### Deadwalker roster

- **Bone Thrall:** cheap swarm skeleton.
- **Corpse Archer:** undead ranged unit.
- **Grave Knight:** armored elite undead.
- **Vorgath the Hollow Crown:** boss commander.

## Buildings

### Olundar buildings

- **City Center:** central population, training, income, vision.
- **Terraced Farm:** food.
- **Lumber Camp:** wood.
- **Hill Mine:** iron and gold.
- **Legion Barracks:** legionaries and spear guards.
- **Archery Yard:** archers.
- **Equite Stable:** cavalry.
- **Siege Workshop:** onagers.
- **Signal Watchtower:** major vision source.
- **Stone Wall:** defensive obstacle.
- **Military Road:** movement network and small commerce.
- **Sun Shrine:** morale, influence, and blight resistance.
- **Frontier Outpost:** forward vision and emergency training.

### Deadwalker buildings

- **Bone Portal:** invasion source and victory target.
- **Bone Pit:** spawns thralls and spreads blight.
- **Grave Forge:** creates stronger undead.
- **Necropolis:** undead city, often replacing fallen living settlements.

## Diplomacy design

Diplomacy is intentionally simple but consequential:

- **Offer Survival Pact:** costs influence, improves relation, and can share vision.
- **Open Trade:** costs influence/gold and adds income.
- **Request War Aid:** can produce units or supplies if relation is good enough.
- **Pressure Them:** grants quick resources but can turn civilizations hostile.

The Diplomacy Ledger keeps current posture, pacts, trade, aid, pressure, field orders, and rivalry history visible so long campaigns do not hide important political consequences in the message log.

Diplomatic Memory adds continuity beyond the recent log. Trade, pact offers, answered aid, pressure, rivalry, and fulfilled field orders become visible promises or grievances. This lets the player understand why advice changes and why a faction feels reliable, resentful, or politically fragile.

War aims show what each discovered civilization is already trying to do without Olundar's orders. They make allies, opportunists, and suspicious scouts legible before the player has enough trust for a Survival Pact.

Survival Pacts unlock broad allied field orders instead of direct micromanagement: allies can defend Olundar roads and outposts, reinforce Olundar Prime, or harass revealed Deadwalker structures.

Faction promises add a more personal layer before diplomacy becomes generic. Dawnward asks for wall guards and reinforced hillforts, Veyr responds to funded caravans and practical supply profit, and Mireclan trusts food, respect, and marsh-route scouting. Each promise costs Olundar real resources and creates visible memory so the ledger shows the political price of building a coalition.

A few turns after a promise, that civilization can return with a follow-through demand. Answering the demand spends more resources but proves the oath under pressure, gives practical help, and deepens diplomatic memory. Ignoring it preserves the treasury at the cost of relation damage and a visible grievance. This keeps promises from being one-click bonuses and makes coalition politics compete with survival logistics.

This should later evolve into allied war plans, tribute, hostage diplomacy, and long-running commitments tied to crisis rulings.

## Deadwalker AI

The Deadwalker AI follows a survival-horror strategy pattern:

1. Spawn units from portal infrastructure.
2. Expand blight from undead buildings.
3. Build new Bone Pits or Grave Forges in blighted frontier zones.
4. Move units toward nearest living targets.
5. Attack units first, then buildings.
6. Convert fallen living cities into Necropolises.

This gives the player a visible long-term enemy growth curve instead of isolated wave defense.

## Population and morale

The prototype keeps population abstract. Food surplus can grow population; shortages harm morale. Morale is a pressure meter rather than a tax spreadsheet. Shrines and stable supply lines are meant to keep the living civilization psychologically intact.

The Crisis Council turns that abstraction into memorable midgame decisions. Refugee caravans, thin granaries, night raid warnings, and emergency councils ask the player to spend scarce resources for population, morale, troops, fortifications, or diplomatic trust.

Chained crisis aftermaths make those decisions persist beyond the first click. A refugee levy can later create petitions, a famine ruling can become market unrest, a raid warning can leave roads to repair or raiders to hunt, and an emergency council can demand proof of public accords. These follow-ups reuse the council surface so the player gets long-term consequence without another management panel.

Aftermath Missions turn some follow-ups into map verbs. The council can now mark repair scars, escort roads, raider trails, or accord routes; the player must send an engineer, scout, cavalry, or combat unit to finish the task. Route missions can reveal a second site, such as a safe-mile camp, raider camp, or accord waystation, and every completed site pays a reward shaped by the target terrain. The Missions lens uses distinct canvas markers for camps, raider sites, accord tablets, and repair scars so these tasks read as places in the world rather than generic UI pips. Mission cards can focus the map on their target, switching to the Missions lens and highlighting the tile so the player can connect the panel instruction to the world. They also preview the recommended eligible unit, current route cost, and same-turn reachability, with a unit jump action for quick dispatch. Focused missions draw a route overlay on revealed tiles from the recommended unit to the target, making the next movement plan visible without revealing hidden terrain. When the route is reachable this turn, Dispatch moves the recommended unit through the normal movement rules so a clear plan can become action without extra map hunting. Completed dispatches create a compact result banner that names the acting unit, summarizes the reward, and calls out a spawned follow-up marker when the route chain continues. A Recent/Archive filter keeps older field outcomes reviewable after their four-turn short history expires, so the player can still read what those political detours achieved. The archive can be filtered by repairs, escorts, raids, or accord runs and searched by text, turn, reward, or actor for long campaign review. Archived outcomes can refocus their completed site on the Missions lens with completed-site art even after the normal short-lived marker has expired, and the tile panel shows a compact receipt for the refocused site. The intent is to make political consequences alter movement priorities without turning the game into chores.

Future versions can deepen these policies with festivals, emergency labor, oath debts, faction-specific refugee politics, and delayed consequences from harsh rulings.

## UI design goals

- Readable on laptops and phones.
- Canvas map with large silhouettes and high-contrast fog.
- Side panel for selected units/buildings, orders, tile data, objectives, diplomacy, and log.
- Compact map lens controls for terrain, blight, roads, supply, and alliance vision.
- Campaign recap overlay for imported saves, victories, and defeats so players can quickly understand what happened and what to do next.
- No hidden mandatory hotkeys.
- Local save, export, and JSON save import from the first prototype.

## Win and loss

### Win

Kill Vorgath and destroy the Bone Portal.

### Loss

Olundar loses its city or collapses beyond recovery. The current prototype hard-loses if the city is destroyed and warns when morale is collapsing.

## Balance philosophy

- Early game: scout and economy.
- Mid game: diplomacy and defense line.
- Late game: siege push into blight.
- Deadwalkers should feel inevitable if ignored, beatable if studied.
- Allies should matter but never play the game for the player.
- Pressure actions should be tempting during emergencies but dangerous long-term.

## Quality gate philosophy

The `npm run quality:check` script is the first production guardrail. It should be run before committing any mechanics change. The current gate validates syntax, data consistency, save-file import, player settings, PWA install shell integrity, map pathing, training, construction, combat, boss/portal rules, simulation stability, and absence of unfinished markers.

Future quality gates should add:

- Deterministic seeded simulation tests.
- Save/load roundtrip tests after every major system.
- UI smoke tests with Playwright or similar.
- Bundle-size budget for older phones.
- Accessibility checks for contrast and tap target size.
- Balance tests for easy/normal/hard Deadwalker expansion curves.
