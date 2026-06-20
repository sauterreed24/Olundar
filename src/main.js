import { BUILDING_TYPES, DIFFICULTY_PRESETS, DIPLOMACY_ACTIONS, MAP_HEIGHT, MAP_LENSES, MAP_WIDTH, RESOURCE_NAMES, SCENARIOS, TERRAIN, UNIT_TYPES } from './content.js';
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
  findPath,
  getAftermathMissions,
  fortifyUnit,
  getCampaignRecap,
  getCrisisCouncil,
  getDiplomacyLedger,
  getEndTurnWarnings,
  getFirstTurnsGuide,
  getObjectiveProgress,
  getReadyOlundarUnits,
  getSiegeOperations,
  getWarCouncil,
  makeDiplomaticPromise,
  resolveCrisis,
  trainingQueueLimit,
  trainingTurnsFor,
  moveUnit,
  performDiplomacy,
  resolvePromiseDemand,
  serializeState,
  setFieldOrder,
  startConstruction,
  startTraining,
  upgradeBuilding,
  upgradeCostFor,
  tileAt,
  unitAt,
  buildingAt,
  isEnemy,
  isTileSupplied,
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
const mapIntel = document.querySelector('#mapIntel');
const mapTurnReport = document.querySelector('#mapTurnReport');
const mapLensBar = document.querySelector('#mapLensBar');
const mapHelp = document.querySelector('.map-help');
const resourceBar = document.querySelector('#resourceBar');
const turnLabel = document.querySelector('#turnLabel');
const objectiveList = document.querySelector('#objectiveList');
const councilPanel = document.querySelector('#councilPanel');
const guidePanel = document.querySelector('#guidePanel');
const operationsPanel = document.querySelector('#operationsPanel');
const crisisPanel = document.querySelector('#crisisPanel');
const missionPanel = document.querySelector('#missionPanel');
const selectionPanel = document.querySelector('#selectionPanel');
const actionPanel = document.querySelector('#actionPanel');
const diplomacyPanel = document.querySelector('#diplomacyPanel');
const logPanel = document.querySelector('#logPanel');
const tilePanel = document.querySelector('#tilePanel');
const mobileIntelDrawer = document.querySelector('#mobileIntelDrawer');
const mobileIntelDrawerSummary = document.querySelector('#mobileIntelDrawerSummary');
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

const MISSION_ARCHIVE_TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'repair', label: 'Repairs' },
  { id: 'escort', label: 'Escorts' },
  { id: 'raid', label: 'Raids' },
  { id: 'accord', label: 'Accords' }
];
const MISSION_ARCHIVE_SORT_ORDERS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' }
];
const MISSION_ARCHIVE_GROUP_MODES = [
  { id: 'flat', label: 'Flat' },
  { id: 'routes', label: 'Routes' },
  { id: 'rulings', label: 'Rulings' }
];
const MISSION_ARCHIVE_DETAIL_MODES = [
  { id: 'details', label: 'Details' },
  { id: 'summary', label: 'Summary' }
];
const PACT_ACCEPTANCE_RELATION = 35;
const BUILD_ORDER = ['farm', 'lumberCamp', 'mine', 'road', 'watchtower', 'wall', 'barracks', 'archeryYard', 'stable', 'workshop', 'shrine', 'outpost'];
const BUILD_DOCTRINE_GROUPS = [
  { label: 'Logistics and economy', meta: 'Roads, food, wood, iron', types: ['road', 'farm', 'lumberCamp', 'mine'] },
  { label: 'Walls and watch', meta: 'Vision, gates, frontier bases', types: ['watchtower', 'wall', 'outpost'] },
  { label: 'Muster halls', meta: 'Infantry, bows, cavalry, siege', types: ['barracks', 'archeryYard', 'stable', 'workshop'] },
  { label: 'Imperial civic works', meta: 'Morale and influence', types: ['shrine'] }
];

let state = createGame({ scenarioId: 'founding' });
let activeSaveSlotId = null;
let hoverTile = null;
let lastTile = { x: 7, y: 16 };
let toastTimer = null;
let playerSettings = readSettings();
let lastAutoRecapKey = null;
let activeMapLens = 'normal';
let focusedMissionId = null;
let missionResultBanner = null;
let missionHistoryFilter = 'recent';
let missionArchiveTypeFilter = 'all';
let missionArchiveSearch = '';
let missionArchiveSortOrder = 'newest';
let missionArchiveGroupMode = 'flat';
let missionArchiveDetailMode = 'details';
let focusedArchivedMissionId = null;
let battleImpact = null;
let turnReport = null;
let mobileIntelDrawerTouched = false;
let syncingMobileIntelDrawer = false;

initAudioPreference();
applyPlayerSettings(playerSettings);
registerPwa();
focusFirstReadyUnit();

function resizeCanvas() {
  const compactViewport = window.innerWidth <= 620;
  const dprCap = compactViewport ? 1.35 : 1.75;
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  const parent = canvas.parentElement;
  const mapScale = getMapScalePreset(playerSettings);
  const width = Math.max(320, parent.clientWidth);
  const idealHeight = width * (compactViewport ? 0.92 : 0.8);
  const maxHeight = Math.max(mapScale.maxHeightFloor, window.innerHeight - mapScale.maxHeightOffset);
  const height = Math.max(mapScale.minHeight, Math.min(idealHeight, maxHeight));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.height = `${height}px`;
  render();
}

