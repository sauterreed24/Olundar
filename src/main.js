import { BUILDING_TYPES, DIFFICULTY_PRESETS, DIPLOMACY_ACTIONS, MAP_HEIGHT, MAP_LENSES, MAP_WIDTH, RESOURCE_NAMES, SCENARIOS, UNIT_TYPES } from './content.js';
import {
  attackBuilding,
  attackUnit,
  canAfford,
  canBuildOn,
  createGame,
  deserializeState,
  endTurn,
  formatCost,
  forecastBuildingAttack,
  forecastUnitAttack,
  fortifyUnit,
  getCampaignRecap,
  getDiplomacyLedger,
  getEndTurnWarnings,
  getFirstTurnsGuide,
  getObjectiveProgress,
  getReadyOlundarUnits,
  getSiegeOperations,
  getWarCouncil,
  trainingQueueLimit,
  trainingTurnsFor,
  moveUnit,
  performDiplomacy,
  serializeState,
  setFieldOrder,
  startConstruction,
  startTraining,
  upgradeBuilding,
  upgradeCostFor,
  unitAt,
  buildingAt,
  isEnemy,
  isVisible
} from './rules.js';
import { describeSelection, describeTilePanel, drawGame, pointToTile } from './render.js';
import { MAX_SAVE_SLOTS, createSaveSlot, defaultSaveSlotName, parseSaveSlots, removeSaveSlot, serializeSaveSlots, upsertSaveSlot } from './saveSlots.js';
import { importSaveSnapshot } from './saveTransfer.js';
import { audioIsEnabled, initAudioPreference, playAudioCue, setAudioVolume, toggleAudio } from './audio.js';
import { registerPwa } from './pwa.js';
import { DEFAULT_SETTINGS, MAP_SCALE_PRESETS, MOTION_MODES, getMapScalePreset, normalizeSettings, readSettings, saveSettings } from './settings.js';

const SAVE_KEY = 'olundar.deadwalker.prototype.save';
const SAVE_SLOTS_KEY = 'olundar.deadwalker.prototype.saveSlots';
const canvas = document.querySelector('#gameCanvas');
const mapLensBar = document.querySelector('#mapLensBar');
const resourceBar = document.querySelector('#resourceBar');
const turnLabel = document.querySelector('#turnLabel');
const objectiveList = document.querySelector('#objectiveList');
const councilPanel = document.querySelector('#councilPanel');
const guidePanel = document.querySelector('#guidePanel');
const operationsPanel = document.querySelector('#operationsPanel');
const selectionPanel = document.querySelector('#selectionPanel');
const actionPanel = document.querySelector('#actionPanel');
const diplomacyPanel = document.querySelector('#diplomacyPanel');
const logPanel = document.querySelector('#logPanel');
const tilePanel = document.querySelector('#tilePanel');
const modeBanner = document.querySelector('#modeBanner');
const toastEl = document.querySelector('#toast');
const setupOverlay = document.querySelector('#setupOverlay');
const campaignSetup = document.querySelector('#campaignSetup');
const saveOverlay = document.querySelector('#saveOverlay');
const saveManager = document.querySelector('#saveManager');
const saveImportInput = document.querySelector('#saveImportInput');
const settingsOverlay = document.querySelector('#settingsOverlay');
const settingsPanel = document.querySelector('#settingsPanel');
const recapOverlay = document.querySelector('#recapOverlay');
const recapPanel = document.querySelector('#recapPanel');
const audioTop = document.querySelector('#audioTop');

let state = createGame({ scenarioId: 'founding' });
let activeSaveSlotId = null;
let hoverTile = null;
let lastTile = { x: 7, y: 16 };
let toastTimer = null;
let playerSettings = readSettings();
let lastAutoRecapKey = null;
let activeMapLens = 'normal';

initAudioPreference();
applyPlayerSettings(playerSettings);
registerPwa();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  const mapScale = getMapScalePreset(playerSettings);
  const width = Math.max(320, parent.clientWidth);
  const idealHeight = width * (MAP_HEIGHT / MAP_WIDTH);
  const maxHeight = Math.max(mapScale.maxHeightFloor, window.innerHeight - mapScale.maxHeightOffset);
  const height = Math.max(mapScale.minHeight, Math.min(idealHeight, maxHeight));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.height = `${height}px`;
  render();
}

function render() {
  drawGame(canvas, state, hoverTile, activeMapLens);
  renderTopBar();
  renderMapLensBar();
  renderCouncil();
  renderGuide();
  renderOperations();
  renderObjectives();
  renderSelection();
  renderActions();
  renderDiplomacy();
  renderLog();
  renderTilePanel();
  renderMode();
  maybeOpenOutcomeRecap();
}

function renderTopBar() {
  const resources = state.factions.olundar.resources;
  const order = ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale'];
  resourceBar.innerHTML = [
    `<span class="resource population"><b>Population</b> ${state.factions.olundar.population}/${state.factions.olundar.housing}</span>`,
    ...order.map((key) => `<span class="resource"><b>${RESOURCE_NAMES[key]}</b> ${Math.floor(resources[key] || 0)}</span>`)
  ].join('');
  renderAudioButton();
  turnLabel.textContent = state.status === 'playing' ? `Turn ${state.turn}` : `${state.status === 'won' ? 'Victory' : 'Defeat'} · Turn ${state.turn}`;
}

function renderAudioButton() {
  const isEnabled = audioIsEnabled();
  audioTop.textContent = isEnabled ? 'Audio On' : 'Audio Off';
  audioTop.setAttribute('aria-pressed', String(isEnabled));
  audioTop.title = isEnabled ? 'Disable audio cues and ambient music' : 'Enable audio cues and ambient music';
}

function renderMapLensBar() {
  if (!mapLensBar) return;
  mapLensBar.innerHTML = '<span class="lens-label">Map lens</span>';
  const group = document.createElement('div');
  group.className = 'lens-buttons';
  for (const lens of Object.values(MAP_LENSES)) {
    const lensButton = button(lens.name, () => {
      activeMapLens = lens.id;
      toast(`${lens.name} lens.`);
      render();
    }, false, lens.text);
    lensButton.setAttribute('aria-pressed', String(activeMapLens === lens.id));
    if (activeMapLens === lens.id) lensButton.classList.add('active');
    group.appendChild(lensButton);
  }
  mapLensBar.appendChild(group);
}

