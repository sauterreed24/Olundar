# Olundar Game Design Bible

## High concept

**Olundar** is a turn-based exploration, survival, diplomacy, and war strategy game set in a Roman-period-inspired world where living civilizations have been weakened by ambition, rivalry, and a long struggle for supreme diplomatic control. That old political game is interrupted by an existential enemy: the **Deadwalkers**, an undead skeleton civilization expanding from a central Bone Portal under the command of **Vorgath the Hollow Crown**.

The player leads Olundar. The goal is not just to turtle and survive. The player must explore through fog, read the geography, build an economy, raise armies, decide which civilizations can be trusted, contain the Deadwalker blight, kill the boss, and destroy the portal.

## Target feel

The tone is romantic catastrophe: ancient banners, desperate alliances, roads through hostile forests, frontier towers glowing in the dark, selfish kings bargaining while skeleton armies march, and the player trying to turn a fractured world into a final living coalition.

The intended difficulty is moderate: challenging enough that poor scouting or poor economy hurts, but not so punishing that casual players are locked out.

The visual target is a bright premium imperial war table rather than placeholder strategy blocks or dashboard chrome: light parchment fog, marble/vellum command surfaces, warm bronze and crimson hierarchy, lapis/jade accents, legible terrain relief, Roman-period shields and weapons, faction color accents, readable building silhouettes, and Deadwalker necrotic glow that communicates threat even at phone scale. The art must remain dependency-light and fast enough for GitHub Pages and older mobile browsers, so the shipped style uses handcrafted canvas vector sprites backed by a reference sprite sheet.

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

- Units move once and strike once per turn. A fighting company that marches into reach of a foe keeps its strike, so closing and hitting is one order, as it is for the AI. A march with no foe in reach spends the order. Engineers spend their order when they move.
- Cavalry that ride 2 or more tiles before striking charge for +2 damage.
- Units have HP, attack, range, move, sight, armor, upkeep, and tags.
- Hills improve ranged attacks.
- Forests and hills improve defense.
- Spears punish cavalry.
- Shrines improve anti-undead fighting nearby.
- Onagers deal extra structure damage.
- Selecting an Olundaran unit and targeting a visible enemy previews damage, range, HP outcome, defensive modifiers, siege bonuses, and portal reformation risk.
- After a successful attack, the Orders panel keeps a Last Strike readout and the struck map tile receives an impact marker so combat decisions feel confirmed instead of silent.
- The portal cannot be permanently destroyed until Vorgath is dead.
- **Counterblows.** A unit that survives a melee blow strikes back at half its normal damage (at least 1). Ranged attacks from beyond arm's reach are never answered. This makes the order of attacks a decision. Archers soften the line, and infantry finish it, so a wounded scout should not poke a grave knight. The same rule protects a braced Olundaran line when the dead attack it.
- **Field ranks.** A blow earns 1 experience and a kill earns 2. At 3, 8, and 15 experience a living unit becomes a Veteran, an Elite, and a Legend. Each rank gives +1 attack and +2 max HP and heals the unit a little. Promotions show on the board as a burst and a rank badge, so the player gets attached to the companies that carried the war.
- **Spoils.** Each dead unit killed by Olundar pays a few grave-goods. Destroying deadwork pays a larger cache. This makes aggression pay for itself instead of being a pure cost.
- **The enemy turn is shown, not summarized.** Every enemy strike is recorded and replayed in sequence after End Turn, so each wound on the line has a visible cause.

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
- **Bone Pit:** an open grave with a rib arch and skull. It spawns thralls and spreads blight.
- **Grave Forge:** a kiln, bone chimney, and ember mouth. It creates stronger undead.
- **Necropolis:** a crowned tomb-city with three spires, often replacing fallen living settlements.

## Diplomacy design

Diplomacy is intentionally simple but consequential:

- **Offer Survival Pact:** costs influence, improves relation, and can share vision.
- **Open Trade:** costs influence/gold and adds income.
- **Request War Aid:** can produce units or supplies if relation is good enough.
- **Pressure Them:** grants quick resources but can turn civilizations hostile.

The Diplomacy Ledger keeps current posture, pacts, trade, aid, pressure, field orders, and rivalry history visible so long campaigns do not hide important political consequences in the message log.

