import { BUILDING_TYPES, DIFFICULTY_PRESETS, MAP_HEIGHT, MAP_WIDTH, RESOURCE_NAMES, SCENARIOS, SUN_EDICTS, UNIT_TYPES } from '../content.js';
import {
  attackCommand,
  buildCommand,
  crisisCommand,
  diplomacyCommand,
  edictCommand,
  executePlayerCommand,
  fieldOrderCommand,
  fortifyCommand,
  getCommandHistory,
  moveCommand,
  trainCommand,
  upgradeCommand
} from '../engine/commands.js';
import { registerPwa } from '../pwa.js';
import {
  createGame,
  deserializeState,
  endTurn,
  forecastBuildingAttack,
  forecastUnitAttack,
  factionBooks,
  findSpawnNear,
  formatCost,
  incomeForBuilding,
  canAfford,
  missingCost,
  isEnemy,
  getAftermathMissions,
  getCrisisCouncil,
  getDiplomacyLedger,
  getEndTurnWarnings,
  getRallyForecast,
  getReadyOlundarUnits,
  olundarCompany,
  companySeat,
  comingCompanySeats,
  nextReadyOlundarUnit,
  getSunEdictStatus,
  getWarCouncil,
  isRevealed,
  isVisible,
  canBuildOn,
  serializeState,
  unitAt,
  upgradeCostFor
} from '../rules.js';
import { createSaveSlot, defaultSaveSlotName, parseSaveSlots, serializeSaveSlots, upsertSaveSlot } from '../saveSlots.js';
import { initAudioPreference, playAudioCue, toggleAudio, audioIsEnabled } from '../audio.js';
import { BUILDING_SPRITE_ORDER, approachFor, coverClause, createBoard, groundAStepWouldOpen, holdingLine, hostsReaching, hoverSummary, loadUnitSprites, musterGround, musterOnTile, plannedYieldLabel, reachersFor, stoodBeside, traceMovePath, UNIT_SPRITE_ORDER, visibleMarchAnchor, visibleThreats, warClock } from './board.js';

const SAVE_KEY = 'olundar.deadwalker.prototype.save';
const SAVE_SLOTS_KEY = 'olundar.deadwalker.prototype.saveSlots';
const BUILD_ORDER = ['farm', 'lumberCamp', 'mine', 'road', 'watchtower', 'wall', 'rallyBanner', 'barracks', 'archeryYard', 'stable', 'workshop', 'shrine', 'outpost'];
const RESOURCE_ICONS = {
  food: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14V6M8 8c2.2-1.6 3.2-3.6 2.4-6-2.2.8-3.4 2.8-2.4 6M8 9C6 7.2 4.2 6.2 3 3c.2 3 2.2 4.8 5 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  wood: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13.5h10M4.5 13.5V8.5L8 4l3.5 4.5v5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  stone: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 12.5 5.2 5h5.6L13 12.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  iron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 10.5h12l-2 3H4zM4.2 10.5 6.2 5h3.6l2 5.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  gold: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.6v4.8M6.2 8h3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
  influence: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 9.5 6h4l-3.2 2.4 1.2 3.8L8 9.8 4.5 12.2 5.7 8.4 2.5 6h4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  morale: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.2S3.2 10.2 3.2 7A2.6 2.6 0 0 1 8 5.4 2.6 2.6 0 0 1 12.8 7C12.8 10.2 8 13.2 8 13.2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  people: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="6" r="1.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.6 13c.4-2.1 1.8-3.2 3.4-3.2s3 .1 3.4 3.2M9.2 13c.2-1.4 1.1-2.2 2-2.2 1 0 1.7.7 2 2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
};

const canvas = document.querySelector('#board');
const dock = document.querySelector('#dock');
const resourcesEl = document.querySelector('#resources');
const turnEl = document.querySelector('#turnLabel');
const modal = document.querySelector('#modal');
const board = createBoard(canvas);

let state = createGame({ scenarioId: 'founding', difficultyId: 'standard', seed: 'Olundar-Founding' });
let hover = null;
let buildType = null;
let endArmed = false;
let tab = 'field';
let pointer = null;
let ledgerPulse = new Set();
let freshCompany = new Set();

initAudioPreference();
registerPwa();
boot();
loadUnitSprites().then((ready) => {
  if (ready) paint();
});

function boot() {
  const fit = () => {
    board.resize();
    const city = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city');
    board.focus(city?.x ?? 7, city?.y ?? 16);
    paint();
  };
  requestAnimationFrame(fit);
  window.addEventListener('resize', fit);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    paint();
    renderGlance();
  });
  document.querySelector('#endTurn').addEventListener('click', requestEndTurn);
  document.querySelector('#nextUnit').addEventListener('click', selectNext);
  document.querySelector('#newTop').addEventListener('click', openNewGame);
  document.querySelector('#saveTop').addEventListener('click', saveGame);
  document.querySelector('#loadTop').addEventListener('click', openLoad);
  document.querySelector('#audioTop').addEventListener('click', () => {
    toggleAudio();
    renderChrome();
  });
  window.addEventListener('keydown', onKey);
  dock.addEventListener('click', onDockClick);
  resourcesEl.addEventListener('click', (event) => {
    const chip = event.target.closest('.res');
    const id = chip?.dataset.store;
    if (id) openHolding(id);
  });
  modal.addEventListener('click', onModalClick);
  board.watch(() => paint());
  renderChrome();
  paint();
}

function paint() {
  board.paint(state, {
    hover,
    selectedUnitId: state.selectedUnitId,
    selectedBuildingId: state.selectedBuildingId,
    buildType
  });
}

function renderChrome() {
  const player = state.factions.olundar;
  turnEl.textContent = state.status === 'playing' ? `Turn ${state.turn}` : state.status === 'won' ? 'Victory' : 'Defeat';
  const harvest = nextHarvest();
  resourcesEl.innerHTML = ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale']
    .map((id) => resourceChip(id, player.resources[id] ?? 0, RESOURCE_NAMES[id], harvest[id] || 0))
    .join('') + resourceChip('people', `${player.population}/${player.housing}`, 'People');
  document.querySelector('#audioTop').textContent = audioIsEnabled() ? 'Audio on' : 'Audio';
  document.querySelector('#endTurn').textContent = endArmed ? 'End turn now' : 'End turn';
  document.querySelector('#endTurn').title = endArmed ? owingPhrase() : '';
  renderDock();
}

function renderDock() {
  const glanceText = orderGlance();
  const clock = warClock(state);
  dock.innerHTML = `
    <div class="tabs">
      ${tabButton('field', 'Field')}
      ${tabButton('council', 'Council')}
      ${tabButton('diplomacy', 'Diplomacy')}
      ${tabButton('log', 'Log')}
    </div>
    <p id="glance" class="glance">${escapeHtml(glanceText)}</p>
    ${companyRoster()}
    <p class="aim"><b>${escapeHtml(clock.title)}</b> ${escapeHtml(clock.detail)}</p>
    ${nextOrder() ? `<p class="note order">${escapeHtml(nextOrder())}</p>` : ''}
    ${tab === 'field' ? fieldTab() : ''}
    ${tab === 'council' ? councilTab() : ''}
    ${tab === 'diplomacy' ? diplomacyTab() : ''}
    ${tab === 'log' ? logTab() : ''}
  `;
}