function renderCouncil() {
  const council = getWarCouncil(state);
  councilPanel.innerHTML = `
    <h2>${escapeHtml(council.headline)}</h2>
    <p class="campaign-meta">${escapeHtml(council.campaign.scenarioName)} · ${escapeHtml(council.campaign.difficultyName)}</p>
    <div class="council-stats">
      ${council.stats.map((stat) => `<span><b>${escapeHtml(stat.value)}</b>${escapeHtml(stat.label)}</span>`).join('')}
    </div>
    <div class="priority-list">
      ${council.priorities.map((item) => `<p class="priority ${escapeHtml(item.tone)}">${escapeHtml(item.text)}</p>`).join('')}
    </div>
  `;
}

function renderGuide() {
  const guide = getFirstTurnsGuide(state);
  guidePanel.hidden = !guide.visible;
  if (!guide.visible) {
    guidePanel.innerHTML = '';
    return;
  }
  guidePanel.innerHTML = `
    <div class="guide-head">
      <div>
        <h2>${escapeHtml(guide.title)}</h2>
        <p>${escapeHtml(guide.phase)}</p>
      </div>
      <span>${guide.completed}/${guide.total}</span>
    </div>
    <p class="guide-summary">${escapeHtml(guide.summary)}</p>
    <ol class="guide-steps">
      ${guide.steps.map((step) => `
        <li class="${step.done ? 'done' : step.id === guide.currentId ? 'current' : ''}">
          <span class="step-status">${step.done ? 'Done' : step.id === guide.currentId ? 'Next' : 'Open'}</span>
          <strong>${escapeHtml(step.label)}</strong>
          <small>${escapeHtml(step.detail)}</small>
        </li>
      `).join('')}
    </ol>
  `;
}

function renderOperations() {
  const operations = getSiegeOperations(state);
  operationsPanel.hidden = !operations.visible;
  if (!operations.visible) {
    operationsPanel.innerHTML = '';
    return;
  }
  operationsPanel.innerHTML = `
    <div class="operations-head">
      <div>
        <h2>${escapeHtml(operations.title)}</h2>
        <p>${escapeHtml(operations.summary)}</p>
      </div>
      <span>${operations.completed}/${operations.total}</span>
    </div>
    <div class="operation-list">
      ${operations.operations.map((operation) => `
        <article class="operation ${escapeHtml(operation.tone)}">
          <span>${operation.done ? 'Done' : operation.tone === 'locked' ? 'Locked' : operation.tone === 'danger' ? 'Urgent' : 'Open'}</span>
          <strong>${escapeHtml(operation.label)}</strong>
          <small>${escapeHtml(operation.detail)}</small>
        </article>
      `).join('')}
    </div>
  `;
}

function renderObjectives() {
  objectiveList.innerHTML = '';
  const objectiveState = getObjectiveProgress(state);
  state.objectives.forEach((objective, i) => {
    const li = document.createElement('li');
    li.className = objectiveState[i].done ? 'done' : '';
    li.innerHTML = `<span>${escapeHtml(objective)}</span><small>${escapeHtml(objectiveState[i].detail)}</small>`;
    objectiveList.appendChild(li);
  });
}

function renderSelection() {
  const selection = describeSelection(state);
  if (!selection) {
    selectionPanel.innerHTML = '<h2>Command Seat</h2><p>Select a unit, city, or building. Scouts reveal the map; engineers build the economy; legions hold the line.</p>';
    return;
  }
  selectionPanel.innerHTML = `
    <h2>${escapeHtml(selection.title)}</h2>
    <p class="muted">${escapeHtml(selection.subtitle)}</p>
    <p>${escapeHtml(selection.body)}</p>
  `;
}