Diplomatic Memory adds continuity beyond the recent log. Trade, pact offers, answered aid, pressure, rivalry, and fulfilled field orders become visible promises or grievances. This lets the player understand why advice changes and why a faction feels reliable, resentful, or politically fragile.

War aims show what each discovered civilization is already trying to do without Olundar's orders. They make allies, opportunists, and suspicious scouts legible before the player has enough trust for a Survival Pact.

Survival Pacts unlock broad allied field orders instead of direct micromanagement: allies can defend Olundar roads and outposts, reinforce Olundar Prime, or harass revealed Deadwalker structures. Each active pact keeps its own command card, so a second ally is not hidden behind the first recommendation.

A hostage tribute spends gold, food, and one envoy from Olundar's population. Three turns later that civilization musters a company under its own banner: Dawnward spears, Veyr riders, or Mireclan archers. A second tribute waits until the first company arrives. If the faction becomes a rival before the due turn, the company never takes the field.

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
7. Gather menace and dispatch directed **marches on Olundar Prime** (the March of the Hollow Crown).
8. Raise **barrow raids** close to the capital in the opening turns.

### Barrow raids

The map is wide, and the first march often takes twenty turns or more to cross it. Before raids existed, a careful player could play thirty turns without a fight. Barrow raids fill that gap. On difficulty-set turns (6, 11, and 17 on Standard), a small band of grave-dead rises from an old barrow six to nine tiles from Olundar Prime. The site favors ruins, forest, hills, and marsh on the side facing the portal. Each raid is announced a turn early: the barrow is revealed and marked with a "rises next turn" label, and the war clock names it. Later raids add a corpse archer and then a grave knight. The raiders march on the capital and pay spoils when they are killed. This teaches combat, counterblows, and ranks early, when the stakes are low.

This gives the player a visible long-term enemy growth curve instead of isolated wave defense.

### The March of the Hollow Crown

Local-target hatred alone let the Deadwalkers feast on the nearest rival civilization while a distant, turtling Olundar sat untouched for dozens of turns. To honor the pillar that the dead are *inevitable if ignored*, the campaign now tracks Deadwalker **menace** that rises every turn after the invasion begins. On a difficulty-scaled cadence the Hollow Crown dispatches a **march**: it conscripts the standing dead nearest to Olundar so the eastern horde turns west, then reinforces any shortfall from the deadwork closest to the capital. Marchers navigate real routes toward Olundar Prime instead of only chasing whatever is nearest.

Marches must actually arrive. Three things used to stall them, and the first march rarely reached Olundar before turn 50. First, conscripts were often already wounded from fighting Veyr and Mireclan, so they turned back at once to heal. Second, marchers could not plan a route through their own crowd. Third, the open tile beside the capital they aimed for was often walled in by Olundar's own units, so they paced in place. Now the Hollow Crown re-knits every conscript to full health, retreating dead heal 3 HP a turn at a deadwork, and marchers plan through their own ranks. When the nearest approach is walled in, they try other open ground near the target. Marchers also ignore living hosts that are not pacted with Olundar unless boxed in. Once a marcher reaches its flank lane, it assaults the city instead of waiting there. Across eight seeds, the first march now comes within six tiles of the capital around turn 44 on Chronicle, 30 on Standard, 24 on Legion, and 22 on Hollow Crown.

Marches also arrive as **waves**. A march used to trickle in one corpse at a time, and a trickle is only a kill zone for archers. Now each dispatched march picks a rally point on its road, about nine tiles from the capital, and its members gather there. Once 60% of the wave is within three tiles of the rally point, or after twelve turns of waiting, the wave surges on Olundar Prime together. A march that would rally where another wave still gathers joins that wave instead. The rally point is marked on the map with a red standard and a "gathers n/m" count, and the war clock names it, so a player can strike the wave while it masses. Far from the capital, marchers make a forced march (+1 move). They drop to their true pace within twelve tiles, so the fight at the walls stays fair. The march also answers Olundar's strength: one extra marcher per five fighting companies (at most three beyond the cap), and grave knights when Olundar fields six or more ranged units.

Marches are designed to be felt, fair, and legible:

