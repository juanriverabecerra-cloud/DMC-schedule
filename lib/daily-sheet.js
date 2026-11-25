// Reads the board runner's Daily OR Schedule workbook into the same shape as a sheet read from
// the WhatsApp photo. Blocks below the room table move around from day to day, so they're found
// by their labels, not by fixed cells.
//
// Right of the table (columns K on) is the board runner's own worksheet: every resident with
// "Location that day" and "Late/Call", and the steps. The Egress tab, made late in those steps,
// has its own date and the day's attendings by slot ("H1 (MOR call)", "OB 14 (OB call)",
// "CV (CHR & CSG)"...) next to each resident's assignment. Both are read: they say where people
// are who aren't in a room (cath lab, NORA, PACU...) and which MDAs are on call.
const MAX_COL = 10;
const LABEL = /^(mda|residents?|pat|ob|night coverage|opsc\b.*|meyers\b.*)$/i;
// "Cath lab (2)"; the count is sometimes left off ("MRI") or written "Cath lab - 2".
const PROCEDURE = /^(cath lab|ep lab|tee|angio|ct|mri|rim|ir|bedside icu)\s*(?:\(\s*(\d*)\s*\)|[-–:]\s*(\d+))?\s*$/i;

const pad = (n) => String(n).padStart(2, "0");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;
// A written date with no year ("Wednesday, Nov 25") is the closest one to now.
function nearestYear(m, d, now) {
  const y = now.getFullYear();
  const options = [y - 1, y, y + 1].map((yy) => valid(yy, m, d)).filter(Boolean);
  const t = now.getTime();
  return options.sort((a, b) => Math.abs(Date.parse(a) - t) - Math.abs(Date.parse(b) - t))[0] || null;
}

// "11/25/26", "11-25-2026", "Wednesday, November 25, 2026", "Nov 25" or a real date cell.
export function isoDate(cell, now = new Date()) {
  if (cell?.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  const text = String(cell?.text ?? "");
  let m = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) return valid(m[3].length === 2 ? `20${m[3]}` : m[3], +m[1], +m[2]);
  m = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return m[3] ? valid(m[3], month, +m[2]) : nearestYear(month, +m[2], now);
  }
  return null;
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

const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

// "Resident | Location that day | Late/Call", right of the room table.
function boardRunnerList(s) {
  let hdr = null;
  for (let r = 1; r <= Math.min(20, s.maxRow) && !hdr; r++) {
    for (let c = MAX_COL + 1; c <= s.maxCol; c++) if (/^residents?$/i.test(clean(s.text(r, c))) && /location/i.test(clean(s.text(r, c + 1)))) { hdr = { r, c }; break; }
  }
  if (!hdr) return [];
  const callCol = /late|call/i.test(clean(s.text(hdr.r, hdr.c + 2))) ? hdr.c + 2 : 0;
  const out = [];
  for (let r = hdr.r + 1, blanks = 0; r <= s.maxRow && blanks < 3; r++) {
    const name = clean(s.text(r, hdr.c));
    if (!name) { blanks++; continue; }
    blanks = 0;
    out.push({ name, where: clean(s.text(r, hdr.c + 1)), call: callCol ? clean(s.text(r, callCol)) : "" });
  }
  return out;
}

// The Egress tab: its date, the attendings by slot, and each resident's assignment.
export function readEgress(wb) {
  const eg = wb.sheets.find((x) => /egress/i.test(x.name));
  if (!eg) return null;
  const text = (r, c) => clean(eg.text(r, c));
  let mdaCol = 0, resCol = 0, head = 1;
  for (let r = 1; r <= Math.min(5, eg.maxRow) && !mdaCol; r++) {
    for (let c = 1; c <= Math.min(12, eg.maxCol); c++) {
      if (/anesthesiologist|^mda$/i.test(text(r, c))) { mdaCol = c; head = r; }
      if (/^residents?$/i.test(text(r, c))) resCol = c;
    }
  }
  const attendings = [];
  const residents = [];
  for (let r = head + 1, blanks = 0; r <= eg.maxRow && blanks < 6; r++) {
    const slot = mdaCol > 1 ? text(r, mdaCol - 1) : "";
    const mda = mdaCol ? text(r, mdaCol) : "";
    const res = resCol ? text(r, resCol) : "";
    if (!slot && !mda && !res) { blanks++; continue; }
    blanks = 0;
    if (slot && mda && !/^anesthesiologist$/i.test(mda)) attendings.push({ slot, name: mda });
    if (res && !/^residents?$/i.test(res)) residents.push({ name: res, where: resCol > 1 ? text(r, resCol - 1) : "", note: text(r, resCol + 1) });
  }
  return { date: isoDate(eg.get(1, 1)) || "", attendings, residents };
}