function renderActions() {
  actionPanel.innerHTML = '';
  const heading = document.createElement('h2');
  heading.textContent = 'Orders';
  actionPanel.appendChild(heading);

  if (state.status !== 'playing') {
    actionPanel.appendChild(button('Review campaign recap', () => openCampaignRecap('current')));
    actionPanel.appendChild(button('Save final campaign', () => openSaveManager('save')));
    actionPanel.appendChild(button('New campaign', () => newCampaign()));
    return;
  }

  const selectedUnit = state.units.find((u) => u.id === state.selectedUnitId);
  const selectedBuilding = state.buildings.find((b) => b.id === state.selectedBuildingId);

  if (!selectedUnit && !selectedBuilding) {
    actionPanel.appendChild(paragraph('Select an Olundaran unit or structure to issue orders.'));
  }

  if (selectedUnit) {
    const def = UNIT_TYPES[selectedUnit.type];
    actionPanel.appendChild(paragraph(`${def.name}: ${selectedUnit.hasActed ? 'acted this turn' : 'ready'}.`));
    actionPanel.appendChild(button('Fortify / Hold position', () => runAction(() => fortifyUnit(state, selectedUnit.id), 'select'), selectedUnit.hasActed || selectedUnit.faction !== 'olundar'));
    if (def.tags.includes('builder') && selectedUnit.faction === 'olundar') {
      const grid = document.createElement('div');
      grid.className = 'button-grid';
      const buildOrder = ['farm', 'lumberCamp', 'mine', 'road', 'watchtower', 'wall', 'barracks', 'archeryYard', 'stable', 'workshop', 'shrine', 'outpost'];
      for (const type of buildOrder) {
        const bDef = BUILDING_TYPES[type];
        const label = `${bDef.name} · ${formatCost(bDef.cost)} · ${bDef.buildTurns}t`;
        const disabled = selectedUnit.hasActed || !canAfford(state.factions.olundar.resources, bDef.cost);
        grid.appendChild(button(label, () => {
          state.mode = { type: 'build', buildingType: type, builderId: selectedUnit.id };
          playAudioCue('ui');
          toast(`Build mode: click ${bDef.name} on this tile or an adjacent tile.`);
          render();
        }, disabled));
      }
      actionPanel.appendChild(subheading('Build'));
      actionPanel.appendChild(grid);
    }
  }

  if (selectedBuilding) {
    const def = BUILDING_TYPES[selectedBuilding.type];
    actionPanel.appendChild(paragraph(`${def.name}: ${selectedBuilding.turnsLeft > 0 ? `under construction, ${selectedBuilding.turnsLeft} turns left` : `tier ${(selectedBuilding.upgraded || 0) + 1}, operational`}.`));
    if (selectedBuilding.faction === 'olundar' && selectedBuilding.turnsLeft <= 0 && def.trains.length) {
      const grid = document.createElement('div');
      grid.className = 'button-grid';
      for (const unitType of def.trains) {
        const uDef = UNIT_TYPES[unitType];
        const turns = trainingTurnsFor(selectedBuilding, unitType);
        const disabled = selectedBuilding.queue.length >= trainingQueueLimit(selectedBuilding) || !canAfford(state.factions.olundar.resources, uDef.cost);
        grid.appendChild(button(`${uDef.name} · ${formatCost(uDef.cost)} · ${turns}t`, () => runAction(() => startTraining(state, selectedBuilding.id, unitType), 'train'), disabled));
      }
      actionPanel.appendChild(subheading('Train'));
      actionPanel.appendChild(paragraph(`Queue ${selectedBuilding.queue.length}/${trainingQueueLimit(selectedBuilding)}. Upgrades increase capacity and speed elite musters.`));
      actionPanel.appendChild(grid);
    }
    if (selectedBuilding.faction === 'olundar' && selectedBuilding.turnsLeft <= 0 && (selectedBuilding.upgraded || 0) < 2) {
      const cost = upgradeCostFor(selectedBuilding);
      actionPanel.appendChild(subheading('Upgrade'));
      actionPanel.appendChild(button(`Upgrade to tier ${(selectedBuilding.upgraded || 0) + 2} · ${formatCost(cost)}`, () => runAction(() => upgradeBuilding(state, selectedBuilding.id), 'build'), !canAfford(state.factions.olundar.resources, cost)));
    }
  }

  actionPanel.appendChild(subheading('Campaign'));
  actionPanel.appendChild(button('Next ready unit', () => selectNextReadyUnit(), !getReadyOlundarUnits(state).length));
  actionPanel.appendChild(button('End turn', () => requestEndTurn()));
  actionPanel.appendChild(button('Save / slots', () => openSaveManager('save')));
  actionPanel.appendChild(button('Load campaign', () => openSaveManager('load')));
  actionPanel.appendChild(button('New campaign', () => newCampaign()));
  actionPanel.appendChild(button('Export save file', () => exportSave()));
  actionPanel.appendChild(button('Import save file', () => openImportSaveFile()));
}

function renderDiplomacy() {
  const ledger = getDiplomacyLedger(state);
  diplomacyPanel.innerHTML = `
    <h2>${escapeHtml(ledger.title)}</h2>
    <p class="ledger-summary">${escapeHtml(ledger.summary)}</p>
    <div class="ledger-stats">
      ${ledger.stats.map((stat) => `<span><b>${escapeHtml(stat.value)}</b>${escapeHtml(stat.label)}</span>`).join('')}
    </div>
  `;
  const list = document.createElement('div');
  list.className = 'diplo-ledger-list';
  for (const entry of ledger.entries) {
    const card = document.createElement('div');
    card.className = `diplo-card ${entry.discovered ? 'known' : 'unknown'} ${entry.posture.tone}`;
    card.innerHTML = `
      <div class="diplo-head">
        <h3>${entry.banner} ${escapeHtml(entry.name)}</h3>
        <span class="${escapeHtml(entry.posture.tone)}">${escapeHtml(entry.posture.label)}</span>
      </div>
      <p>${escapeHtml(entry.discovered ? entry.text : `${entry.name} has not been contacted yet.`)}</p>
      <div class="ledger-tags">
        ${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
      </div>
      <p class="diplo-advice">${escapeHtml(entry.advice)}</p>
      ${entry.recent.length ? `
        <div class="diplo-recent">
          ${entry.recent.map((record) => `<p><b>T${record.turn} ${escapeHtml(record.outcome)}:</b> ${escapeHtml(record.detail)}</p>`).join('')}
        </div>
      ` : ''}
    `;
    if (entry.discovered && state.status === 'playing') {
      if (entry.pact) {
        const orderBlock = document.createElement('div');
        orderBlock.className = 'field-orders';
        orderBlock.innerHTML = `<strong>Field Orders</strong><p>${escapeHtml(entry.fieldOrder?.text || 'Choose how this pact ally should help the front.')}</p>`;
        const orderRow = document.createElement('div');
        orderRow.className = 'field-order-buttons';
        for (const order of entry.fieldOrders) {
          orderRow.appendChild(button(order.active ? `${order.name} active` : order.name, () => runAction(() => setFieldOrder(state, entry.id, order.id), 'diplomacy'), order.disabled || order.active, order.disabledReason || order.text));
        }
        orderBlock.appendChild(orderRow);
        card.appendChild(orderBlock);
      }
      const row = document.createElement('div');
      row.className = 'button-grid diplo-actions';
      for (const action of entry.actions) {
        row.appendChild(button(`${action.name} - ${action.cost}`, () => runAction(() => performDiplomacy(state, entry.id, action.id), 'diplomacy'), action.disabled, action.disabledReason || action.note));
      }
      card.appendChild(row);
    }
    list.appendChild(card);
  }
  diplomacyPanel.appendChild(list);
}

