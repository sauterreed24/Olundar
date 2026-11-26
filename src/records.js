// Personal campaign records, kept per scenario and difficulty on this device:
// the fastest victory and the longest stand in defeat. Stored under their own
// key, apart from save slots, so they never touch saved campaigns.
export const RECORDS_KEY = 'olundar.deadwalker.records';
const NOTED_MAX = 200;

export function recordKey(state) {
  return `${state.campaign?.scenarioId || 'founding'}:${state.campaign?.difficultyId || 'standard'}`;
}

export function parseRecords(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyRecords();
    const entries = parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries) ? parsed.entries : {};
    const clean = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object') continue;
      clean[key] = {
        wins: count(entry.wins),
        losses: count(entry.losses),
        fastestWin: turnOrNull(entry.fastestWin),
        longestStand: turnOrNull(entry.longestStand)
      };
    }
    const noted = Array.isArray(parsed.noted) ? parsed.noted.filter((item) => typeof item === 'string').slice(-NOTED_MAX) : [];
    return { entries: clean, noted };
  } catch {
    return emptyRecords();
  }
}

export function recordsFor(records, state) {
  return records.entries[recordKey(state)] || { wins: 0, losses: 0, fastestWin: null, longestStand: null };
}

// Fold a finished campaign into the records once. Returns the new records, the
// entry before and after, and whether this result set a personal best. Noting
// the same ending twice (a reload, an undo and replay) changes nothing.
export function noteCampaignEnd(records, state) {
  const key = recordKey(state);
  const before = recordsFor(records, state);
  if ((state.status !== 'won' && state.status !== 'lost') || !Number.isInteger(state.turn)) return { records, before, after: before, isBest: false, fresh: false };
  const id = `${state.seed}|${key}|${state.status}|${state.turn}`;
  // The same ending seen again (a reload, an undo and replay) is not a new record.
  if (records.noted.includes(id)) return { records, before, after: before, isBest: false, fresh: false };
  const after = { ...before };
  let isBest = false;
  if (state.status === 'won') {
    after.wins += 1;
    if (after.fastestWin === null || state.turn < after.fastestWin) {
      isBest = true;
      after.fastestWin = state.turn;
    }
  } else {
    after.losses += 1;
    if (after.longestStand === null || state.turn > after.longestStand) {
      isBest = true;
      after.longestStand = state.turn;
    }
  }
  const next = {
    entries: { ...records.entries, [key]: after },
    noted: [...records.noted, id].slice(-NOTED_MAX)
  };
  return { records: next, before, after, isBest, fresh: true };
}

// What brought Olundar Prime down, from the last night's strikes on Olundar's works.
export function fallCause(state) {
  if (state.status !== 'lost') return null;
  const strikes = (state.turnEvents || []).filter((event) => event.kind === 'strike' && event.targetFaction === 'olundar' && event.targetKind === 'building');
  if (!strikes.length) return 'Olundar Prime fell.';
  const byFaction = new Map();
  for (const event of strikes) {
    const entry = byFaction.get(event.attackerFaction) || { attackers: new Set(), damage: 0 };
    entry.attackers.add(event.attackerId);
    entry.damage += event.damage || 0;
    byFaction.set(event.attackerFaction, entry);
  }
  const parts = [...byFaction.entries()].map(([faction, entry]) => {
    const who = faction === 'dead' ? 'of the dead' : `of ${state.factions?.[faction]?.name || 'a rival host'}`;
    return `${entry.attackers.size} ${who} struck for ${entry.damage}`;
  });
  return `On the last night ${parts.join(', and ')} against Olundar's holdings, and the capital fell.`;
}

function count(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function turnOrNull(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function emptyRecords() {
  return { entries: {}, noted: [] };
}
