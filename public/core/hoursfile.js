// Turns whatever file a resident picks into text the hours reader (logged.js) understands.
// New Innovations' Export To Excel file is really a web page with an .xls name, and that's what
// most people pick. But a file opened in Excel or Numbers and saved again becomes a real
// spreadsheet (.xlsx, or .xls from an older Excel) or a .csv, and a page saved by another browser
// can come out as UTF-16. All of those work; a Numbers file or a PDF gets a plain answer instead.
import { readXls } from "./xls.js";

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const starts = (b, sig) => sig.every((x, i) => b[i] === x);

// An Excel date number as the export writes dates ("7/1/2025 4:45 AM"); other numbers as they are.
// Hours in a day are never this large, so only the Start, End and Last Checked columns turn.
export function cellText(v) {
  if (typeof v !== "number") return String(v ?? "").replace(/\s+/g, " ").trim();
  if (v >= 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 1440) * 60000);
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return String(Math.round(v * 100) / 100);
}

export const rowsText = (rows) => rows.map((r) => Array.from(r || [], cellText).join("\t")).join("\n");

// One CSV line into cells, quotes and doubled quotes included.
function csvCells(line) {
  const out = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

// A .csv (or a page pasted from one) as tab-separated rows, so the reader sees the same cells.
export function csvToTabs(text) {
  const lines = String(text).split(/\r?\n/);
  const csv = lines.filter((l) => /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/.test(l));
  const commas = csv.filter((l) => (l.match(/,/g) || []).length >= 3 && !l.includes("\t")).length;
  if (!csv.length || commas < csv.length / 2) return text;
  return lines.map((l) => csvCells(l).map((c) => c.trim()).join("\t")).join("\n");
}

function decodeText(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  // UTF-16 without a mark: every other byte is zero.
  const n = Math.min(b.length, 400);
  let zeros = 0;
  for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++;
  if (n > 40 && zeros > n / 4) return new TextDecoder("utf-16le").decode(b);
  return new TextDecoder("utf-8").decode(b); // drops a UTF-8 mark by itself
}

// The files inside a .zip (an .xlsx is one), read on demand. Inflating uses the browser's own
// DecompressionStream (Safari 16.4+), so nothing extra is downloaded.
function unzip(b) {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Not a zip file");
  const files = new Map();
  for (let p = u32(b, end + 16), n = u16(b, end + 10); n-- > 0 && u32(b, p) === 0x02014b50;) {
    const nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32);
    files.set(new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen)), { method: u16(b, p + 10), size: u32(b, p + 20), at: u32(b, p + 42) });
    p += 46 + nameLen + extra + comment;
  }
  const read = async (name) => {
    const f = files.get(name);
    if (!f) return "";
    const start = f.at + 30 + u16(b, f.at + 26) + u16(b, f.at + 28);
    const data = b.subarray(start, start + f.size);
    if (f.method === 0) return new TextDecoder().decode(data);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  };
  return { has: (name) => files.has(name), read };
}

const unxml = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// The first sheet of an .xlsx as rows of values (strings and numbers).
async function xlsxRows(zip) {
  const workbook = await zip.read("xl/workbook.xml");
  const rels = await zip.read("xl/_rels/workbook.xml.rels");
  const rid = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || rid && rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const shared = [...(await zip.read("xl/sharedStrings.xml")).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));
  const rows = [];
  for (const row of (await zip.read(path)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = c[1].match(/\bt="([^"]+)"/)?.[1];
      const body = c[2] || "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const value = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? unxml(body) : type === "str" || type === "e" ? unxml(v || "") : v !== undefined ? Number(v) : "";
      cells[ref ? colIndex(ref) : cells.length] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// { text } ready for parseLoggedHours, or { error } in the resident's words.
export async function hoursFileText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length) return { error: "That file is empty. Export it again from View Hours." };
  if (starts(b, [0xd0, 0xcf, 0x11, 0xe0])) {
    try { return { text: rowsText(readXls(b)), kind: "xls" }; } catch { return { error: "That Excel file couldn't be read. Pick the GridExport file New Innovations downloaded instead." }; }
  }
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      const zip = unzip(b);
      if (zip.has("Index/Document.iwa")) return { error: "That's a Numbers file. Pick the GridExport file New Innovations downloaded (Files › Downloads), not a copy saved in Numbers." };
      if (zip.has("xl/workbook.xml")) return { text: rowsText(await xlsxRows(zip)), kind: "xlsx" };
    } catch { /* falls through */ }
    return { error: "That file isn't one the app can read. Pick the GridExport file New Innovations downloaded." };
  }
  if (starts(b, [0x25, 0x50, 0x44, 0x46])) return { error: "That's a PDF. Use Export To Excel on View Hours instead." };
  return { text: csvToTabs(decodeText(b)), kind: "text" };
}