function renderLegacyDiplomacy() {
  diplomacyPanel.innerHTML = '<h2>Diplomacy</h2>';
  const discovered = ['dawn', 'veyr', 'mire'].filter((id) => state.factions[id].discovered);
  if (!discovered.length) {
    diplomacyPanel.appendChild(paragraph('No living civilizations discovered yet. Send scouts, build watchtowers, and follow roads through the fog.'));
    return;
  }
  for (const id of discovered) {
    const faction = state.factions[id];
    const relation = state.factions.olundar.relations[id] ?? 0;
    const card = document.createElement('div');
    card.className = 'diplo-card';
    const pact = state.factions.olundar.pacts[id] ? ' · Survival Pact' : '';
    const trade = state.factions.olundar.trades[id] ? ' · Trade' : '';
    card.innerHTML = `<h3>${faction.banner} ${faction.name}</h3><p>${escapeHtml(faction.text)}</p><p><strong>Relation:</strong> ${relation}${pact}${trade}</p>`;
    const row = document.createElement('div');
    row.className = 'button-grid';
    for (const actionId of Object.keys(DIPLOMACY_ACTIONS)) {
      const action = DIPLOMACY_ACTIONS[actionId];
      row.appendChild(button(`${action.name} · ${formatCost(action.cost)}`, () => runAction(() => performDiplomacy(state, id, actionId), 'diplomacy'), !canAfford(state.factions.olundar.resources, action.cost)));
    }
    card.appendChild(row);
    diplomacyPanel.appendChild(card);
  }
}

function renderLog() {
  logPanel.innerHTML = '<h2>War Chronicle</h2>';
  const list = document.createElement('div');
  list.className = 'log-list';
  for (const message of state.messages.slice(0, 10)) {
    const item = document.createElement('p');
    item.className = `log ${message.tone || 'info'}`;
    item.innerHTML = `<span>T${message.turn}</span> ${escapeHtml(message.text)}`;
    list.appendChild(item);
  }
  logPanel.appendChild(list);
}

function renderTilePanel() {
  const tile = hoverTile || lastTile;
  let body = describeTilePanel(state, tile.x, tile.y);
  if (state.mode.type === 'build' && inMap(tile.x, tile.y)) {
    const def = BUILDING_TYPES[state.mode.buildingType];
    const result = canBuildOn(state, state.mode.buildingType, tile.x, tile.y);
    body += `<div class="build-readout ${result.ok ? 'good' : 'bad'}"><strong>${escapeHtml(def.name)}:</strong> ${escapeHtml(result.ok ? 'Valid build site.' : result.reason)}</div>`;
  }
  body += battleForecastReadout(tile);
  tilePanel.innerHTML = body;
}

function battleForecastReadout(tile) {
  if (!tile || !inMap(tile.x, tile.y) || !isVisible(state, tile.x, tile.y) || state.mode.type !== 'select') return '';
  const selectedUnit = state.units.find((u) => u.id === state.selectedUnitId);
  if (!selectedUnit || selectedUnit.faction !== 'olundar') return '';
  const visibleUnit = unitAt(state, tile.x, tile.y);
  const visibleBuilding = buildingAt(state, tile.x, tile.y);
  let forecast = null;
  if (visibleUnit && visibleUnit.id !== selectedUnit.id && isEnemy(state, selectedUnit.faction, visibleUnit.faction)) {
    forecast = forecastUnitAttack(state, selectedUnit.id, visibleUnit.id);
  } else if (visibleBuilding && isEnemy(state, selectedUnit.faction, visibleBuilding.faction)) {
    forecast = forecastBuildingAttack(state, selectedUnit.id, visibleBuilding.id);
  }
  if (!forecast) return '';
  return formatBattleForecast(forecast);
}

function formatBattleForecast(forecast) {
  const title = forecast.ok ? `Attack Forecast: ${forecast.targetName}` : 'Attack Forecast';
  if (!forecast.ok) {
    return `<div class="battle-forecast bad"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(forecast.reason)}</p></div>`;
  }
  const tone = forecast.portalReforms ? 'bad' : forecast.lethal ? 'good' : 'info';
  const hpText = forecast.portalReforms
    ? `${forecast.targetHpBefore} -> reforms to ${forecast.targetHpAfter}`
    : `${forecast.targetHpBefore} -> ${forecast.targetHpAfter}`;
  const detail = forecast.type === 'building' && forecast.siege
    ? 'Siege bonus included.'
    : forecast.type === 'unit' && (forecast.terrainDefense || forecast.fortified)
      ? `Defense: ${forecast.armor + forecast.terrainDefense + forecast.fortified}`
      : `Range: ${forecast.distance}/${forecast.range}`;
  return `
    <div class="battle-forecast ${tone}">
      <strong>${escapeHtml(title)}</strong>
      <div class="forecast-grid">
        <span><b>${forecast.damage}</b>damage</span>
        <span><b>${escapeHtml(hpText)}</b>target HP</span>
        <span><b>${forecast.distance}/${forecast.range}</b>range</span>
      </div>
      <p>${escapeHtml(detail)}</p>
      <small>${escapeHtml(forecast.note)}</small>
    </div>
  `;
}

function renderMode() {
  if (state.mode.type === 'build') {
    const def = BUILDING_TYPES[state.mode.buildingType];
    modeBanner.textContent = `Build mode: ${def.name}. Click the engineer's tile or an adjacent valid tile. Esc cancels.`;
    modeBanner.hidden = false;
  } else {
    modeBanner.hidden = true;
  }
}

function canvasClicked(event) {
  const tile = pointToTile(canvas, event.clientX, event.clientY);
  if (!inMap(tile.x, tile.y)) return;
  lastTile = tile;

  if (state.status !== 'playing') return;

  if (state.mode.type === 'build') {
    const result = startConstruction(state, state.mode.builderId, state.mode.buildingType, tile.x, tile.y);
    state.mode = { type: 'select' };
    handleResult(result, 'build');
    render();
    return;
  }

  const visibleUnit = isVisible(state, tile.x, tile.y) ? unitAt(state, tile.x, tile.y) : null;
  const visibleBuilding = isVisible(state, tile.x, tile.y) ? buildingAt(state, tile.x, tile.y) : null;
  const selectedUnit = state.units.find((u) => u.id === state.selectedUnitId);

  if (selectedUnit && visibleUnit && visibleUnit.id !== selectedUnit.id && isEnemy(state, selectedUnit.faction, visibleUnit.faction)) {
    handleResult(attackUnit(state, selectedUnit.id, visibleUnit.id), 'attack');
    render();
    return;
  }

  if (selectedUnit && visibleBuilding && isEnemy(state, selectedUnit.faction, visibleBuilding.faction)) {
    handleResult(attackBuilding(state, selectedUnit.id, visibleBuilding.id), 'attack');
    render();
    return;
  }

  if (visibleUnit && visibleUnit.faction === 'olundar') {
    selectUnit(visibleUnit.id);
    playAudioCue('select');
    render();
    return;
  }

  if (visibleBuilding && visibleBuilding.faction === 'olundar') {
    selectBuilding(visibleBuilding.id);
    playAudioCue('select');
    render();
    return;
  }

  if (selectedUnit && selectedUnit.faction === 'olundar') {
    handleResult(moveUnit(state, selectedUnit.id, tile.x, tile.y), 'move');
    render();
    return;
  }

  state.selectedUnitId = null;
  state.selectedBuildingId = null;
  render();
}

