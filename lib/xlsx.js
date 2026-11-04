// Minimal .xlsx reader that keeps what the schedules depend on: cell text as Excel
// displays it (including dates such as "10-7"), static fill colors, bold and font color.
// Generic libraries either drop styles or need a paid edition, so this reads the XML directly.
import { unzipSync, strFromU8 } from "fflate";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

function section(xml, name) {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : "";
}

function textOf(fragment) {
  // Concatenate every <t> run, skipping phonetic guide runs.
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decode(m[1]);
  return out;
}

export function colToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function indexToCol(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---- colors ---------------------------------------------------------------

const INDEXED = {
  0: "000000", 1: "FFFFFF", 2: "FF0000", 3: "00FF00", 4: "0000FF", 5: "FFFF00", 6: "FF00FF", 7: "00FFFF",
  8: "000000", 9: "FFFFFF", 10: "FF0000", 11: "00FF00", 12: "0000FF", 13: "FFFF00", 14: "FF00FF", 15: "00FFFF",
  16: "800000", 17: "008000", 18: "000080", 19: "808000", 20: "800080", 21: "008080", 22: "C0C0C0", 23: "808080",
};

function hexToRgb(hex) {
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function rgbToHex([r, g, b]) {
  return [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
}

function applyTint(hex, tint) {
  if (!tint) return hex;
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return rgbToHex(hslToRgb([h, s, l2]));
}

function parseTheme(xml) {
  const scheme = section(xml, "a:clrScheme");
  const order = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const found = {};
  for (const name of order) {
    const block = section(scheme, `a:${name}`);
    const srgb = block.match(/<a:srgbClr\b[^>]*val="([0-9A-Fa-f]{6})"/);
    const sys = block.match(/<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/);
    found[name] = (srgb?.[1] || sys?.[1] || "000000").toUpperCase();
  }
  // Excel's theme index swaps the first two pairs: 0=lt1, 1=dk1, 2=lt2, 3=dk2.
  return [found.lt1, found.dk1, found.lt2, found.dk2, found.accent1, found.accent2, found.accent3,
    found.accent4, found.accent5, found.accent6, found.hlink, found.folHlink];
}

function resolveColor(a, theme) {
  if (!a) return null;
  let hex = null;
  if (a.rgb) hex = a.rgb.length === 8 ? a.rgb.slice(2) : a.rgb;
  else if (a.theme !== undefined) hex = theme[Number(a.theme)] ?? null;
  else if (a.indexed !== undefined) hex = INDEXED[Number(a.indexed)] ?? null;
  if (!hex) return null;
  hex = hex.toUpperCase();
  return a.tint ? applyTint(hex, Number(a.tint)) : hex;
}

// ---- number formats ---------------------------------------------------------

const BUILTIN_DATE_FORMATS = { 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 22: "m/d/yy h:mm" };
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isDateFormat(code) {
  if (!code) return false;
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmy]/i.test(stripped) && !/^general$/i.test(code.trim());
}

function serialToDate(serial, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.round(serial * 86400000));
}

function formatDate(date, code) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const tokens = code.split(";")[0].replace(/\[[^\]]*\]/g, "");
  let out = "";
  for (let i = 0; i < tokens.length;) {
    const rest = tokens.slice(i);
    let mm;
    if (rest[0] === "\\") { out += rest[1] ?? ""; i += 2; continue; }
    if (rest[0] === '"') { const end = rest.indexOf('"', 1); out += rest.slice(1, end); i += end + 1; continue; }
    if ((mm = rest.match(/^yyyy/i))) { out += y; i += 4; continue; }
    if ((mm = rest.match(/^yy/i))) { out += String(y).slice(-2); i += 2; continue; }
    if ((mm = rest.match(/^mmmm/i))) { out += date.toLocaleString("en-US", { month: "long", timeZone: "UTC" }); i += 4; continue; }
    if ((mm = rest.match(/^mmm/i))) { out += MONTHS_SHORT[m - 1]; i += 3; continue; }
    if ((mm = rest.match(/^mm/i))) { out += String(m).padStart(2, "0"); i += 2; continue; }
    if ((mm = rest.match(/^m/i))) { out += m; i += 1; continue; }
    if ((mm = rest.match(/^dd/i))) { out += String(d).padStart(2, "0"); i += 2; continue; }
    if ((mm = rest.match(/^d/i))) { out += d; i += 1; continue; }
    if (/^[hs]/i.test(rest) || /^AM\/PM/i.test(rest)) { i += 1; continue; }
    out += rest[0];
    i += 1;
  }
  return out.trim();
}

function formatNumber(v) {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
}

// ---- workbook ---------------------------------------------------------------

