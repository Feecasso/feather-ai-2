'use strict';

/**
 * Generates every Feather AI 2.0 image asset from code:
 *   assets/sprites/agents.png   (3 agents x 6 frames, 48x64 logical, 3x)
 *   assets/sprites/agents.json  (frame metadata)
 *   assets/icon-256.png, build/icon.png, build/icon.ico
 *   assets/preview-agents.png   (contact sheet for reviewers)
 *
 * No third-party art, fonts, or stock imagery is used.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const S = 3;
const FW = 48;
const FH = 64;
const COLS = 6;
const ROWS = 3;

const C = {
  transparent: [0, 0, 0, 0],
  black: [5, 7, 5, 255],
  outline: [10, 14, 10, 255],
  shadow: [24, 33, 24, 255],
  skin: [92, 52, 30, 255],
  skinHi: [124, 72, 42, 255],
  skinLo: [66, 36, 21, 255],
  hair: [18, 12, 8, 255],
  hairHi: [50, 34, 21, 255],
  coat: [238, 244, 230, 255],
  coatHi: [250, 255, 244, 255],
  coatShade: [196, 208, 188, 255],
  coatDark: [154, 170, 148, 255],
  lime: [184, 255, 56, 255],
  limeDim: [104, 160, 26, 255],
  limeDark: [58, 92, 18, 255],
  cyan: [102, 224, 255, 255],
  amber: [255, 179, 71, 255],
  red: [255, 92, 92, 255],
  pants: [22, 30, 22, 255],
  shoe: [9, 12, 9, 255],
  glass: [20, 42, 34, 255],
  white: [245, 255, 235, 255],
  belt: [42, 34, 22, 255]
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

class Surface {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const index = (y * this.width + x) * 4;
    this.data[index] = color[0];
    this.data[index + 1] = color[1];
    this.data[index + 2] = color[2];
    this.data[index + 3] = color[3];
  }

  fill(color) {
    for (let y = 0; y < this.height; y += 1) for (let x = 0; x < this.width; x += 1) this.set(x, y, color);
  }

  toPng() {
    return encodePng(this.width, this.height, this.data);
  }
}

class Painter {
  constructor(surface, offsetX, offsetY, scale) {
    this.surface = surface;
    this.ox = offsetX;
    this.oy = offsetY;
    this.scale = scale;
  }

  px(x, y, color) {
    const sx = this.ox + Math.round(x) * this.scale;
    const sy = this.oy + Math.round(y) * this.scale;
    for (let dy = 0; dy < this.scale; dy += 1) for (let dx = 0; dx < this.scale; dx += 1) this.surface.set(sx + dx, sy + dy, color);
  }

  rect(x, y, w, h, color) {
    for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) this.px(x + xx, y + yy, color);
  }

  hline(x, y, w, color) {
    this.rect(x, y, w, 1, color);
  }

  vline(x, y, h, color) {
    this.rect(x, y, 1, h, color);
  }
}

const VARIANT = {
  lead: {
    skin: [112, 64, 36, 255],
    skinHi: [146, 88, 51, 255],
    skinLo: [80, 42, 23, 255],
    accent: C.lime
  },
  scanner: {
    skin: [92, 52, 30, 255],
    skinHi: [126, 75, 44, 255],
    skinLo: [64, 35, 20, 255],
    accent: C.cyan
  },
  repair: {
    skin: [126, 76, 43, 255],
    skinHi: [160, 102, 60, 255],
    skinLo: [94, 54, 30, 255],
    accent: C.amber
  }
};

function drawHairLead(p, skin) {
  p.rect(17, 5, 14, 5, C.hair);
  p.rect(18, 4, 12, 1, C.hairHi);
  p.rect(16, 8, 2, 3, C.hair);
  p.rect(30, 8, 2, 3, C.hair);
  p.px(17, 8, C.hair);
  p.px(30, 8, C.hair);
  p.rect(18, 9, 2, 1, C.hairHi);
}

function drawHairScanner(p, skin) {
  // Shoulder-length dreadlocks: crown volume plus segmented side locks.
  p.rect(16, 4, 16, 5, C.hair);
  p.rect(17, 3, 14, 1, C.hairHi);
  p.rect(15, 7, 3, 4, C.hair);
  p.rect(30, 7, 3, 4, C.hair);
  for (let y = 8; y <= 29; y += 3) {
    p.rect(14, y, 3, 3, y % 2 ? C.hair : C.hairHi);
    p.rect(31, y, 3, 3, y % 2 ? C.hairHi : C.hair);
    p.px(13, y + 1, C.hair);
    p.px(34, y + 1, C.hair);
    p.px(15, y + 2, C.hairHi);
    p.px(32, y + 2, C.hairHi);
  }
  p.rect(15, 7, 1, 22, C.hair);
  p.rect(32, 7, 1, 22, C.hair);
  // A couple of locks fall in front of the shoulders.
  p.rect(17, 20, 2, 9, C.hair);
  p.rect(29, 20, 2, 9, C.hairHi);
  p.rect(17, 28, 1, 1, C.hairHi);
  p.rect(30, 27, 1, 1, C.hair);
}

function drawHairRepair(p, skin) {
  // High-top fade with a safety-goggle band pushed up on the forehead.
  p.rect(17, 5, 14, 5, C.hair);
  p.rect(18, 3, 12, 3, C.hair);
  p.rect(19, 2, 3, 1, C.hairHi);
  p.rect(24, 2, 3, 1, C.hairHi);
  p.rect(28, 2, 2, 1, C.hairHi);
  p.rect(16, 9, 2, 2, C.hair);
  p.rect(30, 9, 2, 2, C.hair);
  // Goggle band + amber lenses on the forehead.
  p.rect(18, 8, 12, 2, C.lime);
  p.rect(19, 8, 4, 2, C.glass);
  p.rect(25, 8, 4, 2, C.glass);
  p.px(20, 8, C.amber);
  p.px(26, 8, C.amber);
}

function drawFace(p, variant, frame) {
  const skin = VARIANT[variant].skin;
  const skinHi = VARIANT[variant].skinHi;
  const skinLo = VARIANT[variant].skinLo;
  // Head block with rounded pixel corners.
  p.rect(19, 10, 10, 8, skin);
  p.rect(20, 9, 8, 1, skin);
  p.rect(20, 18, 8, 1, skin);
  p.rect(18, 12, 1, 4, skinLo);
  p.rect(29, 12, 1, 4, skinHi);
  // Ears.
  p.rect(17, 13, 2, 3, skinLo);
  p.rect(30, 13, 2, 3, skinHi);
  // Eyes (blink on idle frame B).
  if (frame === 1) {
    p.hline(21, 14, 2, C.hair);
    p.hline(26, 14, 2, C.hair);
  } else {
    p.rect(21, 13, 2, 2, C.white);
    p.rect(26, 13, 2, 2, C.white);
    p.px(22, 14, C.black);
    p.px(27, 14, C.black);
  }
  // Nose and mouth.
  p.rect(23, 15, 2, 2, skinHi);
  p.px(23, 17, skinLo);
  p.rect(22, 18, 4, 1, C.hair);
  p.px(23, 18, skinLo);
  // Cheek highlight.
  p.px(20, 16, skinHi);
}

function drawScannerFace(p, frame) {
  // Square glasses: two lenses and a bridge, deliberately chunky.
  p.rect(19, 12, 4, 4, C.lime);
  p.rect(25, 12, 4, 4, C.lime);
  p.rect(20, 13, 2, 2, C.glass);
  p.rect(26, 13, 2, 2, C.glass);
  p.px(20, 13, C.cyan);
  p.px(26, 13, C.cyan);
  p.rect(23, 13, 2, 1, C.lime);
  p.px(19, 12, C.black);
  p.px(28, 15, C.black);
  // Short beard along the jaw plus a moustache.
  p.rect(20, 17, 8, 3, C.hair);
  p.rect(21, 19, 6, 1, C.hairHi);
  p.rect(22, 17, 4, 1, C.hairHi);
  p.rect(22, 18, 2, 1, C.skinLo);
  p.rect(25, 18, 2, 1, C.skinLo);
  if (frame === 2 || frame === 3) {
    p.rect(23, 18, 2, 1, C.white);
  }
}

function drawCoat(p, variant, frame) {
  const accent = VARIANT[variant].accent;
  // Shoulders and torso in a white lab coat.
  p.rect(13, 21, 22, 4, C.coat);
  p.rect(14, 24, 20, 18, C.coat);
  p.rect(15, 42, 18, 2, C.coatShade);
  p.rect(16, 20, 16, 1, C.coatHi);
  // Outline.
  p.vline(13, 24, 18, C.coatDark);
  p.vline(34, 24, 18, C.coatDark);
  p.hline(14, 42, 20, C.coatDark);
  // Lapels and center opening.
  p.rect(18, 22, 3, 7, C.coatHi);
  p.rect(27, 22, 3, 7, C.coatHi);
  p.rect(23, 23, 2, 19, C.shadow);
  p.px(22, 22, C.coatShade);
  p.px(25, 22, C.coatShade);
  // Accent tie / lanyard.
  if (variant === 'lead') {
    p.rect(23, 21, 2, 4, accent);
    p.rect(22, 25, 4, 7, accent);
    p.px(23, 32, C.limeDim);
    p.px(24, 32, C.limeDim);
  } else if (variant === 'scanner') {
    p.rect(22, 21, 4, 1, accent);
    p.rect(27, 28, 4, 3, accent);
    p.rect(28, 29, 2, 1, C.glass);
  } else {
    p.rect(22, 21, 4, 2, accent);
    p.rect(27, 30, 4, 2, C.hairHi);
    p.rect(28, 30, 1, 4, C.coatDark);
  }
  // ID badge.
  p.rect(27, 25, 4, 5, C.white);
  p.rect(28, 26, 2, 1, C.coatDark);
  p.rect(28, 28, 2, 1, accent);
  // Pocket.
  p.rect(15, 32, 5, 5, C.coatShade);
  p.hline(15, 32, 5, C.coatHi);
  if (variant === 'repair') {
    p.rect(16, 33, 2, 4, C.limeDim);
    p.rect(18, 33, 1, 3, C.amber);
    p.rect(15, 41, 19, 3, C.belt);
    p.rect(23, 41, 3, 3, C.lime);
    p.px(24, 42, C.black);
  }
  // Buttons.
  p.px(26, 34, C.coatDark);
  p.px(26, 37, C.coatDark);
  p.px(26, 40, C.coatDark);
}

function drawArm(p, variant, side, mode, frame) {
  const skin = VARIANT[variant].skin;
  const skinHi = VARIANT[variant].skinHi;
  const x = side === 'left' ? 11 : 33;
  const dir = side === 'left' ? 1 : -1;
  if (mode === 'up' && side === 'right') {
    p.rect(30, 18, 4, 4, C.coat);
    p.rect(33, 14, 4, 5, C.coat);
    p.rect(35, 10, 4, 5, C.coat);
    p.rect(36, 8, 4, 3, skin);
    p.rect(37, 7, 2, 1, skinHi);
    p.px(39, 10, C.lime);
    return;
  }
  if (mode === 'type') {
    const offset = frame % 2;
    p.rect(x, 22, 4, 11, C.coat);
    p.rect(x + dir * 1, 32, 4, 4, C.coatShade);
    p.rect(x + dir * 3, 35 + offset, 5, 3, skin);
    p.hline(x + dir * 4, 35 + offset, 3, skinHi);
    p.px(x + dir * 2, 22, C.coatHi);
    return;
  }
  // Relaxed arm.
  p.rect(x, 22, 4, 14, C.coat);
  p.rect(x, 36, 4, 3, C.coatShade);
  p.rect(x + (side === 'left' ? -1 : 0), 39, 4, 3, skin);
  p.px(x + (side === 'left' ? 0 : 2), 40, skinHi);
  p.px(x + dir, 23, C.coatHi);
}

function drawLegs(p, frame) {
  p.rect(17, 43, 6, 13, C.pants);
  p.rect(25, 43, 6, 13, C.pants);
  p.rect(18, 43, 1, 13, C.outline);
  p.rect(24, 43, 1, 13, C.outline);
  p.rect(31, 43, 1, 13, C.outline);
  if (frame === 4) {
    // Slight stride for the handoff frame.
    p.rect(16, 55, 8, 3, C.shoe);
    p.rect(25, 55, 9, 3, C.shoe);
    p.rect(33, 55, 2, 2, C.shoe);
  } else {
    p.rect(16, 55, 8, 3, C.shoe);
    p.rect(25, 55, 8, 3, C.shoe);
  }
  p.hline(17, 56, 6, C.outline);
  p.hline(26, 56, 6, C.outline);
}

function drawScientist(p, variant, frame) {
  // Pose per column: 0 idle A, 1 idle B, 2 typing A, 3 typing B, 4 handoff, 5 done.
  const typing = frame === 2 || frame === 3;
  const handoff = frame === 4;
  const done = frame === 5;

  drawLegs(p, frame);

  // Back arm first, then coat/head, then front arm.
  if (handoff) drawArm(p, variant, 'left', 'down', frame);
  else drawArm(p, variant, 'left', typing ? 'type' : 'down', frame);

  drawCoat(p, variant, frame);

  // Neck.
  p.rect(21, 19, 6, 3, VARIANT[variant].skinLo);
  p.rect(22, 19, 4, 2, VARIANT[variant].skin);

  drawFace(p, variant, frame);
  if (variant === 'lead') drawHairLead(p, VARIANT[variant].skin);
  if (variant === 'scanner') {
    drawHairScanner(p, VARIANT[variant].skin);
    drawScannerFace(p, frame);
  }
  if (variant === 'repair') drawHairRepair(p, VARIANT[variant].skin);

  if (done) {
    drawArm(p, variant, 'right', 'up', frame);
    // Lime confirmation spark.
    p.px(41, 7, C.lime);
    p.px(43, 11, C.limeDim);
    p.px(39, 4, C.lime);
  } else if (handoff) {
    drawArm(p, variant, 'right', 'up', frame);
  } else {
    drawArm(p, variant, 'right', typing ? 'type' : 'down', frame);
  }

  // A small pulse light on the chest for non-idle frames.
  if (typing) {
    p.px(28, 23, C.lime);
    p.px(29, 23, C.limeDim);
  }
}

function drawSpriteSheet() {
  const surface = new Surface(FW * S * COLS, FH * S * ROWS);
  const order = ['lead', 'scanner', 'repair'];
  order.forEach((variant, row) => {
    for (let col = 0; col < COLS; col += 1) {
      const painter = new Painter(surface, col * FW * S, row * FH * S, S);
      drawScientist(painter, variant, col);
    }
  });
  return surface;
}

function drawIconSurface() {
  const surface = new Surface(64 * 4, 64 * 4);
  const p = new Painter(surface, 0, 0, 4);
  // Black tile with a lime border and clipped corners.
  p.rect(2, 2, 60, 60, C.black);
  p.rect(3, 3, 58, 58, C.outline);
  p.rect(4, 4, 56, 56, C.black);
  p.rect(4, 4, 56, 2, C.lime);
  p.rect(4, 58, 56, 2, C.lime);
  p.rect(4, 4, 2, 56, C.lime);
  p.rect(58, 4, 2, 56, C.lime);
  p.rect(6, 6, 52, 2, C.limeDark);
  p.rect(6, 56, 52, 2, C.limeDark);
  // Feather shaft.
  for (let i = 0; i < 34; i += 1) {
    const x = 22 + Math.round(i * 0.55);
    const y = 51 - i;
    p.rect(x, y, 2, 2, C.white);
    p.px(x + 1, y + 1, C.lime);
  }
  // Barbs, alternating lime and white.
  for (let i = 0; i < 11; i += 1) {
    const y = 47 - i * 3;
    const x = 22 + i;
    const len = 8 - Math.floor(i / 2);
    p.rect(x - len, y, len, 2, i % 2 ? C.lime : C.white);
    p.rect(x + 2, y - 2, Math.max(3, len - 2), 2, i % 2 ? C.white : C.lime);
    p.px(x - len, y + 1, C.limeDim);
  }
  // Quill tip.
  p.rect(20, 52, 4, 4, C.lime);
  p.rect(18, 55, 3, 3, C.limeDim);
  p.px(17, 57, C.lime);
  // 2.0 badge.
  p.rect(39, 39, 14, 13, C.black);
  p.rect(40, 40, 12, 11, C.lime);
  p.rect(42, 42, 8, 2, C.black);
  p.rect(47, 43, 3, 2, C.black);
  p.rect(44, 45, 6, 2, C.black);
  p.rect(42, 47, 4, 2, C.black);
  p.rect(42, 49, 8, 2, C.black);
  p.rect(39, 53, 2, 2, C.amber);
  return surface;
}

function drawPreview(sheet) {
  const width = FW * S * COLS + 48;
  const height = FH * S * ROWS + 96;
  const surface = new Surface(width, height);
  surface.fill([7, 10, 7, 255]);
  // Copy the sprite sheet.
  for (let y = 0; y < sheet.height; y += 1) {
    for (let x = 0; x < sheet.width; x += 1) {
      const idx = (y * sheet.width + x) * 4;
      const color = [sheet.data[idx], sheet.data[idx + 1], sheet.data[idx + 2], sheet.data[idx + 3]];
      surface.set(x + 24, y + 72, color);
    }
  }
  // Accent lines.
  for (let x = 24; x < width - 24; x += 1) {
    surface.set(x, 30, C.lime);
    surface.set(x, 31, C.limeDark);
    surface.set(x, height - 28, C.limeDark);
  }
  return surface;
}

function scaleDown(surface, size) {
  const out = new Surface(size, size);
  const ratio = surface.width / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(surface.width - 1, Math.floor(x * ratio + ratio / 2));
      const sy = Math.min(surface.height - 1, Math.floor(y * ratio + ratio / 2));
      const idx = (sy * surface.width + sx) * 4;
      out.set(x, y, [surface.data[idx], surface.data[idx + 1], surface.data[idx + 2], surface.data[idx + 3]]);
    }
  }
  return out;
}

function buildIco(surface, sizes) {
  const images = sizes.map((size) => ({ size, png: scaleDown(surface, size).toPng() }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

function main() {
  fs.mkdirSync(path.join(ROOT, 'assets', 'sprites'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

  const sheet = drawSpriteSheet();
  fs.writeFileSync(path.join(ROOT, 'assets', 'sprites', 'agents.png'), sheet.toPng());
  fs.writeFileSync(
    path.join(ROOT, 'assets', 'sprites', 'agents.json'),
    JSON.stringify(
      {
        image: 'agents.png',
        frameWidth: FW * S,
        frameHeight: FH * S,
        scale: S,
        logicalWidth: FW,
        logicalHeight: FH,
        rows: ['lead', 'scanner', 'repair'],
        columns: ['idle-a', 'idle-b', 'work-a', 'work-b', 'handoff', 'done'],
        note: 'Original Feather AI 2.0 pixel art generated by scripts/generate-art.js.'
      },
      null,
      2
    )
  );

  const preview = drawPreview(sheet);
  fs.writeFileSync(path.join(ROOT, 'assets', 'preview-agents.png'), preview.toPng());

  const icon = drawIconSurface();
  fs.writeFileSync(path.join(ROOT, 'assets', 'icon-256.png'), icon.toPng());
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), icon.toPng());
  fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), buildIco(icon, [16, 32, 48, 64, 128, 256]));

  console.log('art: wrote assets/sprites/agents.png');
  console.log('art: wrote assets/sprites/agents.json');
  console.log('art: wrote assets/preview-agents.png');
  console.log('art: wrote assets/icon-256.png, build/icon.png, build/icon.ico');
}

main();