function selectUnit(id) {
  state.selectedUnitId = id;
  state.selectedBuildingId = null;
  state.mode = { type: 'select' };
}

function selectBuilding(id) {
  state.selectedBuildingId = id;
  state.selectedUnitId = null;
  state.mode = { type: 'select' };
}

function runAction(action, successCue = 'ui') {
  const result = action();
  handleResult(result, successCue);
  render();
}

function handleResult(result, successCue = null) {
  if (!result) return false;
  if (!result.ok) {
    if (result.reason) toast(result.reason, 'bad');
    playAudioCue('error');
    return false;
  }
  if (result.reason) toast(result.reason);
  if (successCue) playAudioCue(successCue);
  return true;
}

function requestEndTurn(force = false) {
  if (!force && state.pendingEndTurn === state.turn) force = true;
  const warnings = getEndTurnWarnings(state);
  if (!force && warnings.length) {
    toast(`${warnings[0]} Press End Turn again to confirm.`, 'bad');
    playAudioCue('warning');
    state.pendingEndTurn = state.turn;
    render();
    return;
  }
  state.pendingEndTurn = null;
  state.mode = { type: 'select' };
  endTurn(state);
  toast('Turn resolved. The world moves.');
  playAudioCue('turn');
  render();
}

function selectNextReadyUnit() {
  const [unit] = getReadyOlundarUnits(state);
  if (!unit) {
    toast('No ready Olundaran units remain.');
    playAudioCue('warning');
    return;
  }
  selectUnit(unit.id);
  lastTile = { x: unit.x, y: unit.y };
  toast(`${unit.name} is ready.`);
  playAudioCue('select');
  render();
}

function readSaveSlots() {
  return parseSaveSlots(localStorage.getItem(SAVE_SLOTS_KEY));
}

function writeSaveSlots(slots) {
  localStorage.setItem(SAVE_SLOTS_KEY, serializeSaveSlots(slots));
}

function saveGame(name = null, slotId = activeSaveSlotId) {
  const serialized = serializeState(state);
  const currentSlots = readSaveSlots();
  const existing = currentSlots.find((slot) => slot.id === slotId);
  const slot = createSaveSlot(state, serialized, { id: existing?.id, name: name || existing?.name || defaultSaveSlotName(state) });
  activeSaveSlotId = slot.id;
  writeSaveSlots(upsertSaveSlot(currentSlots, slot));
  localStorage.setItem(SAVE_KEY, serialized);
  toast(`Saved ${slot.name}.`);
  playAudioCue('save');
  return slot;
}

function loadSerializedGame(raw, slot = null) {
  try {
    state = deserializeState(raw);
    activeSaveSlotId = slot?.id || null;
    focusCampaign();
    localStorage.setItem(SAVE_KEY, raw);
    toast(slot ? `Loaded ${slot.name}.` : 'Campaign loaded.');
    playAudioCue('load');
    render();
  } catch (error) {
    toast(error.message || 'Save failed to load.', 'bad');
    playAudioCue('error');
  }
}

function loadGame(slotId = null) {
  const slots = readSaveSlots();
  const slot = slotId ? slots.find((item) => item.id === slotId) : slots.find((item) => item.id === activeSaveSlotId) || slots[0];
  if (slot) {
    loadSerializedGame(slot.data, slot);
    return;
  }
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    toast('No local save found.', 'bad');
    return;
  }
  loadSerializedGame(raw);
}

function importSaveFile(raw, fileName = '') {
  try {
    const imported = importSaveSnapshot(raw, { fileName });
    state = imported.state;
    activeSaveSlotId = imported.slot.id;
    writeSaveSlots(upsertSaveSlot(readSaveSlots(), imported.slot));
    localStorage.setItem(SAVE_KEY, imported.serialized);
    focusCampaign();
    closeSaveManager();
    const outcomeKey = campaignOutcomeKey();
    if (outcomeKey) lastAutoRecapKey = outcomeKey;
    toast(`${imported.slot.name} loaded.`);
    playAudioCue('load');
    render();
    openCampaignRecap('import');
    return imported.slot;
  } catch (error) {
    toast(error.message || 'Save file failed to import.', 'bad');
    playAudioCue('error');
    return null;
  }
}

function newCampaign() {
  openCampaignSetup();
}

function openCampaignSetup() {
  renderCampaignSetup();
  setupOverlay.hidden = false;
  playAudioCue('ui');
}

function closeCampaignSetup() {
  setupOverlay.hidden = true;
}

function openSaveManager(mode = 'save') {
  renderSaveManager(mode);
  saveOverlay.hidden = false;
  playAudioCue('ui');
}

function closeSaveManager() {
  saveOverlay.hidden = true;
}

function openImportSaveFile() {
  saveImportInput.value = '';
  saveImportInput.click();
  playAudioCue('ui');
}

function openSettings() {
  renderSettingsPanel();
  settingsOverlay.hidden = false;
  playAudioCue('ui');
}

function closeSettings() {
  settingsOverlay.hidden = true;
  setAudioVolume(playerSettings.audioVolume);
}

function openCampaignRecap(context = 'current') {
  renderRecapPanel(context);
  recapOverlay.hidden = false;
  playAudioCue(state.status === 'won' ? 'fanfare' : 'ui');
}

