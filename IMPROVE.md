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
**Gate:** `npm run quality:check`, about 45 s and 63 checks. It must pass before any commit.
**Evaluator:** `node eval/run.mjs` plays tuning seeds and prints the scorecard.
Add `--set hold` for the held-out seeds, and `--n 20` for more seeds.
`node eval/ui.mjs` plays the menus in a real browser (New, fresh map, seed, End turn, Save, Load, a defeat with its recap and record).
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
| Check | Target | Baseline 647a926 | Session 3 start = end (main 2ef2430+) |
|---|---|---|---|
| Skill gap: skilled − novice win rate | ≥ 50 pp | 90 / 90 pp | 95 / 90 pp ✅ |
| Fairness: skilled loss rate, Chronicle | ≤ 10% | 0 / 0% | 0 / 0% ✅ |
| Fairness: skilled loss rate, Standard | ≤ 10% | 5 / 10% | 5 / 10% ✅ |
| Challenge: skilled win rate, Hollow Crown | 30–85% | 90 / 95% | 95 / 95% ❌ blocked on Decision 1 |
| Pacing: first strike (novice), median turn | ≤ 8 | 6 / 6 | 6 / 6 ✅ |
| Pacing: skilled win turn, median | 50–110 | 85 / 83 | 83 / 81 ✅ |
| Tension: skilled wins with a close call | 15–60% | 11 / 0% | 11 / 0% ❌ |
| Readability: strikes from unseen attackers | ≤ 35% | 13 / 11% | 11 / 11% ✅ |
| Advice works: guided novice has a mine by turn 30 | ≥ 80% | 0 / 0% | 95 / 95% ✅ |
| Responsiveness: worst End Turn in Node | ≤ 60 ms | 1409 / 3406 ms | 136 / 117 ms in a full run, ~90 ms in a solo heavy-game run ❌ |
| UI playthrough (`eval/ui.mjs`): New, fresh map, seed, End turn, Save/Load, defeat recap and record | all pass | dialogs unclickable | 8/8 ✅ |

Round 3 changed only the UI and tests, so bot numbers can't move. The start and
end columns are the same measured run.

