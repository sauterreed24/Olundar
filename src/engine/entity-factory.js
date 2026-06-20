import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { BUILDING_TYPES, FACTIONS, UNIT_TYPES } from '../content.js';

const FACTION_COLORS = Object.fromEntries(Object.values(FACTIONS).map((f) => [f.id, f.color]));

export function createUnitDisplay(unit, options = {}) {
  const def = UNIT_TYPES[unit.type] || {};
  const container = new Container();
  container.label = `unit:${unit.id}`;
  const base = new Graphics();
  const color = FACTION_COLORS[unit.faction] || '#f0c866';
  const size = options.size || 18;
  base.roundRect(-size * 0.5, -size * 0.5, size, size, size * 0.2);
  base.fill({ color, alpha: 0.92 });
  base.stroke({ color: 0x2a1a0e, width: 1.2, alpha: 0.7 });
  container.addChild(base);

  const label = new Text({
    text: def.glyph || unit.type.slice(0, 1).toUpperCase(),
    style: new TextStyle({ fill: '#17331f', fontSize: Math.max(8, size * 0.45), fontWeight: '800' })
  });
  label.anchor.set(0.5);
  container.addChild(label);
  return container;
}

export function createBuildingDisplay(building, options = {}) {
  const def = BUILDING_TYPES[building.type] || {};
  const container = new Container();
  container.label = `building:${building.id}`;
  const size = options.size || 22;
  const color = FACTION_COLORS[building.faction] || '#d9ac55';
  const body = new Graphics();
  body.roundRect(-size * 0.55, -size * 0.35, size * 1.1, size * 0.9, size * 0.12);
  body.fill({ color, alpha: 0.9 });
  body.stroke({ color: 0x2a1a0e, width: 1.4, alpha: 0.75 });
  container.addChild(body);

  const label = new Text({
    text: def.glyph || '▣',
    style: new TextStyle({ fill: '#17331f', fontSize: Math.max(9, size * 0.42), fontWeight: '800' })
  });
  label.anchor.set(0.5);
  container.addChild(label);
  return container;
}

export function instantiateEntityFromDefinition(kind, entity, layout, tileCenterFn) {
  const display = kind === 'unit'
    ? createUnitDisplay(entity, { size: layout?.tileSize ? layout.tileSize * 0.34 : 18 })
    : createBuildingDisplay(entity, { size: layout?.tileSize ? layout.tileSize * 0.38 : 22 });
  if (layout && tileCenterFn) {
    const pos = tileCenterFn(layout, entity.x, entity.y);
    display.position.set(pos.x, pos.y);
  }
  return display;
}