function companyRoster() {
  const company = olundarCompany(state);
  const coming = comingCompany();
  if (!company.length && !coming.length) return '';
  const open = state.buildings.find((building) => building.id === state.selectedBuildingId);
  const near = new Set(reachersFor(state, open).map((unit) => unit.id));
  const posted = new Set(stoodBeside(state, open).map((unit) => unit.id));
  const living = company.map((unit, index) => {
    const classes = [
      unit.hasActed ? 'spent' : 'ready',
      unit.id === state.selectedUnitId ? 'current' : '',
      unit.fortified > 0 ? 'guard' : '',
      endArmed && !unit.hasActed ? 'owing' : '',
      freshCompany.has(unit.id) ? 'fresh' : '',
      near.has(unit.id) && !posted.has(unit.id) ? 'near' : '',
      posted.has(unit.id) ? 'posted' : ''
    ].filter(Boolean).join(' ');
    const name = unit.name.split(' ').slice(-1)[0];
    const key = index < 9 ? `<span class="seat-key">${index + 1}</span>` : '';
    const guard = unit.fortified > 0 ? `<span class="seat-guard">${unit.fortified}</span>` : '';
    const fresh = freshCompany.has(unit.id) ? '<span class="seat-new">new</span>' : '';
    return `<button type="button" class="${classes}" data-cmd="seat" data-unit="${unit.id}" title="${escapeHtml(unit.name)}${unit.fortified ? ` · guard ${unit.fortified}` : ''}">${key}${guard}${fresh}<span class="seat-face">${unitPortrait(unit)}</span><em>${escapeHtml(name)}</em></button>`;
  }).join('');
  return `<div class="company">${living}${coming.map(comingSeat).join('')}</div>`;
}

function comingCompany() {
  const seats = [];
  const ahead = comingCompanySeats(state);
  for (const building of state.buildings) {
    if (building.faction !== 'olundar' || building.turnsLeft > 0 || !building.queue?.length) continue;
    const entry = building.queue[0];
    const def = UNIT_TYPES[entry.unitType];
    if (!def) continue;
    seats.push({
      buildingId: building.id,
      unitType: entry.unitType,
      turnsLeft: entry.turnsLeft,
      name: def.name,
      waiting: building.queue.length - 1,
      ground: musterGround(state, building),
      ahead: ahead.get(building.id) || 0,
      y: building.y,
      x: building.x
    });
  }
  seats.sort((a, b) => a.turnsLeft - b.turnsLeft || a.y - b.y || a.x - b.x);
  return seats;
}

function comingSeat(seat) {
  const short = seat.name.split(' ').slice(-1)[0];
  const classes = [
    'coming',
    seat.buildingId === state.selectedBuildingId ? 'current' : '',
    seat.turnsLeft <= 1 ? 'soon' : ''
  ].filter(Boolean).join(' ');
  const wait = `musters in ${seat.turnsLeft} turn${seat.turnsLeft === 1 ? '' : 's'}`;
  const place = seat.ground ? ` · steps to ${seat.ground.x},${seat.ground.y}` : ' · no open ground';
  const taken = seat.ahead ? ` · takes seat ${seat.ahead}` : '';
  const extra = seat.waiting ? ` · ${seat.waiting} more waiting` : '';
  return `<button type="button" class="${classes}" data-cmd="coming" data-building="${seat.buildingId}" title="${escapeHtml(`${seat.name} ${wait}${place}${taken}${extra}`)}"><span class="seat-soon">in ${seat.turnsLeft}</span><span class="seat-face">${unitPortrait({ type: seat.unitType, faction: 'olundar' })}</span><em>${escapeHtml(short)}</em></button>`;
}

function nextOrder() {
  const strategic = getWarCouncil(state).priorities.find((item) => !item.text.startsWith('Issue orders'));
  return strategic?.text || '';
}

function selectedGlance() {
  const unit = state.units.find((item) => item.id === state.selectedUnitId);
  const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
  if (unit) {
    const seat = companySeat(state, unit);
    const base = seat ? `Seat ${seat} · ${unit.name}` : unit.name;
    const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
    const approach = approachFor(state, unit, building);
    if (approach && building) {
      return approach.cost > 0
        ? `${base} · ${approach.cost} to ${building.name}`
        : `${base} · ${besidePhrase(building)}`;
    }
    return `${base} · ${unit.x},${unit.y}`;
  }
  if (building) {
    const extra = holdingLine(state, building);
    const postedUnits = stoodBeside(state, building);
    const postedIds = new Set(postedUnits.map((unit) => unit.id));
    const postedNames = postedUnits.map((unit) => unit.name.split(' ').slice(-1)[0]);
    const near = reachersFor(state, building).filter((unit) => !postedIds.has(unit.id)).map((unit) => unit.name.split(' ').slice(-1)[0]);
    const posted = postedNames.length ? `${spokenList(postedNames)} ${postedNames.length === 1 ? 'stands' : 'stand'} here` : '';
    const reach = near.length ? `${spokenList(near)} can reach` : '';
    const parts = [extra ? `${building.name} · ${building.x},${building.y} · ${extra}` : `${building.name} · ${building.x},${building.y}`];
    if (posted) parts.push(posted);
    if (reach) parts.push(reach);
    return parts.join(' · ');
  }
  return owingPhrase() || 'Select a unit, then choose a highlighted tile.';
}

function besidePhrase(building) {
  const income = incomeForBuilding(state, building);
  const yieldText = Object.entries(income)
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, amount]) => `${id} +${amount}`)
    .join(', ');
  return yieldText ? `beside ${building.name} · ${yieldText}` : `beside ${building.name}`;
}

function owingPhrase() {
  const company = olundarCompany(state);
  const owing = company.filter((unit) => !unit.hasActed);
  if (!owing.length) return '';
  const shown = owing.slice(0, 4).map((unit) => {
    const index = company.indexOf(unit);
    const short = unit.name.split(' ').slice(-1)[0];
    return index < 9 ? `${index + 1} ${short}` : short;
  });
  const rest = owing.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')}, and ${rest} more` : spokenList(shown);
  return `${list} still ${owing.length === 1 ? 'owes' : 'owe'} an order.`;
}

