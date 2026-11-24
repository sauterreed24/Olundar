import { BUILDING_TYPES, DIFFICULTY_PRESETS, RESOURCE_NAMES, SCENARIOS, SUN_EDICTS, UNIT_TYPES } from '../content.js';
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
  formatCost,
  isEnemy,
  getAftermathMissions,
  getCrisisCouncil,
  getDiplomacyLedger,
  getEndTurnWarnings,
  getRallyForecast,
  getReadyOlundarUnits,
  getSunEdictStatus,
  getWarCouncil,
  isRevealed,
  isVisible,
  serializeState,
  unitAt,
  upgradeCostFor
} from '../rules.js';
import { createSaveSlot, defaultSaveSlotName, parseSaveSlots, serializeSaveSlots, upsertSaveSlot } from '../saveSlots.js';
import { initAudioPreference, playAudioCue, toggleAudio, audioIsEnabled } from '../audio.js';
import { BUILDING_SPRITE_ORDER, createBoard, hostsReaching, hoverSummary, loadUnitSprites, traceMovePath, UNIT_SPRITE_ORDER, visibleMarchAnchor, visibleThreats } from './board.js';

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
  resourcesEl.innerHTML = ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale']
    .map((id) => resourceChip(id, player.resources[id] ?? 0, RESOURCE_NAMES[id]))
    .join('') + resourceChip('people', `${player.population}/${player.housing}`, 'People');
  document.querySelector('#audioTop').textContent = audioIsEnabled() ? 'Audio on' : 'Audio';
  document.querySelector('#endTurn').textContent = endArmed ? 'End turn now' : 'End turn';
  renderDock();
}

function renderDock() {
  const glanceText = orderGlance();
  dock.innerHTML = `
    <div class="tabs">
      ${tabButton('field', 'Field')}
      ${tabButton('council', 'Council')}
      ${tabButton('diplomacy', 'Diplomacy')}
      ${tabButton('log', 'Log')}
    </div>
    <p id="glance" class="glance">${escapeHtml(glanceText)}</p>
    ${tab === 'field' ? fieldTab() : ''}
    ${tab === 'council' ? councilTab() : ''}
    ${tab === 'diplomacy' ? diplomacyTab() : ''}
    ${tab === 'log' ? logTab() : ''}
  `;
}

function selectedGlance() {
  const unit = state.units.find((item) => item.id === state.selectedUnitId);
  const building = state.buildings.find((item) => item.id === state.selectedBuildingId);
  if (unit) return `${unit.name} · ${unit.x},${unit.y}`;
  if (building) return `${building.name} · ${building.x},${building.y}`;
  const ready = getReadyOlundarUnits(state).length;
  return ready ? `${ready} gold pennants still owe an order.` : 'Select a unit, then choose a highlighted tile.';
}

