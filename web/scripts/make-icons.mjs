// Generates placeholder PWA icons (no dependencies): three fanned cards on the
// app's dark background. Writes web/public/icons/*.png. Replace these files with
// real artwork whenever it exists; the manifest only cares about the filenames.
//
// Usage: node scripts/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = new URL('../public/icons/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const BG = [0x14, 0x18, 0x1f];
const CARDS = [
  { angle: -0.32, color: [0x4f, 0x8f, 0xd6] },
  { angle: 0.32, color: [0xd6, 0x60, 0x4f] },
  { angle: 0, color: [0xd8, 0xb4, 0x5a] },
];
const BORDER = [0x0b, 0x0e, 0x13];

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgb.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance-ish test: is (px,py) inside a rounded rect rotated by `angle` about (cx,cy)? */
function insideCard(px, py, cx, cy, w, h, r, angle) {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = px - cx;
  const dy = py - cy;
  const x = Math.abs(dx * cos - dy * sin);
  const y = Math.abs(dx * sin + dy * cos);
  const ax = x - (w / 2 - r);
  const ay = y - (h / 2 - r);
  if (ax <= 0 && y <= h / 2) return true;
  if (ay <= 0 && x <= w / 2) return true;
  return ax > 0 && ay > 0 && ax * ax + ay * ay <= r * r;
}

function render(size, scale) {
  const rgb = Buffer.alloc(size * size * 3);
  const pivotX = size / 2;
  const pivotY = size * 0.8;
  const w = size * 0.34 * scale;
  const h = size * 0.5 * scale;
  const r = size * 0.04 * scale;
  const border = Math.max(1.5, size * 0.012);
  const reach = size * 0.3 * scale; // distance from pivot to each card's center
  const shapes = CARDS.map((card) => ({
    ...card,
    cx: pivotX + Math.sin(card.angle) * reach,
    cy: pivotY - Math.cos(card.angle) * reach,
  }));
  const SS = 3; // supersampling grid per axis
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          let color = BG;
          for (const s of shapes) {
            if (insideCard(x, y, s.cx, s.cy, w, h, r, s.angle)) {
              color = insideCard(x, y, s.cx, s.cy, w - 2 * border, h - 2 * border, Math.max(0, r - border), s.angle)
                ? s.color
                : BORDER;
            }
          }
          rs += color[0];
          gs += color[1];
          bs += color[2];
        }
      }
      const i = (py * size + px) * 3;
      rgb[i] = Math.round(rs / (SS * SS));
      rgb[i + 1] = Math.round(gs / (SS * SS));
      rgb[i + 2] = Math.round(bs / (SS * SS));
    }
  }
  return encodePng(size, rgb);
}

mkdirSync(OUT_DIR, { recursive: true });
const outputs = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, 0.78], // keep artwork inside the maskable safe zone
  ['apple-touch-icon.png', 180, 1],
];
for (const [file, size, scale] of outputs) {
  writeFileSync(join(OUT_DIR, file), render(size, scale));
  console.log(`wrote icons/${file} (${size}x${size})`);
}