function spokenList(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function nextHarvest() {
  const books = factionBooks(state);
  const income = { ...books.income };
  const upkeep = { ...books.upkeep };
  for (const building of state.buildings) {
    if (building.faction !== 'olundar') continue;
    if (building.turnsLeft === 1) {
      const extra = incomeForBuilding(state, { ...building, turnsLeft: 0 });
      for (const [key, amount] of Object.entries(extra)) income[key] = (income[key] || 0) + (amount || 0);
    }
    const musters = (building.turnsLeft === 0 || building.turnsLeft === 1) && building.queue?.[0]?.turnsLeft === 1;
    if (!musters || !findSpawnNear(state, building.x, building.y, building.faction)) continue;
    const bite = UNIT_TYPES[building.queue[0].unitType]?.upkeep || {};
    for (const [key, amount] of Object.entries(bite)) upkeep[key] = (upkeep[key] || 0) + (amount || 0);
  }
  const nets = {};
  for (const key of ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale']) {
    nets[key] = (income[key] || 0) - (upkeep[key] || 0);
  }
  const foodAfter = (state.factions.olundar.resources.food || 0) + (income.food || 0) - (upkeep.food || 0);
  const faction = state.factions.olundar;
  if (foodAfter > 120 && faction.population < faction.housing) nets.food -= 12;
  return nets;
}

function resourceChip(id, value, label, net = 0) {
  const due = spendDue(id);
  const bite = comingBite(id);
  const hot = ledgerPulse.has(id) ? ' pulse' : '';
  const mark = `${due ? ' due' : ''}${bite ? ' bite' : ''}`;
  const holdings = holdingsFor(id);
  const selected = holdings.find((item) => item.building.id === state.selectedBuildingId);
  const lead = holdings[0];
  const led = selected ? ' led' : '';
  const place = selected && holdings.length > 1
    ? ` · ${holdings.indexOf(selected) + 1} of ${holdings.length}`
    : '';
  const many = holdings.length > 1 ? `<small class="many" title="${holdings.length} holdings">${holdings.length}</small>` : '';
  const forecast = net ? `<small class="next${net < 0 ? ' drain' : ''}" title="next harvest">${net > 0 ? '+' : '−'}${Math.abs(net)}</small>` : '';
  const debit = `${due ? `<small>−${due}</small>` : ''}${bite ? `<small class="soon" title="each turn once mustered">−${bite}</small>` : ''}${forecast}${many}`;
  const hint = selected
    ? ` title="${escapeHtml(`${selected.building.name} · ${label.toLowerCase()} +${selected.amount}${place}`)}"`
    : lead
      ? ` title="${escapeHtml(`${lead.building.name} leads ${label.toLowerCase()}${holdings.length > 1 ? ` · ${holdings.length}` : ''}`)}"`
      : '';
  return `<span class="res res-${id}${hot}${mark}${led}" data-store="${id}"${hint}>${RESOURCE_ICONS[id]}<span><b>${value}${debit}</b><em>${escapeHtml(label)}</em></span></span>`;
}

function holdingsFor(id) {
  if (!id || id === 'people') return [];
  return state.buildings
    .filter((building) => building.faction === 'olundar' && building.turnsLeft <= 0 && building.type !== 'road')
    .map((building) => ({ building, amount: incomeForBuilding(state, building)[id] || 0 }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.building.y - b.building.y || a.building.x - b.building.x);
}

function openHolding(id) {
  if (!id || id === 'people') return;
  const holdings = holdingsFor(id);
  if (!holdings.length) {
    notice(`No holding yields ${RESOURCE_NAMES[id] || id}.`, 'info');
    return;
  }
  const index = holdings.findIndex((item) => item.building.id === state.selectedBuildingId);
  const next = holdings[(index + 1) % holdings.length].building;
  state.selectedBuildingId = next.id;
  state.selectedUnitId = null;
  buildType = null;
  endArmed = false;
  board.ensureVisible(next.x, next.y);
  board.play({ kind: 'mark', x: next.x, y: next.y, duration: 560 });
  paint();
  renderChrome();
}

function purse(cost) {
  const resources = state.factions.olundar.resources;
  const missing = missingCost(resources, cost || {});
  const short = !canAfford(resources, cost || {});
  return { short, text: short ? `Need ${formatCost(missing)}` : formatCost(cost) };
}

function spendDue(id) {
  if (!buildType) return 0;
  const cost = BUILDING_TYPES[buildType]?.cost || {};
  if (!canAfford(state.factions.olundar.resources, cost)) return 0;
  return cost[id] || 0;
}

function comingBite(id) {
  let total = 0;
  for (const building of state.buildings) {
    if (building.faction !== 'olundar') continue;
    for (const entry of building.queue || []) total += UNIT_TYPES[entry.unitType]?.upkeep?.[id] || 0;
  }
  return total;
}

function orderButton({ cmd, attrs = '', name, cost, armed = false, enabled = true }) {
  const bill = purse(cost);
  const open = enabled && !bill.short;
  const classes = [armed && open ? 'armed' : '', bill.short ? 'short' : ''].filter(Boolean).join(' ');
  return `<button type="button" data-cmd="${cmd}" ${attrs} ${classes ? `class="${classes}"` : ''} ${open ? '' : 'disabled'}>${escapeHtml(name)} · ${escapeHtml(bill.text)}</button>`;
}

function unitPortrait(unit) {
  const index = UNIT_SPRITE_ORDER.indexOf(unit.type);
  if (index < 0) return '';
  const tone = unit.faction === 'dead' ? 'dead' : 'living';
  return `<div class="portrait-plate ${tone}"><div class="portrait" style="background-position:${-index * 78}px 0"></div></div>`;
}

function buildingPortrait(building) {
  const index = BUILDING_SPRITE_ORDER.indexOf(building.type);
  if (index < 0) return '';
  const tone = building.faction === 'dead' ? 'dead' : 'living';
  return `<div class="portrait-plate ${tone}"><div class="portrait building" style="background-position:${-index * 86}px 0"></div></div>`;
}

function orderGlance() {
  if (!hover) return selectedGlance();
  const field = buildType ? new Map() : board.movementField();
  const parts = [hoverSummary(state, hover, field)];
  const due = musterOnTile(state, hover.x, hover.y);
  if (due) parts.push(`${due.name} steps here in ${due.turnsLeft}`);
  if (buildType) {
    const name = BUILDING_TYPES[buildType].name;
    const turns = BUILDING_TYPES[buildType].buildTurns;
    if (board.buildSites().has(`${hover.x},${hover.y}`)) {
      const yieldText = plannedYieldLabel(state, buildType, hover.x, hover.y);
      parts.push(yieldText ? `place ${name} · ${yieldText}` : `place ${name}`);
      if (turns) parts.push(`rises in ${turns}`);
      parts.push(`spends ${formatCost(BUILDING_TYPES[buildType].cost)}`);
    } else {
      parts.push(canBuildOn(state, buildType, hover.x, hover.y).reason || `${name} will not stand here`);
    }
    return parts.join(' · ');
  }
  const unit = state.units.find((item) => item.id === state.selectedUnitId);
  if (!unit || unit.hasActed || unit.faction !== 'olundar') return parts.join(' · ');
  if (field.has(`${hover.x},${hover.y}`)) {
    const hosts = hostsReaching(state, unit.faction, hover.x, hover.y, unit.id);
    parts.push(hosts.length ? `exposed to ${hosts.map((enemy) => enemy.name).join(', ')}` : 'covered');
    const opened = groundAStepWouldOpen(state, unit, hover.x, hover.y);
    if (opened.length) parts.push(`${opened.length} new ground`);
  }
  if (isVisible(state, hover.x, hover.y)) {
    const enemy = unitAt(state, hover.x, hover.y);
    if (enemy && enemy.id !== unit.id) {
      const forecast = forecastUnitAttack(state, unit.id, enemy.id);
      if (forecast.ok) {
        const blow = forecast.lethal ? `${forecast.damage} damage, falls` : `${forecast.damage} damage, ${forecast.targetHpAfter} left`;
        const why = coverClause(forecast);
        parts.push(why ? `${blow} · ${why}` : blow);
      }
    }
    const structure = state.buildings.find((item) => item.x === hover.x && item.y === hover.y && item.type !== 'road');
    if (structure) {
      const forecast = forecastBuildingAttack(state, unit.id, structure.id);
      if (forecast.ok) parts.push(`${forecast.damage} to ${structure.name}`);
    }
  }
  return parts.join(' · ');
}

function renderGlance() {
  const glance = document.querySelector('#glance');
  if (glance) glance.textContent = orderGlance();
}

function fieldTab() {
  const unit = state.units.find((item) => item.id === state.selectedUnitId);
  const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
  if (state.status !== 'playing') {
    return `<section class="card"><h2>${state.status === 'won' ? 'Olundar stands' : 'Olundar has fallen'}</h2><p>Start a new campaign or load a saved one.</p></section>`;
  }
  if (!unit && !building) {
    const owed = owingPhrase();
    const line = owed ? `${owed} Press a seat, or N.` : 'The company has spent its orders.';
    return `<section class="card"><h2>The valley holds</h2><p>${escapeHtml(line)}</p><p class="note">Books next turn: ${escapeHtml(booksLine())}.</p><p class="note">Gold pennants still owe an order. Gold steps are walks, crimson steps are exposed, and a red bracket can be struck.</p>${buildHint()}</section>`;
  }
  if (unit) return unitCard(unit);
  return buildingCard(building);
}

function booksLine() {
  const { income, upkeep } = factionBooks(state);
  const parts = [];
  for (const key of ['food', 'wood', 'stone', 'iron', 'gold', 'influence']) {
    const earned = income[key] || 0;
    const eaten = upkeep[key] || 0;
    if (!earned && !eaten) continue;
    if (earned && eaten) parts.push(`${key} +${earned} −${eaten}`);
    else if (earned) parts.push(`${key} +${earned}`);
    else parts.push(`${key} −${eaten}`);
  }
  return parts.join(', ');
}

function upkeepPhrase(def) {
  const parts = Object.entries(def?.upkeep || {}).filter(([, amount]) => amount).map(([id, amount]) => `${amount} ${id}`);
  return parts.length ? `upkeep ${parts.join(', ')}` : '';
}

function upkeepLine(def) {
  const phrase = upkeepPhrase(def);
  return phrase ? `<p class="note">${escapeHtml(phrase[0].toUpperCase() + phrase.slice(1))}.</p>` : '';
}

function threatLine(unit) {
  if (unit.faction !== 'olundar') return '';
  const threats = visibleThreats(state, unit);
  if (!threats.length) return '<p class="note">No visible host can strike this unit.</p>';
  const names = threats.map((enemy) => enemy.name).join(', ');
  return `<p class="note danger">In reach of ${escapeHtml(names)}.</p>`;
}

function unitCard(unit) {
  const def = UNIT_TYPES[unit.type];
  const forecast = unit.faction === 'olundar' ? getRallyForecast(state, unit) : null;
  const rally = forecast?.reason === 'rally'
    ? `Rallies for ${forecast.heal} if it rests.`
    : forecast?.reason === 'blight'
      ? 'Grave-blight blocks rally.'
      : forecast?.reason === 'contact'
        ? 'Enemy contact blocks rally.'
        : forecast?.reason === 'exposed'
          ? 'No haven or banner in reach.'
          : '';
  const mine = unit.faction === 'olundar';
  const seat = companySeat(state, unit);
  const role = seat ? `Seat ${seat} · ${def.role}` : def.role;
  return `
    <section class="card unit-card">
      <div class="unit-head">
        ${unitPortrait(unit)}
        <div>
          <h2>${escapeHtml(unit.name)}</h2>
          <p class="role">${escapeHtml(role)}</p>
        </div>
      </div>
      <ul class="stats">
        <li><b>${unit.hp}/${unit.maxHp}</b><span>Health</span></li>
        <li><b>${def.move}</b><span>Move</span></li>
        <li><b>${def.attack}</b><span>Attack</span></li>
        <li><b>${def.range}</b><span>Range</span></li>
      </ul>
      <div class="bar"><span style="width:${Math.round(100 * unit.hp / unit.maxHp)}%"></span></div>
      <p>${escapeHtml(def.text)}</p>
      ${upkeepLine(def)}
      ${rally ? `<p class="note">${escapeHtml(rally)}</p>` : ''}
      ${unit.fortified > 0 ? '<p class="note">Fortified. The guard holds until this unit moves or strikes.</p>' : ''}
      ${stoodNote(unit)}
      ${threatLine(unit)}
      ${mine && !unit.hasActed ? '<p class="note">The pennant means this order is still open. Crimson steps are exposed. A red bracket can be struck.</p>' : ''}
      ${buildType ? `<p class="note">The chip is the yield once the holding stands. Gold brackets mark richer ground. A red wash will not take it.</p>` : ''}
      <div class="actions">
        ${mine && !unit.hasActed ? stepUpButton(unit) : ''}
        ${mine && !unit.hasActed ? `<button type="button" data-cmd="fortify">Fortify</button>` : ''}
        ${mine && unit.type === 'engineer' && !unit.hasActed ? buildButtons() : ''}
        ${buildType ? `<button type="button" data-cmd="cancel-build">Cancel build</button>` : ''}
      </div>
    </section>
  `;
}

function stoodNote(unit) {
  const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
  const approach = approachFor(state, unit, building);
  if (!approach || approach.cost > 0 || !building) return '';
  return `<p class="note">Stands beside ${escapeHtml(building.name)}.</p>`;
}

function stepUpButton(unit) {
  const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
  const approach = approachFor(state, unit, building);
  if (!approach || approach.cost < 1 || !building) return '';
  return `<button type="button" data-cmd="step-up">Step up · ${approach.cost}</button>`;
}

function stepUp() {
  const unit = state.units.find((item) => item.id === state.selectedUnitId);
  const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
  const approach = approachFor(state, unit, building);
  if (!unit || !approach || approach.cost < 1) return;
  run(moveCommand(unit.id, approach.x, approach.y), { stay: true });
}

function buildingCard(building) {
  const def = BUILDING_TYPES[building.type];
  const mine = building.faction === 'olundar';
  const trains = mine && building.turnsLeft <= 0 ? def.trains.map((type) => {
    const unit = UNIT_TYPES[type];
    const bite = upkeepPhrase(unit);
    const name = bite ? `Train ${unit.name}, ${bite}` : `Train ${unit.name}`;
    return orderButton({ cmd: 'train', attrs: `data-unit="${type}"`, name, cost: unit.cost });
  }).join('') : '';
  return `
    <section class="card">
      <div class="unit-head">
        ${buildingPortrait(building)}
        <div>
          <h2>${escapeHtml(building.name)}</h2>
          <p class="role">${escapeHtml(def.name)} · tier ${(building.upgraded || 0) + 1}</p>
        </div>
      </div>
      <p class="muted">${building.hp}/${building.maxHp} HP</p>
      <p>${escapeHtml(def.text)}</p>
      ${workMeter(building, def)}
      ${building.turnsLeft > 0 ? `<p class="note">Finishes in ${building.turnsLeft} turn${building.turnsLeft === 1 ? '' : 's'}.</p>` : ''}
      ${(building.queue || []).map((entry) => {
        const trainee = UNIT_TYPES[entry.unitType];
        const name = trainee?.name || 'A company';
        const bite = upkeepPhrase(trainee);
        const wait = `${name} musters in ${entry.turnsLeft} turn${entry.turnsLeft === 1 ? '' : 's'}.`;
        const line = bite ? `${wait} ${bite[0].toUpperCase()}${bite.slice(1)}.` : wait;
        return `<p class="note">${escapeHtml(line)}</p>`;
      }).join('')}
      <div class="actions">
        ${trains}
        ${mine && building.turnsLeft <= 0 ? orderButton({ cmd: 'upgrade', name: 'Upgrade', cost: upgradeCostFor(building) }) : ''}
      </div>
    </section>
  `;
}

function workMeter(building, def) {
  if (!building.turnsLeft || !def.buildTurns) return '';
  const done = Math.round(100 * (1 - building.turnsLeft / def.buildTurns));
  return `<div class="bar work" aria-label="Work done"><span style="width:${done}%"></span></div>`;
}

function buildButtons() {
  return BUILD_ORDER.map((type) => {
    const def = BUILDING_TYPES[type];
    return orderButton({ cmd: 'arm-build', attrs: `data-building="${type}"`, name: def.name, cost: def.cost, armed: buildType === type });
  }).join('');
}

function buildHint() {
  return buildType ? '<p class="note">The chip is the yield once the holding stands. Gold brackets mark richer ground. A red wash will not take it.</p>' : '';
}

function councilTab() {
  const council = getWarCouncil(state);
  const crisis = getCrisisCouncil(state);
  const missions = getAftermathMissions(state);
  const edicts = getSunEdictStatus(state);
  return `
    <section class="card">
      <h2>${escapeHtml(council.headline || 'War council')}</h2>
      ${council.priorities.map((item) => `<p>${escapeHtml(item.text)}</p>`).join('')}
    </section>
    <section class="card">
      <h2>Sun decrees</h2>
      <p class="muted">${edicts.ready ? 'Ready.' : `Cooling down for ${edicts.cooldown} turn${edicts.cooldown === 1 ? '' : 's'}.`}${edicts.activeLabel ? ` Active: ${escapeHtml(edicts.activeLabel)}.` : ''}</p>
      <div class="actions">
        ${Object.values(SUN_EDICTS).map((edict) => orderButton({ cmd: 'edict', attrs: `data-edict="${edict.id}"`, name: edict.name, cost: edict.cost, enabled: edicts.ready })).join('')}
      </div>
    </section>
    ${crisis.visible ? crisisCard(crisis) : ''}
    ${missions.visible ? missionCard(missions) : ''}
  `;
}

function crisisCard(crisis) {
  return `
    <section class="card">
      <h2>${escapeHtml(crisis.title)}</h2>
      <p>${escapeHtml(crisis.summary)}</p>
      ${crisis.events.map((event) => `
        <article>
          <h3>${escapeHtml(event.name)}</h3>
          <p>${escapeHtml(event.text)}</p>
          <div class="actions">
            ${event.choices.map((choice) => `<button type="button" data-cmd="crisis" data-event="${event.id}" data-choice="${choice.id}" ${choice.disabled ? 'disabled' : ''}>${escapeHtml(choice.name)}</button>`).join('')}
          </div>
        </article>
      `).join('')}
    </section>
  `;
}

function missionCard(missions) {
  return `
    <section class="card">
      <h2>${escapeHtml(missions.title)}</h2>
      <p>${escapeHtml(missions.summary)}</p>
      ${missions.active.slice(0, 4).map((mission) => `<p><b>${escapeHtml(mission.name)}</b> ${escapeHtml(mission.target)}. ${escapeHtml(mission.route?.text || '')}</p>`).join('')}
    </section>
  `;
}

function diplomacyTab() {
  const ledger = getDiplomacyLedger(state);
  return `
    <section class="card">
      <h2>${escapeHtml(ledger.title)}</h2>
      <p>${escapeHtml(ledger.summary)}</p>
    </section>
    ${ledger.entries.map((entry) => `
      <section class="card">
        <h2>${escapeHtml(entry.name)}</h2>
        <p class="muted">${escapeHtml(entry.posture.label)} · relation ${entry.relation}</p>
        <p>${escapeHtml(entry.discovered ? entry.advice : 'Not contacted yet.')}</p>
        ${entry.discovered ? `<div class="actions">
          ${entry.actions.map((action) => `<button type="button" data-cmd="diplomacy" data-faction="${entry.id}" data-action="${action.id}" ${action.disabled ? 'disabled' : ''}>${escapeHtml(action.name)}</button>`).join('')}
          ${(entry.fieldOrders || []).map((order) => `<button type="button" data-cmd="order" data-faction="${entry.id}" data-order="${order.id}" ${order.active || order.disabled ? 'disabled' : ''}>${escapeHtml(order.name)}</button>`).join('')}
        </div>` : ''}
      </section>
    `).join('')}
  `;
}

function logTab() {
  const lines = state.messages.slice(0, 14);
  return `<section class="card log">${lines.map((message) => `<p class="${escapeHtml(message.tone || 'info')}"><b>T${message.turn}</b> ${escapeHtml(message.text)}</p>`).join('') || '<p>No messages yet.</p>'}</section>`;
}

function tabButton(id, label) {
  return `<button type="button" data-cmd="tab" data-tab="${id}" ${tab === id ? 'class="armed"' : ''}>${label}</button>`;
}

function onDockClick(event) {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const cmd = button.dataset.cmd;
  if (cmd === 'tab') {
    tab = button.dataset.tab;
    renderDock();
    return;
  }
  if (cmd === 'fortify') run(fortifyCommand(state.selectedUnitId));
  else if (cmd === 'step-up') stepUp();
  else if (cmd === 'seat') takeSeat(button.dataset.unit);
  else if (cmd === 'coming') takeComing(button.dataset.building);
  else if (cmd === 'arm-build') {
    buildType = button.dataset.building;
    state.selectedBuildingId = null;
    paint();
    renderChrome();
  } else if (cmd === 'cancel-build') {
    buildType = null;
    paint();
    renderChrome();
  } else if (cmd === 'train') run(trainCommand(state.selectedBuildingId, button.dataset.unit));
  else if (cmd === 'upgrade') run(upgradeCommand(state.selectedBuildingId));
  else if (cmd === 'diplomacy') run(diplomacyCommand(button.dataset.faction, button.dataset.action));
  else if (cmd === 'order') run(fieldOrderCommand(button.dataset.faction, button.dataset.order));
  else if (cmd === 'edict') run(edictCommand(button.dataset.edict));
  else if (cmd === 'crisis') run(crisisCommand(button.dataset.event, button.dataset.choice));
}

function onPointerDown(event) {
  const mapTile = board.minimapAt(event.clientX, event.clientY);
  if (mapTile) {
    pointer = { minimap: true, id: event.pointerId, moved: true };
    canvas.setPointerCapture(event.pointerId);
    board.focus(mapTile.x, mapTile.y);
    paint();
    return;
  }
  const tile = board.tileAtPoint(event.clientX, event.clientY);
  pointer = { x: event.clientX, y: event.clientY, tile, moved: false, id: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (pointer?.minimap && pointer.id === event.pointerId) {
    const mapTile = board.minimapAt(event.clientX, event.clientY);
    if (mapTile) {
      board.focus(mapTile.x, mapTile.y);
      paint();
    }
    return;
  }
  const tile = board.tileAtPoint(event.clientX, event.clientY);
  if (pointer && pointer.id === event.pointerId) {
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 8) {
      pointer.moved = true;
      board.panByPixels(dx, dy);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      paint();
    }
  }
  const same = hover?.x === tile?.x && hover?.y === tile?.y;
  hover = tile;
  if (!same) {
    paint();
    renderGlance();
  }
}

function onPointerUp(event) {
  if (pointer?.minimap) {
    pointer = null;
    return;
  }
  if (!pointer || pointer.moved) {
    pointer = null;
    return;
  }
  const tile = board.tileAtPoint(event.clientX, event.clientY);
  pointer = null;
  if (tile) actOnTile(tile);
}

function actOnTile(tile) {
  if (state.status !== 'playing') return;
  const selected = state.units.find((unit) => unit.id === state.selectedUnitId);
  if (buildType && selected?.type === 'engineer') {
    const result = run(buildCommand(selected.id, buildType, tile.x, tile.y));
    if (result?.ok !== false) buildType = null;
    return;
  }
  const visibleUnit = isVisible(state, tile.x, tile.y) ? unitAt(state, tile.x, tile.y) : null;
  const visibleBuilding = isVisible(state, tile.x, tile.y)
    ? state.buildings.find((building) => building.x === tile.x && building.y === tile.y && building.type !== 'road')
    : null;
  if (selected && !selected.hasActed && visibleUnit && visibleUnit.faction !== 'olundar' && isEnemyTile(selected, visibleUnit)) {
    run(attackCommand(selected.id, visibleUnit.id, 'unit'));
    return;
  }
  if (selected && !selected.hasActed && visibleBuilding && visibleBuilding.faction !== 'olundar' && isEnemyTile(selected, visibleBuilding)) {
    run(attackCommand(selected.id, visibleBuilding.id, 'building'));
    return;
  }
  if (visibleUnit?.faction === 'olundar') {
    state.selectedUnitId = visibleUnit.id;
    state.selectedBuildingId = null;
    buildType = null;
    board.ensureVisible(visibleUnit.x, visibleUnit.y);
    renderChrome();
    paint();
    return;
  }
  if (visibleBuilding?.faction === 'olundar') {
    state.selectedBuildingId = visibleBuilding.id;
    state.selectedUnitId = null;
    buildType = null;
    board.ensureVisible(visibleBuilding.x, visibleBuilding.y);
    renderChrome();
    paint();
    return;
  }
  if (selected && !selected.hasActed && board.movementField().has(`${tile.x},${tile.y}`)) {
    run(moveCommand(selected.id, tile.x, tile.y));
    return;
  }
  if (visibleUnit || visibleBuilding) {
    notice('Out of reach.', 'info');
    return;
  }
  if (isRevealed(state, tile.x, tile.y)) {
    state.selectedUnitId = null;
    state.selectedBuildingId = null;
    renderChrome();
    paint();
  }
}

function isEnemyTile(attacker, target) {
  if (!isEnemy(state, attacker.faction, target.faction)) return false;
  const def = UNIT_TYPES[attacker.type];
  const distance = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
  return distance > 0 && distance <= def.range;
}

function run(command, options = {}) {
  const stayId = options.stay ? state.selectedUnitId : null;
  const stayBuilding = options.stay ? state.selectedBuildingId : null;
  const scouted = command.type === 'move' ? scoutMemory(state) : null;
  const cue = motionCue(command);
  const result = executePlayerCommand(state, command);
  endArmed = false;
  const opened = scouted && result?.ok !== false ? openedGround(state, scouted.ground) : [];
  const sighted = scouted && result?.ok !== false ? sightedHosts(state, scouted.hosts) : [];
  let text = result?.reason || (result?.ok === false ? 'That order failed.' : 'Done.');
  if (opened.length || sighted.length || result?.ruinWhisper) {
    const extra = [];
    if (opened.length) extra.push(`${opened.length} new ground`);
    if (sighted.length) extra.push(`${sighted.map((unit) => unit.name).join(', ')} sighted`);
    if (result?.ruinWhisper) extra.push(result.ruinWhisper.echo ? 'a ruin whispers' : 'ruins surveyed');
    text = `${text} ${extra.join('. ')}.`;
  }
  let nextUnit = null;
  if (result?.ok !== false) {
    if (opened.length) board.play({ kind: 'dawn', tiles: opened, duration: 760 });
    if (sighted.length) board.play({ kind: 'sight', tiles: sighted.map((unit) => ({ x: unit.x, y: unit.y })), duration: 880 });
    playAudioCue('ui');
    playCue(cue, result);
    if (command.type === 'build' && result.building) {
      state.selectedUnitId = null;
      state.selectedBuildingId = result.building.id;
      buildType = null;
    } else if (!options.stay && !opened.length && !sighted.length) nextUnit = handOffSpentUnit();
  }
  if (options.stay && result?.ok !== false && stayId) {
    state.selectedUnitId = stayId;
    state.selectedBuildingId = stayBuilding;
    const held = state.buildings.find((building) => building.id === stayBuilding);
    if (held) text = `${text} Stands beside ${held.name}.`;
  }
  if (nextUnit) text = `${text} ${nextUnit.name} is next.`;
  notice(text, result?.ok === false ? 'bad' : 'good');
  const focus = state.units.find((unit) => unit.id === state.selectedUnitId) || state.buildings.find((building) => building.id === state.selectedBuildingId);
  if (focus) board.ensureVisible(focus.x, focus.y);
  paint();
  renderChrome();
  return result;
}

function scoutMemory(state) {
  const ground = new Set();
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (isRevealed(state, x, y)) ground.add(`${x},${y}`);
    }
  }
  const hosts = new Set();
  for (const unit of state.units) {
    if (isEnemy(state, 'olundar', unit.faction) && isVisible(state, unit.x, unit.y)) hosts.add(unit.id);
  }
  return { ground, hosts };
}