function closeCampaignRecap() {
  recapOverlay.hidden = true;
}

function maybeOpenOutcomeRecap() {
  const key = campaignOutcomeKey();
  if (!key || lastAutoRecapKey === key || !recapOverlay.hidden) return;
  lastAutoRecapKey = key;
  openCampaignRecap('current');
}

function campaignOutcomeKey() {
  if (state.status === 'playing') return null;
  return `${state.status}:${state.winner || 'none'}:${state.turn}:${state.messages[0]?.text || ''}`;
}

function renderRecapPanel(context = 'current') {
  const recap = getCampaignRecap(state, context);
  recapPanel.innerHTML = `
    <div class="setup-head">
      <div>
        <h2 id="recapTitle">${escapeHtml(recap.title)}</h2>
        <p>${escapeHtml(recap.subtitle)}</p>
      </div>
      <button class="icon-button" type="button" data-action="close-recap" aria-label="Close campaign recap">X</button>
    </div>
    <div class="recap-banner ${escapeHtml(recap.tone)}">
      <strong>${escapeHtml(recap.statusLabel)}</strong>
      <p>${escapeHtml(recap.summary)}</p>
    </div>
    <div class="recap-stats">
      ${recap.stats.map((stat) => `<span><b>${escapeHtml(stat.value)}</b>${escapeHtml(stat.label)}</span>`).join('')}
    </div>
    <div class="recap-details">
      ${recap.details.map((detail) => `<p>${escapeHtml(detail)}</p>`).join('')}
    </div>
    <h3>Campaign Milestones</h3>
    <div class="recap-milestones">
      ${recap.milestones.map((milestone) => `
        <article class="${milestone.done ? 'done' : ''}">
          <span>${milestone.done ? 'Done' : 'Open'}</span>
          <strong>${escapeHtml(milestone.label)}</strong>
          <small>${escapeHtml(milestone.detail)}</small>
        </article>
      `).join('')}
    </div>
    <h3>${state.status === 'playing' ? 'Resume With' : 'After-Action Advice'}</h3>
    <ol class="recap-next">
      ${recap.nextSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
    </ol>
    <div class="setup-actions">
      <button type="button" data-action="close-recap">${state.status === 'playing' ? 'Return to campaign' : 'Close'}</button>
      <button type="button" data-action="save-campaign">Save campaign</button>
      <button type="button" data-action="new-campaign">New campaign</button>
    </div>
  `;
}

function renderSettingsPanel() {
  const settings = normalizeSettings(playerSettings);
  settingsPanel.innerHTML = `
    <div class="setup-head">
      <div>
        <h2 id="settingsTitle">Settings</h2>
        <p>Player comfort and device fit</p>
      </div>
      <button class="icon-button" type="button" data-action="close-settings" aria-label="Close settings">X</button>
    </div>
    <label class="setup-field volume-field">
      <span>Audio volume <b id="volumeValue">${settings.audioVolume}%</b></span>
      <input id="audioVolume" name="audioVolume" type="range" min="0" max="100" step="1" value="${settings.audioVolume}" />
    </label>
    <h3>Motion</h3>
    <div class="card-grid settings-grid">
      ${Object.values(MOTION_MODES).map((item) => choiceCard('motion', item.id, item.label, item.text, item.id === settings.motion)).join('')}
    </div>
    <h3>Map Scale</h3>
    <div class="card-grid settings-grid">
      ${Object.values(MAP_SCALE_PRESETS).map((item) => choiceCard('mapScale', item.id, item.label, item.text, item.id === settings.mapScale)).join('')}
    </div>
    <div class="setup-actions">
      <button type="submit">Apply Settings</button>
      <button type="button" data-action="reset-settings">Reset</button>
      <button type="button" data-action="close-settings">Cancel</button>
    </div>
  `;
}

function applyPlayerSettings(settings) {
  playerSettings = normalizeSettings(settings);
  setAudioVolume(playerSettings.audioVolume);
  document.body.classList.toggle('reduced-motion', playerSettings.motion === 'reduced');
}

function persistPlayerSettings(settings) {
  applyPlayerSettings(saveSettings(settings));
}

function renderSaveManager(mode = 'save') {
  const slots = readSaveSlots();
  const active = slots.find((slot) => slot.id === activeSaveSlotId);
  const legacyRaw = localStorage.getItem(SAVE_KEY);
  const hasLegacy = Boolean(legacyRaw && !slots.some((slot) => slot.data === legacyRaw));
  const slotName = active?.name || defaultSaveSlotName(state);
  saveManager.innerHTML = `
    <div class="setup-head">
      <div>
        <h2 id="saveManagerTitle">${mode === 'load' ? 'Load Campaign' : 'Save Campaign'}</h2>
        <p>${slots.length}/${MAX_SAVE_SLOTS} named slots used${active ? ` · Active: ${escapeHtml(active.name)}` : ''}</p>
      </div>
      <button class="icon-button" type="button" data-action="close-save" aria-label="Close save manager">X</button>
    </div>
    <label class="setup-field">
      <span>Slot name</span>
      <input id="saveSlotName" name="slotName" value="${escapeHtml(slotName)}" autocomplete="off" maxlength="48" />
    </label>
    <div class="setup-actions save-primary-actions">
      <button type="submit">Save Current Campaign</button>
      <button type="button" data-action="load-latest" ${slots.length ? '' : 'disabled'}>Load Latest</button>
      <button type="button" data-action="import-file">Import JSON</button>
      <button type="button" data-action="close-save">Cancel</button>
    </div>
    <h3>Named Slots</h3>
    <div class="save-slot-list">
      ${slots.length ? slots.map((slot) => saveSlotCard(slot)).join('') : '<p class="muted">No named campaign slots yet. Save the current campaign to create one.</p>'}
      ${hasLegacy ? legacySaveCard() : ''}
    </div>
  `;
}