function render() {
  drawGame(canvas, state, hoverTile, activeMapLens, focusedMissionRouteOverlay(), missionSiteFocusOverlay(), battleImpactOverlay(), openingOrderOverlay());
  renderTopBar();
  renderMapLensBar();
  renderMapHelp();
  renderMapTurnReport();
  renderCouncil();
  renderGuide();
  renderOperations();
  renderCrisisCouncil();
  renderAftermathMissions();
  renderObjectives();
  renderSelection();
  renderActions();
  renderDiplomacy();
  renderLog();
  renderTilePanel();
  renderMapIntel();
  renderMode();
  renderMobileIntelDrawer();
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

function mappedPercent() {
  const revealed = Array.isArray(state.revealed) ? state.revealed.filter(Boolean).length : 0;
  return Math.round((revealed / (MAP_WIDTH * MAP_HEIGHT)) * 100);
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

function currentOpeningDirective() {
  const guide = getFirstTurnsGuide(state);
  if (!guide.visible) return null;
  const current = guide.steps.find((step) => step.id === guide.currentId && !step.done)
    || guide.steps.find((step) => !step.done);
  if (!current) return null;
  return { guide, current };
}

function renderMapHelp() {
  if (!mapHelp) return;
  if (state.mode.type === 'build') {
    const def = BUILDING_TYPES[state.mode.buildingType];
    mapHelp.innerHTML = [
      `<span class="next-directive"><b>Build</b> ${escapeHtml(def.name)}</span>`,
      '<span>Green sites are valid</span>',
      '<span>Red sites are blocked</span>',
      '<span>Use placement survey or click map</span>',
      '<span>Esc cancels build</span>'
    ].join('');
    return;
  }
  const directive = currentOpeningDirective();
  const compactDirective = Boolean(directive && window.innerWidth <= 620);
  const hints = compactDirective ? [] : [
    '<span>Gold field marks terrain-adjusted movement radius</span>',
    '<span>Standards mark key moves</span>',
    '<span>Laurels mark supplied ground</span>',
    '<span>Hover previews route cost</span>',
    '<span>Red rim marks attack reach</span>',
    '<span>E ends turn | Esc cancels build</span>'
  ];
  const chips = [
    ...(directive ? [`<span class="next-directive"><b>Next</b> ${escapeHtml(directive.current.label)}</span>`] : []),
    ...hints
  ];
  mapHelp.innerHTML = chips.join('');
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
  const openSteps = guide.steps.filter((step) => !step.done);
  const recentlyDone = guide.steps.filter((step) => step.done).slice(-1);
  const visibleSteps = [...recentlyDone, ...openSteps.slice(0, 3)];
  const hiddenCount = Math.max(0, guide.steps.length - visibleSteps.length);
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
      ${visibleSteps.map((step) => `
        <li class="${step.done ? 'done' : step.id === guide.currentId ? 'current' : ''}">
          <span class="step-status">${step.done ? 'Done' : step.id === guide.currentId ? 'Next' : 'Open'}</span>
          <strong>${escapeHtml(step.label)}</strong>
          <small>${escapeHtml(step.detail)}</small>
        </li>
      `).join('')}
    </ol>
    ${hiddenCount ? `<p class="guide-more">${hiddenCount} later opening ${hiddenCount === 1 ? 'order' : 'orders'} stay queued below the current priorities.</p>` : ''}
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

function renderCrisisCouncil() {
  const council = getCrisisCouncil(state);
  crisisPanel.hidden = !council.visible;
  if (!council.visible) {
    crisisPanel.innerHTML = '';
    return;
  }

  crisisPanel.innerHTML = `
    <div class="crisis-head">
      <h2>${escapeHtml(council.title)}</h2>
      <p>${escapeHtml(council.summary)}</p>
    </div>
  `;

  if (council.events.length) {
    const list = document.createElement('div');
    list.className = 'crisis-list';
    for (const event of council.events) {
      const card = document.createElement('article');
      card.className = `crisis-card ${event.tone}`;
      card.innerHTML = `
        <div class="crisis-title">
          <span>${escapeHtml(event.label || (event.tone === 'danger' ? 'Urgent' : event.tone === 'good' ? 'Council' : 'Open'))}</span>
          <h3>${escapeHtml(event.name)}</h3>
        </div>
        <p>${escapeHtml(event.text)}</p>
      `;

      const choices = document.createElement('div');
      choices.className = 'crisis-choices';
      for (const choice of event.choices) {
        const row = document.createElement('div');
        row.className = 'crisis-choice';
        const choiceButton = button(`${choice.name} - ${choice.costText}`, () => runAction(() => resolveCrisis(state, event.id, choice.id), 'ui'), choice.disabled, choice.disabledReason);
        row.appendChild(choiceButton);
        const detail = document.createElement('small');
        detail.textContent = `${choice.text} ${choice.preview}`;
        row.appendChild(detail);
        choices.appendChild(row);
      }
      card.appendChild(choices);
      list.appendChild(card);
    }
    crisisPanel.appendChild(list);
  }

  if (council.history.length) {
    const history = document.createElement('div');
    history.className = 'crisis-history';
    history.innerHTML = `
      <h3>Recent Rulings</h3>
      ${council.history.map((record) => `
        <p class="${escapeHtml(record.tone)}"><b>T${record.turn} ${escapeHtml(record.choiceName)}:</b> ${escapeHtml(record.outcome)}</p>
      `).join('')}
    `;
    crisisPanel.appendChild(history);
  }
}

function renderAftermathMissions() {
  const missions = getAftermathMissions(state);
  const visible = missions.visible || Boolean(missionResultBanner);
  missionPanel.hidden = !visible;
  if (!visible) {
    missionPanel.innerHTML = '';
    return;
  }
  missionPanel.innerHTML = `
    <div class="missions-head">
      <h2>${escapeHtml(missions.title)}</h2>
      <p>${escapeHtml(missions.summary)}</p>
    </div>
    ${missionResultBanner ? missionResultBannerMarkup() : ''}
    ${missions.active.length ? `
      <div class="mission-list">
        ${missions.active.map((mission) => `
          <article class="mission ${escapeHtml(mission.tone)} ${mission.id === focusedMissionId ? 'focused' : ''}">
            <span>${escapeHtml(mission.required)}</span>
            <strong>${escapeHtml(mission.name)}</strong>
            <small>${escapeHtml(mission.text)} Target ${escapeHtml(mission.target)}${mission.context ? ` / ${escapeHtml(mission.context)}` : ''}. ${escapeHtml(mission.reward)}</small>
            <div class="mission-route ${escapeHtml(mission.route?.tone || 'info')}">
              <b>${escapeHtml(mission.route?.label || 'Route')}</b>
              <span>${escapeHtml(mission.route?.text || 'Select the mission target to inspect the route.')}</span>
            </div>
            <div class="mission-actions">
              <button type="button" data-action="dispatch-mission" data-mission-id="${escapeHtml(mission.id)}" ${mission.route?.unitId && mission.route?.reachableThisTurn ? '' : 'disabled'} title="${mission.route?.reachableThisTurn ? 'Move the recommended unit to complete this mission now' : 'The recommended route is not ready this turn'}">Dispatch</button>
              <button type="button" data-action="focus-mission-unit" data-mission-id="${escapeHtml(mission.id)}" ${mission.route?.unitId ? '' : 'disabled'}>Unit</button>
              <button type="button" data-action="focus-mission" data-mission-id="${escapeHtml(mission.id)}">Focus</button>
            </div>
          </article>
        `).join('')}
      </div>
    ` : ''}
    ${missionHistoryMarkup(missions)}
  `;
}

function missionHistoryMarkup(missions) {
  if (!missions.recent.length && !missions.archive.length) return '';
  const filter = missionHistoryFilter === 'archive' || (!missions.recent.length && missions.archive.length) ? 'archive' : 'recent';
  const typeFilter = selectedMissionArchiveType();
  const search = normalizedMissionArchiveSearch();
  const sortOrder = selectedMissionArchiveSortOrder();
  const groupMode = selectedMissionArchiveGroupMode();
  const detailMode = selectedMissionArchiveDetailMode();
  const archive = filter === 'archive' ? sortedArchiveMissions(filteredArchiveMissions(missions.archive, typeFilter, search), sortOrder) : [];
  const history = filter === 'archive' ? archive : missions.recent;
  const title = filter === 'archive' ? missionArchiveTitle(typeFilter, archive.length, missions.archiveCount) : `Completed (${missions.recentCount})`;
  const archiveNote = filter === 'archive' && (typeFilter !== 'all' || search || sortOrder !== 'newest' || groupMode !== 'flat' || detailMode !== 'details')
    ? `<small class="mission-history-note">${escapeHtml(missionArchiveStatusLabel(typeFilter, search, sortOrder, groupMode, detailMode))} (${archive.length}/${missions.archiveCount}).</small>`
    : '';
  const historyMarkup = filter === 'archive' && groupMode !== 'flat'
    ? missionArchiveGroupedRecordsMarkup(history, detailMode)
    : history.map((mission) => missionHistoryRecordMarkup(mission)).join('');

  return `
    <div class="mission-history">
      <div class="mission-history-head">
        <h3>${escapeHtml(title)}</h3>
        <div class="mission-history-tools" role="group" aria-label="Completed mission history filter">
          <button type="button" data-action="set-mission-history" data-filter="recent" aria-pressed="${filter === 'recent'}" ${missions.recentCount ? '' : 'disabled'}>Recent</button>
          <button type="button" data-action="set-mission-history" data-filter="archive" aria-pressed="${filter === 'archive'}" ${missions.archiveCount ? '' : 'disabled'}>Archive</button>
        </div>
      </div>
      ${filter === 'archive' ? missionArchiveTypeFilterMarkup(missions.archive, typeFilter) : ''}
      ${filter === 'archive' ? missionArchiveSearchMarkup(search) : ''}
      ${filter === 'archive' ? missionArchiveSortMarkup(sortOrder) : ''}
      ${filter === 'archive' ? missionArchiveGroupMarkup(groupMode) : ''}
      ${filter === 'archive' && groupMode !== 'flat' ? missionArchiveDetailMarkup(detailMode) : ''}
      ${history.length ? historyMarkup : '<p class="history-empty">No completed field tasks match this filter.</p>'}
      ${archiveNote}
    </div>
  `;
}

function missionArchiveTypeFilterMarkup(archive, selected) {
  if (!archive.length) return '';
  return `
    <div class="mission-type-filter" role="group" aria-label="Archive mission type filter">
      ${MISSION_ARCHIVE_TYPE_FILTERS.map((item) => {
        const count = archiveTypeCount(archive, item.id);
        return `<button type="button" data-action="set-mission-archive-type" data-filter="${escapeHtml(item.id)}" aria-pressed="${selected === item.id}" ${item.id !== 'all' && !count ? 'disabled' : ''}>${escapeHtml(item.label)} <span>${count}</span></button>`;
      }).join('')}
    </div>
  `;
}

function missionArchiveSearchMarkup(search) {
  return `
    <form class="mission-archive-search" data-action="search-mission-archive">
      <input name="archiveSearch" value="${escapeHtml(search)}" maxlength="40" placeholder="Search archive" autocomplete="off" />
      <button type="submit">Find</button>
      <button type="button" data-action="clear-mission-archive-search" ${search ? '' : 'disabled'}>Clear</button>
    </form>
  `;
}

function missionArchiveSortMarkup(selected) {
  return `
    <div class="mission-archive-sort" role="group" aria-label="Archive mission sort order">
      ${MISSION_ARCHIVE_SORT_ORDERS.map((item) => `<button type="button" data-action="set-mission-archive-sort" data-sort="${escapeHtml(item.id)}" aria-pressed="${selected === item.id}">${escapeHtml(item.label)}</button>`).join('')}
    </div>
  `;
}

function missionArchiveGroupMarkup(selected) {
  return `
    <div class="mission-archive-group-mode" role="group" aria-label="Archive mission grouping">
      ${MISSION_ARCHIVE_GROUP_MODES.map((item) => `<button type="button" data-action="set-mission-archive-group" data-group="${escapeHtml(item.id)}" aria-pressed="${selected === item.id}">${escapeHtml(item.label)}</button>`).join('')}
    </div>
  `;
}

function missionArchiveDetailMarkup(selected) {
  return `
    <div class="mission-archive-detail-mode" role="group" aria-label="Archive group detail level">
      ${MISSION_ARCHIVE_DETAIL_MODES.map((item) => `<button type="button" data-action="set-mission-archive-detail" data-detail="${escapeHtml(item.id)}" aria-pressed="${selected === item.id}">${escapeHtml(item.label)}</button>`).join('')}
    </div>
  `;
}

function missionArchiveGroupedRecordsMarkup(missions, detailMode = 'details') {
  const showRecords = detailMode !== 'summary';
  return missionArchiveGroups(missions).map((group) => `
    <section class="mission-archive-group">
      <div class="mission-archive-group-head">
        <strong>${escapeHtml(group.title)}</strong>
        <span>${escapeHtml(group.summary)}</span>
      </div>
      ${selectedMissionArchiveGroupMode() === 'rulings' ? missionArchiveGroupSummaryMarkup(group.records) : ''}
      ${showRecords ? group.records.map((mission) => missionHistoryRecordMarkup(mission)).join('') : ''}
    </section>
  `).join('');
}

function missionArchiveGroupSummaryMarkup(records) {
  const summary = missionArchiveGroupRewardSummary(records);
  return `
    <div class="mission-archive-group-summary">
      <span>${escapeHtml(summary.rewards)}</span>
      <span>${escapeHtml(summary.followUps)}</span>
    </div>
  `;
}

function missionArchiveGroupRewardSummary(records) {
  const terrainCaches = records.filter((mission) => /site yields/i.test(mission.reward)).length;
  const followUps = records.reduce((sum, mission) => sum + missionArchiveFollowUpCount(mission.reward), 0);
  const tags = missionArchiveRewardTags(records);
  const rewardParts = [`${records.length} field reward${records.length === 1 ? '' : 's'}`];
  if (terrainCaches) rewardParts.push(`${terrainCaches} terrain cache${terrainCaches === 1 ? '' : 's'}`);
  rewardParts.push(...tags);
  return {
    rewards: `Rewards: ${rewardParts.join(', ')}`,
    followUps: `Follow-ups: ${followUps || 'no'} marker${followUps === 1 ? '' : 's'}`
  };
}

function missionArchiveRewardTags(records) {
  const counts = [
    ['influence', /influence|trust|relations?/i],
    ['morale', /morale/i],
    ['gold', /gold|coin/i],
    ['field XP', /experience|xp/i],
    ['fortification', /holdings|repaired|reinforces?/i],
    ['supplies', /supplies|stores|caches|resources/i]
  ].map(([label, pattern]) => [label, records.filter((mission) => pattern.test(mission.reward)).length])
    .filter(([, count]) => count);
  return counts.slice(0, 4).map(([label, count]) => `${count} ${label}`);
}

function missionArchiveFollowUpCount(text = '') {
  return (String(text).match(/follow-up marker opens/gi) || []).length;
}

function missionArchiveGroups(missions) {
  const groups = new Map();
  for (const mission of missions) {
    const key = missionArchiveGroupKey(mission);
    if (!groups.has(key.id)) groups.set(key.id, { ...key, records: [] });
    groups.get(key.id).records.push(mission);
  }
  return Array.from(groups.values()).map((group) => {
    const turns = group.records.map((mission) => mission.completedTurn || 0).filter(Boolean);
    const low = Math.min(...turns);
    const high = Math.max(...turns);
    const range = `${group.records.length} task${group.records.length === 1 ? '' : 's'}${turns.length ? ` / T${low}${low === high ? '' : `-T${high}`}` : ''}`;
    return {
      ...group,
      summary: group.detail ? `${group.detail} / ${range}` : range
    };
  });
}

function missionArchiveGroupKey(mission) {
  if (selectedMissionArchiveGroupMode() === 'rulings') {
    if (mission.originLabel) {
      return {
        id: `ruling:${mission.originEventId || ''}:${mission.originChoiceId || mission.originLabel}`,
        title: mission.originLabel,
        detail: mission.originSourceLabel || ''
      };
    }
    return { id: `ruling:legacy:${mission.type || 'field'}`, title: 'Unlabeled Field Rulings', detail: 'Legacy archive' };
  }
  if (mission.routeName || mission.chainTag) {
    const title = mission.routeName || mission.chainTag.replace(/([a-z])([A-Z])/g, '$1 $2');
    return { id: `route:${mission.chainTag || title}`, title };
  }
  return { id: `standalone:${mission.type || 'field'}`, title: `${missionArchiveTypeLabel(mission.type)} Field Work` };
}

function filteredArchiveMissions(archive, typeFilter = 'all', search = '') {
  const typed = typeFilter === 'all' ? archive : archive.filter((mission) => mission.type === typeFilter);
  if (!search) return typed;
  return typed.filter((mission) => missionArchiveSearchText(mission).includes(search));
}

function sortedArchiveMissions(archive, sortOrder = 'newest') {
  const sorted = archive.slice().sort((a, b) => {
    const turnDiff = (b.completedTurn || 0) - (a.completedTurn || 0);
    return turnDiff || String(b.id).localeCompare(String(a.id));
  });
  return sortOrder === 'oldest' ? sorted.reverse() : sorted;
}

function archiveTypeCount(archive, typeFilter = 'all') {
  return filteredArchiveMissions(archive, typeFilter).length;
}

function selectedMissionArchiveType() {
  return MISSION_ARCHIVE_TYPE_FILTERS.some((item) => item.id === missionArchiveTypeFilter) ? missionArchiveTypeFilter : 'all';
}

function selectedMissionArchiveSortOrder() {
  return MISSION_ARCHIVE_SORT_ORDERS.some((item) => item.id === missionArchiveSortOrder) ? missionArchiveSortOrder : 'newest';
}

function selectedMissionArchiveGroupMode() {
  return MISSION_ARCHIVE_GROUP_MODES.some((item) => item.id === missionArchiveGroupMode) ? missionArchiveGroupMode : 'flat';
}

function selectedMissionArchiveDetailMode() {
  return MISSION_ARCHIVE_DETAIL_MODES.some((item) => item.id === missionArchiveDetailMode) ? missionArchiveDetailMode : 'details';
}

function missionArchiveTypeLabel(typeFilter = 'all') {
  return MISSION_ARCHIVE_TYPE_FILTERS.find((item) => item.id === typeFilter)?.label || 'All';
}

function missionArchiveSortLabel(sortOrder = 'newest') {
  return sortOrder === 'oldest' ? 'oldest first' : 'newest first';
}

function missionArchiveGroupLabel(groupMode = 'flat') {
  if (groupMode === 'routes') return 'route groups';
  if (groupMode === 'rulings') return 'ruling groups';
  return 'flat list';
}

function missionArchiveDetailLabel(detailMode = 'details') {
  return detailMode === 'summary' ? 'summary only' : 'full details';
}

function missionArchiveTitle(typeFilter, visibleCount, archiveCount) {
  if (typeFilter === 'all') return `Archive (${archiveCount})`;
  return `${missionArchiveTypeLabel(typeFilter)} (${visibleCount})`;
}

function normalizedMissionArchiveSearch() {
  return missionArchiveSearch.trim().toLowerCase();
}

function missionArchiveSearchText(mission) {
  return [
    mission.name,
    mission.context,
    mission.reward,
    mission.completedBy,
    mission.site,
    mission.terrain,
    mission.routeName,
    mission.chainTag,
    mission.originLabel,
    mission.originSourceLabel,
    mission.type,
    `t${mission.completedTurn}`
  ].filter(Boolean).join(' ').toLowerCase();
}

function missionArchiveFilterLabel(typeFilter, search) {
  return [typeFilter !== 'all' ? missionArchiveTypeLabel(typeFilter) : '', search ? `"${search}"` : ''].filter(Boolean).join(' + ') || 'All';
}

function missionArchiveStatusLabel(typeFilter, search, sortOrder, groupMode, detailMode) {
  return [
    typeFilter !== 'all' || search ? `Filtered: ${missionArchiveFilterLabel(typeFilter, search)}` : '',
    `Sorted: ${missionArchiveSortLabel(sortOrder)}`,
    groupMode !== 'flat' ? `Grouped: ${missionArchiveGroupLabel(groupMode)}` : '',
    groupMode !== 'flat' ? `Detail: ${missionArchiveDetailLabel(detailMode)}` : ''
  ].filter(Boolean).join('; ');
}

function clearFocusedArchivedMissionIfFilteredOut() {
  if (!focusedArchivedMissionId) return;
  const visible = filteredArchiveMissions(getAftermathMissions(state).archive, selectedMissionArchiveType(), normalizedMissionArchiveSearch())
    .some((mission) => mission.id === focusedArchivedMissionId);
  if (!visible) focusedArchivedMissionId = null;
}

function missionHistoryRecordMarkup(mission) {
  return `
    <article class="mission-history-record ${mission.id === focusedArchivedMissionId ? 'focused' : ''}">
      <p>
        <b>T${escapeHtml(mission.completedTurn)} ${escapeHtml(mission.name)}:</b>
        ${mission.context ? `${escapeHtml(mission.context)}. ` : ''}${escapeHtml(mission.reward)}
        ${mission.originLabel ? `<small>Ruling: ${escapeHtml(mission.originLabel)}${mission.originSourceLabel ? ` / ${escapeHtml(mission.originSourceLabel)}` : ''}.</small>` : ''}
        ${mission.completedBy ? `<small>Completed by ${escapeHtml(mission.completedBy)}.</small>` : ''}
      </p>
      <button type="button" data-action="focus-completed-mission" data-mission-id="${escapeHtml(mission.id)}" title="Show this completed site on the Missions lens">Site</button>
    </article>
  `;
}

function focusMissionTarget(missionId) {
  const mission = getAftermathMissions(state).active.find((item) => item.id === missionId);
  if (!mission) {
    toast('That mission is no longer active.', 'bad');
    return;
  }
  activeMapLens = 'missions';
  focusedMissionId = mission.id;
  focusedArchivedMissionId = null;
  hoverTile = { x: mission.x, y: mission.y };
  lastTile = hoverTile;
  toast(`${mission.name} target ${mission.target}.`, 'info');
  render();
  scrollBattlefieldIntoView();
}

function focusMissionUnit(missionId) {
  const mission = getAftermathMissions(state).active.find((item) => item.id === missionId);
  const unit = mission?.route?.unitId ? state.units.find((item) => item.id === mission.route.unitId) : null;
  if (!mission || !unit) {
    toast('No eligible mission unit is available.', 'bad');
    return;
  }
  state.selectedUnitId = unit.id;
  state.selectedBuildingId = null;
  state.mode = { type: 'select' };
  focusedMissionId = mission.id;
  focusedArchivedMissionId = null;
  hoverTile = { x: unit.x, y: unit.y };
  lastTile = hoverTile;
  toast(`${unit.name} route to ${mission.name}.`, mission.route.reachableThisTurn ? 'good' : 'info');
  render();
  scrollBattlefieldIntoView();
}

function dispatchMission(missionId) {
  const mission = getAftermathMissions(state).active.find((item) => item.id === missionId);
  const unit = mission?.route?.unitId ? state.units.find((item) => item.id === mission.route.unitId) : null;
  if (!mission || !unit) {
    toast('No eligible mission unit is available.', 'bad');
    playAudioCue('error');
    return;
  }
  if (!mission.route.reachableThisTurn) {
    focusedMissionId = mission.id;
    toast('This mission route needs staging before dispatch.', 'bad');
    playAudioCue('warning');
    render();
    return;
  }
  state.selectedUnitId = unit.id;
  state.selectedBuildingId = null;
  state.mode = { type: 'select' };
  focusedMissionId = mission.id;
  focusedArchivedMissionId = null;
  hoverTile = { x: mission.x, y: mission.y };
  lastTile = hoverTile;
  const result = moveUnit(state, unit.id, mission.x, mission.y);
  if (handleResult(result, 'move')) {
    const completed = !getAftermathMissions(state).active.some((item) => item.id === mission.id);
    if (completed) {
      captureMissionResult(mission.id);
      focusedMissionId = null;
      toast(`${mission.name} completed by ${unit.name}.`, 'good');
    }
  }
  render();
  scrollBattlefieldIntoView();
}

function focusCompletedMissionSite(missionId) {
  const missions = getAftermathMissions(state);
  const mission = [...missions.recent, ...missions.archive].find((item) => item.id === missionId);
  if (!mission) {
    toast('That completed mission is no longer in the review archive.', 'bad');
    return;
  }
  activeMapLens = 'missions';
  focusedMissionId = null;
  focusedArchivedMissionId = mission.id;
  state.selectedUnitId = null;
  state.selectedBuildingId = null;
  state.mode = { type: 'select' };
  hoverTile = { x: mission.x, y: mission.y };
  lastTile = hoverTile;
  toast(`${mission.name} completed site ${mission.target}.`, 'info');
  render();
  scrollBattlefieldIntoView();
}

function captureMissionResult(missionId) {
  const completed = getAftermathMissions(state).recent.find((mission) => mission.id === missionId);
  if (!completed) return;
  missionResultBanner = {
    id: completed.id,
    name: completed.name,
    completedTurn: completed.completedTurn,
    completedBy: completed.completedBy || 'Olundar',
    context: completed.context,
    reward: completed.reward,
    followUp: missionFollowUpText(completed.reward)
  };
}

function missionFollowUpText(text = '') {
  const match = String(text).match(/A follow-up marker opens at ([^:]+): ([^.]+)\./);
  return match ? `Next marker: ${match[2]} at ${match[1]}.` : '';
}

function missionResultBannerMarkup() {
  return `
    <article class="mission-result">
      <div>
        <span>T${escapeHtml(missionResultBanner.completedTurn)} Result</span>
        <strong>${escapeHtml(missionResultBanner.name)}</strong>
      </div>
      <p><b>${escapeHtml(missionResultBanner.completedBy)}</b>${missionResultBanner.context ? ` secured ${escapeHtml(missionResultBanner.context)}.` : ' completed the field task.'}</p>
      <small>${escapeHtml(missionResultBanner.reward)}</small>
      ${missionResultBanner.followUp ? `<em>${escapeHtml(missionResultBanner.followUp)}</em>` : ''}
      <button type="button" data-action="close-mission-result" aria-label="Dismiss mission result">Close</button>
    </article>
  `;
}

function focusedMissionRouteOverlay() {
  if (!focusedMissionId) return null;
  const mission = getAftermathMissions(state).active.find((item) => item.id === focusedMissionId);
  if (!mission?.route?.path?.length) return null;
  return {
    missionId: mission.id,
    missionName: mission.name,
    tone: mission.route.tone,
    reachableThisTurn: mission.route.reachableThisTurn,
    path: mission.route.path,
    target: { x: mission.x, y: mission.y },
    unitId: mission.route.unitId
  };
}

function missionSiteFocusOverlay() {
  const mission = focusedArchivedMission();
  if (!mission) return null;
  return {
    missionId: mission.id,
    name: `${mission.name} complete`,
    x: mission.x,
    y: mission.y,
    site: mission.site,
    type: mission.type,
    completed: true
  };
}

function battleImpactOverlay() {
  if (!battleImpact || !inMap(battleImpact.x, battleImpact.y)) return null;
  return battleImpact;
}

function openingOrderOverlay() {
  const directive = currentOpeningDirective();
  if (!directive || state.status !== 'playing') return null;
  const action = openingDirectiveAction(directive.current.id);
  if (!action) return null;
  const orderTarget = openingActionTarget(action);
  if (!orderTarget) return null;
  const { target, unit } = orderTarget;

  let path = [];
  let cost = null;
  if (unit && Number.isFinite(action.x) && Number.isFinite(action.y)) {
    const move = UNIT_TYPES[unit.type]?.move || 0;
    const found = action.kind === 'move'
      ? findPath(state, unit, action.x, action.y, move)
      : null;
    if (found?.path?.length) {
      path = [{ x: unit.x, y: unit.y }, ...found.path.map(pathKeyToTile)];
      cost = found.cost;
    } else if (unit.x !== action.x || unit.y !== action.y) {
      path = [{ x: unit.x, y: unit.y }, target];
    }
  }

  return {
    kind: action.kind,
    label: action.label,
    meta: action.meta,
    canExecute: action.canExecute !== false && !action.disabled,
    unitId: action.unitId || null,
    buildingId: action.buildingId || null,
    target,
    path,
    cost
  };
}

function openingActionTarget(action) {
  const unit = action.unitId ? state.units.find((item) => item.id === action.unitId) : null;
  const building = action.buildingId ? state.buildings.find((item) => item.id === action.buildingId) : null;
  const source = unit || building || null;
  const target = Number.isFinite(action.x) && Number.isFinite(action.y)
    ? { x: action.x, y: action.y }
    : source ? { x: source.x, y: source.y } : null;
  if (!target || !inMap(target.x, target.y)) return null;
  return { target, unit, building };
}

function openingDirectiveForTile(tile) {
  if (state.status !== 'playing' || state.mode.type !== 'select') return null;
  const directive = currentOpeningDirective();
  if (!directive) return null;
  const action = openingDirectiveAction(directive.current.id);
  if (!action || action.canExecute === false || action.disabled) return null;
  const orderTarget = openingActionTarget(action);
  return orderTarget?.target.x === tile.x && orderTarget.target.y === tile.y ? action : null;
}

function pathKeyToTile(key) {
  return { x: key % MAP_WIDTH, y: Math.floor(key / MAP_WIDTH) };
}

function focusedArchivedMission() {
  if (!focusedArchivedMissionId) return null;
  const missions = getAftermathMissions(state);
  return [...missions.recent, ...missions.archive].find((item) => item.id === focusedArchivedMissionId) || null;
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
    selectionPanel.classList.remove('selection-panel-collapsed');
    const readyUnits = getReadyOlundarUnits(state).length;
    selectionPanel.innerHTML = `
      <div class="command-kicker">Imperial command</div>
      <h2>Command Seat</h2>
      <p>Select a unit, city, or building. Scouts reveal the map; engineers build the economy; legions hold the line.</p>
      <div class="command-stats">
        <span class="stat-chip"><b>${readyUnits}</b><small>Ready units</small></span>
        <span class="stat-chip"><b>${state.turn}</b><small>Turn</small></span>
        <span class="stat-chip"><b>${mappedPercent()}%</b><small>Mapped</small></span>
      </div>
    `;
    return;
  }
  const kind = selection.unit ? 'Unit' : 'Structure';
  const collapseSelectionDossier = isMobileIntelDrawerMode();
  selectionPanel.classList.toggle('selection-panel-collapsed', collapseSelectionDossier);
  const mobileCollapsed = collapseSelectionDossier ? '' : ' open';
  const portrait = selectionPortraitMarkup(selection);
  selectionPanel.innerHTML = `
    <details class="selection-dossier"${mobileCollapsed}>
      <summary class="selection-dossier-summary">
        ${portrait}
        <span>
          <small>${escapeHtml(kind)} dossier</small>
          <b>${escapeHtml(selection.title)}</b>
          <em>${escapeHtml(selection.subtitle)}</em>
        </span>
      </summary>
      <div class="selection-dossier-body">
        <div class="selection-command">
          ${portrait}
          <div>
            <div class="command-kicker">${escapeHtml(kind)} selected</div>
            <h2>${escapeHtml(selection.title)}</h2>
            <p class="muted">${escapeHtml(selection.subtitle)}</p>
          </div>
        </div>
        ${selectionStatMarkup(selection)}
        <p>${escapeHtml(selection.body)}</p>
      </div>
    </details>
  `;
}

function renderActions() {
  actionPanel.innerHTML = '';
  actionPanel.appendChild(orderHeader());
  const selectedUnit = state.units.find((u) => u.id === state.selectedUnitId);
  const selectedBuilding = state.buildings.find((b) => b.id === state.selectedBuildingId);
  if (battleImpact) actionPanel.appendChild(battleImpactCard());
  if (turnReport && !isMobileIntelDrawerMode()) actionPanel.appendChild(turnReportCard());
  const commandStrip = selectedCommandStrip(selectedUnit, selectedBuilding);
  if (commandStrip) actionPanel.appendChild(commandStrip);
  const placementCard = buildPlacementCard();
  if (placementCard) actionPanel.appendChild(placementCard);
  const doctrineCard = state.mode.type === 'build' ? null : openingDoctrineCard();
  if (doctrineCard) actionPanel.appendChild(doctrineCard);
  const envoyCard = diplomacyOpportunityCard();
  if (envoyCard) actionPanel.appendChild(envoyCard);
  const pactCommandCard = pactFieldCommandCard();
  if (pactCommandCard) actionPanel.appendChild(pactCommandCard);

  if (state.status !== 'playing') {
    const section = actionSection('Campaign resolved', 'Archive the result or begin another war council.');
    const actions = commandActions('campaign-tools');
    actions.appendChild(orderButton('Campaign recap', 'Review final milestones', () => openCampaignRecap('current'), { tone: 'primary' }));
    actions.appendChild(orderButton('Save campaign', 'Store the finished state', () => openSaveManager('save')));
    actions.appendChild(orderButton('New campaign', 'Start a fresh table', () => newCampaign()));
    section.appendChild(actions);
    actionPanel.appendChild(section);
    return;
  }

  if (!selectedUnit && !selectedBuilding) {
    actionPanel.appendChild(orderNote('Select an Olundaran unit or structure to issue field orders. The campaign tools remain available below.'));
  }

  if (selectedUnit) {
    const def = UNIT_TYPES[selectedUnit.type];
    const status = selectedUnit.faction === 'olundar'
      ? (selectedUnit.hasActed ? 'Orders spent for this turn.' : 'Ready for direct orders.')
      : 'Foreign or hostile contact under observation.';
    const isEngineer = def.tags.includes('builder') && selectedUnit.faction === 'olundar';
    if (isEngineer) {
      const buildSection = actionSection('Construction orders', 'Place roads, economy sites, defenses, and mustering halls from this engineer.', 'build-orders');
      const doctrineCard = buildDoctrineCard(selectedUnit);
      if (doctrineCard) buildSection.appendChild(doctrineCard);
      const buildDrawer = orderDrawer('Full construction catalog', 'Grouped by doctrine', 'build-drawer', false);
      for (const group of BUILD_DOCTRINE_GROUPS) {
        const groupDrawer = orderDrawer(group.label, group.meta, 'build-group-drawer', false);
        const grid = commandActions('build-actions');
        for (const type of group.types.filter((item) => BUILD_ORDER.includes(item))) {
          grid.appendChild(buildOrderButton(selectedUnit, type));
        }
        groupDrawer.appendChild(grid);
        buildDrawer.appendChild(groupDrawer);
      }
      buildSection.appendChild(buildDrawer);
      actionPanel.appendChild(buildSection);
    }
    const unitSection = actionSection(def.name, `${status} HP ${selectedUnit.hp}/${selectedUnit.maxHp}. Move ${def.move}, sight ${def.sight}.`, 'unit-orders');
    const unitActions = commandActions('primary-orders');
    unitActions.appendChild(orderButton('Fortify position', 'Hold this tile and conserve the line', () => runAction(() => fortifyUnit(state, selectedUnit.id), 'select'), {
      disabled: selectedUnit.hasActed || selectedUnit.faction !== 'olundar',
      tone: 'primary'
    }));
    unitSection.appendChild(unitActions);
    actionPanel.appendChild(unitSection);
  }

  if (selectedBuilding) {
    const def = BUILDING_TYPES[selectedBuilding.type];
    const buildingStatus = selectedBuilding.turnsLeft > 0
      ? `Under construction, ${turnCountLabel(selectedBuilding.turnsLeft)} left.`
      : `Tier ${(selectedBuilding.upgraded || 0) + 1}, operational.`;
    actionPanel.appendChild(actionSection(def.name, `${buildingStatus} HP ${selectedBuilding.hp}/${selectedBuilding.maxHp}.`, 'structure-orders'));

    if (selectedBuilding.faction === 'olundar' && selectedBuilding.turnsLeft <= 0 && def.trains.length) {
      const trainSection = actionSection('Muster troops', `Queue ${selectedBuilding.queue.length}/${trainingQueueLimit(selectedBuilding)}. Upgrades increase capacity and speed elite musters.`, 'train-orders');
      const grid = commandActions('train-actions');
      for (const unitType of def.trains) {
        const uDef = UNIT_TYPES[unitType];
        const turns = trainingTurnsFor(selectedBuilding, unitType);
        const disabled = selectedBuilding.queue.length >= trainingQueueLimit(selectedBuilding) || !canAfford(state.factions.olundar.resources, uDef.cost);
        grid.appendChild(orderButton(uDef.name, `${formatCost(uDef.cost)} | ${turns} turns`, () => runAction(() => startTraining(state, selectedBuilding.id, unitType), 'train'), { disabled, tone: 'primary' }));
      }
      trainSection.appendChild(grid);
      actionPanel.appendChild(trainSection);
    }
    if (selectedBuilding.faction === 'olundar' && selectedBuilding.turnsLeft <= 0 && (selectedBuilding.upgraded || 0) < 2) {
      const cost = upgradeCostFor(selectedBuilding);
      const upgradeSection = actionSection('Upgrade works', 'Invest in durability, vision, and stronger strategic output.', 'upgrade-orders');
      const upgradeActions = commandActions('primary-orders');
      upgradeActions.appendChild(orderButton(`Upgrade to tier ${(selectedBuilding.upgraded || 0) + 2}`, formatCost(cost), () => runAction(() => upgradeBuilding(state, selectedBuilding.id), 'build'), {
        disabled: !canAfford(state.factions.olundar.resources, cost),
        tone: 'primary'
      }));
      upgradeSection.appendChild(upgradeActions);
      actionPanel.appendChild(upgradeSection);
    }
  }

  const readyUnits = getReadyOlundarUnits(state).length;
  const campaignSection = actionSection('Campaign tempo', `${readyUnits} ready unit${readyUnits === 1 ? '' : 's'} before the council should end the turn.`, 'campaign-orders');
  const primaryCampaign = commandActions('campaign-primary');
  primaryCampaign.appendChild(orderButton('Next ready unit', 'Jump to an unused Olundaran force', () => selectNextReadyUnit(), {
    disabled: !readyUnits,
    tone: 'primary'
  }));
  primaryCampaign.appendChild(orderButton('End turn', 'Resolve enemies, training, blight, and diplomacy', () => requestEndTurn(), { tone: 'danger' }));
  campaignSection.appendChild(primaryCampaign);

  const tools = commandActions('campaign-tools');
  tools.appendChild(orderButton('Save slots', 'Store this campaign', () => openSaveManager('save')));
  tools.appendChild(orderButton('Load', 'Open a saved campaign', () => openSaveManager('load')));
  tools.appendChild(orderButton('New', 'Restart from setup', () => newCampaign()));
  tools.appendChild(orderButton('Export', 'Download save file', () => exportSave()));
  tools.appendChild(orderButton('Import', 'Load save file', () => openImportSaveFile()));
  const toolsDrawer = document.createElement('details');
  toolsDrawer.className = 'campaign-tools-drawer';
  toolsDrawer.innerHTML = '<summary><span>Campaign tools</span> <small>Save, load, export</small></summary>';
  toolsDrawer.appendChild(tools);
  campaignSection.appendChild(toolsDrawer);
  actionPanel.appendChild(campaignSection);
}

function selectedCommandStrip(selectedUnit, selectedBuilding) {
  if (!selectedUnit && !selectedBuilding) return null;
  const selection = selectedUnit
    ? { unit: selectedUnit }
    : { building: selectedBuilding };
  const title = selectedUnit ? UNIT_TYPES[selectedUnit.type].name : BUILDING_TYPES[selectedBuilding.type].name;
  const factionLabel = selectedUnit?.faction || selectedBuilding?.faction || 'unknown';
  const status = selectedUnit
    ? selectedUnit.hasActed ? 'Orders spent' : 'Ready'
    : selectedBuilding.turnsLeft > 0 ? `${turnCountLabel(selectedBuilding.turnsLeft)} left` : 'Operational';
  const role = selectedUnit
    ? unitCommandRole(selectedUnit)
    : selectedBuilding.queue?.length
      ? `${selectedBuilding.queue.length}/${trainingQueueLimit(selectedBuilding)} queue`
      : `Tier ${(selectedBuilding.upgraded || 0) + 1}`;
  const hp = selectedUnit
    ? `${selectedUnit.hp}/${selectedUnit.maxHp}`
    : `${selectedBuilding.hp}/${selectedBuilding.maxHp}`;
  const mobility = selectedUnit
    ? `${UNIT_TYPES[selectedUnit.type].move} move`
    : selectedBuilding.turnsLeft > 0 ? 'Building' : 'Holding';
  const x = selectedUnit?.x ?? selectedBuilding.x;
  const y = selectedUnit?.y ?? selectedBuilding.y;
  const card = document.createElement('article');
  card.className = 'mobile-command-strip';
  card.innerHTML = `
    ${selectionPortraitMarkup(selection)}
    <div class="mobile-command-strip-main">
      <div class="mobile-command-strip-head">
        <span>${escapeHtml(factionLabel)} command</span>
        <b>${escapeHtml(status)}</b>
      </div>
      <strong>${escapeHtml(title)}</strong>
      <div class="mobile-command-strip-stats">
        <span><b>${escapeHtml(hp)}</b><small>HP</small></span>
        <span><b>${escapeHtml(mobility)}</b><small>${selectedUnit ? 'Move' : 'Work'}</small></span>
        <span><b>${escapeHtml(role)}</b><small>Role</small></span>
        <span><b>${escapeHtml(`${x},${y}`)}</b><small>Tile</small></span>
      </div>
    </div>
  `;
  return card;
}

function unitCommandRole(unit) {
  const tags = UNIT_TYPES[unit.type].tags || [];
  if (tags.includes('builder')) return 'Builder';
  if (tags.includes('ranged')) return 'Ranged';
  if (tags.includes('mounted')) return 'Cavalry';
  if (tags.includes('recon')) return 'Recon';
  if (tags.includes('siege')) return 'Siege';
  if (tags.includes('undead')) return 'Undead';
  return 'Line';
}

function buildDoctrineCard(builder) {
  const recommendations = buildDoctrineRecommendations(builder).slice(0, 3);
  if (!recommendations.length) return null;
  const card = document.createElement('article');
  card.className = 'build-doctrine-card';
  card.innerHTML = `
    <div class="build-doctrine-head">
      <span>Engineer Doctrine</span>
      <b>${escapeHtml(mappedPercent())}% mapped</b>
    </div>
    <strong>Choose construction by campaign need</strong>
    <p>Prioritize logistics, iron, ranged defense, and forward sight before browsing every imperial work.</p>
  `;
  const actions = commandActions('build-doctrine-actions');
  for (const item of recommendations) {
    actions.appendChild(buildOrderButton(builder, item.type, 'primary', item.label, item.meta));
  }
  card.appendChild(actions);
  return card;
}

function buildPlacementCard() {
  if (state.mode.type !== 'build') return null;
  const builder = state.units.find((unit) => unit.id === state.mode.builderId);
  const def = BUILDING_TYPES[state.mode.buildingType];
  if (!builder || !def) return null;
  const candidates = buildPlacementCandidates(builder, state.mode.buildingType);
  const validCount = candidates.filter((candidate) => candidate.ok).length;
  const card = document.createElement('article');
  card.className = 'build-placement-card';
  card.innerHTML = `
    <div class="build-placement-head">
      <span>Placement survey</span>
      <b>${validCount}/${candidates.length} valid</b>
    </div>
    <strong>${escapeHtml(def.name)}</strong>
    <p>${escapeHtml(def.text)} Cost: ${escapeHtml(formatCost(def.cost))}.</p>
  `;
  const actions = commandActions('build-placement-actions');
  for (const candidate of candidates) {
    const terrain = formatTerrainName(tileAt(state, candidate.x, candidate.y)?.terrain || 'unknown');
    const meta = candidate.ok
      ? `${terrain} ${candidate.x},${candidate.y}`
      : candidate.reason;
    actions.appendChild(orderButton(candidate.label, meta, () => commitBuildPlacement(candidate), {
      disabled: !candidate.ok,
      tone: candidate.ok ? 'primary' : 'secondary',
      title: candidate.ok ? `Build ${def.name} at ${candidate.x},${candidate.y}` : candidate.reason
    }));
  }
  card.appendChild(actions);
  const footer = commandActions('build-placement-footer');
  footer.appendChild(orderButton('Cancel placement', 'Return to unit orders', () => {
    state.mode = { type: 'select' };
    toast(`${def.name} placement cancelled.`, 'info');
    render();
  }, { tone: 'secondary' }));
  card.appendChild(footer);
  return card;
}

function buildPlacementCandidates(builder, buildingType) {
  const offsets = [
    { dx: 0, dy: 0, label: 'Builder tile' },
    { dx: 1, dy: 0, label: 'East site' },
    { dx: -1, dy: 0, label: 'West site' },
    { dx: 0, dy: 1, label: 'South site' },
    { dx: 0, dy: -1, label: 'North site' }
  ];
  return offsets
    .map(({ dx, dy, label }) => ({ x: builder.x + dx, y: builder.y + dy, label }))
    .filter((candidate) => inMap(candidate.x, candidate.y))
    .map((candidate) => {
      const result = canBuildOn(state, buildingType, candidate.x, candidate.y);
      return {
        ...candidate,
        ok: result.ok,
        reason: result.ok ? 'Valid site.' : result.reason
      };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok));
}

function commitBuildPlacement(candidate) {
  if (state.mode.type !== 'build' || !candidate.ok) return;
  const buildingType = state.mode.buildingType;
  const result = startConstruction(state, state.mode.builderId, buildingType, candidate.x, candidate.y);
  if (result.ok) {
    state.mode = { type: 'select' };
    if (result.building?.id) selectBuilding(result.building.id);
    lastTile = { x: candidate.x, y: candidate.y };
    hoverTile = lastTile;
  }
  handleResult(result, 'build');
  render();
}

function buildDoctrineRecommendations(builder) {
  const has = (type) => state.buildings.some((building) => building.faction === 'olundar' && building.type === type);
  const candidates = [
    { type: 'road', label: 'Extend road line', meta: 'Logistics spine | 1 turn' },
    !has('mine') ? { type: 'mine', label: 'Claim iron hill', meta: 'Iron for legions and siege' } : null,
    !has('archeryYard') ? { type: 'archeryYard', label: 'Raise archery yard', meta: 'Ranged kill zone' } : null,
    !has('shrine') && state.factions.olundar.resources.influence <= 3 ? { type: 'shrine', label: 'Consecrate Sun Shrine', meta: 'Influence and morale' } : null,
    !has('outpost') && mappedPercent() >= 12 ? { type: 'outpost', label: 'Plant frontier outpost', meta: 'Forward sight and muster' } : null,
    !has('wall') ? { type: 'wall', label: 'Close a kill gate', meta: 'Chokepoint defense' } : null
  ].filter(Boolean);
  const actionable = candidates.filter((item) => {
    const bDef = BUILDING_TYPES[item.type];
    return bDef
      && canAfford(state.factions.olundar.resources, bDef.cost)
      && buildPlacementCandidates(builder, item.type).some((candidate) => candidate.ok);
  });
  const fallback = candidates.length ? candidates : BUILD_ORDER.map((type) => ({
    type,
    label: BUILDING_TYPES[type].name,
    meta: `${formatCost(BUILDING_TYPES[type].cost)} | ${turnCountLabel(BUILDING_TYPES[type].buildTurns)}`
  }));
  return (actionable.length ? actionable : fallback).filter((item) => BUILDING_TYPES[item.type] && !builder.hasActed);
}

function buildOrderButton(builder, type, tone = 'secondary', labelOverride = null, metaOverride = null) {
  const bDef = BUILDING_TYPES[type];
  const affordable = Boolean(bDef && canAfford(state.factions.olundar.resources, bDef.cost));
  const placeable = Boolean(bDef && buildPlacementCandidates(builder, type).some((candidate) => candidate.ok));
  const disabled = !bDef || builder.hasActed || !affordable || !placeable;
  const label = labelOverride || bDef.name;
  const meta = !affordable
    ? `${formatCost(bDef.cost)} required`
    : !placeable
      ? 'No adjacent valid site'
      : metaOverride || `${formatCost(bDef.cost)} | ${turnCountLabel(bDef.buildTurns)}`;
  return orderButton(label, meta, () => enterBuildMode(builder.id, type), { disabled, tone });
}

function turnCountLabel(turns) {
  return `${turns} turn${turns === 1 ? '' : 's'}`;
}

function enterBuildMode(builderId, buildingType) {
  const bDef = BUILDING_TYPES[buildingType];
  if (!bDef) return;
  state.mode = { type: 'build', buildingType, builderId };
  playAudioCue('ui');
  toast(`Build mode: place ${bDef.name} from the survey or highlighted map sites.`);
  render();
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
      ${entry.warAim ? `
        <div class="war-aim ${escapeHtml(entry.warAim.tone)}">
          <strong>War Aim</strong>
          <p>${escapeHtml(entry.warAim.name)} - ${escapeHtml(entry.warAim.text)}</p>
        </div>
      ` : ''}
      ${entry.discovered && (entry.memory.promises || entry.memory.grievances || entry.memory.records.length) ? `
        <div class="diplo-memory ${escapeHtml(entry.memory.tone)}">
          <div class="memory-head">
            <strong>Diplomatic Memory</strong>
            <span>Balance ${entry.memory.balance >= 0 ? '+' : ''}${entry.memory.balance}</span>
          </div>
          <div class="memory-stats">
            <span><b>${entry.memory.promises}</b>Promises</span>
            <span><b>${entry.memory.grievances}</b>Grievances</span>
          </div>
          <p>${escapeHtml(entry.memory.summary)}</p>
          ${entry.memory.records.length ? `
            <div class="memory-records">
              ${entry.memory.records.map((record) => `<p class="${escapeHtml(record.type)}"><b>T${record.turn} ${escapeHtml(record.label)}:</b> ${escapeHtml(record.detail)}</p>`).join('')}
            </div>
          ` : ''}
        </div>
      ` : ''}
      ${entry.recent.length ? `
        <div class="diplo-recent">
          ${entry.recent.map((record) => `<p><b>T${record.turn} ${escapeHtml(record.outcome)}:</b> ${escapeHtml(record.detail)}</p>`).join('')}
        </div>
      ` : ''}
      ${entry.demandHistory.length ? `
        <div class="promise-demand-history">
          ${entry.demandHistory.map((demand) => `<p class="${escapeHtml(demand.tone)}"><b>T${demand.turn} ${escapeHtml(demand.name)}:</b> ${escapeHtml(demand.text)}</p>`).join('')}
        </div>
      ` : ''}
    `;
    if (entry.discovered && state.status === 'playing') {
      if (entry.demands.length) {
        const demandBlock = document.createElement('div');
        demandBlock.className = 'promise-demands';
        demandBlock.innerHTML = '<strong>Promise Demands</strong>';
        for (const demand of entry.demands) {
          const item = document.createElement('div');
          item.className = 'promise-demand';
          item.innerHTML = `
            <p><b>${escapeHtml(demand.name)}</b> ${escapeHtml(demand.text)}</p>
            <small>${escapeHtml(demand.preview)}</small>
          `;
          const actions = document.createElement('div');
          actions.className = 'button-grid demand-actions';
          actions.appendChild(button(`Answer - ${demand.cost}`, () => runAction(() => resolvePromiseDemand(state, entry.id, demand.id, 'answer'), 'diplomacy'), demand.disabled, demand.disabledReason || demand.preview));
          actions.appendChild(button('Ignore demand', () => runAction(() => resolvePromiseDemand(state, entry.id, demand.id, 'ignore'), 'diplomacy'), false, 'Record a grievance and cool relations without spending resources.'));
          item.appendChild(actions);
          demandBlock.appendChild(item);
        }
        card.appendChild(demandBlock);
      }
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
      if (entry.commitments.length) {
        const promiseBlock = document.createElement('div');
        promiseBlock.className = 'faction-promises';
        promiseBlock.innerHTML = '<strong>Faction Promises</strong><p>Spend resources on a civilization-specific commitment that leaves a visible diplomatic memory.</p>';
        const promiseRow = document.createElement('div');
        promiseRow.className = 'button-grid promise-actions';
        for (const promise of entry.commitments) {
          promiseRow.appendChild(button(promise.fulfilled ? `${promise.name} kept` : `${promise.name} - ${promise.cost}`, () => runAction(() => makeDiplomaticPromise(state, entry.id, promise.id), 'diplomacy'), promise.disabled, promise.disabledReason || promise.preview));
        }
        promiseBlock.appendChild(promiseRow);
        card.appendChild(promiseBlock);
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
  body += missionSiteReceiptMarkup(tile);
  if (state.mode.type === 'build' && inMap(tile.x, tile.y)) {
    const def = BUILDING_TYPES[state.mode.buildingType];
    const result = canBuildOn(state, state.mode.buildingType, tile.x, tile.y);
    body += `<div class="build-readout ${result.ok ? 'good' : 'bad'}"><strong>${escapeHtml(def.name)}:</strong> ${escapeHtml(result.ok ? 'Valid build site.' : result.reason)}</div>`;
  }
  body += battleForecastReadout(tile);
  tilePanel.innerHTML = body;
}

function renderMapIntel() {
  const tile = hoverTile || lastTile;
  if (!mapIntel || !tile || !inMap(tile.x, tile.y)) return;
  if (turnReport && window.innerWidth <= 980) {
    mapIntel.hidden = true;
    return;
  }
  mapIntel.hidden = false;
  const intel = mapIntelState(tile);
  mapIntel.className = `map-intel ${intel.tone}`;
  mapIntel.innerHTML = `
    <div class="map-intel-head">
      <span>${escapeHtml(intel.kicker)}</span>
      <strong>${escapeHtml(intel.title)}</strong>
    </div>
    <p>${escapeHtml(intel.detail)}</p>
    <div class="map-intel-stats">
      ${intel.stats.map((stat) => `<span><b>${escapeHtml(stat.value)}</b>${escapeHtml(stat.label)}</span>`).join('')}
    </div>
  `;
}

function renderMapTurnReport() {
  if (!mapTurnReport) return;
  const shouldShow = Boolean(turnReport && window.innerWidth <= 980);
  mapTurnReport.hidden = !shouldShow;
  if (!shouldShow) {
    mapTurnReport.innerHTML = '';
    return;
  }
  const glance = turnReport.metrics.map((item) => `
    <span><b>${escapeHtml(item.value)}</b>${escapeHtml(item.label)}</span>
  `).join('');
  const deltas = turnReport.deltas.length ? `
    <div class="map-turn-report-deltas">
      ${turnReport.deltas.slice(0, 3).map((item) => `
        <span class="${escapeHtml(item.tone)}"><b>${escapeHtml(item.value)}</b> ${escapeHtml(item.label)}</span>
      `).join('')}
    </div>
  ` : '';
  const notes = turnReport.messages.length ? `
    <div class="map-turn-report-notes">
      ${turnReport.messages.slice(0, 2).map((message) => `
        <p class="${escapeHtml(message.tone || 'info')}">${escapeHtml(message.text)}</p>
      `).join('')}
    </div>
  ` : '';
  mapTurnReport.className = `map-turn-report ${turnReport.tone}`;
  mapTurnReport.innerHTML = `
    <div class="map-turn-report-head">
      <span>Turn report</span>
      <strong>${escapeHtml(turnReport.title)}</strong>
      <button type="button" data-action="clear-turn-report" aria-label="Dismiss turn report">Close</button>
    </div>
    <p>${escapeHtml(turnReport.summary)}</p>
    <div class="map-turn-report-glance">${glance}</div>
    ${deltas}
    ${notes}
    <div class="map-turn-report-actions">
      <button type="button" data-action="continue-turn-orders">Continue orders</button>
    </div>
  `;
}

function mapIntelState(tile) {
  if (!isVisible(state, tile.x, tile.y)) {
    return {
      tone: 'hidden',
      kicker: 'Uncharted',
      title: `Sector ${tile.x},${tile.y}`,
      detail: 'Move scouts or build vision to reveal this ground before committing plans.',
      stats: [
        { value: '--', label: 'terrain' },
        { value: 'fog', label: 'status' }
      ]
    };
  }

  const mapTile = tileAt(state, tile.x, tile.y);
  const terrain = mapTile ? TERRAIN[mapTile.terrain] : null;
  const terrainName = terrain?.name || formatTerrainName(mapTile?.terrain || 'unknown');
  const visibleUnit = unitAt(state, tile.x, tile.y);
  const visibleBuilding = buildingAt(state, tile.x, tile.y);
  const road = Boolean(mapTile?.road || state.buildings.some((building) => building.type === 'road' && building.x === tile.x && building.y === tile.y));
  const supplied = Boolean(mapTile && isTileSupplied(state, tile.x, tile.y));
  const selectedUnit = state.units.find((unit) => unit.id === state.selectedUnitId);
  const baseStats = [
    { value: terrainName, label: 'terrain' },
    { value: `${tile.x},${tile.y}`, label: 'sector' }
  ];
  if (road) baseStats.push({ value: 'road', label: 'logistics' });
  else if (supplied) baseStats.push({ value: 'supply', label: 'logistics' });
  if (mapTile?.blight) baseStats.push({ value: `${mapTile.blight}/9`, label: 'blight' });

  const openingAction = openingDirectiveForTile(tile);
  if (openingAction) {
    return {
      tone: 'order',
      kicker: 'Opening order',
      title: openingAction.label,
      detail: `Click to execute this guided order. ${openingAction.meta}`,
      stats: [...baseStats, { value: openingAction.executeMeta || 'ready', label: 'command' }]
    };
  }

  if (state.mode.type === 'build') {
    const def = BUILDING_TYPES[state.mode.buildingType];
    const result = canBuildOn(state, state.mode.buildingType, tile.x, tile.y);
    return {
      tone: result.ok ? 'good' : 'bad',
      kicker: 'Build survey',
      title: def.name,
      detail: result.ok ? 'Valid site. Click to commit this engineer order.' : result.reason,
      stats: [...baseStats, { value: formatCost(def.cost), label: 'cost' }]
    };
  }

  if (selectedUnit?.faction === 'olundar' && state.mode.type === 'select') {
    const def = UNIT_TYPES[selectedUnit.type];
    if (visibleUnit && visibleUnit.id !== selectedUnit.id && isEnemy(state, selectedUnit.faction, visibleUnit.faction)) {
      const forecast = forecastUnitAttack(state, selectedUnit.id, visibleUnit.id);
      return mapIntelForecast(`Engage ${visibleUnit.name}`, forecast, baseStats);
    }
    if (visibleBuilding && isEnemy(state, selectedUnit.faction, visibleBuilding.faction)) {
      const forecast = forecastBuildingAttack(state, selectedUnit.id, visibleBuilding.id);
      return mapIntelForecast(`Strike ${visibleBuilding.name}`, forecast, baseStats);
    }
    if (selectedUnit.hasActed) {
      return {
        tone: 'spent',
        kicker: selectedUnit.name,
        title: terrainName,
        detail: 'Orders spent. Select another ready force or end the turn.',
        stats: [...baseStats, { value: 'acted', label: 'unit' }]
      };
    }
    if (selectedUnit.x === tile.x && selectedUnit.y === tile.y) {
      return {
        tone: 'current',
        kicker: selectedUnit.name,
        title: terrainName,
        detail: 'Current position. Use the highlighted field to choose a destination or hold.',
        stats: [...baseStats, { value: `${def.move}`, label: 'move' }]
      };
    }
    const path = findPath(state, selectedUnit, tile.x, tile.y, def.move);
    if (path) {
      const remaining = Math.max(0, def.move - path.cost);
      const logistics = road ? 'Road-linked move. Click to reposition along Olundar logistics.'
        : supplied ? 'Supplied move. This tile remains inside Olundar command reach.'
          : 'Valid move. Click to spend this unit action here.';
      return {
        tone: road ? 'road' : supplied ? 'good' : 'neutral',
        kicker: selectedUnit.name,
        title: terrainName,
        detail: logistics,
        stats: [...baseStats, { value: `${path.cost}/${def.move}`, label: 'move' }, { value: `${remaining}`, label: 'left' }, { value: supplied ? 'held' : 'field', label: 'supply' }]
      };
    }
    return {
      tone: 'bad',
      kicker: selectedUnit.name,
      title: terrainName,
      detail: 'No legal path inside this unit action. Use roads, scouts, or a closer destination.',
      stats: [...baseStats, { value: `${def.move}`, label: 'move' }]
    };
  }

  const occupant = visibleUnit
    ? `${visibleUnit.name} (${visibleUnit.faction})`
    : visibleBuilding
      ? `${visibleBuilding.name} (${visibleBuilding.faction})`
      : 'Open ground';
  return {
    tone: visibleUnit || visibleBuilding ? 'occupied' : 'neutral',
    kicker: 'Field intel',
    title: terrainName,
    detail: occupant,
    stats: baseStats
  };
}

function mapIntelForecast(title, forecast, baseStats) {
  if (!forecast.ok) {
    return {
      tone: 'bad',
      kicker: 'Attack forecast',
      title,
      detail: forecast.reason,
      stats: [...baseStats, { value: `${forecast.distance}/${forecast.range}`, label: 'range' }]
    };
  }
  return {
    tone: forecast.portalReforms ? 'bad' : forecast.lethal ? 'good' : 'attack',
    kicker: 'Attack forecast',
    title,
    detail: forecast.portalReforms ? forecast.note : forecast.lethal ? 'Lethal strike if committed.' : forecast.note,
    stats: [
      ...baseStats,
      { value: `${forecast.damage}`, label: 'damage' },
      { value: `${forecast.targetHpBefore}->${forecast.targetHpAfter}`, label: 'hp' },
      { value: `${forecast.distance}/${forecast.range}`, label: 'range' }
    ]
  };
}

function formatTerrainName(type) {
  return String(type)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function missionSiteReceiptMarkup(tile) {
  const mission = focusedArchivedMission();
  if (!mission || !tile || mission.x !== tile.x || mission.y !== tile.y) return '';
  return `
    <div class="mission-site-receipt">
      <strong>T${escapeHtml(mission.completedTurn)} Field Receipt</strong>
      <span>${escapeHtml(mission.name)}${mission.context ? ` / ${escapeHtml(mission.context)}` : ''}</span>
      <p>${escapeHtml(mission.reward)}</p>
      ${mission.completedBy ? `<small>Completed by ${escapeHtml(mission.completedBy)}.</small>` : ''}
    </div>
  `;
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
    modeBanner.textContent = `Build mode: ${def.name}. Click a highlighted valid site or use the placement survey in Orders. Esc cancels.`;
    modeBanner.hidden = false;
  } else {
    modeBanner.hidden = true;
  }
}

function renderMobileIntelDrawer() {
  if (!mobileIntelDrawer) return;
  const council = getWarCouncil(state);
  const guide = getFirstTurnsGuide(state);
  const deadPressure = council.stats.find((stat) => stat.label === 'Dead pressure')?.value || 'Unknown';
  const opening = guide.visible ? `${guide.completed}/${guide.total} opening` : `${getReadyOlundarUnits(state).length} ready`;
  if (mobileIntelDrawerSummary) {
    mobileIntelDrawerSummary.textContent = `${mappedPercent()}% mapped - ${opening} - Dead ${deadPressure.toLowerCase()}`;
  }
  syncMobileIntelDrawer();
}

function syncMobileIntelDrawer() {
  if (!mobileIntelDrawer) return;
  if (!isMobileIntelDrawerMode()) {
    mobileIntelDrawerTouched = false;
    setMobileIntelDrawerOpen(true);
    return;
  }
  if (!mobileIntelDrawerTouched) {
    setMobileIntelDrawerOpen(mobileIntelNeedsAttention());
  }
}

function mobileIntelNeedsAttention() {
  if (state.status !== 'playing') return true;
  return panelHasVisibleContent(crisisPanel) || panelHasVisibleContent(missionPanel) || panelHasVisibleContent(operationsPanel);
}

function panelHasVisibleContent(panel) {
  return Boolean(panel && !panel.hidden && panel.textContent.trim());
}

function isMobileIntelDrawerMode() {
  return window.innerWidth <= 620;
}

function setMobileIntelDrawerOpen(open) {
  if (!mobileIntelDrawer || mobileIntelDrawer.open === open) return;
  syncingMobileIntelDrawer = true;
  mobileIntelDrawer.open = open;
  window.setTimeout(() => {
    syncingMobileIntelDrawer = false;
  }, 0);
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

  const openingAction = openingDirectiveForTile(tile);
  if (openingAction) {
    executeOpeningDirective(openingAction);
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
    if (successCue === 'attack') battleImpact = null;
    if (result.reason) toast(result.reason, 'bad');
    playAudioCue('error');
    return false;
  }
  turnReport = null;
  if (successCue === 'attack') captureBattleImpact(result);
  if (result.reason) toast(result.reason);
  if (successCue) playAudioCue(successCue);
  return true;
}

function captureBattleImpact(result) {
  if (!['unit', 'building'].includes(result.type) || !Number.isFinite(result.targetX) || !Number.isFinite(result.targetY)) return;
  const hpBefore = Number.isFinite(result.targetHpBefore) ? result.targetHpBefore : null;
  const hpAfter = Number.isFinite(result.targetHpAfter) ? result.targetHpAfter : null;
  battleImpact = {
    x: result.targetX,
    y: result.targetY,
    type: result.type,
    tone: result.portalReforms ? 'bad' : result.targetDestroyed || result.lethal ? 'good' : 'info',
    attackerName: result.attackerName || 'Attacker',
    targetName: result.targetName || 'Target',
    damage: Number.isFinite(result.damage) ? result.damage : 0,
    hpBefore,
    hpAfter,
    targetDestroyed: !result.portalReforms && Boolean(result.targetDestroyed || result.lethal),
    portalReforms: Boolean(result.portalReforms)
  };
  lastTile = { x: result.targetX, y: result.targetY };
}

function battleImpactCard() {
  const card = document.createElement('article');
  card.className = `battle-impact ${battleImpact.tone}`;
  const hpText = battleImpact.portalReforms
    ? `${battleImpact.hpBefore} -> reforms to ${battleImpact.hpAfter}`
    : battleImpact.hpBefore !== null && battleImpact.hpAfter !== null
      ? `${battleImpact.hpBefore} -> ${battleImpact.hpAfter}`
      : 'resolved';
  const outcome = battleImpact.portalReforms
    ? 'The portal knits itself around Vorgath.'
    : battleImpact.targetDestroyed
      ? 'Target broken.'
      : 'Target still stands.';
  card.innerHTML = `
    <div>
      <span>Last Strike</span>
      <strong>${escapeHtml(battleImpact.attackerName)} -> ${escapeHtml(battleImpact.targetName)}</strong>
    </div>
    <p><b>${escapeHtml(battleImpact.damage)}</b> damage. HP ${escapeHtml(hpText)}. ${escapeHtml(outcome)}</p>
    <button type="button" data-action="clear-battle-impact" aria-label="Dismiss battle impact">Close</button>
  `;
  return card;
}

function captureTurnSnapshot() {
  const resources = state.factions.olundar.resources;
  return {
    latestMessage: state.messages[0] || null,
    resources: Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, Math.floor(value || 0)])),
    mapped: mappedPercent(),
    deadUnits: state.units.filter((unit) => unit.faction === 'dead').length,
    deadBuildings: state.buildings.filter((building) => building.faction === 'dead').length
  };
}

function buildTurnReport(before, previousTurn) {
  const resources = state.factions.olundar.resources;
  const resourceDeltas = ['food', 'wood', 'stone', 'iron', 'gold', 'influence', 'morale']
    .map((key) => {
      const beforeValue = before.resources[key] || 0;
      const currentValue = Math.floor(resources[key] || 0);
      return { key, label: RESOURCE_NAMES[key], delta: currentValue - beforeValue, currentValue };
    })
    .filter((item) => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const boundary = before.latestMessage ? state.messages.indexOf(before.latestMessage) : -1;
  const messages = (boundary >= 0 ? state.messages.slice(0, boundary) : state.messages.slice(0, 4))
    .filter((message) => message && message.turn >= previousTurn)
    .slice(0, 4);
  const readyUnits = getReadyOlundarUnits(state).length;
  const mapped = mappedPercent();
  const deadUnits = state.units.filter((unit) => unit.faction === 'dead').length;
  const deadBuildings = state.buildings.filter((building) => building.faction === 'dead').length;
  const deadPressureDelta = (deadUnits + deadBuildings) - (before.deadUnits + before.deadBuildings);
  const dangerMessage = messages.find((message) => ['bad', 'danger'].includes(message.tone));
  const goodMessage = messages.find((message) => message.tone === 'good');
  const summaryMessage = dangerMessage || goodMessage || messages[0];
  const tone = state.status === 'lost'
    ? 'bad'
    : state.status === 'won'
      ? 'good'
      : dangerMessage || deadPressureDelta > 0
        ? 'bad'
        : goodMessage || resourceDeltas.some((item) => item.delta > 0)
          ? 'good'
          : 'info';
  const deltas = resourceDeltas.slice(0, 4).map((item) => ({
    label: item.label,
    value: `${item.delta > 0 ? '+' : ''}${item.delta}`,
    tone: item.delta > 0 ? 'good' : 'bad'
  }));
  const readyClause = readyUnits
    ? `${readyUnits} Olundaran force${readyUnits === 1 ? '' : 's'} await fresh orders.`
    : 'No idle Olundaran forces remain.';
  const pressureClause = deadPressureDelta > 0
    ? `Deadwalker pressure rose by ${deadPressureDelta}.`
    : deadPressureDelta < 0
      ? `Deadwalker pressure fell by ${Math.abs(deadPressureDelta)}.`
      : '';
  const pressureToast = deadPressureDelta > 0
    ? `Dead +${deadPressureDelta}`
    : deadPressureDelta < 0
      ? `Dead -${Math.abs(deadPressureDelta)}`
      : 'Dead steady';
  const readyToast = readyUnits
    ? `${readyUnits} ready`
    : 'no idle forces';
  const storesClause = resourceDeltas.length
    ? `Stores shifted ${resourceDeltas.slice(0, 3).map((item) => `${item.delta > 0 ? '+' : ''}${item.delta} ${item.label}`).join(', ')}.`
    : '';
  const summary = summaryMessage
    ? summaryMessage.text
    : [pressureClause, storesClause, readyClause].filter(Boolean).join(' ');
  return {
    title: `Turn ${previousTurn} -> ${state.turn}`,
    tone,
    summary,
    toast: `Turn ${state.turn} resolved - ${pressureToast}, ${readyToast}.`,
    metrics: [
      { label: 'Ready', value: String(readyUnits) },
      { label: 'Mapped', value: `${mapped}%${mapped !== before.mapped ? ` (${mapped > before.mapped ? '+' : ''}${mapped - before.mapped})` : ''}` },
      { label: 'Population', value: `${state.factions.olundar.population}/${state.factions.olundar.housing}` },
      { label: 'Dead pressure', value: `${deadUnits + deadBuildings}${deadPressureDelta ? ` (${deadPressureDelta > 0 ? '+' : ''}${deadPressureDelta})` : ''}` }
    ],
    deltas,
    messages
  };
}

function turnReportCard() {
  const card = document.createElement('article');
  card.className = `turn-report ${turnReport.tone}`;
  const metrics = turnReport.metrics.map((item) => `
    <span><b>${escapeHtml(item.value)}</b>${escapeHtml(item.label)}</span>
  `).join('');
  const deltas = turnReport.deltas.length ? `
    <div class="turn-report-deltas">
      ${turnReport.deltas.map((item) => `<span class="${escapeHtml(item.tone)}"><b>${escapeHtml(item.value)}</b> ${escapeHtml(item.label)}</span>`).join('')}
    </div>
  ` : '';
  const messages = turnReport.messages.length ? `
    <div class="turn-report-notes">
      ${turnReport.messages.map((message) => `<p class="${escapeHtml(message.tone || 'info')}">${escapeHtml(message.text)}</p>`).join('')}
    </div>
  ` : '';
  const glance = turnReport.metrics.slice(0, 2).map((item) => `
    <span><b>${escapeHtml(item.value)}</b>${escapeHtml(item.label)}</span>
  `).join('');
  const detailsOpen = isMobileIntelDrawerMode() ? '' : ' open';
  card.innerHTML = `
    <div class="turn-report-head">
      <span>Campaign Report</span>
      <strong>${escapeHtml(turnReport.title)}</strong>
      <button type="button" data-action="clear-turn-report" aria-label="Dismiss turn report">Close</button>
    </div>
    <p>${escapeHtml(turnReport.summary)}</p>
    <div class="turn-report-actions">
      <button type="button" data-action="continue-turn-orders">Continue orders</button>
    </div>
    <div class="turn-report-glance">${glance}</div>
    <details class="turn-report-detail-drawer"${detailsOpen}>
      <summary><span>Report details</span><small>Metrics, stores, notes</small></summary>
      <div class="turn-report-metrics">${metrics}</div>
      ${deltas}
      ${messages}
    </details>
  `;
  return card;
}

function openingDoctrineCard() {
  const directive = currentOpeningDirective();
  if (!directive || state.status !== 'playing') return null;
  const { guide, current } = directive;
  const recommendation = openingDirectiveAction(current.id);
  const card = document.createElement('article');
  card.className = 'opening-doctrine';
  card.innerHTML = `
    <div class="opening-doctrine-head">
      <span>${escapeHtml(guide.title)}</span>
      <b>${escapeHtml(`${guide.completed}/${guide.total}`)}</b>
    </div>
    <strong>${escapeHtml(current.label)}</strong>
    <p>${escapeHtml(current.detail)}</p>
    <small>${escapeHtml(guide.phase)}</small>
    ${recommendation ? `
      <div class="doctrine-recommendation">
        <span>Recommended Order</span>
        <strong>${escapeHtml(recommendation.label)}</strong>
        <small>${escapeHtml(recommendation.meta)}</small>
      </div>
    ` : ''}
  `;
  const actions = commandActions('doctrine-actions');
  if (recommendation?.canExecute) {
    actions.appendChild(orderButton(recommendation.executeLabel || 'Do order', recommendation.executeMeta || recommendation.meta, () => executeOpeningDirective(recommendation), {
      disabled: Boolean(recommendation.disabled),
      tone: 'primary'
    }));
  }
  actions.appendChild(orderButton(recommendation ? 'Preview' : 'Focus order', recommendation?.previewMeta || focusOpeningDirectiveMeta(current.id), () => focusOpeningDirective(current.id), {
    tone: recommendation?.canExecute ? 'secondary' : 'primary'
  }));
  card.appendChild(actions);
  return card;
}

function diplomacyOpportunityCard() {
  const opportunity = currentDiplomacyOpportunity();
  if (!opportunity || state.status !== 'playing') return null;
  const card = document.createElement('article');
  card.className = 'opening-doctrine diplomacy-doctrine';
  card.innerHTML = `
    <div class="opening-doctrine-head">
      <span>Envoy Opportunity</span>
      <b>${escapeHtml(opportunity.badge)}</b>
    </div>
    <strong>${escapeHtml(opportunity.title)}</strong>
    <p>${escapeHtml(opportunity.detail)}</p>
    <small>${escapeHtml(opportunity.phase)}</small>
    <div class="doctrine-recommendation">
      <span>Diplomatic Order</span>
      <strong>${escapeHtml(opportunity.recommendation)}</strong>
      <small>${escapeHtml(opportunity.meta)}</small>
    </div>
  `;
  const actions = commandActions('doctrine-actions envoy-actions');
  actions.appendChild(orderButton('Seal Survival Pact', opportunity.cost, () => runAction(() => executeDiplomacyOpportunity(opportunity), 'diplomacy'), {
    tone: 'primary'
  }));
  actions.appendChild(orderButton('Show ally lens', 'Shared sight and pact options', () => focusDiplomacyOpportunity(opportunity.entry.id)));
  card.appendChild(actions);
  return card;
}

function currentDiplomacyOpportunity() {
  const ledger = getDiplomacyLedger(state);
  const pactTrustGain = DIPLOMACY_ACTIONS.pact?.relation || 0;
  const entry = ledger.entries.find((item) => {
    if (!item.discovered || item.pact || item.atWar || item.relation + pactTrustGain < PACT_ACCEPTANCE_RELATION) return false;
    return item.actions.some((action) => action.id === 'pact' && !action.disabled);
  });
  if (!entry) return null;
  const action = entry.actions.find((item) => item.id === 'pact');
  return {
    entry,
    action,
    badge: `${entry.relation} trust`,
    title: `Bind ${entry.name} to the living front`,
    detail: `${entry.name} has enough trust for an oath offer to become a Survival Pact. Shared vision and emergency aid should not be buried below routine field orders.`,
    phase: 'Diplomacy into survival',
    recommendation: 'Offer Survival Pact',
    meta: `${entry.posture.label} - ${entry.advice}`,
    cost: action.cost
  };
}

function executeDiplomacyOpportunity(opportunity) {
  const result = performDiplomacy(state, opportunity.entry.id, opportunity.action.id);
  if (!result.ok) return result;
  activeMapLens = 'alliance';
  return {
    ...result,
    reason: `${opportunity.entry.name} signs the Survival Pact. Alliance vision is now on the map.`
  };
}

function focusDiplomacyOpportunity(factionId) {
  activeMapLens = 'alliance';
  render();
  const card = diplomacyPanel.querySelector(`.diplo-card.known`);
  const target = [...diplomacyPanel.querySelectorAll('.diplo-card.known')].find((item) => item.textContent.includes(state.factions[factionId]?.name || '')) || card;
  target?.scrollIntoView({ block: 'start', behavior: playerSettings.motion === 'reduced' ? 'auto' : 'smooth' });
}

function pactFieldCommandCard() {
  const opportunity = currentPactFieldCommand();
  if (!opportunity || state.status !== 'playing') return null;
  const { entry, recommendation } = opportunity;
  const activeOrder = entry.fieldOrder || entry.fieldOrders.find((order) => order.active);
  const card = document.createElement('article');
  card.className = 'opening-doctrine diplomacy-doctrine pact-command';
  card.innerHTML = `
    <div class="opening-doctrine-head">
      <span>Pact Field Command</span>
      <b>${escapeHtml(opportunity.badge)}</b>
    </div>
    <strong>${escapeHtml(entry.name)}: ${escapeHtml(activeOrder?.name || 'Awaiting order')}</strong>
    <p>${escapeHtml(opportunity.detail)}</p>
    <small>${escapeHtml(opportunity.phase)}</small>
    <div class="doctrine-recommendation">
      <span>Recommended Pact Order</span>
      <strong>${escapeHtml(recommendation.name)}</strong>
      <small>${escapeHtml(recommendation.text)}</small>
    </div>
  `;
  const actions = commandActions('doctrine-actions pact-actions');
  for (const order of entry.fieldOrders) {
    const active = Boolean(order.active);
    actions.appendChild(orderButton(order.name, active ? 'Active order' : order.text, () => runAction(() => executePactFieldOrder(entry, order), 'diplomacy'), {
      disabled: active || order.disabled,
      title: order.disabledReason || order.text,
      tone: order.id === recommendation.id ? 'primary' : 'secondary'
    }));
  }
  actions.appendChild(orderButton('Show ally lens', 'Shared sight and pact positions', () => focusDiplomacyOpportunity(entry.id)));
  card.appendChild(actions);
  return card;
}

function currentPactFieldCommand() {
  const ledger = getDiplomacyLedger(state);
  const pactEntries = ledger.entries
    .filter((entry) => entry.discovered && entry.pact && !entry.atWar && entry.fieldOrders.length)
    .sort((a, b) => {
      const aRecommended = recommendedPactFieldOrderId(a);
      const bRecommended = recommendedPactFieldOrderId(b);
      return Number(a.fieldOrder?.id === aRecommended) - Number(b.fieldOrder?.id === bRecommended);
    });
  const entry = pactEntries[0];
  if (!entry) return null;
  const recommendationId = recommendedPactFieldOrderId(entry);
  const recommendation = entry.fieldOrders.find((order) => order.id === recommendationId)
    || entry.fieldOrders.find((order) => !order.active)
    || entry.fieldOrders[0];
  return {
    entry,
    recommendation,
    badge: `${pactEntries.length} pact${pactEntries.length === 1 ? '' : 's'}`,
    phase: pactCommandKnownDeadPressure() ? 'Alliance into warfront' : 'Alliance into patrols',
    detail: pactCommandKnownDeadPressure()
      ? 'Deadwalker pressure is visible. Give this ally a live field order so shared vision becomes coordinated movement.'
      : 'A Survival Pact is active. Set the allied behavior now so this civilization protects roads, reinforces Olundar, or prepares the eastern push.'
  };
}

function recommendedPactFieldOrderId(entry) {
  if (pactCommandCapitalThreat()) return 'reinforceCapital';
  if (pactCommandKnownDeadPressure()) return 'harassDeadworks';
  if (entry.id === 'dawn') return 'defendRoads';
  return state.turn <= 8 ? 'defendRoads' : 'reinforceCapital';
}

function pactCommandKnownDeadPressure() {
  return Boolean(state.flags.firstDeadwalkerSeen)
    || state.units.some((unit) => unit.faction === 'dead' && isVisible(state, unit.x, unit.y))
    || state.buildings.some((building) => building.faction === 'dead' && isVisible(state, building.x, building.y));
}

function pactCommandCapitalThreat() {
  const capital = state.buildings.find((building) => building.faction === 'olundar' && building.type === 'city');
  if (!capital) return false;
  return state.units.some((unit) => unit.faction === 'dead'
    && isVisible(state, unit.x, unit.y)
    && Math.abs(unit.x - capital.x) + Math.abs(unit.y - capital.y) <= 8);
}

function executePactFieldOrder(entry, order) {
  const result = setFieldOrder(state, entry.id, order.id);
  if (!result.ok) return result;
  activeMapLens = 'alliance';
  return {
    ...result,
    reason: `${entry.name}: ${order.name}. Alliance lens shows the shared front.`
  };
}

function openingDirectiveAction(stepId) {
  if (['scout', 'contact', 'front'].includes(stepId)) {
    const scout = openingUnitByTag('recon');
    const destination = scout ? bestScoutAdvance(scout) : null;
    if (!scout || !destination) return null;
    return {
      kind: 'move',
      unitId: scout.id,
      x: destination.x,
      y: destination.y,
      canExecute: !scout.hasActed,
      disabled: scout.hasActed,
      label: `Advance ${scout.name}`,
      meta: `${destination.revealGain} new map tile${destination.revealGain === 1 ? '' : 's'} | ${destination.cost}/${UNIT_TYPES[scout.type].move} move`,
      executeLabel: 'Do order',
      executeMeta: `${destination.x},${destination.y} sector`,
      previewMeta: `Preview ${destination.x},${destination.y} sector`,
      previewToast: `${scout.name} can scout ${destination.x},${destination.y} and reveal ${destination.revealGain} new map tile${destination.revealGain === 1 ? '' : 's'}.`
    };
  }

  if (stepId === 'training') {
    return recommendedTrainingOrder();
  }

  if (stepId === 'engineer') {
    return openingBlockedInfrastructureAction(recommendedBuildPreview(stepId));
  }

  if (stepId === 'iron') {
    return recommendedIronOrder();
  }

  return null;
}

function openingBlockedInfrastructureAction(action) {
  if (!action || action.kind !== 'build' || action.canExecute) return action;
  const builder = state.units.find((unit) => unit.id === action.unitId);
  if (!builder?.hasActed) return action;
  return blockedBuilderRecovery(builder, action.label, action.label);
}

function blockedBuilderRecovery(builder, blockedLabel, nextLabel = blockedLabel) {
  const readyUnits = getReadyOlundarUnits(state).filter((unit) => unit.id !== builder.id);
  const scout = readyUnits.find((unit) => UNIT_TYPES[unit.type].tags.includes('recon'));
  const scoutDestination = scout ? bestScoutAdvance(scout) : null;
  if (scout && scoutDestination) {
    return {
      kind: 'move',
      unitId: scout.id,
      x: scoutDestination.x,
      y: scoutDestination.y,
      canExecute: true,
      label: 'Scout while engineer readies',
      meta: `${scoutDestination.revealGain} new map tile${scoutDestination.revealGain === 1 ? '' : 's'} | ${blockedLabel} next`,
      executeLabel: 'Do order',
      executeMeta: `${scoutDestination.x},${scoutDestination.y} contact search`,
      previewMeta: `Preview ${scoutDestination.x},${scoutDestination.y} scout route`,
      previewToast: `${scout.name} can keep searching for allies while the engineer prepares ${nextLabel}.`,
      successToast: `${scout.name} scouts ahead while the engineer resets.`
    };
  }
  const guard = readyUnits.find((unit) => !UNIT_TYPES[unit.type].tags.includes('builder')) || readyUnits[0];
  if (guard) {
    return {
      kind: 'fortify',
      unitId: guard.id,
      canExecute: true,
      label: `Fortify ${guard.name}`,
      meta: `${blockedLabel} needs a fresh engineer next turn`,
      executeLabel: 'Do order',
      executeMeta: 'Hold the line before ending turn',
      previewMeta: `Focus ${guard.name}`,
      previewToast: `${guard.name} can fortify now while the engineer prepares the iron claim.`,
      successToast: `${guard.name} fortified.`
    };
  }
  return {
    kind: 'end-turn',
    canExecute: true,
    label: 'End turn for fresh engineer',
    meta: `${nextLabel} is ready for turn ${state.turn + 1}`,
    executeLabel: 'Do order',
    executeMeta: `Advance to turn ${state.turn + 1}`,
    previewMeta: 'Review turn pass',
    previewToast: `End the turn so ${builder.name} can claim iron with a fresh action.`
  };
}

function focusOpeningDirectiveMeta(stepId) {
  if (['engineer', 'iron'].includes(stepId)) return 'Select a builder and show the map';
  if (stepId === 'training') return 'Select the city queue';
  if (['contact', 'front', 'scout'].includes(stepId)) return 'Select a scout and show the map';
  return 'Jump to the right command surface';
}

function focusOpeningDirective(stepId) {
  const recommendation = openingDirectiveAction(stepId);
  if (recommendation) {
    previewOpeningDirective(recommendation);
    return;
  }
  const readyOlundar = state.units.filter((unit) => unit.faction === 'olundar' && !unit.hasActed);
  const allOlundar = state.units.filter((unit) => unit.faction === 'olundar');
  const byTag = (tag) => openingUnitByTag(tag);
  let targetUnit = null;
  let targetBuilding = null;

  if (['engineer', 'iron'].includes(stepId)) {
    targetUnit = byTag('builder');
  } else if (stepId === 'training') {
    targetBuilding = state.buildings.find((building) => {
      const def = BUILDING_TYPES[building.type];
      return building.faction === 'olundar' && building.turnsLeft <= 0 && def?.trains?.length;
    });
  } else {
    targetUnit = byTag('recon') || readyOlundar[0] || allOlundar[0];
  }

  if (targetBuilding) {
    selectBuilding(targetBuilding.id);
    lastTile = { x: targetBuilding.x, y: targetBuilding.y };
    hoverTile = lastTile;
    const def = BUILDING_TYPES[targetBuilding.type];
    toast(`${def.name} ready for the next opening order.`, 'info');
    playAudioCue('select');
    render();
    if (window.innerWidth <= 980) actionPanel.scrollIntoView({ block: 'start', behavior: playerSettings.motion === 'reduced' ? 'auto' : 'smooth' });
    return;
  }

  if (targetUnit) {
    selectUnit(targetUnit.id);
    lastTile = { x: targetUnit.x, y: targetUnit.y };
    hoverTile = lastTile;
    toast(`${targetUnit.name} focused for the next opening order.`, 'info');
    playAudioCue('select');
    render();
    if (window.innerWidth <= 980) scrollBattlefieldIntoView();
    return;
  }

  toast('No matching force is ready for that opening order.', 'bad');
  playAudioCue('warning');
}

function openingUnitByTag(tag) {
  const readyOlundar = state.units.filter((unit) => unit.faction === 'olundar' && !unit.hasActed);
  const allOlundar = state.units.filter((unit) => unit.faction === 'olundar');
  return readyOlundar.find((unit) => UNIT_TYPES[unit.type].tags.includes(tag))
    || allOlundar.find((unit) => UNIT_TYPES[unit.type].tags.includes(tag));
}

function bestScoutAdvance(unit) {
  const def = UNIT_TYPES[unit.type];
  const candidates = [];
  const minX = Math.max(0, unit.x - def.move);
  const maxX = Math.min(MAP_WIDTH - 1, unit.x + def.move);
  const minY = Math.max(0, unit.y - def.move);
  const maxY = Math.min(MAP_HEIGHT - 1, unit.y + def.move);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if ((x === unit.x && y === unit.y) || gridDistance(unit.x, unit.y, x, y) > def.move) continue;
      const path = findPath(state, unit, x, y, def.move);
      if (!path) continue;
      const tile = tileAt(state, x, y);
      const revealGain = forecastRevealGain(unit, x, y);
      const terrainBonus = tile?.terrain === 'ruins' ? 5 : tile?.terrain === 'hills' ? 3 : tile?.terrain === 'forest' ? 2 : tile?.terrain === 'river' ? -3 : 0;
      const roadBonus = tile?.road ? 3 : 0;
      const forwardBonus = (x - unit.x) * 0.9 - Math.abs(y - unit.y) * 0.15;
      const score = revealGain * 10 + terrainBonus + roadBonus + forwardBonus - path.cost * 0.6;
      candidates.push({ x, y, cost: path.cost, revealGain, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || b.revealGain - a.revealGain || a.cost - b.cost || b.x - a.x)[0] || null;
}

function forecastRevealGain(unit, x, y) {
  const def = UNIT_TYPES[unit.type];
  const tile = tileAt(state, x, y);
  const radius = Math.max(1, def.sight + Math.max(-1, TERRAIN[tile?.terrain]?.sight || 0));
  let gain = 0;
  for (let ty = y - radius; ty <= y + radius; ty += 1) {
    for (let tx = x - radius; tx <= x + radius; tx += 1) {
      if (!inMap(tx, ty) || gridDistance(x, y, tx, ty) > radius) continue;
      if (!state.revealed[ty * MAP_WIDTH + tx]) gain += 1;
    }
  }
  return gain;
}

function gridDistance(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function recommendedTrainingOrder() {
  const buildings = state.buildings.filter((building) => {
    const def = BUILDING_TYPES[building.type];
    return building.faction === 'olundar' && building.turnsLeft <= 0 && def?.trains?.length && building.queue.length < trainingQueueLimit(building);
  });
  for (const building of buildings) {
    const def = BUILDING_TYPES[building.type];
    const unitType = (def.trains.includes('scout') && canAfford(state.factions.olundar.resources, UNIT_TYPES.scout.cost))
      ? 'scout'
      : def.trains.find((type) => canAfford(state.factions.olundar.resources, UNIT_TYPES[type].cost));
    if (!unitType) continue;
    const unitDef = UNIT_TYPES[unitType];
    const turns = trainingTurnsFor(building, unitType);
    return {
      kind: 'train',
      buildingId: building.id,
      unitType,
      canExecute: true,
      label: `Queue ${unitDef.name}`,
      meta: `${formatCost(unitDef.cost)} | ${turns} turn${turns === 1 ? '' : 's'}`,
      executeLabel: 'Do order',
      executeMeta: `${BUILDING_TYPES[building.type].name} queue`,
      previewMeta: `Inspect ${BUILDING_TYPES[building.type].name}`,
      previewToast: `${BUILDING_TYPES[building.type].name} can queue ${unitDef.name}.`
    };
  }
  return null;
}

function recommendedBuildPreview(stepId) {
  const engineer = openingUnitByTag('builder');
  if (!engineer) return null;
  const buildOrder = ['road', 'farm', 'lumberCamp', 'mine', 'watchtower'];
  const sites = [{ x: engineer.x, y: engineer.y }, ...neighborsOf(engineer.x, engineer.y)];
  for (const type of buildOrder) {
    for (const site of sites) {
      const result = canBuildOn(state, type, site.x, site.y);
      if (!result.ok) continue;
      return {
        kind: 'build',
        unitId: engineer.id,
        buildingType: type,
        x: site.x,
        y: site.y,
        canExecute: !engineer.hasActed,
        disabled: engineer.hasActed,
        label: `Start ${BUILDING_TYPES[type].name}`,
        meta: `${site.x},${site.y} sector | ${formatCost(BUILDING_TYPES[type].cost)}`,
        executeLabel: 'Do order',
        executeMeta: `${BUILDING_TYPES[type].name} at ${site.x},${site.y}`,
        previewMeta: `Preview ${BUILDING_TYPES[type].name} site`,
        previewToast: `${engineer.name} can start ${BUILDING_TYPES[type].name} at ${site.x},${site.y}.`,
        successToast: `${BUILDING_TYPES[type].name} started at ${site.x},${site.y}.`
      };
    }
  }
  return {
    kind: 'focus',
    unitId: engineer.id,
    x: engineer.x,
    y: engineer.y,
    label: `Focus ${engineer.name}`,
    meta: 'Choose a valid construction site',
    previewMeta: 'Select builder',
    previewToast: `${engineer.name} is ready for construction.`
  };
}

function recommendedIronOrder() {
  const engineer = openingUnitByTag('builder');
  if (!engineer) return null;
  const mine = recommendedMineBuild(engineer);
  if (mine) return openingBlockedInfrastructureAction(mine);
  if (engineer.hasActed) return blockedBuilderRecovery(engineer, 'Hill Mine route', 'Hill Mine route');
  const target = bestIronMineTarget(engineer);
  if (!target) {
    return {
      kind: 'focus',
      unitId: engineer.id,
      x: engineer.x,
      y: engineer.y,
      label: `Focus ${engineer.name}`,
      meta: 'Scout hills or ruins for the first mine',
      previewMeta: 'Select builder',
      previewToast: `${engineer.name} needs a visible hill or ruin route before claiming iron.`
    };
  }
  const roadAdvance = bestIronRoadAdvance(engineer, target);
  if (roadAdvance) return roadAdvance;
  const roadExtension = recommendedIronRoadExtension(engineer, target);
  if (roadExtension) return roadExtension;
  return bestIronAdvance(engineer, target) || {
    kind: 'focus',
    unitId: engineer.id,
    x: engineer.x,
    y: engineer.y,
    label: `Focus ${engineer.name}`,
    meta: `Plan the road toward ${target.x},${target.y}`,
    previewMeta: 'Select builder',
    previewToast: `${engineer.name} needs a clearer route to the first mine site.`
  };
}

function recommendedMineBuild(engineer) {
  const sites = [{ x: engineer.x, y: engineer.y }, ...neighborsOf(engineer.x, engineer.y)];
  for (const site of sites) {
    const result = canBuildOn(state, 'mine', site.x, site.y);
    if (!result.ok) continue;
    return {
      kind: 'build',
      unitId: engineer.id,
      buildingType: 'mine',
      x: site.x,
      y: site.y,
      canExecute: !engineer.hasActed,
      disabled: engineer.hasActed,
      label: 'Start Hill Mine',
      meta: `${site.x},${site.y} iron site | ${formatCost(BUILDING_TYPES.mine.cost)}`,
      executeLabel: 'Do order',
      executeMeta: `Hill Mine at ${site.x},${site.y}`,
      previewMeta: 'Preview Hill Mine site',
      previewToast: `${engineer.name} can open iron production at ${site.x},${site.y}.`,
      successToast: `Hill Mine started at ${site.x},${site.y}.`
    };
  }
  return null;
}

function bestIronMineTarget(engineer) {
  const candidates = [];
  for (const tile of state.map.tiles) {
    if (!['hills', 'ruins'].includes(tile.terrain)) continue;
    if (buildingAt(state, tile.x, tile.y)) continue;
    const path = findPath(state, engineer, tile.x, tile.y, Infinity);
    if (!path) continue;
    const roadBias = tile.road ? -8 : 0;
    const terrainBias = tile.terrain === 'hills' ? -4 : 5;
    const revealedBias = state.revealed[tile.y * MAP_WIDTH + tile.x] ? -2 : 0;
    const dawnHillBias = gridDistance(tile.x, tile.y, 14, 8) * 0.12;
    const score = path.cost * 10 + terrainBias + roadBias + revealedBias + dawnHillBias;
    candidates.push({ x: tile.x, y: tile.y, terrain: tile.terrain, road: tile.road, cost: path.cost, score });
  }
  return candidates.sort((a, b) => a.score - b.score || a.cost - b.cost || a.y - b.y || a.x - b.x)[0] || null;
}

function bestIronRoadAdvance(engineer, target) {
  const currentPath = findPath(state, engineer, target.x, target.y, Infinity);
  if (!currentPath) return null;
  const def = UNIT_TYPES[engineer.type];
  const candidates = [];
  for (const tile of state.map.tiles) {
    if (!tile.road || (tile.x === engineer.x && tile.y === engineer.y)) continue;
    const movePath = findPath(state, engineer, tile.x, tile.y, def.move);
    if (!movePath) continue;
    const remainingPath = findPath(state, { ...engineer, x: tile.x, y: tile.y }, target.x, target.y, Infinity);
    if (!remainingPath || remainingPath.cost >= currentPath.cost) continue;
    const playerRoad = state.buildings.some((building) => building.faction === 'olundar' && building.type === 'road' && building.turnsLeft <= 0 && building.x === tile.x && building.y === tile.y);
    candidates.push({
      x: tile.x,
      y: tile.y,
      cost: movePath.cost,
      remaining: remainingPath.cost,
      score: remainingPath.cost * 10 + movePath.cost - (playerRoad ? 6 : 1)
    });
  }
  const destination = candidates.sort((a, b) => a.score - b.score || a.remaining - b.remaining || a.cost - b.cost)[0];
  if (!destination) return null;
  return ironMoveDirective(engineer, destination, target, 'Advance along the iron road', `road march | ${destination.cost}/${def.move} move`);
}

function recommendedIronRoadExtension(engineer, target) {
  const sites = [{ x: engineer.x, y: engineer.y }, ...neighborsOf(engineer.x, engineer.y)];
  const candidates = [];
  for (const site of sites) {
    const result = canBuildOn(state, 'road', site.x, site.y);
    if (!result.ok) continue;
    const remainingPath = findPath(state, { ...engineer, x: site.x, y: site.y }, target.x, target.y, Infinity);
    if (!remainingPath) continue;
    candidates.push({
      ...site,
      remaining: remainingPath.cost,
      score: remainingPath.cost * 10 + gridDistance(site.x, site.y, target.x, target.y)
    });
  }
  const site = candidates.sort((a, b) => a.score - b.score || a.remaining - b.remaining || a.y - b.y || a.x - b.x)[0];
  if (!site) return null;
  return {
    kind: 'build',
    unitId: engineer.id,
    buildingType: 'road',
    x: site.x,
    y: site.y,
    canExecute: true,
    label: 'Extend iron road',
    meta: `toward ${target.x},${target.y} ${TERRAIN[target.terrain].name} | ${formatCost(BUILDING_TYPES.road.cost)}`,
    executeLabel: 'Do order',
    executeMeta: `Iron road at ${site.x},${site.y}`,
    previewMeta: 'Preview iron road',
    previewToast: `${engineer.name} can extend supply toward the first Hill Mine route.`,
    successToast: `Iron road extended toward ${target.x},${target.y}.`
  };
}

function bestIronAdvance(engineer, target) {
  const currentPath = findPath(state, engineer, target.x, target.y, Infinity);
  if (!currentPath) return null;
  const def = UNIT_TYPES[engineer.type];
  const candidates = [];
  for (const tile of state.map.tiles) {
    if (tile.x === engineer.x && tile.y === engineer.y) continue;
    const movePath = findPath(state, engineer, tile.x, tile.y, def.move);
    if (!movePath) continue;
    const remainingPath = findPath(state, { ...engineer, x: tile.x, y: tile.y }, target.x, target.y, Infinity);
    if (!remainingPath || remainingPath.cost >= currentPath.cost) continue;
    candidates.push({
      x: tile.x,
      y: tile.y,
      cost: movePath.cost,
      remaining: remainingPath.cost,
      score: remainingPath.cost * 10 + movePath.cost - (tile.road ? 2 : 0)
    });
  }
  const destination = candidates.sort((a, b) => a.score - b.score || a.remaining - b.remaining || a.cost - b.cost)[0];
  if (!destination) return null;
  return ironMoveDirective(engineer, destination, target, 'March toward hill iron', `${destination.cost}/${def.move} move | ${target.x},${target.y} mine route`);
}

function ironMoveDirective(engineer, destination, target, label, meta) {
  return {
    kind: 'move',
    unitId: engineer.id,
    x: destination.x,
    y: destination.y,
    canExecute: true,
    label,
    meta,
    executeLabel: 'Do order',
    executeMeta: `${destination.x},${destination.y} sector`,
    previewMeta: `Preview route to ${destination.x},${destination.y}`,
    previewToast: `${engineer.name} can move toward the ${TERRAIN[target.terrain].name} mine route at ${target.x},${target.y}.`,
    successToast: `${engineer.name} advances toward iron at ${target.x},${target.y}.`
  };
}

function neighborsOf(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ].filter((tile) => inMap(tile.x, tile.y));
}

function previewOpeningDirective(action) {
  if (action.buildingId) {
    const building = state.buildings.find((item) => item.id === action.buildingId);
    if (building) selectBuilding(building.id);
  } else if (action.unitId) {
    const unit = state.units.find((item) => item.id === action.unitId);
    if (unit) selectUnit(unit.id);
  }
  if (action.kind === 'build' || action.kind === 'build-preview') {
    state.mode = { type: 'build', buildingType: action.buildingType, builderId: action.unitId };
  }
  if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
    lastTile = { x: action.x, y: action.y };
    hoverTile = lastTile;
  }
  toast(action.previewToast || `${action.label} previewed.`, 'info');
  playAudioCue('select');
  render();
  if (window.innerWidth <= 980) scrollBattlefieldIntoView();
}

function focusOpeningFollowThrough(previousStepId) {
  const directive = currentOpeningDirective();
  if (!directive) return false;
  const recommendation = openingDirectiveAction(directive.current.id);
  if (!recommendation) return false;

  let focusTile = null;
  if (recommendation.buildingId) {
    const building = state.buildings.find((item) => item.id === recommendation.buildingId);
    if (building) {
      selectBuilding(building.id);
      focusTile = { x: building.x, y: building.y };
    }
  } else if (recommendation.unitId) {
    const unit = state.units.find((item) => item.id === recommendation.unitId);
    if (unit) {
      selectUnit(unit.id);
      focusTile = { x: unit.x, y: unit.y };
    }
  }

  if (!focusTile) return false;
  if (Number.isFinite(recommendation.x) && Number.isFinite(recommendation.y)) {
    focusTile = { x: recommendation.x, y: recommendation.y };
  }
  lastTile = focusTile;
  hoverTile = focusTile;
  return true;
}

function scrollOpeningFollowThroughRail(previousStepId) {
  if (!['scout', 'contact', 'front', 'training', 'engineer', 'iron', 'turn-report'].includes(previousStepId)) return;
  if (window.innerWidth > 980) {
    resetCommandRailScroll();
    return;
  }
  scrollBattlefieldIntoView();
}

function resetCommandRailScroll() {
  const rail = document.querySelector('.side');
  if (!rail) return;
  rail.scrollTo({
    top: 0,
    behavior: 'auto'
  });
}

function scrollBattlefieldIntoView() {
  const battlefield = canvas.parentElement;
  if (!battlefield) return;
  const topbar = document.querySelector('.topbar');
  const resourceOffset = window.innerWidth <= 620 ? Math.ceil(resourceBar?.getBoundingClientRect().height || 0) : 0;
  const offset = Math.ceil(topbar?.getBoundingClientRect().height || 0) + resourceOffset + 10;
  const top = Math.max(0, window.scrollY + battlefield.getBoundingClientRect().top - offset);
  window.scrollTo({
    top,
    behavior: 'auto'
  });
}

function executeOpeningDirective(action) {
  const previousStepId = currentOpeningDirective()?.current?.id || null;
  if (action.kind === 'move') {
    selectUnit(action.unitId);
    lastTile = { x: action.x, y: action.y };
    hoverTile = lastTile;
    const result = moveUnit(state, action.unitId, action.x, action.y);
    const ok = handleResult(result, 'move');
    if (ok) {
      toast(action.successToast || `${action.label} to ${action.x},${action.y}.`, 'good');
      focusOpeningFollowThrough(previousStepId);
    }
    render();
    if (ok) scrollOpeningFollowThroughRail(previousStepId);
    return;
  }
  if (action.kind === 'train') {
    selectBuilding(action.buildingId);
    const result = startTraining(state, action.buildingId, action.unitType);
    const ok = handleResult(result, 'train');
    if (ok) {
      toast(`${UNIT_TYPES[action.unitType].name} queued.`, 'good');
      focusOpeningFollowThrough(previousStepId);
    }
    render();
    if (ok) scrollOpeningFollowThroughRail(previousStepId);
    return;
  }
  if (action.kind === 'build') {
    selectUnit(action.unitId);
    lastTile = { x: action.x, y: action.y };
    hoverTile = lastTile;
    const result = startConstruction(state, action.unitId, action.buildingType, action.x, action.y);
    const ok = handleResult(result, 'build');
    if (ok) {
      if (result.building?.id) selectBuilding(result.building.id);
      lastTile = { x: action.x, y: action.y };
      hoverTile = lastTile;
      toast(action.successToast || `${BUILDING_TYPES[action.buildingType].name} started.`, 'good');
      focusOpeningFollowThrough(previousStepId);
    } else {
      state.mode = { type: 'build', buildingType: action.buildingType, builderId: action.unitId };
    }
    render();
    if (window.innerWidth <= 980) scrollBattlefieldIntoView();
    return;
  }
  if (action.kind === 'fortify') {
    selectUnit(action.unitId);
    const unit = state.units.find((item) => item.id === action.unitId);
    if (unit) {
      lastTile = { x: unit.x, y: unit.y };
      hoverTile = lastTile;
    }
    const result = fortifyUnit(state, action.unitId);
    const ok = handleResult(result, 'ui');
    if (ok) {
      toast(action.successToast || `${unit?.name || 'Unit'} fortified.`, 'good');
      focusOpeningFollowThrough(previousStepId);
    }
    render();
    if (window.innerWidth <= 980) scrollBattlefieldIntoView();
    return;
  }
  if (action.kind === 'end-turn') {
    state.mode = { type: 'select' };
    requestEndTurn(true);
    focusOpeningFollowThrough(previousStepId);
    render();
    return;
  }
  previewOpeningDirective(action);
}

function focusTurnReportOnMobile() {
  if (!turnReport || window.innerWidth > 980) return;
  scrollBattlefieldIntoView();
}

function requestEndTurn(force = false) {
  const previousStepId = currentOpeningDirective()?.current?.id || null;
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
  const before = captureTurnSnapshot();
  const previousTurn = state.turn;
  battleImpact = null;
  endTurn(state);
  turnReport = buildTurnReport(before, previousTurn);
  focusOpeningFollowThrough(previousStepId);
  toast(turnReport.toast, turnReport.tone === 'bad' ? 'bad' : 'info');
  playAudioCue('turn');
  render();
  focusTurnReportOnMobile();
}

function continueTurnReportOrders() {
  turnReport = null;
  focusOpeningFollowThrough('turn-report');
  render();
  if (window.innerWidth <= 980) scrollBattlefieldIntoView();
}

function selectNextReadyUnit() {
  const readyUnits = getReadyOlundarUnits(state);
  const currentIndex = readyUnits.findIndex((unit) => unit.id === state.selectedUnitId);
  const unit = currentIndex >= 0 && readyUnits.length > 1
    ? readyUnits[(currentIndex + 1) % readyUnits.length]
    : readyUnits[0];
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

function focusFirstReadyUnit() {
  const [unit] = getReadyOlundarUnits(state);
  if (!unit) return;
  state.selectedUnitId = unit.id;
  state.selectedBuildingId = null;
  state.mode = { type: 'select' };
  lastTile = { x: unit.x, y: unit.y };
  hoverTile = null;
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
    focusedMissionId = null;
    missionResultBanner = null;
    missionHistoryFilter = 'recent';
    missionArchiveTypeFilter = 'all';
    missionArchiveSearch = '';
    missionArchiveSortOrder = 'newest';
    missionArchiveGroupMode = 'flat';
    missionArchiveDetailMode = 'details';
    focusedArchivedMissionId = null;
    battleImpact = null;
    turnReport = null;
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
    focusedMissionId = null;
    missionResultBanner = null;
    missionHistoryFilter = 'recent';
    missionArchiveTypeFilter = 'all';
    missionArchiveSearch = '';
    missionArchiveSortOrder = 'newest';
    missionArchiveGroupMode = 'flat';
    missionArchiveDetailMode = 'details';
    focusedArchivedMissionId = null;
    battleImpact = null;
    turnReport = null;
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
  focusedMissionId = null;
  missionResultBanner = null;
  missionHistoryFilter = 'recent';
  missionArchiveTypeFilter = 'all';
  missionArchiveSearch = '';
  missionArchiveSortOrder = 'newest';
  missionArchiveGroupMode = 'flat';
  missionArchiveDetailMode = 'details';
  focusedArchivedMissionId = null;
  battleImpact = null;
  turnReport = null;
  focusFirstReadyUnit();
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

function selectionStatMarkup(selection) {
  const stats = [];
  if (selection.unit) {
    const unit = selection.unit;
    const def = UNIT_TYPES[unit.type];
    stats.push(['HP', `${unit.hp}/${unit.maxHp}`]);
    stats.push(['Move', def.move]);
    stats.push(['Attack', def.range > 1 ? `${def.attack} R${def.range}` : def.attack]);
    stats.push(['Sight', def.sight]);
    stats.push(['Status', unit.hasActed ? 'Acted' : 'Ready']);
  } else if (selection.building) {
    const building = selection.building;
    stats.push(['HP', `${building.hp}/${building.maxHp}`]);
    stats.push(['Tier', (building.upgraded || 0) + 1]);
    stats.push(['Queue', `${building.queue?.length || 0}/${trainingQueueLimit(building)}`]);
    stats.push(['Build', building.turnsLeft > 0 ? `${building.turnsLeft}t` : 'Ready']);
  }
  return `<div class="command-stats">${stats.map(([label, value]) => `<span class="stat-chip"><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></span>`).join('')}</div>`;
}

function selectionPortraitMarkup(selection) {
  const entity = selection.unit || selection.building;
  const type = cssToken(entity?.type || 'unknown');
  const faction = cssToken(entity?.faction || 'neutral');
  const kind = selection.unit ? 'unit' : 'building';
  const svg = selection.unit ? unitPortraitSvg(selection.unit) : buildingPortraitSvg(selection.building);
  return `<div class="selection-portrait ${kind}-portrait portrait-${type} faction-${faction}" aria-hidden="true">${svg}</div>`;
}

function unitPortraitSvg(unit) {
  const dead = unit.faction === 'dead';
  if (dead) return deadwalkerPortraitSvg(unit.type);
  switch (unit.type) {
    case 'scout':
      return portraitSvg(`
        <path class="portrait-hill" d="M8 47c10-10 19-15 30-10 7 3 13 6 19 10v10H8z"/>
        <path class="portrait-cloak" d="M25 28c-4 5-6 13-8 24h26c-1-10-4-19-10-24z"/>
        <path class="portrait-hood" d="M22 25c3-8 14-8 18 0l-2 9H24z"/>
        <circle class="portrait-face" cx="31" cy="30" r="5"/>
        <path class="portrait-bow" d="M46 19c8 9 8 25 0 34"/>
        <path class="portrait-string" d="M47 19v34"/>
        <path class="portrait-banner" d="M38 20h10l-3 4 3 4H38z"/>
      `);
    case 'engineer':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c9-8 18-11 27-8 8 3 14 5 23 3v12H7z"/>
        <path class="portrait-body" d="M24 31h16l5 22H19z"/>
        <circle class="portrait-face" cx="32" cy="27" r="5"/>
        <path class="portrait-helmet" d="M24 26c1-7 15-8 17 0z"/>
        <path class="portrait-beam" d="M15 52l15-25"/>
        <path class="portrait-beam" d="M49 52L34 27"/>
        <path class="portrait-tool" d="M43 18l8 8M48 21l-8 8"/>
        <rect class="portrait-pack" x="18" y="37" width="9" height="9" rx="2"/>
      `);
    case 'legionary':
      return portraitSvg(`
        <path class="portrait-hill" d="M8 49c11-6 21-8 32-5 7 2 12 3 16 2v11H8z"/>
        <path class="portrait-sword" d="M45 17l2 25M42 21l8-1"/>
        <path class="portrait-body" d="M22 31h20l3 21H19z"/>
        <circle class="portrait-face" cx="32" cy="27" r="5"/>
        <path class="portrait-helmet" d="M22 27c2-10 18-10 20 0z"/>
        <path class="portrait-shield" d="M16 32c10 0 16 3 16 3 0 12-5 18-16 21-9-3-13-10-13-21 0 0 5-3 13-3z"/>
        <path class="portrait-shield-line" d="M16 34v19"/>
      `);
    case 'spearGuard':
      return portraitSvg(`
        <path class="portrait-hill" d="M8 48c9-6 20-8 31-5 8 2 13 3 17 1v13H8z"/>
        <path class="portrait-spear" d="M48 8v46M44 13l4-7 4 7"/>
        <path class="portrait-body" d="M23 32h17l4 21H20z"/>
        <circle class="portrait-face" cx="32" cy="28" r="5"/>
        <path class="portrait-helmet" d="M23 27c2-9 16-9 18 0z"/>
        <path class="portrait-shield tower" d="M17 31c7 0 12 3 12 3v18c-3 3-8 5-12 5-4 0-9-2-12-5V34s5-3 12-3z"/>
      `);
    case 'archer':
      return portraitSvg(`
        <path class="portrait-hill" d="M8 48c11-8 22-10 33-4 6 3 11 4 15 3v10H8z"/>
        <path class="portrait-body" d="M25 32h15l4 21H20z"/>
        <circle class="portrait-face" cx="32" cy="28" r="5"/>
        <path class="portrait-hood" d="M23 27c2-9 16-9 18 0l-3 8H26z"/>
        <path class="portrait-bow" d="M50 14c-9 12-9 28 0 40"/>
        <path class="portrait-string" d="M50 14v40"/>
        <path class="portrait-arrow" d="M28 35h22M45 31l5 4-5 4"/>
        <path class="portrait-quiver" d="M16 30l8 22"/>
      `);
    case 'cavalry':
      return portraitSvg(`
        <path class="portrait-hill" d="M6 49c10-7 20-9 32-5 8 3 14 4 20 1v12H6z"/>
        <path class="portrait-horse" d="M12 39c7-10 23-10 34-4l8 8-7 5H22l-7 6-4-4 5-7z"/>
        <path class="portrait-horse-neck" d="M42 33l5-10 6 10-1 9"/>
        <path class="portrait-rider" d="M27 21h10l4 16H24z"/>
        <circle class="portrait-face" cx="32" cy="19" r="4"/>
        <path class="portrait-sword" d="M43 12l4 20"/>
      `);
    case 'onager':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c11-7 23-8 35-4 7 2 11 2 15 0v11H7z"/>
        <circle class="portrait-wheel" cx="22" cy="48" r="7"/>
        <circle class="portrait-wheel" cx="43" cy="48" r="7"/>
        <path class="portrait-frame" d="M15 47h35M20 43l18-17 16 18M28 43l8-20"/>
        <path class="portrait-arm" d="M34 26l19-16"/>
        <circle class="portrait-shot" cx="54" cy="9" r="3"/>
        <path class="portrait-crew" d="M15 34h9l2 11H13z"/>
      `);
    default:
      return portraitSvg(`
        <path class="portrait-hill" d="M8 48c11-7 21-9 32-5 7 2 12 3 16 1v13H8z"/>
        <path class="portrait-body" d="M23 31h18l4 22H19z"/>
        <circle class="portrait-face" cx="32" cy="27" r="5"/>
        <path class="portrait-helmet" d="M23 26c2-9 16-9 18 0z"/>
        <path class="portrait-banner" d="M42 17h10l-3 4 3 4H42z"/>
      `);
  }
}

function deadwalkerPortraitSvg(type) {
  if (type === 'lichBoss') {
    return portraitSvg(`
      <path class="portrait-blight" d="M7 50c12-11 27-13 50-5v12H7z"/>
      <path class="portrait-aura" d="M18 47c0-17 6-29 14-29s14 12 14 29z"/>
      <circle class="portrait-skull" cx="32" cy="28" r="10"/>
      <path class="portrait-crown" d="M22 20l4-8 6 7 6-7 4 8z"/>
      <path class="portrait-ribs" d="M23 40h18M25 45h14M28 50h8"/>
      <path class="portrait-staff" d="M49 15v39M45 18l4-6 4 6"/>
    `);
  }
  return portraitSvg(`
    <path class="portrait-blight" d="M7 50c12-10 25-12 50-5v12H7z"/>
    <path class="portrait-aura" d="M19 48c1-15 6-26 13-26s13 11 13 26z"/>
    <circle class="portrait-skull" cx="32" cy="29" r="9"/>
    <path class="portrait-ribs" d="M23 40h18M25 45h14M28 50h8"/>
    <path class="portrait-bone-arm" d="M20 39L9 30M44 39l11-9"/>
    <path class="portrait-weapon" d="M47 17v35"/>
  `);
}

function buildingPortraitSvg(building) {
  switch (building.type) {
    case 'city':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c9-8 22-11 34-7 6 2 11 3 16 1v13H7z"/>
        <path class="portrait-wall" d="M13 40h38v13H13z"/>
        <path class="portrait-roof" d="M11 39l21-17 21 17z"/>
        <path class="portrait-column" d="M19 39V27M32 39V23M45 39V27"/>
        <path class="portrait-banner" d="M34 14h13l-4 4 4 4H34z"/>
      `);
    case 'farm':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c12-8 25-10 50-5v12H7z"/>
        <path class="portrait-terrace" d="M12 48h39M16 41h36M21 34h28"/>
        <path class="portrait-roof" d="M19 34l13-10 13 10z"/>
        <rect class="portrait-wall" x="22" y="34" width="20" height="13" rx="2"/>
        <path class="portrait-crop" d="M14 47c3-7 7-9 12-11M37 47c3-6 7-8 13-9"/>
      `);
    case 'lumberCamp':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c11-8 23-10 50-4v11H7z"/>
        <path class="portrait-tree" d="M17 44l8-22 8 22zM37 46l7-19 8 19z"/>
        <path class="portrait-trunk" d="M25 43v10M44 45v8"/>
        <path class="portrait-log" d="M15 50h28M20 46h26"/>
      `);
    case 'mine':
      return portraitSvg(`
        <path class="portrait-mountain" d="M8 52l18-30 10 16 7-11 14 25z"/>
        <path class="portrait-mine" d="M23 52c1-11 6-17 13-17s12 6 13 17z"/>
        <path class="portrait-beam" d="M20 51h31M25 43h22M31 35v17M42 39v13"/>
        <path class="portrait-gold-vein" d="M17 43l8-7M44 29l6 8"/>
      `);
    case 'barracks':
    case 'archeryYard':
    case 'stable':
    case 'workshop':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c10-7 22-9 50-4v11H7z"/>
        <path class="portrait-wall" d="M13 36h38v17H13z"/>
        <path class="portrait-roof" d="M10 36l22-14 22 14z"/>
        <path class="portrait-banner" d="M37 17h13l-4 4 4 4H37z"/>
        <path class="portrait-weapon-rack" d="M19 50V37M25 50V35M19 41h12M41 50l-9-14M34 41h12"/>
      `);
    case 'watchtower':
    case 'outpost':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c12-8 25-9 50-4v11H7z"/>
        <path class="portrait-tower" d="M23 52l4-30h10l4 30z"/>
        <path class="portrait-roof" d="M19 22l13-11 13 11z"/>
        <path class="portrait-window" d="M29 30h7v7h-7z"/>
        <path class="portrait-banner" d="M36 14h13l-4 4 4 4H36z"/>
      `);
    case 'wall':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 51c12-7 25-8 50-4v10H7z"/>
        <path class="portrait-wall" d="M10 33h44v20H10z"/>
        <path class="portrait-crenel" d="M12 25h8v8h-8zM25 25h8v8h-8zM38 25h8v8h-8z"/>
        <path class="portrait-stone-line" d="M13 40h38M13 47h38M22 33v20M36 33v20"/>
      `);
    case 'road':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c12-7 25-8 50-4v11H7z"/>
        <path class="portrait-road" d="M21 56c2-18 7-32 22-48"/>
        <path class="portrait-road-edge" d="M12 55c4-18 10-34 26-49M31 57c1-17 4-29 18-46"/>
        <path class="portrait-banner" d="M40 18h11l-3 4 3 4H40z"/>
      `);
    case 'shrine':
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c11-8 24-9 50-4v11H7z"/>
        <circle class="portrait-sun" cx="32" cy="20" r="8"/>
        <path class="portrait-rays" d="M32 7v5M32 28v6M19 20h5M40 20h5M23 11l4 4M41 11l-4 4M23 29l4-4M41 29l-4-4"/>
        <path class="portrait-column" d="M21 51V34M32 51V31M43 51V34"/>
        <path class="portrait-plinth" d="M16 52h32M20 34h24"/>
      `);
    case 'portal':
    case 'bonePit':
    case 'graveForge':
    case 'necropolis':
      return portraitSvg(`
        <path class="portrait-blight" d="M7 50c14-10 28-11 50-5v12H7z"/>
        <path class="portrait-necro" d="M17 52V31l15-14 15 14v21z"/>
        <path class="portrait-portal" d="M24 51c0-17 4-27 8-27s8 10 8 27z"/>
        <path class="portrait-ribs" d="M20 40h24M23 46h18"/>
        <path class="portrait-aura" d="M18 52c0-23 6-38 14-38s14 15 14 38z"/>
      `);
    default:
      return portraitSvg(`
        <path class="portrait-hill" d="M7 50c11-8 24-9 50-4v11H7z"/>
        <path class="portrait-wall" d="M15 38h34v15H15z"/>
        <path class="portrait-roof" d="M12 38l20-15 20 15z"/>
        <path class="portrait-banner" d="M36 17h13l-4 4 4 4H36z"/>
      `);
  }
}

function portraitSvg(body) {
  return `<svg class="portrait-svg" viewBox="0 0 64 64" focusable="false">
    <rect class="portrait-vellum" x="2" y="2" width="60" height="60" rx="9"/>
    <path class="portrait-sky" d="M6 41c7-13 19-22 32-22 9 0 15 4 20 10v29H6z"/>
    ${body}
  </svg>`;
}

function cssToken(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase();
}

function orderHeader() {
  const header = document.createElement('div');
  header.className = 'order-head';
  header.innerHTML = '<span>War council</span><h2>Orders</h2>';
  return header;
}

function actionSection(title, detail = '', className = '') {
  const section = document.createElement('section');
  section.className = `order-section ${className}`.trim();
  section.innerHTML = `
    <div class="order-section-head">
      <h3>${escapeHtml(title)}</h3>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
    </div>
  `;
  return section;
}

function commandActions(className = '') {
  const actions = document.createElement('div');
  actions.className = `command-actions ${className}`.trim();
  return actions;
}

function orderDrawer(label, meta, className = '', open = false) {
  const drawer = document.createElement('details');
  drawer.className = `order-drawer ${className}`.trim();
  if (open) drawer.open = true;
  drawer.innerHTML = `<summary><span>${escapeHtml(label)}</span>${meta ? ` <small>${escapeHtml(meta)}</small>` : ''}</summary>`;
  return drawer;
}

function orderButton(label, meta, onClick, options = {}) {
  const { disabled = false, title = '', tone = 'secondary' } = options;
  const el = button(label, onClick, disabled, title);
  el.className = `order-button ${tone}`.trim();
  el.innerHTML = `
    <span class="order-button-label">${escapeHtml(label)}</span>
    ${meta ? `<span class="order-button-meta">${escapeHtml(meta)}</span>` : ''}
  `;
  return el;
}

function orderNote(text) {
  const p = paragraph(text);
  p.className = 'order-note';
  return p;
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

function canvasCursorForTile(tile) {
  if (!tile || !inMap(tile.x, tile.y)) return '';
  return openingDirectiveForTile(tile) ? 'pointer' : '';
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
  canvas.style.cursor = canvasCursorForTile(hoverTile);
  renderTilePanel();
  renderMapIntel();
  drawGame(canvas, state, hoverTile, activeMapLens, focusedMissionRouteOverlay(), missionSiteFocusOverlay(), battleImpactOverlay(), openingOrderOverlay());
});
canvas.addEventListener('mouseleave', () => {
  hoverTile = null;
  canvas.style.cursor = '';
  render();
});

mobileIntelDrawer?.addEventListener('toggle', () => {
  if (!syncingMobileIntelDrawer && isMobileIntelDrawerMode()) {
    mobileIntelDrawerTouched = true;
  }
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

function handleTurnReportAction(action) {
  if (action === 'clear-turn-report') {
    turnReport = null;
    render();
    if (window.innerWidth <= 980) scrollBattlefieldIntoView();
    return true;
  }
  if (action === 'continue-turn-orders') {
    continueTurnReportOrders();
    return true;
  }
  return false;
}

actionPanel.addEventListener('click', (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === 'clear-battle-impact') {
    battleImpact = null;
    render();
  } else if (handleTurnReportAction(target.dataset.action)) return;
});

mapTurnReport?.addEventListener('click', (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  handleTurnReportAction(target.dataset.action);
});

missionPanel.addEventListener('click', (event) => {
  const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === 'focus-mission') focusMissionTarget(target.dataset.missionId);
  else if (target.dataset.action === 'focus-mission-unit') focusMissionUnit(target.dataset.missionId);
  else if (target.dataset.action === 'dispatch-mission') dispatchMission(target.dataset.missionId);
  else if (target.dataset.action === 'focus-completed-mission') focusCompletedMissionSite(target.dataset.missionId);
  else if (target.dataset.action === 'set-mission-history') {
    missionHistoryFilter = target.dataset.filter === 'archive' ? 'archive' : 'recent';
    render();
  }
  else if (target.dataset.action === 'set-mission-archive-type') {
    const next = MISSION_ARCHIVE_TYPE_FILTERS.some((item) => item.id === target.dataset.filter) ? target.dataset.filter : 'all';
    missionArchiveTypeFilter = next;
    clearFocusedArchivedMissionIfFilteredOut();
    render();
  }
  else if (target.dataset.action === 'set-mission-archive-sort') {
    missionArchiveSortOrder = MISSION_ARCHIVE_SORT_ORDERS.some((item) => item.id === target.dataset.sort) ? target.dataset.sort : 'newest';
    render();
  }
  else if (target.dataset.action === 'set-mission-archive-group') {
    missionArchiveGroupMode = MISSION_ARCHIVE_GROUP_MODES.some((item) => item.id === target.dataset.group) ? target.dataset.group : 'flat';
    render();
  }
  else if (target.dataset.action === 'set-mission-archive-detail') {
    missionArchiveDetailMode = MISSION_ARCHIVE_DETAIL_MODES.some((item) => item.id === target.dataset.detail) ? target.dataset.detail : 'details';
    render();
  }
  else if (target.dataset.action === 'clear-mission-archive-search') {
    missionArchiveSearch = '';
    render();
  }
  else if (target.dataset.action === 'close-mission-result') {
    missionResultBanner = null;
    render();
  }
});

missionPanel.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.dataset.action !== 'search-mission-archive') return;
  event.preventDefault();
  const data = new FormData(event.target);
  missionArchiveSearch = String(data.get('archiveSearch') || '').slice(0, 40);
  clearFocusedArchivedMissionIfFilteredOut();
  render();
});

missionPanel.addEventListener('input', (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'archiveSearch') return;
  missionArchiveSearch = event.target.value.slice(0, 40);
  clearFocusedArchivedMissionIfFilteredOut();
});

missionPanel.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'archiveSearch') return;
  missionArchiveSearch = event.target.value.slice(0, 40);
  clearFocusedArchivedMissionIfFilteredOut();
  render();
});

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