Checks for a human (bots can't judge these): how the battle animations feel,
whether the war-table art reads well on a phone, audio, touch controls, and
whether the march waves feel tense.

## Backlog (top first)
1. **Tension:** the skilled bot's capital is never threatened (0–11% close calls),
   even under harsh Hollow Crown marches. Its army meets marches far forward.
   Root-cause candidates: marches only ever target the capital, so one forward
   army screens everything. Making marches target other holdings is a core
   mechanic change, so it's under Decisions.
2. **Hollow Crown challenge:** blocked on Decision 1. March tuning has a cliff
   (see Alternatives).
3. **Responsiveness** ~90–136 ms. The remaining cost is the route search for
   walled-in marchers. The next step would share one search per target, but that
   changes routes and so loses the reference-equivalence proof. Only worth it if a
   phone playtest shows the hitch.
4. **Economy floats:** banked food, iron, and gold reach the hundreds or thousands
   late on. A sink is a design change; propose it under Decisions if it comes up
   in a playtest.
5. **Phone:** the resource bar scrolls sideways with a hidden scrollbar, so gold,
   influence, and morale are off screen on a 390 px phone. Check for a human
   (layout taste) before changing it.
6. **Ally wins in the recap:** blocked on Decision 2. If allies may win, the new
   end card should name who broke the portal.
7. `moveUnit` returns `pathTiles: path.tiles`, which is always undefined (unused).

## Alternatives (strong losers worth revisiting)
- **Leash Vorgath to his court** (radius 3 or 8 around the portal). Allied kills
  and "unearned" novice wins dropped to 0, and the boss stays the siege climax.
  But the skilled bot's win rate fell from ~90% to ~33% (6-seed probe), with many
  timeouts: a defended heartland is very hard to crack. It needs a stronger
  siege bot, or siege help, before it can ship. Under Decisions.
- **Stronger Hollow Crown marches** (round 3, tune seeds, skilled / novice win):
  size 5 + growth 2 + cap 16 → 95 / 15%; interval 5 + cap 16 → 95 / 20%;
  size 5 + growth 2 + cap 20 + interval 5 → 90 / 0%; size 6 + growth 2 + cap 18 +
  first turn 5 → 90 / 5%; size 6 + growth 3 + cap 22 + interval 5 + first turn 5 →
  50 / 0% with 45% skilled losses. Close calls stayed 0 in every variant. It only
  punishes novices until a cliff. Revisit after Decision 1.
- (Shipped in round 2: city +1 stone a turn. Once the advice was fixed, stone
  became the binding constraint, so last round's "no effect" result had gone stale.)

## Strategy (kinds of change and hit rate)
- Bug fixes found by bots or scripted play: 4/4 kept. These were the boss-kill
  flag, dialog stacking, unseeded upkeep, and Procedural Frontier's fixed map.
  Highest value per hour.
- Performance with a reference-equivalence test: 2/2 kept, with shrinking returns
  (12× → 1.2×). Paused.
- Onboarding/readability: 3/3 kept (actionable iron advice, stone income, end
  recap with the cause of defeat).
- Goals/progression: 1/1 kept (personal records, round 3). No bot metric, so it's
  verified by UI steps.
- Replayability: 1/1 kept (fresh maps).
- Difficulty tuning: 0/4 (Hollow Crown march variants). Tuning can't fix a
  check whose outcome is dominated by an AI behaviour (Vorgath walking out).
- New mechanic / AI behaviour: 0/1 (Vorgath leash), moved to Decisions.
- Candidate choice: when a check fails for structural reasons, find out which
  rule drives it (the bossKiller data) before tuning around it. Round 3 spent
  4 runs learning that.

## Playbook (provisional unless marked)
- Instrument before theorizing: `eval/trace.mjs` and an ASCII map dump found
  every round-1 bug faster than reading code.
- Any rules refactor must keep `findPath` route-identical. The quality gate
  compares it against `eval/reference/find-path.mjs`.
- Bot-only metrics can hide UI breakage. Run `node eval/ui.mjs` whenever
  CSS, dialogs, or input handling change.
- Advice text must name real places, and the board must mark them. Players
  can't act on "secure iron" when no ore is in supply range.
- A rejected candidate can become right later. Re-test Alternatives when the
  constraint that blocked them changes (stone income: rejected in round 1,
  kept in round 2).
- Run timing checks alone. Parallel evaluator runs inflate End Turn ms 1.5–7×.
- Test generators must use `makeRng`, never a bare power-of-two LCG: its low
  bits cycle, and it let a broken records check pass (round 3). Prove every new
  check fails on 2–3 deliberate mutations.
- Never do bookkeeping (records, saves) inside a tab's renderer. Other tabs
  skip it (round 3 review).
- UI state that "announces once" (a new record) needs a memo keyed to the event.
  Repaints are frequent. Reset it on New and Load.
- When bot outcomes look odd (a novice wins on the hardest difficulty), check
  who landed the decisive blows (`bossKiller`, `portalBreaker` in the run JSON).

## Log
### Rounds 1–2 (condensed; details in git history and merged PR #163)
Built eval/ (4 bots, seeded, deterministic, tune and held-out seeds, menu
playthrough). Kept:
- **Boss counterblow fix.** The portal could reform forever.
- **Seeded upkeep roll.**
- **Dialogs above the board.** The New, Save and Load dialogs couldn't be clicked.
- **findPath rewrite and lazy search.** End Turn went from 1.4 s to about 0.1 s,
  with routes identical.
- **Actionable iron advice and board marker.** Advice check 0 → 95%.
- **Fresh maps and seeds in the New dialog.**
- **City +1 stone a turn.**
Rejected: the Vorgath leash (went to Decisions) and stone income (round 1;
shipped in round 2 once its blocker was fixed).

### Round 3 (session 3) — the end of a campaign, and a tuning dead end
Playing as a first-time player and then a returning one turned up two new
findings. The new UI ends every campaign with one bare sentence: the
recap the rules build is never shown. And nothing records a best to beat.
Kept:
- **End-of-campaign card.** Shows the turn, summary, cause of a fall, goals met,
  and tips. Personal records (fastest victory, longest stand) are kept per
  scenario and difficulty in their own storage key, and are idempotent per
  ending. Covered by a property test against a reference fold (fails on three
  mutations) and a browser defeat step (record, repaint, replay).
- **Check fix in its own commit.** The path-equivalence check's generator is now
  makeRng. The old LCG had cycling low bits.
Rejected: four Hollow Crown march tunings (Alternatives). Performance stopped
for shrinking returns.
Independent review (a separate agent): it found five real problems, all fixed.
A defeat on a non-Field tab wasn't recorded. The record line named the wrong
map. A rival's sack was blamed on the dead. The fallback text claimed a morale
collapse. The turn wasn't escaped. It also found that Load didn't clear undo
(pre-existing, fixed).
Failures:
- (d) Side effects in render code (writing records inside the Field tab's
  card) missed every other tab. Lesson: do game-event bookkeeping where the
  state changes or in tab-independent chrome, never in a tab's renderer.
- (a) The first records check passed a mutation because of the weak LCG. Caught
  by the mutation step; now a Playbook rule.
- (b) The record line flipped on repaint. Caught by a UI step written before the
  fix.
- (c) Four tuning runs before concluding that Hollow Crown is behaviour-bound.
  The bossKiller data from session 1 already suggested it.
Round gain: small on the scorecard, since none of the failing checks moved. The
gain is a visible player feature (a goal to beat, and what went wrong). For two
rounds the gains have been small and the remaining failing checks need Decisions
1 and 3. Next session: get those answers, or switch focus to a phone playtest of
feel and readability.

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
3. **Should Deadwalker marches threaten more than the capital?** Marches only
   ever target Olundar Prime, so one forward army screens everything, and a
   skilled player never sees the capital in danger (0–11% close calls). Option:
   later marches pick the weakest outlying holding (outpost, mine) on the way,
   telegraphed by the existing rally standard. Recommendation: try it after
   Decision 1, since both change the late-game pressure.