function openedGround(state, before) {
  const tiles = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (!isRevealed(state, x, y) || before.has(`${x},${y}`)) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function sightedHosts(state, before) {
  return state.units.filter((unit) => isEnemy(state, 'olundar', unit.faction) && isVisible(state, unit.x, unit.y) && !before.has(unit.id));
}

function motionCue(command) {
  const unit = state.units.find((item) => item.id === command.payload?.unitId);
  if (command.type === 'move' && unit) {
    const path = traceMovePath(board.movementField(), unit, command.payload.x, command.payload.y);
    const route = path.length > 1 ? path : [{ x: unit.x, y: unit.y }, { x: command.payload.x, y: command.payload.y }];
    return { kind: 'walk', unitId: unit.id, path: route, duration: Math.min(980, 220 + route.length * 110) };
  }
  if (command.type === 'attack' && unit) {
    const target = command.payload.targetType === 'building'
      ? state.buildings.find((item) => item.id === command.payload.targetId)
      : state.units.find((item) => item.id === command.payload.targetId);
    if (!target) return null;
    return {
      kind: 'strike',
      unitId: unit.id,
      tx: target.x,
      ty: target.y,
      defender: { type: target.type, faction: target.faction },
      duration: 460
    };
  }
  if (command.type === 'fortify' && unit) return { kind: 'brace', unitId: unit.id, duration: 480 };
  if (command.type === 'build') return { kind: 'stake', x: command.payload.x, y: command.payload.y, duration: 640 };
  return null;
}

function playCue(cue, result) {
  if (!cue) return;
  if (cue.kind === 'strike') {
    board.play(cue);
    board.play({ kind: 'impact', x: cue.tx, y: cue.ty, duration: 540 });
    if (Number.isFinite(result?.damage)) {
      board.play({ kind: 'damage', x: cue.tx, y: cue.ty, text: `−${result.damage}`, duration: 780 });
    }
    if (result?.targetDestroyed && cue.defender?.type) {
      board.play({ kind: 'fall', type: cue.defender.type, faction: cue.defender.faction, x: cue.tx, y: cue.ty, duration: 620 });
    }
    return;
  }
  board.play(cue);
}

function handOffSpentUnit() {
  const current = state.units.find((unit) => unit.id === state.selectedUnitId);
  if (!current?.hasActed) return null;
  const next = nextReadyOlundarUnit(state, current.id);
  if (!next) return null;
  state.selectedUnitId = next.id;
  state.selectedBuildingId = null;
  board.ensureVisible(next.x, next.y);
  board.play({ kind: 'beckon', unitId: next.id, duration: 560 });
  return next;
}

function marchPath(from, to) {
  const path = [{ x: from.x, y: from.y }];
  let x = from.x;
  let y = from.y;
  while (x !== to.x) {
    x += Math.sign(to.x - x);
    path.push({ x, y });
  }
  while (y !== to.y) {
    y += Math.sign(to.y - y);
    path.push({ x, y });
  }
  return path;
}

function playEnemyMarch(before) {
  const moves = [];
  for (const unit of state.units) {
    const prev = before.find((item) => item.id === unit.id);
    if (!prev || (prev.x === unit.x && prev.y === unit.y)) continue;
    const path = marchPath(prev, unit);
    board.play({ kind: 'walk', unitId: unit.id, path, duration: Math.min(1100, 200 + path.length * 80) });
    moves.push({ x: prev.x, y: prev.y, nx: unit.x, ny: unit.y });
  }
  for (const prev of before) {
    if (state.units.some((unit) => unit.id === prev.id)) continue;
    board.play({ kind: 'fall', type: prev.type, faction: prev.faction, x: prev.x, y: prev.y, duration: 680 });
  }
  return visibleMarchAnchor(state, moves);
}

function playArrivals(before, halls = []) {
  const arrived = state.units.filter((unit) => !before.some((item) => item.id === unit.id));
  const walks = musterWalks(arrived, halls);
  for (const unit of arrived) {
    const hall = walks.get(unit.id);
    if (!hall) {
      board.play({ kind: 'arrive', unitId: unit.id, duration: 700 });
      continue;
    }
    const path = marchPath(hall, unit);
    const duration = Math.min(860, 240 + path.length * 160);
    board.play({ kind: 'walk', unitId: unit.id, path, duration });
    board.play({ kind: 'arrive', unitId: unit.id, duration });
  }
  return arrived;
}

function musterWalks(units, halls) {
  const pairs = [];
  for (const unit of units) {
    halls.forEach((hall, index) => {
      if (hall.type !== unit.type || hall.faction !== unit.faction) return;
      const dist = Math.abs(hall.x - unit.x) + Math.abs(hall.y - unit.y);
      if (dist > 0 && dist <= 5) pairs.push({ id: unit.id, index, dist });
    });
  }
  pairs.sort((a, b) => a.dist - b.dist || a.index - b.index);
  const usedUnits = new Set();
  const usedHalls = new Set();
  const walks = new Map();
  for (const pair of pairs) {
    if (usedUnits.has(pair.id) || usedHalls.has(pair.index)) continue;
    usedUnits.add(pair.id);
    usedHalls.add(pair.index);
    walks.set(pair.id, halls[pair.index]);
  }
  return walks;
}

function arrivalLine(units) {
  const ours = units.filter((unit) => unit.faction === 'olundar');
  const theirs = units.filter((unit) => unit.faction !== 'olundar' && isVisible(state, unit.x, unit.y));
  const parts = [];
  if (ours.length) parts.push(`${ours.map((unit) => unit.name).join(', ')} musters`);
  if (theirs.length) parts.push(`${theirs.map((unit) => unit.name).join(', ')} takes the field`);
  return parts.join('. ');
}

function requestEndTurn() {
  if (state.status !== 'playing') return;
  const warnings = getEndTurnWarnings(state);
  if (warnings.length && !endArmed) {
    endArmed = true;
    notice(owingPhrase() || warnings[0], 'info');
    renderChrome();
    return;
  }
  const before = state.units.map((unit) => ({ id: unit.id, x: unit.x, y: unit.y, type: unit.type, faction: unit.faction }));
  const beforeStores = resourceSnapshot();
  const rising = state.buildings.filter((building) => building.faction === 'olundar' && building.turnsLeft > 0).map((building) => building.id);
  const halls = state.buildings
    .filter((building) => building.turnsLeft <= 0 && building.queue?.[0]?.turnsLeft === 1)
    .map((building) => ({ x: building.x, y: building.y, type: building.queue[0].unitType, faction: building.faction }));
  endTurn(state);
  const watch = playEnemyMarch(before);
  const arrived = playArrivals(before, halls);
  const mustered = arrived.filter((unit) => unit.faction === 'olundar');
  freshCompany = new Set(mustered.map((unit) => unit.id));
  if (mustered.length && !watch) {
    state.selectedUnitId = mustered[0].id;
    state.selectedBuildingId = null;
  }
  for (const id of rising) {
    const building = state.buildings.find((item) => item.id === id);
    if (building && building.turnsLeft === 0) board.play({ kind: 'rise', x: building.x, y: building.y, duration: 520 });
  }
  endArmed = false;
  buildType = null;
  getCommandHistory().clear();
  const marched = state.units.filter((unit) => {
    const prev = before.find((item) => item.id === unit.id);
    return unit.faction !== 'olundar' && prev && (prev.x !== unit.x || prev.y !== unit.y);
  }).length;
  const harvest = harvestLine(beforeStores);
  const arrival = arrivalLine(arrived);
  const works = worksLine(rising);
  const advance = marched ? `Turn ${state.turn}. ${marched} hosts advance.` : `Turn ${state.turn}.`;
  const bits = [advance];
  if (harvest.text) bits.push(`Harvest ${harvest.text}.`);
  if (works) bits.push(`${works}.`);
  if (arrival) bits.push(`${arrival}.`);
  notice(bits.join(' '), 'good');
  ledgerPulse = new Set(harvest.pulsed);
  playAudioCue('endTurn');
  if (watch) board.ensureVisible(watch.x, watch.y);
  else if (arrived.some((unit) => unit.faction === 'olundar')) {
    const muster = arrived.find((unit) => unit.faction === 'olundar');
    board.ensureVisible(muster.x, muster.y);
  } else {
    const held = state.buildings.find((building) => building.id === state.selectedBuildingId);
    if (held) board.ensureVisible(held.x, held.y);
    else if (!state.selectedUnitId) {
      const city = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city');
      if (city) board.focus(city.x, city.y);
    }
  }
  renderChrome();
  ledgerPulse = new Set();
  freshCompany = new Set();
  paint();
}

function worksLine(ids) {
  const parts = [];
  for (const id of ids) {
    const building = state.buildings.find((item) => item.id === id);
    if (!building) continue;
    if (building.turnsLeft > 0) parts.push(`${building.name} rises in ${building.turnsLeft}`);
    else {
      const paid = holdingLine(state, building);
      parts.push(paid ? `${building.name} stands, ${paid}` : `${building.name} stands`);
    }
  }
  return parts.join('. ');
}

function resourceSnapshot() {
  const resources = state.factions.olundar.resources;
  const snap = { people: state.factions.olundar.population };
  for (const key of ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale']) snap[key] = resources[key] || 0;
  return snap;
}

function harvestLine(before) {
  const resources = state.factions.olundar.resources;
  const parts = [];
  const pulsed = [];
  for (const key of ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale']) {
    const delta = (resources[key] || 0) - (before[key] || 0);
    if (!delta) continue;
    parts.push(`${key} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`);
    pulsed.push(key);
  }
  const people = state.factions.olundar.population - before.people;
  if (people) {
    parts.push(`people ${people > 0 ? '+' : '−'}${Math.abs(people)}`);
    pulsed.push('people');
  }
  return { text: parts.join(', '), pulsed };
}

function selectNext() {
  const ready = getReadyOlundarUnits(state);
  if (!ready.length) {
    notice('No ready units.', 'info');
    return;
  }
  const index = ready.findIndex((unit) => unit.id === state.selectedUnitId);
  const next = ready[(index + 1) % ready.length];
  state.selectedUnitId = next.id;
  state.selectedBuildingId = null;
  board.ensureVisible(next.x, next.y);
  board.play({ kind: 'beckon', unitId: next.id, duration: 460 });
  renderChrome();
  paint();
}

function takeSeat(unitId) {
  const unit = state.units.find((item) => item.id === unitId && item.faction === 'olundar');
  if (!unit) return;
  const held = state.buildings.find((building) => building.id === state.selectedBuildingId);
  const keeps = Boolean(approachFor(state, unit, held));
  state.selectedUnitId = unit.id;
  state.selectedBuildingId = keeps ? held.id : null;
  buildType = null;
  endArmed = false;
  board.ensureVisible(unit.x, unit.y);
  board.play({ kind: 'beckon', unitId: unit.id, duration: 460 });
  paint();
  renderChrome();
}

function takeComing(buildingId) {
  const building = state.buildings.find((item) => item.id === buildingId && item.faction === 'olundar');
  if (!building?.queue?.length || building.turnsLeft > 0) return;
  state.selectedBuildingId = building.id;
  state.selectedUnitId = null;
  buildType = null;
  endArmed = false;
  board.ensureVisible(building.x, building.y);
  paint();
  renderChrome();
}

function onKey(event) {
  if (event.target?.closest?.('input, textarea, select')) return;
  if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const unit = olundarCompany(state)[Number(event.key) - 1];
    if (unit) {
      takeSeat(unit.id);
      event.preventDefault();
    }
    return;
  }
  if ((event.key === 'f' || event.key === 'F') && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const selected = state.units.find((unit) => unit.id === state.selectedUnitId && unit.faction === 'olundar');
    if (selected) run(fortifyCommand(selected.id));
    event.preventDefault();
    return;
  }
  if (event.key === 'e' || event.key === 'E') requestEndTurn();
  else if (event.key === 'n' || event.key === 'N') selectNext();
  else if (event.key === 'Escape') {
    buildType = null;
    endArmed = false;
    modal.hidden = true;
    renderChrome();
    paint();
  } else if ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey)) {
    board.clearMotion();
    const result = event.shiftKey ? getCommandHistory().redo(state) : getCommandHistory().undo(state);
    notice(result.reason, result.ok ? 'good' : 'info');
    renderChrome();
    paint();
  } else if (event.key === 'ArrowLeft') board.pan(-1, 0);
  else if (event.key === 'ArrowRight') board.pan(1, 0);
  else if (event.key === 'ArrowUp') board.pan(0, -1);
  else if (event.key === 'ArrowDown') board.pan(0, 1);
  else return;
  if (event.key.startsWith('Arrow')) {
    paint();
    event.preventDefault();
  }
}

