import { COSMETICS } from './content.js';

export const COSMETIC_PROFILE_STORAGE_KEY = 'olundar.player.cosmetics';

const DEFAULT_BANNER_COLOR_ID = defaultCatalogId(COSMETICS.bannerColors, 'sun-gold');
const DEFAULT_UNIT_VARIANT_ID = defaultCatalogId(COSMETICS.unitVariants, 'classic');

export const DEFAULT_COSMETIC_PROFILE = Object.freeze({
  selectedBannerColorId: DEFAULT_BANNER_COLOR_ID,
  selectedUnitVariantId: DEFAULT_UNIT_VARIANT_ID,
  unlockedBannerColorIds: Object.freeze(defaultCatalogIds(COSMETICS.bannerColors)),
  unlockedUnitVariantIds: Object.freeze(defaultCatalogIds(COSMETICS.unitVariants))
});

export function cosmeticCatalog() {
  return {
    bannerColors: Object.values(COSMETICS.bannerColors || {}),
    unitVariants: Object.values(COSMETICS.unitVariants || {})
  };
}

export function normalizeCosmeticProfile(value = {}) {
  const profile = value && typeof value === 'object' ? value : {};
  const bannerIds = Object.keys(COSMETICS.bannerColors || {});
  const variantIds = Object.keys(COSMETICS.unitVariants || {});
  const unlockedBannerColorIds = normalizeUnlockedIds(profile.unlockedBannerColorIds, bannerIds, DEFAULT_COSMETIC_PROFILE.unlockedBannerColorIds);
  const unlockedUnitVariantIds = normalizeUnlockedIds(profile.unlockedUnitVariantIds, variantIds, DEFAULT_COSMETIC_PROFILE.unlockedUnitVariantIds);
  const selectedBannerColorId = unlockedBannerColorIds.includes(profile.selectedBannerColorId) ? profile.selectedBannerColorId : DEFAULT_COSMETIC_PROFILE.selectedBannerColorId;
  const selectedUnitVariantId = unlockedUnitVariantIds.includes(profile.selectedUnitVariantId) ? profile.selectedUnitVariantId : DEFAULT_COSMETIC_PROFILE.selectedUnitVariantId;

  return {
    selectedBannerColorId,
    selectedUnitVariantId,
    unlockedBannerColorIds,
    unlockedUnitVariantIds
  };
}

export function readCosmeticProfile(storage = null) {
  const store = storage || safeStorage();
  if (!store) return normalizeCosmeticProfile(DEFAULT_COSMETIC_PROFILE);

  try {
    return normalizeCosmeticProfile(JSON.parse(store.getItem(COSMETIC_PROFILE_STORAGE_KEY) || '{}'));
  } catch {
    return normalizeCosmeticProfile(DEFAULT_COSMETIC_PROFILE);
  }
}