- **Telegraphed.** The Deadwalker Intent panel shows the next march's countdown, projected size, and how many dead are already marching, so pressure is never an un-signposted ambush.
- **Escalating but bounded.** Each march grows and its composition hardens with menace (thralls, then corpse archers, then grave knights), but a per-difficulty size cap keeps waves counterable instead of becoming an unwinnable tide.
- **Difficulty-coherent.** Harder presets start marches earlier, send them more often, and gather menace faster, so Hollow Crown is genuinely more relentless than Chronicle rather than accidentally gentler.

### Recovery and attrition

Living units have no innate regeneration, which previously made every point of blight attrition or combat damage a permanent loss and turned bad turns into death spirals with no comeback. Wounded Olundaran units now **rally** at the end of the turn when resting beside a friendly city or outpost, healing faster near a Sun Shrine and slightly faster when fortified. A completed **Rally Banner** extends that healing in a three-tile radius, so a frontier kill-box can rotate troops without marching all the way home. Selecting the banner, or a unit inside it, paints a laurel ring on revealed tiles, and the unit dossier names the next heal or the reason it will not happen: grave-blight, enemy contact, or no haven. Units standing in grave-blight or pinned next to an enemy cannot rally. This makes attrition a rotate-and-heal rhythm — pull veterans back to recover, then return them to the line — and gives the player a real comeback tool against the escalating marches without trivializing front-line losses.

Pact orders to defend roads or reinforce the capital also **intercept** marching dead. The allied AI steps onto the march route before it reaches Olundar Prime, and the map draws a bronze dashed lane with the ally's color and a shield at the hold tile when that tile is already revealed. A hidden hold is mentioned on the pact card only after the march itself is known, so the coalition's plan does not reveal unseen ground.

## Population and morale

The prototype keeps population abstract. Food surplus can grow population; shortages harm morale. Morale is a pressure meter rather than a tax spreadsheet. Shrines and stable supply lines are meant to keep the living civilization psychologically intact.

The Crisis Council turns that abstraction into memorable midgame decisions. Refugee caravans, thin granaries, night raid warnings, and emergency councils ask the player to spend scarce resources for population, morale, troops, fortifications, or diplomatic trust.

Chained crisis aftermaths make those decisions persist beyond the first click. A refugee levy can later create petitions, a famine ruling can become market unrest, a raid warning can leave roads to repair or raiders to hunt, and an emergency council can demand proof of public accords. These follow-ups reuse the council surface so the player gets long-term consequence without another management panel.

Aftermath Missions turn some follow-ups into map verbs. The council can now mark repair scars, escort roads, raider trails, or accord routes; the player must send an engineer, scout, cavalry, or combat unit to finish the task. Route missions can reveal a second site, such as a safe-mile camp, raider camp, or accord waystation, and every completed site pays a reward shaped by the target terrain. The Missions lens uses distinct canvas markers for camps, raider sites, accord tablets, and repair scars so these tasks read as places in the world rather than generic UI pips. Mission cards can focus the map on their target, switching to the Missions lens and highlighting the tile so the player can connect the panel instruction to the world. They also preview the recommended eligible unit, current route cost, and same-turn reachability, with a unit jump action for quick dispatch. Focused missions draw a route overlay on revealed tiles from the recommended unit to the target, making the next movement plan visible without revealing hidden terrain. When the route is reachable this turn, Dispatch moves the recommended unit through the normal movement rules so a clear plan can become action without extra map hunting. Completed dispatches create a compact result banner that names the acting unit, summarizes the reward, and calls out a spawned follow-up marker when the route chain continues. A Recent/Archive filter keeps older field outcomes reviewable after their four-turn short history expires, so the player can still read what those political detours achieved. The archive can be filtered by repairs, escorts, raids, or accord runs, searched by text, turn, reward, ruling, or actor, sorted newest-first or oldest-first, and grouped by route chain or origin ruling for long campaign review. Ruling groups include a compact summary row that totals field rewards, terrain caches, notable reward types, and spawned follow-up markers before the individual receipts, and grouped archives can collapse to summary-only review when a campaign accumulates many tasks. Archived outcomes can refocus their completed site on the Missions lens with completed-site art even after the normal short-lived marker has expired, and the tile panel shows a compact receipt for the refocused site. **Copy chronicle** writes the current filtered, sorted, and grouped archive into plain text, including reward totals and follow-ups, so a long campaign can leave the panel as a readable record. The intent is to make political consequences alter movement priorities without turning the game into chores.

