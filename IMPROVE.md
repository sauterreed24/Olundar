# IMPROVE.md — Olundar improvement loop

## The game
Olundar is a browser turn-based strategy game (plain JS, canvas, no build step).
The player leads a Roman-style city against the Deadwalkers, an undead empire.
They scout through fog, build an economy, raise legions, and deal with three
living factions. To win they kill Vorgath the Hollow Crown, then break the
Bone Portal. It's for strategy players on desktop and older phones (PWA).

**Core loop:** order each unit (move, then strike), build and train, then End Turn.
The Deadwalkers then march, raid, and spread blight. Barrow raids start around
turn 6, and marches start at turn 12 on Standard. A Standard win takes about 70–100 turns.

**Run it:** `npm ci && npm start`, then open http://localhost:4173.
**Gate:** `npm run quality:check`, about 40 s and 60 checks. It must pass before any commit.
**Evaluator:** `node eval/run.mjs` plays tuning seeds and prints the scorecard.
Add `--set hold` for the held-out seeds, and `--n 20` for more seeds.
`node eval/ui.mjs` plays the menus in a real browser (New, End turn, Save, Load).
`node eval/trace.mjs <bot> <difficulty> <seed> [every]` prints one game turn by turn.

### Evaluator design
- The bots act only through the same rule calls the UI uses: moveUnit, attackUnit,
  attackBuilding, startTraining, startConstruction, and endTurn.
  - `idle` never acts. It measures how long neglect survives.
  - `novice` trains at random, charges the nearest visible foe, takes the first
    strike it finds, never retreats, and forgets a third of its units each turn.
  - `guided` is the novice, except its engineers and scout do exactly what the
    War Council says. It checks whether the in-game advice can be followed.
  - `skilled` follows a build order and expands toward ore with outposts. It
    focus-fires using forecasts (archers first, no fatal counterblows), pulls the
    wounded home, holds until it has 9 healthy troops after turn 20, then marches
    on Vorgath and then the portal.
- Every run is seeded and the evaluator is deterministic (verified: two runs
  give identical game outcomes). Tuning seeds are `tune-0..N`. Held-out seeds
  `hold-0..N` are never tuned against.
- Seed-set noise: with 20 seeds, win rates move up to ±10 percentage points
  between the tune and hold sets. Treat a smaller difference as noise.

## Constraints (never break)
- Saved games and slots: `deserializeState` must keep loading old saves. Don't
  change the save version without a migration.
- Controls: click to select, move, and strike. `N` selects the next unit. `E`
  ends the turn (press twice when units are idle). `Ctrl/Cmd+Z` undoes, and
  `Ctrl/Cmd+S` saves.
- Platform: no build step, and runs from GitHub Pages. Keep it light on old
  phones. Bump the `sw.js` cache name whenever shipped files change.
- Identity: Roman-period war table, bright parchment and bronze look, and the
  "kill Vorgath, then break the portal" arc. Weekly challenge seeds share map
  generation, so changing map generation changes challenge maps.
- Don't publish, deploy, or add monetization.

## Scorecard (Standard unless noted; n=20 per cell; tune / held-out seeds)
| Check | Target | Baseline 647a926 (tune / hold) | Round 1 (tune / hold) |
|---|---|---|---|
| Skill gap: skilled − novice win rate | ≥ 50 pp | 90 / 90 pp | 95 / 90 pp ✅ |
| Fairness: skilled loss rate, Chronicle | ≤ 10% | 0 / 0% | 0 / 0% ✅ |
| Fairness: skilled loss rate, Standard | ≤ 10% | 5 / 10% | 5 / 10% ✅ |
| Challenge: skilled win rate, Hollow Crown | 30–85% | 90 / 95% | 90 / 95% ❌ too easy |
| Pacing: first strike (novice), median turn | ≤ 8 | 6 / 6 | 6 / 6 ✅ |
| Pacing: skilled win turn, median | 50–110 | 85 / 83 | 85 / 83 ✅ |
| Tension: skilled wins with a close call | 15–60% | 11 / 0% | 11 / 0% ❌ |
| Readability: strikes from unseen attackers | ≤ 35% | 13 / 11% | 10 / 11% ✅ |
| Advice works: guided novice has a mine by turn 30 | ≥ 80% | 0% (10 tune seeds) / 0% | 100 / 80% ✅ (after review fix; 85 / 70% before) |
| Responsiveness: worst End Turn in Node | ≤ 60 ms | 1409 / 3406 ms | ~105 ms measured alone. 313 / 763 ms when 3 evaluators and a reviewer ran in parallel, so timing under load is noise ❌ |

Like for like under the same parallel load (held-out set), the novice on Hollow Crown
went from a mean End Turn of 129 ms to 15 ms, and the worst from 3406 ms to 763 ms.
The guided novice on Standard went from 0% to 10% wins on held-out seeds.

The other bots don't read the advice, so their outcomes are unaffected by the
advice change. The pathfinding rewrite is route-identical and the boss fix rarely
fires, so outcome differences between baseline and round 1 are small and within
noise. Side effect: the guided novice wins 100% on Chronicle, against 65% for the
novice.