function saveSlotCard(slot) {
  const active = slot.id === activeSaveSlotId ? ' active' : '';
  return `
    <article class="save-slot${active}">
      <div>
        <strong>${escapeHtml(slot.name)}</strong>
        <span>${escapeHtml(slot.scenarioName)} · ${escapeHtml(slot.difficultyName)} · Turn ${escapeHtml(slot.turn)}</span>
        <small>${escapeHtml(formatSavedAt(slot.savedAt))} · ${escapeHtml(slot.seed)} · ${escapeHtml(slot.status)}</small>
      </div>
      <div class="slot-actions">
        <button type="button" data-action="load-slot" data-slot-id="${escapeHtml(slot.id)}">Load</button>
        <button type="button" data-action="overwrite-slot" data-slot-id="${escapeHtml(slot.id)}">Overwrite</button>
        <button type="button" data-action="delete-slot" data-slot-id="${escapeHtml(slot.id)}">Delete</button>
      </div>
    </article>
  `;
}

function legacySaveCard() {
  return `
    <article class="save-slot legacy">
      <div>
        <strong>Legacy quick save</strong>
        <span>Single-slot save from an earlier build</span>
        <small>Load it, then save into a named slot.</small>
      </div>
      <div class="slot-actions">
        <button type="button" data-action="load-legacy">Load</button>
      </div>
    </article>
  `;
}

function formatSavedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function renderCampaignSetup(selectedScenarioId = state.campaign?.scenarioId || 'founding', selectedDifficultyId = state.campaign?.difficultyId || SCENARIOS[selectedScenarioId]?.difficultyId || 'standard', seedOverride = null) {
  const scenario = SCENARIOS[selectedScenarioId] || SCENARIOS.founding;
  const difficultyId = DIFFICULTY_PRESETS[selectedDifficultyId] ? selectedDifficultyId : scenario.difficultyId;
  const seedValue = seedOverride || scenario.seed;
  campaignSetup.innerHTML = `
    <div class="setup-head">
      <div>
        <h2 id="campaignSetupTitle">New Campaign</h2>
        <p>${escapeHtml(scenario.name)} · ${escapeHtml(DIFFICULTY_PRESETS[difficultyId].name)}</p>
      </div>
      <button class="icon-button" type="button" data-action="close-setup" aria-label="Close campaign setup">X</button>
    </div>
    <label class="setup-field">
      <span>Seed</span>
      <input id="campaignSeed" name="seed" value="${escapeHtml(seedValue)}" autocomplete="off" />
    </label>
    <h3>Scenario</h3>
    <div class="card-grid">
      ${Object.values(SCENARIOS).map((item) => choiceCard('scenarioId', item.id, item.name, item.text, item.id === selectedScenarioId)).join('')}
    </div>
    <h3>Difficulty</h3>
    <div class="card-grid difficulty-grid">
      ${Object.values(DIFFICULTY_PRESETS).map((item) => choiceCard('difficultyId', item.id, item.name, item.text, item.id === difficultyId)).join('')}
    </div>
    <div class="setup-actions">
      <button type="submit">Start Campaign</button>
      <button type="button" data-action="close-setup">Cancel</button>
    </div>
  `;
}

function choiceCard(name, value, title, text, checked) {
  return `
    <label class="choice-card ${checked ? 'selected' : ''}">
      <input type="radio" name="${name}" value="${escapeHtml(value)}" ${checked ? 'checked' : ''} />
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(text)}</span>
    </label>
  `;
}

function startConfiguredCampaign(form) {
  const data = new FormData(form);
  const scenarioId = data.get('scenarioId') || 'founding';
  const scenario = SCENARIOS[scenarioId] || SCENARIOS.founding;
  const difficultyId = data.get('difficultyId') || scenario.difficultyId || 'standard';
  const seed = String(data.get('seed') || scenario.seed).trim() || scenario.seed;
  state = createGame({ scenarioId, difficultyId, seed });
  activeSaveSlotId = null;
  hoverTile = null;
  lastTile = { x: 7, y: 16 };
  lastAutoRecapKey = null;
  closeCampaignRecap();
  closeCampaignSetup();
  toast(`${state.campaign.scenarioName} started on ${state.campaign.difficultyName}.`);
  playAudioCue('fanfare');
  render();
}

