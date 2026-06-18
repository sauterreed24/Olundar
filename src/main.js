import { BUILDING_TYPES, DIPLOMACY_ACTIONS, FACTIONS, MAP_HEIGHT, MAP_WIDTH, RESOURCE_NAMES, UNIT_TYPES } from './content.js';
import {
  attackBuilding,
  attackUnit,
  canAfford,
  createGame,
  deserializeState,
  endTurn,
  formatCost,
  fortifyUnit,
  moveUnit,
  performDiplomacy,
  serializeState,
  startConstruction,
  startTraining,
  unitAt,
  buildingAt,
  isEnemy,
  isVisible
} from './rules.js';
import { describeSelection, describeTilePanel, drawGame, pointToTile } from './render.js';

const SAVE_KEY = 'olundar.deadwalker.prototype.save';
const canvas = document.querySelector('#gameCanvas');
const resourceBar = document.querySelector('#resourceBar');
const turnLabel = document.querySelector('#turnLabel');
const objectiveList = document.querySelector('#objectiveList');
const selectionPanel = document.querySelector('#selectionPanel');
const actionPanel = document.querySelector('#actionPanel');
const diplomacyPanel = document.querySelector('#diplomacyPanel');
const logPanel = document.querySelector('#logPanel');
const tilePanel = document.querySelector('#tilePanel');
const modeBanner = document.querySelector('#modeBanner');
const toastEl = document.querySelector('#toast');

let state = createGame('Olundar-Founding');
let hoverTile = null;
let lastTile = { x: 7, y: 16 };
let toastTimer = null;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  const width = Math.max(320, parent.clientWidth);
  const idealHeight = width * (MAP_HEIGHT / MAP_WIDTH);
  const maxHeight = Math.max(420, window.innerHeight - 146);
  const height = Math.max(360, Math.min(idealHeight, maxHeight));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.height = `${height}px`;
  render();
}

function render() {
  drawGame(canvas, state, hoverTile);
  renderTopBar();
  renderObjectives();
  renderSelection();
  renderActions();
  renderDiplomacy();
  renderLog();
  renderTilePanel();
  renderMode();
}

function renderTopBar() {
  const resources = state.factions.olundar.resources;
  const order = ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale'];
  resourceBar.innerHTML = order.map((key) => `<span class="resource"><b>${RESOURCE_NAMES[key]}</b> ${Math.floor(resources[key] || 0)}</span>`).join('');
  turnLabel.textContent = state.status === 'playing' ? `Turn ${state.turn}` : `${state.status === 'won' ? 'Victory' : 'Defeat'} · Turn ${state.turn}`;
}

