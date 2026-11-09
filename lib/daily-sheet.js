// Reads the board runner's Daily OR Schedule workbook into the same shape as a sheet read from
// the WhatsApp photo. Blocks below the room table move around from day to day, so they're found
// by their labels, not by fixed cells. Columns from K on are the board runner's own worksheet
// (resident list, steps, H1-H16) and are ignored.
const MAX_COL = 10;
const LABEL = /^(mda|residents?|pat|ob|night coverage|opsc\b.*|meyers\b.*)$/i;
const PROCEDURE = /^(cath lab|ep lab|tee|angio|ct|mri|bedside icu)\s*\((\d+)\)\s*$/i;

const pad = (n) => String(n).padStart(2, "0");

function isoDate(cell) {
  if (cell?.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  const m = String(cell?.text ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
}

// Start times are stored as a fraction of a day (0.3125 is 7:30).
function clockText(cell) {
  if (!cell) return "";
  // A cell formatted as a time reads as a Date on Excel's day zero.
  if (cell.value instanceof Date) {
    const h = cell.value.getUTCHours() % 12 || 12;
    return `${h}:${pad(cell.value.getUTCMinutes())}`;
  }
  const n = typeof cell.value === "number" ? cell.value : null;
  if (n === null || n <= 0 || n >= 1) return cell.text.trim();
  const mins = Math.round(n * 1440);
  const h = Math.floor(mins / 60) % 12 || 12;
  return `${h}:${pad(mins % 60)}`;
}

export function parseDailyWorkbook(wb) {
  const s = wb.sheets.find((x) => /or schedule/i.test(x.name)) || wb.sheets[0];
  if (!s) throw new Error("The workbook has no sheets.");
  const text = (r, c) => s.text(r, c).replace(/\s+/g, " ").trim();

  // The header row names the columns, so an added column doesn't shift anything.
  let head = 0;
  for (let r = 1; r <= Math.min(12, s.maxRow) && !head; r++) {
    for (let c = 1; c <= MAX_COL; c++) if (/^surgeon$/i.test(text(r, c))) head = r;
  }
  if (!head) throw new Error("Couldn't find the row with OR, Surgeon, Time.");
  const col = {};
  for (let c = 1; c <= MAX_COL; c++) {
    const t = text(head, c).toLowerCase();
    if (t === "or") col.or = c;
    else if (t === "surgeon") col.surgeon = c;
    else if (t === "time") col.time = c;
    else if (t.includes("case")) col.cases = c;
    else if (t === "mda") col.mda = c;
    else if (t.includes("resident") || t.includes("crna")) col.staff = c;
    else if (t === "ja") col.ja = c;
    else if (t === "breaks") col.breaks = c;
  }
  if (!col.or || !col.staff) throw new Error("The room table's columns have changed.");

  let date = null;
  for (let r = 1; r < head && !date; r++) for (let c = 1; c <= MAX_COL && !date; c++) date = isoDate(s.get(r, c));
  if (!date) throw new Error("Couldn't find the date at the top of the sheet.");

  // The room table runs until the first block label.
  let end = s.maxRow + 1;
  for (let r = head + 1; r <= s.maxRow && end > s.maxRow; r++) {
    for (let c = 1; c <= MAX_COL; c++) if (LABEL.test(text(r, c))) { end = r; break; }
  }
  const rooms = [];
  for (let r = head + 1; r < end; r++) {
    const room = {
      or: text(r, col.or), surgeon: text(r, col.surgeon), time: clockText(s.get(r, col.time)), cases: text(r, col.cases),
      mda: text(r, col.mda), staff: text(r, col.staff), ja: text(r, col.ja), breaks: text(r, col.breaks), extra: "",
    };
    if (room.or && (room.surgeon || room.staff || room.mda)) rooms.push(room);
  }

  // ---- the blocks below the table ----
  const used = new Set();
  const take = (r, c) => { used.add(`${r},${c}`); return text(r, c); };
  // Names going down a column, until a blank cell or the next label.
  const down = (r, c) => {
    const out = [];
    for (let y = r; y <= s.maxRow && text(y, c) && !LABEL.test(text(y, c)); y++) out.push(take(y, c));
    return out;
  };
  const find = (re) => {
    for (let r = end; r <= s.maxRow; r++) for (let c = 1; c <= MAX_COL; c++) if (re.test(text(r, c))) return { r, c, m: text(r, c).match(re) };
    return null;
  };
  const skip = (r, c) => used.add(`${r},${c}`);

  const opsc = { rooms: "", mdas: [], residents: [] };
  const o = find(/^opsc\b.*?(?:\((\d+)\))?\s*$/i);
  if (o) {
    skip(o.r, o.c);
    opsc.rooms = o.m[1] || "";
    opsc.mdas = down(o.r, o.c + 1);
    const y = o.r + opsc.mdas.length;
    if (/^residents?$/i.test(text(y, o.c + 1))) { skip(y, o.c + 1); opsc.residents = down(y + 1, o.c + 1); }
  }

  const meyers = { rooms: "", mda: "" };
  const my = find(/^meyers\b.*?(?:\((\d+)\))?\s*$/i);
  if (my) {
    skip(my.r, my.c);
    meyers.rooms = my.m[1] || "";
    if (/^mda$/i.test(text(my.r, my.c + 1))) { skip(my.r, my.c + 1); meyers.mda = take(my.r + 1, my.c + 1); }
    else meyers.mda = take(my.r, my.c + 1);
  }

  const procedures = [];
  for (let r = end; r <= s.maxRow; r++) {
    for (let c = 1; c <= MAX_COL; c++) {
      const m = text(r, c).match(PROCEDURE);
      if (!m) continue;
      skip(r, c);
      let mda = "";
      for (let x = c + 1; x <= Math.min(c + 3, MAX_COL) && !mda; x++) if (text(r, x) && !LABEL.test(text(r, x)) && !PROCEDURE.test(text(r, x))) mda = take(r, x);
      procedures.push({ name: m[1], count: m[2], mda });
    }
  }

  let pat = [];
  const p = find(/^pat$/i);
  if (p) { skip(p.r, p.c); pat = down(p.r + 1, p.c); }

  const ob = { mda: "", residents: [] };
  const b = find(/^ob$/i);
  if (b) {
    skip(b.r, b.c);
    if (text(b.r + 1, b.c) && !LABEL.test(text(b.r + 1, b.c))) ob.mda = take(b.r + 1, b.c);
    for (let y = b.r + 1; y <= b.r + 3; y++) {
      if (/^residents?$/i.test(text(y, b.c))) { skip(y, b.c); ob.residents = down(y + 1, b.c); break; }
    }
  }

  let night = [];
  const n = find(/^night coverage$/i);
  if (n) { skip(n.r, n.c); night = down(n.r + 1, n.c); }

  // Anything else down there is a note, such as "SDS RESIDENTS OR 7 & 8".
  const notes = [];
  for (let r = end; r <= s.maxRow; r++) {
    for (let c = 1; c <= MAX_COL; c++) {
      const t = text(r, c);
      if (t && !used.has(`${r},${c}`) && !LABEL.test(t)) notes.push(t);
    }
  }

  return { date, rooms, opsc, procedures, meyers, pat, ob, night, notes };
}

// True when every room with a case has someone in it, and the egress tab, made late in the
// board runner's steps, carries the same date. Together that looks finished.
export function looksComplete(wb, daily) {
  const cased = daily.rooms.filter((r) => r.surgeon);
  if (!cased.length || cased.some((r) => !r.staff)) return false;
  const eg = wb.sheets.find((x) => /egress/i.test(x.name));
  if (!eg) return true;
  return isoDate(eg.get(1, 1)) === daily.date;
}