function exportSave() {
  const blob = new Blob([serializeState(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `olundar-save-turn-${state.turn}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  playAudioCue('save');
}

function focusCampaign() {
  const selected = state.units.find((unit) => unit.id === state.selectedUnitId)
    || state.buildings.find((building) => building.id === state.selectedBuildingId)
    || state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city')
    || state.units.find((unit) => unit.faction === 'olundar');
  if (selected) lastTile = { x: selected.x, y: selected.y };
  hoverTile = null;
}

function hasBuilding(type) {
  return state.buildings.some((b) => b.faction === 'olundar' && b.type === type && b.turnsLeft <= 0);
}

function button(label, onClick, disabled = false, title = '') {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.disabled = disabled;
  if (title) el.title = title;
  el.addEventListener('click', onClick);
  return el;
}

function paragraph(text) {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function subheading(text) {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

function toast(text, tone = 'good') {
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.className = `toast show ${tone}`;
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 2400);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function inMap(x, y) {
  return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
}

canvas.addEventListener('click', canvasClicked);
canvas.addEventListener('mousemove', (event) => {
  const tile = pointToTile(canvas, event.clientX, event.clientY);
  if (!inMap(tile.x, tile.y)) {
    hoverTile = null;
  } else {
    hoverTile = tile;
    lastTile = tile;
  }
  renderTilePanel();
  drawGame(canvas, state, hoverTile, activeMapLens);
});
canvas.addEventListener('mouseleave', () => {
  hoverTile = null;
  render();
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !recapOverlay.hidden) {
    closeCampaignRecap();
    return;
  }
  if (event.key === 'Escape' && !saveOverlay.hidden) {
    closeSaveManager();
    return;
  }
  if (event.key === 'Escape' && !settingsOverlay.hidden) {
    closeSettings();
    return;
  }
  if (event.key === 'Escape' && !setupOverlay.hidden) {
    closeCampaignSetup();
    return;
  }
  if (event.key === 'Escape') {
    state.mode = { type: 'select' };
    render();
  } else if (event.key.toLowerCase() === 'e') {
    requestEndTurn(event.shiftKey);
  } else if (event.key.toLowerCase() === 'n') {
    selectNextReadyUnit();
  } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    saveGame();
  } else if (event.key.toLowerCase() === 'l' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    openSaveManager('load');
  }
});

document.querySelector('#endTurnTop').addEventListener('click', () => {
  requestEndTurn(state.pendingEndTurn === state.turn);
});
document.querySelector('#nextUnitTop').addEventListener('click', () => selectNextReadyUnit());
audioTop.addEventListener('click', () => {
  const isEnabled = toggleAudio();
  renderAudioButton();
  toast(isEnabled ? 'Audio enabled.' : 'Audio muted.');
  if (isEnabled) playAudioCue('fanfare');
});
document.querySelector('#newTop').addEventListener('click', () => newCampaign());
document.querySelector('#saveTop').addEventListener('click', () => openSaveManager('save'));
document.querySelector('#loadTop').addEventListener('click', () => openSaveManager('load'));
document.querySelector('#settingsTop').addEventListener('click', () => openSettings());

setupOverlay.addEventListener('click', (event) => {
  if (event.target === setupOverlay) closeCampaignSetup();
});

campaignSetup.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.action === 'close-setup') closeCampaignSetup();
});

campaignSetup.addEventListener('change', (event) => {
  const data = new FormData(campaignSetup);
  const scenarioId = data.get('scenarioId') || 'founding';
  const scenario = SCENARIOS[scenarioId] || SCENARIOS.founding;
  const scenarioChanged = event.target instanceof HTMLInputElement && event.target.name === 'scenarioId';
  const difficultyId = scenarioChanged ? (scenario.difficultyId || 'standard') : (data.get('difficultyId') || scenario.difficultyId || 'standard');
  const seed = event.target instanceof HTMLInputElement && event.target.name === 'scenarioId'
    ? scenario.seed
    : String(data.get('seed') || scenario.seed);
  renderCampaignSetup(scenarioId, difficultyId, seed);
});

campaignSetup.addEventListener('submit', (event) => {
  event.preventDefault();
  startConfiguredCampaign(campaignSetup);
});

saveOverlay.addEventListener('click', (event) => {
  if (event.target === saveOverlay) closeSaveManager();
});

settingsOverlay.addEventListener('click', (event) => {
  if (event.target === settingsOverlay) closeSettings();
});

recapOverlay.addEventListener('click', (event) => {
  if (event.target === recapOverlay) closeCampaignRecap();
});

recapPanel.addEventListener('click', (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const action = event.target.dataset.action;
  if (action === 'close-recap') {
    closeCampaignRecap();
  } else if (action === 'save-campaign') {
    closeCampaignRecap();
    openSaveManager('save');
  } else if (action === 'new-campaign') {
    closeCampaignRecap();
    newCampaign();
  }
});

saveManager.addEventListener('click', (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const action = event.target.dataset.action;
  if (!action) return;
  if (action === 'close-save') {
    closeSaveManager();
  } else if (action === 'load-latest') {
    const [latest] = readSaveSlots();
    if (latest) {
      closeSaveManager();
      loadGame(latest.id);
    }
  } else if (action === 'load-slot') {
    closeSaveManager();
    loadGame(event.target.dataset.slotId);
  } else if (action === 'overwrite-slot') {
    const slots = readSaveSlots();
    const slot = slots.find((item) => item.id === event.target.dataset.slotId);
    if (slot) {
      saveGame(slot.name, slot.id);
      renderSaveManager('save');
    }
  } else if (action === 'delete-slot') {
    const slotId = event.target.dataset.slotId;
    const slots = readSaveSlots();
    const slot = slots.find((item) => item.id === slotId);
    if (slot && window.confirm(`Delete save slot "${slot.name}"?`)) {
      writeSaveSlots(removeSaveSlot(slots, slotId));
      if (activeSaveSlotId === slotId) activeSaveSlotId = null;
      toast(`Deleted ${slot.name}.`);
      renderSaveManager('load');
    }
  } else if (action === 'load-legacy') {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      closeSaveManager();
      loadSerializedGame(raw);
    }
  } else if (action === 'import-file') {
    openImportSaveFile();
  }
});

saveImportInput.addEventListener('change', async () => {
  const [file] = Array.from(saveImportInput.files || []);
  if (!file) return;

  try {
    importSaveFile(await file.text(), file.name);
  } catch (error) {
    toast(error.message || 'Save file failed to import.', 'bad');
    playAudioCue('error');
  } finally {
    saveImportInput.value = '';
  }
});

saveManager.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(saveManager);
  const slot = saveGame(data.get('slotName'));
  renderSaveManager('save');
  const input = saveManager.querySelector('#saveSlotName');
  if (input instanceof HTMLInputElement) input.value = slot.name;
});

settingsPanel.addEventListener('click', (event) => {
  if (!(event.target instanceof HTMLElement)) return;
  const action = event.target.dataset.action;
  if (action === 'close-settings') {
    closeSettings();
  } else if (action === 'reset-settings') {
    persistPlayerSettings(DEFAULT_SETTINGS);
    renderSettingsPanel();
    resizeCanvas();
    toast('Settings reset.');
    playAudioCue('ui');
  }
});

settingsPanel.addEventListener('input', (event) => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'audioVolume') {
    const settings = normalizeSettings({ ...playerSettings, audioVolume: event.target.value });
    setAudioVolume(settings.audioVolume);
    const value = settingsPanel.querySelector('#volumeValue');
    if (value) value.textContent = `${settings.audioVolume}%`;
  }
});

settingsPanel.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement) || !['motion', 'mapScale'].includes(event.target.name)) return;
  for (const input of settingsPanel.querySelectorAll(`input[name="${event.target.name}"]`)) {
    input.closest('.choice-card')?.classList.toggle('selected', input.checked);
  }
});

settingsPanel.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(settingsPanel);
  persistPlayerSettings({
    audioVolume: data.get('audioVolume'),
    motion: data.get('motion'),
    mapScale: data.get('mapScale')
  });
  closeSettings();
  resizeCanvas();
  toast('Settings applied.');
  playAudioCue('ui');
});

resizeCanvas();