export function parseDailyWorkbook(wb, { now = new Date() } = {}) {
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

  // The date at the top. It isn't always there (the board runner sometimes clears it), and then
  // daily-sync.js works out the day from the Egress tab and the rooms instead: a missing date
  // must never stop the sheet from coming in.
  let date = "";
  for (let r = 1; r < head && !date; r++) for (let c = 1; c <= MAX_COL && !date; c++) date = isoDate(s.get(r, c), now) || "";

  // The room table runs until the first row below it that starts a block: a label in the OR
  // column ("OPSC (6)"), or a label on a row with no room. A role word inside a room row, like
  // "PAT" in the Breaks column, is a person, not the PAT block.
  const roomRow = (r) => !!text(r, col.or) && !LABEL.test(text(r, col.or));
  let end = s.maxRow + 1;
  for (let r = head + 1; r <= s.maxRow && end > s.maxRow; r++) {
    if (roomRow(r)) continue;
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

  // Cath lab, EP lab, CT... read after PAT, OB and Night coverage, which can share their rows
  // (the PAT resident sits in the JA column of the cath lab row). The MDA is in the MDA column,
  // and a resident sent there is in the Resident/CRNA column, with a JA beside them.
  const procedures = [];
  const free = (r, c) => (c && !used.has(`${r},${c}`) && text(r, c) && !LABEL.test(text(r, c)) && !PROCEDURE.test(text(r, c)) ? take(r, c) : "");
  for (let r = end; r <= s.maxRow; r++) {
    for (let c = 1; c <= MAX_COL; c++) {
      const m = text(r, c).match(PROCEDURE);
      if (!m) continue;
      skip(r, c);
      let mda = col.mda > c ? free(r, col.mda) : "";
      for (let x = c + 1; x <= Math.min(c + 3, MAX_COL) && !mda; x++) if (x !== col.staff && x !== col.ja) mda = free(r, x);
      procedures.push({ name: m[1], count: m[2] ?? m[3] ?? "", mda, staff: col.staff > c ? free(r, col.staff) : "", ja: col.ja > c ? free(r, col.ja) : "" });
    }
  }

  // Anything else down there is a note, such as "SDS RESIDENTS OR 7 & 8".
  const notes = [];
  for (let r = end; r <= s.maxRow; r++) {
    for (let c = 1; c <= MAX_COL; c++) {
      const t = text(r, c);
      if (t && !used.has(`${r},${c}`) && !LABEL.test(t)) notes.push(t);
    }
  }

  const egress = readEgress(wb);
  return {
    date, rooms, opsc, procedures, meyers, pat, ob, night, notes,
    people: boardRunnerList(s),
    egressDate: egress?.date || "",
    egress: egress ? { attendings: egress.attendings, residents: egress.residents } : { attendings: [], residents: [] },
  };
}

// True when every room with a case has someone in it, and the egress tab, made late in the
// board runner's steps, carries the same date. Together that looks finished.
// `date` is the day the sheet is for, which may not be the date printed at its top (see
// daily-sync.js: a sheet being made for tomorrow can still show today's date).
export function looksComplete(wb, daily, date = daily.date) {
  const cased = daily.rooms.filter((r) => r.surgeon);
  if (!cased.length || cased.some((r) => !r.staff)) return false;
  const eg = wb.sheets.find((x) => /egress/i.test(x.name));
  if (!eg) return true;
  return isoDate(eg.get(1, 1)) === date;
}
