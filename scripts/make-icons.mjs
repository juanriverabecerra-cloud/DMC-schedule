// Draws the app icons (PNG + SVG) with signed-distance shapes, no image libraries needed.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/icons");
fs.mkdirSync(out, { recursive: true });

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const roundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

// Shapes in unit coordinates (0..1). `inset` shrinks the artwork for maskable icons.
function scene(inset) {
  const s = (v) => 0.5 + (v - 0.5) * inset;
  const k = inset;
  const dots = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const green = r === 1 && c === 2, blue = r === 0 && c === 3;
    dots.push({ d: (x, y) => circle(x, y, s(0.33 + c * 0.113), s(0.53 + r * 0.1), 0.034 * k), color: green ? "#22c55e" : blue ? "#2f6fed" : "#c3d3f5" });
  }
  return [
    { d: (x, y) => roundRect(x, y, s(0.5), s(0.56), 0.27 * k, 0.25 * k, 0.07 * k), color: "#ffffff" },
    { d: (x, y) => Math.max(roundRect(x, y, s(0.5), s(0.56), 0.27 * k, 0.25 * k, 0.07 * k), (s(0.42)) - y), color: "#ffffff" },
    { d: (x, y) => Math.max(roundRect(x, y, s(0.5), s(0.56), 0.27 * k, 0.25 * k, 0.07 * k), y - s(0.42)), color: "#dbe6ff" },
    { d: (x, y) => roundRect(x, y, s(0.38), s(0.31), 0.03 * k, 0.07 * k, 0.03 * k), color: "#ffffff" },
    { d: (x, y) => roundRect(x, y, s(0.62), s(0.31), 0.03 * k, 0.07 * k, 0.03 * k), color: "#ffffff" },
    ...dots,
  ];
}

function render(size, { bleed, inset = 1 }) {
  const buf = Buffer.alloc(size * size * 4);
  const shapes = scene(inset);
  const top = hex("#3d7bff"), bot = hex("#1c3fa8");
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const px = 1 / size;
      const bgD = bleed ? -1 : roundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.225);
      const bgA = Math.min(1, Math.max(0, 0.5 - bgD / px));
      const t = (u + v) / 2;
      let col = top.map((c, i) => c + (bot[i] - c) * t);
      for (const sh of shapes) {
        const a = Math.min(1, Math.max(0, 0.5 - sh.d(u, v) / px));
        if (a > 0) { const sc = hex(sh.color); col = col.map((c, i) => c + (sc[i] - c) * a); }
      }
      const o = (y * size + x) * 4;
      buf[o] = Math.round(col[0]); buf[o + 1] = Math.round(col[1]); buf[o + 2] = Math.round(col[2]); buf[o + 3] = Math.round(bgA * 255);
    }
  }
  return png(size, buf);
}

fs.writeFileSync(path.join(out, "icon-192.png"), render(192, { bleed: false }));
fs.writeFileSync(path.join(out, "icon-512.png"), render(512, { bleed: false }));
fs.writeFileSync(path.join(out, "icon-512-maskable.png"), render(512, { bleed: true, inset: 0.78 }));
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), render(180, { bleed: true, inset: 0.92 }));
fs.writeFileSync(path.join(out, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d7bff"/><stop offset="1" stop-color="#1c3fa8"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#g)"/>
<rect x="14.7" y="19.8" width="34.6" height="32" rx="4.5" fill="#fff"/>
<rect x="14.7" y="26.9" width="34.6" height="24.9" fill="#dbe6ff"/><rect x="14.7" y="45" width="34.6" height="6.8" rx="4.5" fill="#dbe6ff"/>
<rect x="22.4" y="15.4" width="3.8" height="9" rx="1.9" fill="#fff"/><rect x="37.8" y="15.4" width="3.8" height="9" rx="1.9" fill="#fff"/>
<circle cx="28" cy="40.3" r="2.6" fill="#c3d3f5"/><circle cx="35.2" cy="40.3" r="2.6" fill="#22c55e"/><circle cx="42.4" cy="34" r="2.6" fill="#2f6fed"/><circle cx="21" cy="34" r="2.6" fill="#c3d3f5"/>
</svg>
`);
console.log("icons written to", out);
