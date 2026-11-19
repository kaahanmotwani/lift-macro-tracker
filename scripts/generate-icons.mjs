#!/usr/bin/env node
/**
 * Generates the PWA / home-screen icons.
 *
 * Written by hand rather than pulled from an image library: it's ~120 lines of
 * pure Node, and it means `npm run icons` works on any machine with no native
 * dependencies to compile. Run it after changing the brand color.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const BG = [10, 11, 13, 255]; // --color-ink
const FG = [249, 115, 22, 255]; // --color-accent

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit RGBA, no interlacing)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // bytes 10-12 stay 0: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with its filter type byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function canvas(size, fill) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) buf.set(fill, i * 4);
  return buf;
}

/** Anti-aliased rounded rectangle, by 3×3 supersampling of coverage. */
function roundRect(buf, size, x0, y0, w, h, r, color) {
  const inside = (px, py) => {
    const cx = Math.min(Math.max(px, x0 + r), x0 + w - r);
    const cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
    if (px < x0 || px > x0 + w || py < y0 || py > y0 + h) return false;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r || (px >= x0 + r && px <= x0 + w - r) || (py >= y0 + r && py <= y0 + h - r);
  };

  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y0 + h)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x0 + w)); x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
        }
      }
      if (!hits) continue;
      const a = hits / 9;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        buf[i + c] = Math.round(buf[i + c] * (1 - a) + color[c] * a);
      }
      buf[i + 3] = 255;
    }
  }
}

/** A dumbbell: two end blocks, two inner collars, one bar. */
function drawIcon(size, { padding = 0.16 } = {}) {
  const buf = canvas(size, BG);
  const s = (v) => v * size;
  const midY = s(0.5);

  const inset = s(padding);
  const usable = size - inset * 2;
  const u = (v) => inset + v * usable;

  // outer plates
  roundRect(buf, size, u(0), midY - s(0.19), s(0.13) * (usable / size), s(0.38), s(0.045), FG);
  roundRect(buf, size, u(1) - s(0.13) * (usable / size), midY - s(0.19), s(0.13) * (usable / size), s(0.38), s(0.045), FG);
  // inner collars
  roundRect(buf, size, u(0.19), midY - s(0.115), s(0.085) * (usable / size), s(0.23), s(0.03), FG);
  roundRect(buf, size, u(1) - s(0.275) * (usable / size), midY - s(0.115), s(0.085) * (usable / size), s(0.23), s(0.03), FG);
  // bar
  roundRect(buf, size, u(0.26), midY - s(0.045), usable * 0.48, s(0.09), s(0.03), FG);

  return buf;
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, padding: 0.13 },
  { file: "icon-512.png", size: 512, padding: 0.13 },
  // iOS crops nothing but shows the icon on a light background — keep the art
  // inside a comfortable margin so it reads at 60px on a home screen.
  { file: "apple-touch-icon.png", size: 180, padding: 0.15 },
  // Maskable icons get cropped to a circle on Android; keep art well inside.
  { file: "maskable-512.png", size: 512, padding: 0.24 },
];

for (const { file, size, padding } of targets) {
  const png = encodePng(size, size, drawIcon(size, { padding }));
  writeFileSync(join(OUT, file), png);
  console.log(`wrote public/icons/${file} (${size}×${size}, ${png.length} bytes)`);
}