export function readXlsx(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const files = unzipSync(u8);
  const get = (p) => (files[p] ? strFromU8(files[p]) : "");

  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new Error("Not an .xlsx workbook (xl/workbook.xml missing).");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const rels = {};
  for (const m of get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attrs(m[0]);
    rels[a.Id] = a.Target;
  }

  const shared = [];
  for (const m of get("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const theme = parseTheme(get("xl/theme/theme1.xml"));
  const stylesXml = get("xl/styles.xml");

  const numFmts = { ...BUILTIN_DATE_FORMATS };
  for (const m of section(stylesXml, "numFmts").matchAll(/<numFmt\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    numFmts[Number(a.numFmtId)] = a.formatCode;
  }

  const fonts = [];
  for (const m of section(stylesXml, "fonts").matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)) {
    const body = m[1] || "";
    const bold = /<b\s*\/>|<b\s+val="(1|true)"\s*\/>/.test(body);
    const strike = /<strike\s*\/>|<strike\s+val="(1|true)"\s*\/>/.test(body);
    const colorTag = body.match(/<color\b[^>]*\/?>/);
    fonts.push({ bold, strike, color: colorTag ? resolveColor(attrs(colorTag[0]), theme) : null });
  }

  const fills = [];
  for (const m of section(stylesXml, "fills").matchAll(/<fill\b[^>]*?(?:\/>|>([\s\S]*?)<\/fill>)/g)) {
    const body = m[1] || "";
    const pattern = body.match(/<patternFill\b[^>]*?(?:\/>|>([\s\S]*?)<\/patternFill>)/);
    if (!pattern) { fills.push(null); continue; }
    const pa = attrs(pattern[0].match(/<patternFill\b[^>]*>/)[0]);
    if (!pa.patternType || pa.patternType === "none" || pa.patternType === "gray125") { fills.push(null); continue; }
    const fg = (pattern[1] || "").match(/<fgColor\b[^>]*\/?>/);
    fills.push(fg ? resolveColor(attrs(fg[0]), theme) : null);
  }

  const xfs = [];
  for (const m of section(stylesXml, "cellXfs").matchAll(/<xf\b[^>]*?\/?>/g)) {
    const a = attrs(m[0]);
    xfs.push({ numFmtId: Number(a.numFmtId || 0), fontId: Number(a.fontId || 0), fillId: Number(a.fillId || 0) });
  }

  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    const target = rels[a["r:id"]];
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    sheets.push(readSheet(a.name, get(path), { shared, xfs, fonts, fills, numFmts, date1904 }));
  }
  return { sheets, sheet: (name) => sheets.find((s) => s.name === name) };
}

function readSheet(name, xml, ctx) {
  const cells = new Map();
  let maxRow = 0, maxCol = 0;
  const hiddenCols = new Set();
  for (const m of section(xml, "cols").matchAll(/<col\b[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    if (a.hidden === "1" || a.hidden === "true") for (let c = Number(a.min); c <= Number(a.max); c++) hiddenCols.add(c);
  }
  for (const m of section(xml, "sheetData").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(m[1]);
    const ref = a.r.match(/^([A-Z]+)(\d+)$/);
    if (!ref) continue;
    const col = colToIndex(ref[1]), row = Number(ref[2]);
    const body = m[2] || "";
    const xf = ctx.xfs[Number(a.s || 0)] || { numFmtId: 0, fontId: 0, fillId: 0 };
    const font = ctx.fonts[xf.fontId] || {};
    const fill = ctx.fills[xf.fillId] || null;
    const vRaw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
    let value = null, text = "";
    switch (a.t) {
      case "s": text = ctx.shared[Number(vRaw)] ?? ""; value = text; break;
      case "inlineStr": text = textOf(body); value = text; break;
      case "str": text = vRaw !== undefined ? decode(vRaw) : ""; value = text; break;
      case "b": value = vRaw === "1"; text = value ? "TRUE" : "FALSE"; break;
      case "e": text = vRaw !== undefined ? decode(vRaw) : ""; value = text; break;
      default:
        if (vRaw !== undefined && vRaw !== "") {
          value = Number(vRaw);
          const fmt = ctx.numFmts[xf.numFmtId];
          if (isDateFormat(fmt)) {
            const date = serialToDate(value, ctx.date1904);
            text = formatDate(date, fmt);
            value = date;
          } else text = formatNumber(value);
        }
    }
    const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
    cells.set(`${row},${col}`, {
      row, col, value, text,
      formula: formula ? decode(formula) : null,
      fill, bold: !!font.bold, strike: !!font.strike, fontColor: font.color || null,
    });
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  return {
    name, cells, maxRow, maxCol, hiddenCols,
    get(row, col) { return cells.get(`${row},${col}`) || null; },
    text(row, col) { return (cells.get(`${row},${col}`)?.text ?? "").trim(); },
  };
}