function resourceChip(id, value, label) {
  return `<span class="res res-${id}">${RESOURCE_ICONS[id]}<span><b>${value}</b><em>${escapeHtml(label)}</em></span></span>`;
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
  if (buildType) {
    const name = BUILDING_TYPES[buildType].name;
    parts.push(board.buildSites().has(`${hover.x},${hover.y}`) ? `place ${name}` : `${name} will not stand here`);
    return parts.join(' · ');
  }
  const unit = state.units.find((item) => item.id === state.selectedUnitId);
  if (!unit || unit.hasActed || unit.faction !== 'olundar') return parts.join(' · ');
  if (field.has(`${hover.x},${hover.y}`)) {
    const hosts = hostsReaching(state, unit.faction, hover.x, hover.y, unit.id);
    parts.push(hosts.length ? `exposed to ${hosts.map((enemy) => enemy.name).join(', ')}` : 'covered');
  }
  if (isVisible(state, hover.x, hover.y)) {
    const enemy = unitAt(state, hover.x, hover.y);
    if (enemy && enemy.id !== unit.id) {
      const forecast = forecastUnitAttack(state, unit.id, enemy.id);
      if (forecast.ok) parts.push(forecast.lethal ? `${forecast.damage} damage, falls` : `${forecast.damage} damage, ${forecast.targetHpAfter} left`);
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
    const ready = getReadyOlundarUnits(state).length;
    return `<section class="card"><h2>The valley holds</h2><p>${ready} unit${ready === 1 ? '' : 's'} still have orders. Select one on the map, or press N.</p><p class="note">Gold pennants still owe an order. Gold steps are walks, crimson steps are exposed, and a red bracket can be struck.</p>${buildHint()}</section>`;
  }
  if (unit) return unitCard(unit);
  return buildingCard(building);
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
  return `
    <section class="card unit-card">
      <div class="unit-head">
        ${unitPortrait(unit)}
        <div>
          <h2>${escapeHtml(unit.name)}</h2>
          <p class="role">${escapeHtml(def.role)}</p>
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
      ${rally ? `<p class="note">${escapeHtml(rally)}</p>` : ''}
      ${unit.fortified > 0 ? '<p class="note">Fortified. The guard holds until this unit moves or strikes.</p>' : ''}
      ${threatLine(unit)}
      ${mine && !unit.hasActed ? '<p class="note">The pennant means this order is still open. Crimson steps are exposed. A red bracket can be struck.</p>' : ''}
      ${buildType ? `<p class="note">The ghost shows where ${escapeHtml(BUILDING_TYPES[buildType].name)} can rise. A red wash will not take it.</p>` : ''}
      <div class="actions">
        ${mine && !unit.hasActed ? `<button type="button" data-cmd="fortify">Fortify</button>` : ''}
        ${mine && unit.type === 'engineer' && !unit.hasActed ? buildButtons() : ''}
        ${buildType ? `<button type="button" data-cmd="cancel-build">Cancel build</button>` : ''}
      </div>
    </section>
  `;
}

function buildingCard(building) {
  const def = BUILDING_TYPES[building.type];
  const mine = building.faction === 'olundar';
  const trains = mine && building.turnsLeft <= 0 ? def.trains.map((type) => {
    const unit = UNIT_TYPES[type];
    return `<button type="button" data-cmd="train" data-unit="${type}">Train ${escapeHtml(unit.name)} · ${escapeHtml(formatCost(unit.cost))}</button>`;
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
      ${building.turnsLeft > 0 ? `<p class="note">Finishes in ${building.turnsLeft} turn${building.turnsLeft === 1 ? '' : 's'}.</p>` : ''}
      <div class="actions">
        ${trains}
        ${mine && building.turnsLeft <= 0 ? `<button type="button" data-cmd="upgrade">Upgrade · ${escapeHtml(formatCost(upgradeCostFor(building)))}</button>` : ''}
      </div>
    </section>
  `;
}

function buildButtons() {
  return BUILD_ORDER.map((type) => {
    const def = BUILDING_TYPES[type];
    return `<button type="button" data-cmd="arm-build" data-building="${type}" ${buildType === type ? 'class="armed"' : ''}>${escapeHtml(def.name)} · ${escapeHtml(formatCost(def.cost))}</button>`;
  }).join('');
}

function buildHint() {
  return buildType ? `<p class="note">The ghost shows where ${escapeHtml(BUILDING_TYPES[buildType].name)} can rise. A red wash will not take it.</p>` : '';
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
        ${Object.values(SUN_EDICTS).map((edict) => `<button type="button" data-cmd="edict" data-edict="${edict.id}" ${edicts.ready ? '' : 'disabled'}>${escapeHtml(edict.name)} · ${escapeHtml(formatCost(edict.cost))}</button>`).join('')}
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

function run(command) {
  const cue = motionCue(command);
  const result = executePlayerCommand(state, command);
  endArmed = false;
  notice(result?.reason || (result?.ok === false ? 'That order failed.' : 'Done.'), result?.ok === false ? 'bad' : 'good');
  if (result?.ok !== false) {
    playAudioCue('ui');
    playCue(cue, result);
    handOffSpentUnit();
  }
  const focus = state.units.find((unit) => unit.id === state.selectedUnitId) || state.buildings.find((building) => building.id === state.selectedBuildingId);
  if (focus) board.ensureVisible(focus.x, focus.y);
  paint();
  renderChrome();
  return result;
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
  if (command.type === 'build') return { kind: 'rise', x: command.payload.x, y: command.payload.y, duration: 460 };
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
  if (!current?.hasActed) return;
  const ready = getReadyOlundarUnits(state);
  if (!ready.length) return;
  state.selectedUnitId = ready[0].id;
  state.selectedBuildingId = null;
  board.ensureVisible(ready[0].x, ready[0].y);
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

function requestEndTurn() {
  if (state.status !== 'playing') return;
  const warnings = getEndTurnWarnings(state);
  if (warnings.length && !endArmed) {
    endArmed = true;
    notice(warnings[0], 'info');
    renderChrome();
    return;
  }
  const before = state.units.map((unit) => ({ id: unit.id, x: unit.x, y: unit.y, type: unit.type, faction: unit.faction }));
  endTurn(state);
  const watch = playEnemyMarch(before);
  endArmed = false;
  buildType = null;
  getCommandHistory().clear();
  const marched = state.units.filter((unit) => {
    const prev = before.find((item) => item.id === unit.id);
    return unit.faction !== 'olundar' && prev && (prev.x !== unit.x || prev.y !== unit.y);
  }).length;
  notice(marched ? `Turn ${state.turn}. ${marched} hosts advance.` : `Turn ${state.turn}.`, 'good');
  playAudioCue('endTurn');
  if (watch) board.ensureVisible(watch.x, watch.y);
  else if (!state.selectedUnitId) {
    const city = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city');
    if (city) board.focus(city.x, city.y);
  }
  renderChrome();
  paint();
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
  renderChrome();
  paint();
}

function onKey(event) {
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
