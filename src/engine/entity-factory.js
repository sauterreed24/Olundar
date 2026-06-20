import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { FACTIONS, UNIT_TYPES, BUILDING_TYPES } from '../content.js';

const atlasCache = new Map();

export function createEntityFromDefinition(kind, id, atlasTexture = null) {
  const def = kind === 'unit' ? UNIT_TYPES[id] : BUILDING_TYPES[id];
  if (!def) return null;

  const container = new Container();
  container.label = `${kind}:${id}`;
  container.eventMode = 'static';

  const plinth = new Graphics();
  plinth.ellipse(0, 8, 14, 5);
  plinth.fill({ color: 0x000000, alpha: 0.2 });
  container.addChild(plinth);

  const body = new Graphics();
  const faction = def.faction === 'dead' ? FACTIONS.dead : FACTIONS.olundar;
  const accent = parseInt(String(faction?.color || '#f0c866').replace('#', ''), 16) || 0xf0c866;
  body.roundRect(-10, -14, 20, 22, 6);
  body.fill({ color: accent, alpha: 0.88 });
  body.stroke({ color: 0x17331f, width: 1.2, alpha: 0.5 });
  container.addChild(body);

  if (atlasTexture && def.artFrame) {
    const frame = atlasCache.get(def.artFrame) || textureFrame(atlasTexture, def.artFrame);
    if (frame) {
      const sprite = new Sprite(frame);
      sprite.anchor.set(0.5, 0.85);
      sprite.width = 28;
      sprite.height = 28;
      container.addChild(sprite);
    }
  }

  container.entityMeta = {
    kind,
    id,
    name: def.name,
    role: def.role || def.glyph,
    faction: def.faction,
    accent
  };

  return container;
}

function textureFrame(baseTexture, frameName) {
  const frame = {
    scout: { x: 0, y: 0, w: 64, h: 64 },
    legionary: { x: 64, y: 0, w: 64, h: 64 },
    portal: { x: 128, y: 0, w: 64, h: 64 }
  }[frameName];
  if (!frame) return null;
  const texture = new Texture({
    source: baseTexture.source,
    frame: { x: frame.x, y: frame.y, width: frame.w, height: frame.h }
  });
  atlasCache.set(frameName, texture);
  return texture;
}

export function instantiateMapEntities(state, atlasTexture = null) {
  const root = new Container();
  root.label = 'entities';

  for (const unit of state.units) {
    if (unit.hp <= 0) continue;
    const entity = createEntityFromDefinition('unit', unit.type, atlasTexture);
    if (entity) {
      entity.mapId = unit.id;
      root.addChild(entity);
    }
  }

  for (const building of state.buildings) {
    const entity = createEntityFromDefinition('building', building.type, atlasTexture);
    if (entity) {
      entity.mapId = building.id;
      root.addChild(entity);
    }
  }

  return root;
}

export function syncEntityPositions(entityRoot, layout, state) {
  if (!entityRoot || !layout) return;
  for (const child of entityRoot.children) {
    const unit = state.units.find((entry) => entry.id === child.mapId);
    const building = state.buildings.find((entry) => entry.id === child.mapId);
    const source = unit || building;
    if (!source) continue;
    const x = layout.originX + (source.x - source.y) * layout.halfTileWidth;
    const y = layout.originY + (source.x + source.y) * layout.halfTileHeight;
    child.position.set(x, y);
  }
}