function saveGame() {
  const serialized = serializeState(state);
  const slots = parseSaveSlots(localStorage.getItem(SAVE_SLOTS_KEY));
  const slot = createSaveSlot(state, serialized, { name: defaultSaveSlotName(state) });
  localStorage.setItem(SAVE_SLOTS_KEY, serializeSaveSlots(upsertSaveSlot(slots, slot)));
  localStorage.setItem(SAVE_KEY, serialized);
  notice(`Saved ${slot.name}.`, 'good');
}

function openLoad() {
  const slots = parseSaveSlots(localStorage.getItem(SAVE_SLOTS_KEY));
  modal.hidden = false;
  modal.innerHTML = `
    <form class="dialog">
      <h2>Load</h2>
      <div class="actions">
        ${slots.map((slot) => `<button type="button" data-slot="${escapeHtml(slot.id)}">${escapeHtml(slot.name)} · turn ${slot.turn}</button>`).join('') || '<p>No saved campaigns.</p>'}
        <button type="button" data-close="1">Close</button>
      </div>
    </form>
  `;
}

function openNewGame() {
  modal.hidden = false;
  modal.innerHTML = `
    <form class="dialog" id="newGame">
      <h2>New campaign</h2>
      <label>Scenario
        <select name="scenario">${Object.values(SCENARIOS).map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}</select>
      </label>
      <label>Difficulty
        <select name="difficulty">${Object.values(DIFFICULTY_PRESETS).map((item) => `<option value="${item.id}" ${item.id === 'standard' ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>
      </label>
      <div class="actions">
        <button type="submit" class="primary">Start</button>
        <button type="button" data-close="1">Close</button>
      </div>
    </form>
  `;
  modal.querySelector('#newGame').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const scenario = SCENARIOS[data.get('scenario')] || SCENARIOS.founding;
    state = createGame({
      scenarioId: scenario.id,
      difficultyId: data.get('difficulty') || scenario.difficultyId || 'standard',
      seed: scenario.seed
    });
    buildType = null;
    endArmed = false;
    modal.hidden = true;
    getCommandHistory().clear();
    const city = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city');
    board.focus(city?.x ?? 7, city?.y ?? 16);
    notice(`${state.campaign.scenarioName} begun.`, 'good');
    renderChrome();
    paint();
  });
}

function onModalClick(event) {
  if (event.target.dataset.close || event.target === modal) {
    modal.hidden = true;
    return;
  }
  const slotId = event.target.dataset?.slot;
  if (!slotId) return;
  const slot = parseSaveSlots(localStorage.getItem(SAVE_SLOTS_KEY)).find((item) => item.id === slotId);
  if (!slot) return;
  state = deserializeState(slot.data);
  modal.hidden = true;
  buildType = null;
  const city = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city');
  board.focus(city?.x ?? 7, city?.y ?? 16);
  notice(`Loaded ${slot.name}.`, 'good');
  renderChrome();
  paint();
}

function notice(text, tone = 'info') {
  let toast = document.querySelector('#toast');
  if (!toast) {
    toast = document.createElement('p');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = `toast show ${tone}`;
  toast.textContent = text;
  window.clearTimeout(notice.timer);
  notice.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
