import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { getContentTables } from './content-loader.js';

const SPRITE_REGIONS = {
  scout: { x: 0, y: 164, w: 120, h: 120 },
  legionary: { x: 138, y: 164, w: 120, h: 120 },
  archer: { x: 276, y: 164, w: 120, h: 120 },
  shrine: { x: 552, y: 164, w: 120, h: 120 },
  portal: { x: 828, y: 164, w: 120, h: 120 }
};

export function createEntityFromDefinition(kind, id, options = {}) {
  const tables = getContentTables();
  const def = kind === 'unit' ? tables.units[id] : tables.buildings[id];
  if (!def) return null;

  const root = new Container();
  root.label = `${kind}:${id}`;
  root.eventMode = 'static';

  const body = new Graphics();
  const color = options.factionColor || '#f0c866';
  body.roundRect(-14, -18, 28, 24, 6);
  body.fill({ color: hexToNumber(color), alpha: 0.92 });
  body.stroke({ color: 0x2b2218, width: 2, alpha: 0.7 });
  root.addChild(body);

  if (options.spriteSheet?.source) {
    const region = SPRITE_REGIONS[id];
    if (region) {
      const frame = new Texture({
        source: options.spriteSheet.source,
        frame: { x: region.x, y: region.y, width: region.w, height: region.h }
      });
      const sprite = new Sprite(frame);
      sprite.anchor.set(0.5, 0.85);
      sprite.width = 34;
      sprite.height = 34;
      root.addChild(sprite);
    }
  }

  root.entityMeta = {
    kind,
    id,
    definition: def,
    artPath: options.artPath || `./assets/sprites/olundar-sprite-sheet.svg#${id}`
  };

  return root;
}

export function createTerrainMarker(terrainId) {
  const tables = getContentTables();
  const def = tables.terrain[terrainId];
  if (!def) return null;
  const marker = new Graphics();
  const palette = terrainPalette(terrainId);
  marker.poly([-16, 0, 0, -10, 16, 0, 0, 10]);
  marker.fill({ color: hexToNumber(palette.base), alpha: 0.95 });
  marker.stroke({ color: hexToNumber(palette.shadow), width: 2, alpha: 0.8 });
  marker.entityMeta = { kind: 'terrain', id: terrainId, definition: def };
  return marker;
}

function terrainPalette(id) {
  const palettes = {
    plains: { base: '#cfe66d', shadow: '#6f9b3f' },
    forest: { base: '#278f52', shadow: '#0f5934' },
    hills: { base: '#d9ac55', shadow: '#9b6b2b' },
    mountains: { base: '#bdc9c2', shadow: '#74817b' },
    river: { base: '#1caee0', shadow: '#04739f' },
    marsh: { base: '#78bf6b', shadow: '#427d4a' },
    ruins: { base: '#cfbe93', shadow: '#7f7155' },
    blight: { base: '#675b86', shadow: '#2d2440' }
  };
  return palettes[id] || palettes.plains;
}

function hexToNumber(hex) {
  return Number.parseInt(String(hex).replace('#', ''), 16);
}