Checks for a human (bots can't judge these): how the battle animations feel,
whether the war-table art reads well on a phone, audio, touch controls, and
whether the march waves feel tense.

## Backlog (top first)
1. Advice check on held-out seeds is 80%, right at the target. The remaining misses: no ore
   is revealed, so the advice is only "scout for hills". Point the scout advice somewhere concrete.
2. Hollow Crown is no harder than Standard for the skilled bot (90% wins on both).
   The novice wins 30% on Hollow Crown and 0% on Standard, because allied
   factions kill Vorgath once he wanders out (see Decisions).
3. Tension: the skilled bot's capital is rarely threatened (11% close calls).
   Marches break on the field army.
4. Economy floats: by turn 80, banked food, iron, and gold reach the hundreds or
   thousands (the novice holds 15k food). Nothing to spend on means no decisions.
   Stone has no income at all.
5. The New dialog always uses the scenario's fixed seed, so every Founding
   campaign has the same map. The old UI had an editable seed.
6. `moveUnit` returns `pathTiles: path.tiles`, which is always undefined (unused).
7. The skilled bot's portal siege is slow (boss dead around turn 45, portal
   around turn 80). Look at whether the portal assault is a grind.

## Alternatives (strong losers worth revisiting)
- **Leash Vorgath to his court** (radius 3 or 8 around the portal). Allied kills
  and "unearned" novice wins dropped to 0, and the boss stays the siege climax.
  But the skilled bot's win rate fell from ~90% to ~33% (6-seed probe), with many
  timeouts: a defended heartland is very hard to crack. It needs a stronger
  siege bot, or siege help, before it can ship. Under Decisions.
- **City produces +1 stone a turn.** Not needed: the advice check scored 90%
  both with and without it. Stone still has no income, so it's worth revisiting
  if economy work starts.

## Strategy (kinds of change and hit rate)
- Bug fixes found by bots or scripted play: 3/3 kept. The counterblow boss-kill
  flag, the dialog stacking, and the unseeded upkeep roll.
- Performance with a reference-equivalence test: 1/1 kept (End Turn 12× faster).
- Onboarding/readability (advice you can act on): 1/1 kept. See Log, round 1.
- New mechanic / AI behaviour (Vorgath leash): 0/1. It trades off against
  winnability, so it went to Decisions.

## Playbook (provisional unless marked)
- Instrument before theorizing: `eval/trace.mjs` and an ASCII map dump found
  every round-1 bug faster than reading code.
- Any rules refactor must keep `findPath` route-identical. The quality gate
  compares it against `eval/reference/find-path.mjs`.
- Bot-only metrics can hide UI breakage. Run `node eval/ui.mjs` whenever
  CSS, dialogs, or input handling change.
- Advice text must name real places, and the board must mark them. Players
  can't act on "secure iron" when no ore is in supply range.
- When bot outcomes look odd (a novice wins on the hardest difficulty), check
  who landed the decisive blows (`bossKiller`, `portalBreaker` in the run JSON).

## Log
### Round 1 (2026-11-26) — set up the evaluator, fix what the bots found
Kept, each committed separately:
- **Vorgath killed by a counterblow never set `bossSlain`**, so the portal
  reformed forever and the campaign couldn't be won. Found on 1 of 3 skilled
  games. Fixed in `removeUnit`, and loading a save with no Hollow Crown repairs it.
  A new check fails on the old code.
- **Unseeded upkeep roll** (`Math.random`) is now seeded, so games replay exactly.
- **End Turn speed:** findPath rewrite (heap, occupancy index, typed arrays,
  one shared search for approach fallbacks). 1310 → about 105 ms on the worst
  3 games, measured alone, with identical outcomes. A reference-equivalence
  check covers it.
- **New, Save, and Load dialogs were under the board canvas** (a regression from the
  layered-board commit), so clicks never reached them. Fixed with z-index.
  `eval/ui.mjs` plus a CSS stacking check.
- **Iron advice:** the council said "build a Hill Mine" when none could be placed.
  It now names an outpost or mine tile and marks it on the board. Advice
  check: 0% → 85% tune, 70% held-out.
Rejected: the Vorgath leash (see Alternatives and Decisions) and +1 stone a turn
(no effect).
Independent review (a separate agent that didn't see my reasoning): it confirmed
findPath identical across 14.8k fuzzed searches and 36 full campaigns hashed every
turn. It found 3 minor issues, all fixed: the advice named a tile under a unit,
the marker cache key was stale, and the toast sat under the modal. Fixing the first
lifted the advice check to 100 / 80%.
Round gain: two game-breaking bugs fixed, End Turn ~12× faster, and onboarding
advice that can actually be followed. No scorecard check got worse.
Failures and why:
- Baseline numbers for the advice check were first measured on 10 seeds only,
  because the check was added mid-round.
- The responsiveness check is unreliable when evaluators run in parallel.
  Fix for next round: measure timing in a dedicated solo run
  (`--bots novice --diffs hollowCrown`). Provisional.
- Held-out advice failures are mostly seeds where the novice scout never
  reveals ore, so the advice stays at "scout for hills". Next candidate:
  have the opening scout advice point toward unexplored ground near the capital.

- Lesson (provisional): advice must pass the same checks as the action it
  recommends, including units standing on the tile. Test the advice against
  canBuildOn rather than terrain alone.

## Decisions for me
1. **Should Vorgath stay at his portal?** Right now he walks up to 40 tiles
   toward the nearest living target. Allies often kill him, and he sometimes
   reaches Olundar's walls. The design says the climax is a siege and that
   "turtling should buy time, never victory". A leash matches that, but the
   skilled bot's wins drop sharply. Recommendation: leash him to about 6 tiles,
   paired with a siege aid such as cheaper onagers or blight wards for the
   assault. Re-tune until skilled Standard wins are ≥ 80% again.
2. **Should allies be able to win the campaign for you?** Allied factions often
   land the final blow on Vorgath or the portal. If coalition victories are
   intended, label them in the recap ("Dawnward broke the portal"). If not,
   require Olundar to break the portal.