Future versions can deepen these policies with festivals, emergency labor, oath debts, faction-specific refugee politics, and delayed consequences from harsh rulings.

## UI design goals

- Readable on laptops and phones.
- Canvas map with large silhouettes and high-contrast fog.
- Side panel for selected units/buildings, orders, tile data, objectives, diplomacy, and log.
- Compact map lens controls for terrain, blight, roads, supply, and alliance vision.
- Campaign recap overlay for imported saves, victories, and defeats so players can quickly understand what happened and what to do next.
- No hidden mandatory hotkeys.
- Local save, export, and JSON save import from the first prototype.

## The final act

Before this pass the campaign could not be won with a normal army. Living units pay 3 movement to enter blight, and infantry and archers have 2, so no legionary, archer, or onager could step onto the blight around the portal. Now every company can always move one tile onto passable ground by spending its whole move, as in most tactics games. The same rule unsticks 2-move dead in marshes.

Killing Vorgath is the turning point of the war. With the Hollow Crown slain:

- every march falters and loses its road to Olundar Prime
- no new deadwork rises, and the portal and grave forges raise no more dead
- grave-blight withers by one level a turn wherever no surviving deadwork feeds it, so each razed pit or forge opens the road
- the war clock reads "The Crown is broken" and counts the dead that remain

This keeps the climax where the design wants it, at the duel with Vorgath, and makes the portal assault a finite siege instead of a grind against endless spawns. In scripted campaigns, an attacking bot that keeps a home guard of six and pushes with the rest from turn 30 kills Vorgath around turns 56 to 89 and breaks the portal between turns 91 and 139 in seven of eight Standard and Hollow Crown campaigns.

## Win and loss

### Win

Kill Vorgath and destroy the Bone Portal.

### Loss

Olundar loses its city or collapses beyond recovery. The current prototype hard-loses if the city is destroyed and warns when morale is collapsing.

## Balance philosophy

- Early game: scout and economy.
- Mid game: diplomacy and defense line.
- Late game: siege push into blight.
- Deadwalkers should feel inevitable if ignored, beatable if studied: the March of the Hollow Crown guarantees pressure reaches the player, but telegraphing, march size caps, and rally healing keep it fair.
- Turtling should buy time, never victory; escalating menace eventually forces the player out to kill Vorgath and shatter the portal.
- Allies should matter but never play the game for the player.
- Pressure actions should be tempting during emergencies but dangerous long-term.

## Rendering and device budget

The board must stay smooth on older phones:

- **Two stacked canvases.** Terrain (fog, ground, features, roads, vignette) is painted onto its own canvas underneath the board. It is repainted only when the camera, fog, turn, or works change. Units, overlays, the minimap, and effects draw straight onto the transparent board canvas above it, so a frame never copies a full-screen bitmap. This cut the cost of an idle frame from about 54 ms to 5 ms at 4× CPU throttle.
- **Idle at 30 fps.** Pennants and selection glow repaint at most every 33 ms, or 66 ms in low-power mode. Walks, strikes, and camera glides still run every frame.
- **Frame governor.** If a frame repeatedly takes more than 14 ms, the board steps its render resolution down from 2× to 1.5× to 1× CSS pixels and switches to low-power idle.
- **Motion respects the player.** Camera glides, banners, collapses, falls, and screen shake are skipped under reduced motion.

## Quality gate philosophy

The `npm run quality:check` script is the first production guardrail. It should be run before committing any mechanics change. The current gate validates syntax, data consistency, save-file import, player settings, PWA install shell integrity, map pathing, training, construction, combat, boss/portal rules, simulation stability, and absence of unfinished markers.

Future quality gates should add:

- Deterministic seeded simulation tests.
- Save/load roundtrip tests after every major system.
- UI smoke tests with Playwright or similar.
- Bundle-size budget for older phones.
- Accessibility checks for contrast and tap target size.
- Balance tests for easy/normal/hard Deadwalker expansion curves.
