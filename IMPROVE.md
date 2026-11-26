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

## Scorecard (Standard unless noted; tune seeds n=20)
| Check | Target | Baseline (647a926) | Now |
|---|---|---|---|
| Skill gap: skilled minus novice win rate | ≥ 50 pp | 90 pp | see Log |
| Fairness: skilled loss rate (Chronicle / Standard) | ≤ 10% | 0% / 5% | see Log |
| Challenge: skilled win rate on Hollow Crown | 30–85% | 90% (too easy) | see Log |
| Pacing: first strike turn (novice), median | ≤ 8 | 6 | see Log |
| Pacing: skilled win turn, median | 50–110 | 85 | see Log |
| Tension: skilled wins with a close call (capital below 50%) | 15–60% | 11% | see Log |
| Readability: enemy strikes from unseen attackers (skilled) | ≤ 35% | 13% | see Log |
| Advice works: guided novice has a mine by turn 30 | ≥ 80% | 0% | see Log |
| Responsiveness: worst End Turn compute in Node | ≤ 60 ms | 1409 ms | see Log |

Checks for a human (bots can't judge these): how the battle animations feel,
whether the war-table art reads well on a phone, audio, touch controls, and
whether the march waves feel tense.

## Backlog (top first)
1. Hollow Crown is no harder than Standard for the skilled bot (90% wins on both).
   The novice wins 30% on Hollow Crown and 0% on Standard, because allied
   factions kill Vorgath once he wanders out (see Decisions).
2. Tension: the skilled bot's capital is rarely threatened (11% close calls).
   Marches break on the field army.
3. Economy floats: by turn 80, banked food, iron, and gold reach the hundreds or
   thousands (the novice holds 15k food). Nothing to spend on means no decisions.
   Stone has no income at all.
4. The New dialog always uses the scenario's fixed seed, so every Founding
   campaign has the same map. The old UI had an editable seed.
5. `moveUnit` returns `pathTiles: path.tiles`, which is always undefined (unused).
6. The skilled bot's portal siege is slow (boss dead around turn 45, portal
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
See the detailed entries below this heading (filled in as the round goes).

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