export function saveCosmeticProfile(profile, storage = null) {
  const normalized = normalizeCosmeticProfile(profile);
  const store = storage || safeStorage();

  try {
    store?.setItem(COSMETIC_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage can be unavailable in embedded or private contexts.
  }

  return normalized;
}

export function setSelectedCosmetics(profile, selection = {}) {
  const normalized = normalizeCosmeticProfile(profile);
  const selectedBannerColorId = normalized.unlockedBannerColorIds.includes(selection.bannerColorId)
    ? selection.bannerColorId
    : normalized.selectedBannerColorId;
  const selectedUnitVariantId = normalized.unlockedUnitVariantIds.includes(selection.unitVariantId)
    ? selection.unitVariantId
    : normalized.selectedUnitVariantId;
  return normalizeCosmeticProfile({ ...normalized, selectedBannerColorId, selectedUnitVariantId });
}

export function updateCosmeticProfileFromState(profile, state) {
  const normalized = normalizeCosmeticProfile(profile);
  const next = {
    ...normalized,
    unlockedBannerColorIds: [...normalized.unlockedBannerColorIds],
    unlockedUnitVariantIds: [...normalized.unlockedUnitVariantIds]
  };
  const unlocked = [];
  const scenarioId = state?.campaign?.scenarioId || '';
  const factions = state?.factions || {};
  const olundar = factions.olundar || {};
  const pacts = olundar.pacts || {};
  const trades = olundar.trades || {};
  const hasAnyPact = Object.values(pacts).some(Boolean);
  const hasAnyTrade = Object.values(trades).some(Boolean);
  const challenge = Boolean(state?.campaign?.challenge || scenarioId === 'weeklyChallenge');
  const deadworksDestroyed = Number(state?.flags?.deadStrongholdsDestroyed || 0);
  const hasOnager = (state?.units || []).some((unit) => unit.faction === 'olundar' && unit.type === 'onager');
  const hasWorkshop = (state?.buildings || []).some((building) => building.faction === 'olundar' && building.type === 'workshop' && building.turnsLeft <= 0);
  const mireContact = Boolean(factions.mire?.discovered || pacts.mire || trades.mire || scenarioId === 'mireVeil');

  if (scenarioId === 'dawnroad' || factions.dawn?.discovered || hasAnyPact || hasAnyTrade) unlock(next, unlocked, 'banner', 'road-azure');
  if (mireContact) {
    unlock(next, unlocked, 'banner', 'mire-green');
    unlock(next, unlocked, 'variant', 'marsh-cloak');
  }
  if (scenarioId === 'hollowEclipse' || deadworksDestroyed > 0 || state?.status === 'won' || state?.flags?.portalDestroyed) {
    unlock(next, unlocked, 'banner', 'eclipse-crimson');
  }
  if (scenarioId === 'ironVanguard' || hasOnager || hasWorkshop) unlock(next, unlocked, 'variant', 'vanguard-brass');
  if (challenge) {
    unlock(next, unlocked, 'banner', 'challenge-white');
    unlock(next, unlocked, 'variant', 'challenge-laurel');
  }

  const nextProfile = normalizeCosmeticProfile(next);
  return {
    profile: nextProfile,
    unlocked,
    changed: unlocked.length > 0 || JSON.stringify(nextProfile) !== JSON.stringify(normalized)
  };
}

export function cosmeticStyleForUnit(profile, unit, fallbackColor = '#f0c866') {
  const normalized = normalizeCosmeticProfile(profile);
  const applies = unit?.faction === 'olundar';
  const banner = applies ? COSMETICS.bannerColors?.[normalized.selectedBannerColorId] : null;
  const variant = applies ? COSMETICS.unitVariants?.[normalized.selectedUnitVariantId] : null;
  return {
    bannerColor: banner?.color || fallbackColor,
    accentColor: banner?.accent || '#fff4ba',
    trimColor: variant?.trim || '#f6e4a6',
    pattern: variant?.pattern || 'disc',
    emblem: variant?.emblem || 'sun',
    bannerId: banner?.id || null,
    variantId: variant?.id || null,
    custom: Boolean(applies && banner && variant)
  };
}

export function validateCosmeticsConfig() {
  const catalog = cosmeticCatalog();
  const errors = [];
  validateCatalogGroup(COSMETICS.bannerColors, 'banner color', ['color', 'accent'], errors);
  validateCatalogGroup(COSMETICS.unitVariants, 'unit variant', ['trim', 'emblem', 'pattern'], errors);
  if (!catalog.bannerColors.some((item) => item.default)) errors.push('Cosmetics need a default banner color.');
  if (!catalog.unitVariants.some((item) => item.default)) errors.push('Cosmetics need a default unit variant.');
  if (errors.length) throw new Error(errors.join('; '));
  return {
    bannerColorIds: catalog.bannerColors.map((item) => item.id),
    unitVariantIds: catalog.unitVariants.map((item) => item.id),
    defaultProfile: normalizeCosmeticProfile(DEFAULT_COSMETIC_PROFILE)
  };
}

function unlock(profile, unlocked, kind, id) {
  const key = kind === 'banner' ? 'unlockedBannerColorIds' : 'unlockedUnitVariantIds';
  const table = kind === 'banner' ? COSMETICS.bannerColors : COSMETICS.unitVariants;
  if (!table?.[id] || profile[key].includes(id)) return;
  profile[key].push(id);
  unlocked.push({ kind, id, name: table[id].name });
}

function normalizeUnlockedIds(value, validIds, defaults) {
  const ids = Array.isArray(value) ? value : [];
  const allowed = new Set(validIds);
  const out = [];
  for (const id of [...defaults, ...ids]) {
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function validateCatalogGroup(group, label, requiredKeys, errors) {
  if (!group || typeof group !== 'object') {
    errors.push(`Missing ${label} catalog.`);
    return;
  }
  for (const [id, item] of Object.entries(group)) {
    if (item.id !== id) errors.push(`${label} ${id} id mismatch.`);
    if (!item.name || !item.text) errors.push(`${label} ${id} needs name and text.`);
    for (const key of requiredKeys) {
      if (!item[key]) errors.push(`${label} ${id} missing ${key}.`);
    }
  }
}

function defaultCatalogIds(group) {
  return Object.values(group || {}).filter((item) => item.default).map((item) => item.id);
}

function defaultCatalogId(group, fallback) {
  return defaultCatalogIds(group)[0] || fallback;
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