function renderObjectives() {
  objectiveList.innerHTML = '';
  const revealedPortal = state.buildings.some((b) => b.type === 'portal' && state.revealed[b.y * MAP_WIDTH + b.x]);
  const objectiveState = [
    revealedPortal,
    hasBuilding('barracks') && hasBuilding('farm') && hasBuilding('lumberCamp'),
    Object.values(state.factions).filter((f) => !f.player && f.id !== 'dead' && f.discovered).length >= 2,
    state.flags.bossSlain,
    state.flags.portalDestroyed
  ];
  state.objectives.forEach((objective, i) => {
    const li = document.createElement('li');
    li.className = objectiveState[i] ? 'done' : '';
    li.textContent = objective;
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
    actionPanel.appendChild(button('Fortify / Hold position', () => runAction(() => fortifyUnit(state, selectedUnit.id)), selectedUnit.hasActed || selectedUnit.faction !== 'olundar'));
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
    actionPanel.appendChild(paragraph(`${def.name}: ${selectedBuilding.turnsLeft > 0 ? `under construction, ${selectedBuilding.turnsLeft} turns left` : 'operational'}.`));
    if (selectedBuilding.faction === 'olundar' && selectedBuilding.turnsLeft <= 0 && def.trains.length) {
      const grid = document.createElement('div');
      grid.className = 'button-grid';
      for (const unitType of def.trains) {
        const uDef = UNIT_TYPES[unitType];
        const disabled = selectedBuilding.queue.length >= 3 || !canAfford(state.factions.olundar.resources, uDef.cost);
        grid.appendChild(button(`${uDef.name} · ${formatCost(uDef.cost)} · ${uDef.trainTurns}t`, () => runAction(() => startTraining(state, selectedBuilding.id, unitType)), disabled));
      }
      actionPanel.appendChild(subheading('Train'));
      actionPanel.appendChild(grid);
    }
  }

  actionPanel.appendChild(subheading('Campaign'));
  actionPanel.appendChild(button('End turn', () => {
    state.mode = { type: 'select' };
    endTurn(state);
    toast('Turn resolved. The world moves.');
    render();
  }));
  actionPanel.appendChild(button('Save', () => saveGame()));
  actionPanel.appendChild(button('Load', () => loadGame()));
  actionPanel.appendChild(button('New campaign', () => newCampaign()));
  actionPanel.appendChild(button('Export save file', () => exportSave()));
}

function renderDiplomacy() {
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
      row.appendChild(button(`${action.name} · ${formatCost(action.cost)}`, () => runAction(() => performDiplomacy(state, id, actionId)), !canAfford(state.factions.olundar.resources, action.cost)));
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
  tilePanel.innerHTML = describeTilePanel(state, tile.x, tile.y);
}

function renderMode() {
  if (state.mode.type === 'build') {
    const def = BUILDING_TYPES[state.mode.buildingType];
    modeBanner.textContent = `Build mode: ${def.name}. Click the engineer’s tile or an adjacent valid tile. Esc cancels.`;
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
    handleResult(result);
    render();
    return;
  }

  const visibleUnit = isVisible(state, tile.x, tile.y) ? unitAt(state, tile.x, tile.y) : null;
  const visibleBuilding = isVisible(state, tile.x, tile.y) ? buildingAt(state, tile.x, tile.y) : null;
  const selectedUnit = state.units.find((u) => u.id === state.selectedUnitId);

  if (selectedUnit && visibleUnit && visibleUnit.id !== selectedUnit.id && isEnemy(state, selectedUnit.faction, visibleUnit.faction)) {
    handleResult(attackUnit(state, selectedUnit.id, visibleUnit.id));
    render();
    return;
  }

  if (selectedUnit && visibleBuilding && isEnemy(state, selectedUnit.faction, visibleBuilding.faction)) {
    handleResult(attackBuilding(state, selectedUnit.id, visibleBuilding.id));
    render();
    return;
  }

  if (visibleUnit && visibleUnit.faction === 'olundar') {
    selectUnit(visibleUnit.id);
    render();
    return;
  }

  if (visibleBuilding && visibleBuilding.faction === 'olundar') {
    selectBuilding(visibleBuilding.id);
    render();
    return;
  }

  if (selectedUnit && selectedUnit.faction === 'olundar') {
    handleResult(moveUnit(state, selectedUnit.id, tile.x, tile.y));
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

function runAction(action) {
  const result = action();
  handleResult(result);
  render();
}

function handleResult(result) {
  if (!result) return;
  if (!result.ok && result.reason) toast(result.reason, 'bad');
  else if (result.reason) toast(result.reason);
}

function saveGame() {
  localStorage.setItem(SAVE_KEY, serializeState(state));
  toast('Campaign saved locally.');
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) {
    toast('No local save found.', 'bad');
    return;
  }
  try {
    state = deserializeState(raw);
    toast('Campaign loaded.');
    render();
  } catch (error) {
    toast(error.message || 'Save failed to load.', 'bad');
  }
}

function newCampaign() {
  const seed = window.prompt('Campaign seed:', `Olundar-${Math.floor(Math.random() * 9999)}`);
  if (!seed) return;
  state = createGame(seed);
  hoverTile = null;
  lastTile = { x: 7, y: 16 };
  toast(`New campaign: ${seed}`);
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
}

function hasBuilding(type) {
  return state.buildings.some((b) => b.faction === 'olundar' && b.type === type && b.turnsLeft <= 0);
}

function button(label, onClick, disabled = false) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.disabled = disabled;
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
  drawGame(canvas, state, hoverTile);
});
canvas.addEventListener('mouseleave', () => {
  hoverTile = null;
  render();
});

window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    state.mode = { type: 'select' };
    render();
  } else if (event.key.toLowerCase() === 'e') {
    endTurn(state);
    toast('Turn resolved.');
    render();
  } else if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    saveGame();
  } else if (event.key.toLowerCase() === 'l' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    loadGame();
  }
});

document.querySelector('#endTurnTop').addEventListener('click', () => {
  endTurn(state);
  toast('Turn resolved.');
  render();
});
document.querySelector('#newTop').addEventListener('click', () => newCampaign());
document.querySelector('#saveTop').addEventListener('click', () => saveGame());
document.querySelector('#loadTop').addEventListener('click', () => loadGame());

resizeCanvas();
