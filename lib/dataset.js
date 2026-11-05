// The stored dataset and how each kind of upload is merged into it.
import { upsertPerson } from "./people.js";
import { parseCallWorkbook } from "./parse-call.js";
import { parseRotationsWorkbook } from "./parse-rotations.js";
import { CODES, CALL_CODES, normCode } from "../public/core/codes.js";
import { createMatcher } from "../public/core/names.js";
import { createModel } from "../public/core/model.js";
import { parseDirectoryText, buildDirectory } from "../public/core/directory.js";

export function emptyDataset() {
  return {
    version: 1,
    updatedAt: null,
    people: [],
    rotations: {},
    rotationColors: {},
    months: {},
    interns: { weeks: {}, pat: {} },
    daily: {},
    directory: { people: {}, places: [] },
    settings: {},
    log: [],
  };
}

export function normalizeDataset(ds) {
  const base = emptyDataset();
  const out = { ...base, ...(ds || {}) };
  for (const k of ["rotations", "rotationColors", "months", "daily", "settings"]) out[k] = out[k] || {};
  out.interns = { weeks: {}, pat: {}, ...(out.interns || {}) };
  out.directory = { people: {}, places: [], ...(out.directory || {}) };
  out.people = out.people || [];
  out.log = out.log || [];
  return out;
}

function touch(ds, entry) {
  ds.updatedAt = new Date().toISOString();
  ds.log = [{ at: ds.updatedAt, ...entry }, ...(ds.log || [])].slice(0, 40);
}

const KNOWN_STATUS = /^(vac|vacation|pc|no call|off|loa)\b/i;

function isKnownCode(t) {
  const c = normCode(t);
  return !!(CODES[c] || CALL_CODES[c] || KNOWN_STATUS.test(t));
}

export function mergeCallWorkbook(ds, bytes, fileName) {
  const parsed = parseCallWorkbook(bytes, { fileName });
  const added = [];
  const unknownCodes = new Set();
  for (const m of parsed.months) {
    const rows = {};
    for (const row of m.rows) {
      const { person, added: isNew } = upsertPerson(ds.people, row.name, { cls: row.cls, authoritative: true });
      if (isNew) added.push(person.canonical);
      rows[person.id] = { rotation: row.rotation, next: row.next, number: row.number, days: row.days };
      for (const cell of Object.values(row.days)) if (cell.t && !isKnownCode(cell.t)) unknownCodes.add(cell.t);
    }
    ds.months[m.month] = {
      sheet: m.sheet, fileName, uploadedAt: new Date().toISOString(), lastUpdated: m.lastUpdated,
      days: m.days, rows, coverage: m.coverage, legend: m.legend,
    };
  }
  let internCount = 0;
  if (parsed.interns) {
    const iv = parsed.interns;
    const ids = [];
    for (const row of iv.rows) {
      const { person, added: isNew } = upsertPerson(ds.people, row.name, { cls: "PGY-1", authoritative: true });
      if (isNew) added.push(person.canonical);
      ids.push(person.id);
      iv.weeks.forEach((w, i) => {
        if (!w) return;
        const wk = (ds.interns.weeks[w.start] ||= { end: w.end, rows: {} });
        wk.end = w.end;
        if (row.weeks[i]) wk.rows[person.id] = row.weeks[i];
      });
    }
    internCount = ids.length;
    const interns = ds.people.filter((p) => p.cls === "PGY-1");
    const match = createMatcher(interns);
    for (const block of iv.pat) {
      ds.interns.pat[block.start] = {
        end: block.end,
        people: block.people.map((x) => ({ name: x.name, number: x.number, id: match(x.name) })),
      };
    }
  }
  touch(ds, { type: "call", fileName, months: parsed.months.map((m) => m.month) });
  return {
    months: parsed.months.map((m) => ({ month: m.month, residents: m.rows.length, lastUpdated: m.lastUpdated })),
    interns: internCount,
    added,
    unknownCodes: [...unknownCodes].sort(),
    warnings: parsed.warnings,
  };
}

export function mergeRotationsWorkbook(ds, bytes, fileName, ayStart) {
  const parsed = parseRotationsWorkbook(bytes, { fileName, ayStart });
  const added = [];
  for (const entry of parsed.people) {
    const { person, added: isNew } = upsertPerson(ds.people, entry.name, { cls: entry.cls });
    if (isNew) added.push(person.canonical);
    const plan = (ds.rotations[person.id] ||= {});
    for (const [month, v] of Object.entries(entry.months)) {
      plan[month] = v.name;
      if (v.color && !ds.rotationColors[v.name]) ds.rotationColors[v.name] = v.color;
    }
  }
  touch(ds, { type: "rotations", fileName, ay: parsed.ay });
  return { ay: parsed.ay, residents: parsed.people.length, added, warnings: parsed.warnings };
}

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Daily OR sheet as reviewed in the admin screen (or returned by the photo reader).
export function cleanDaily(input, date) {
  const d = input || {};
  const list = (a) => (Array.isArray(a) ? a.map(str).filter(Boolean) : []);
  return {
    date,
    rooms: (Array.isArray(d.rooms) ? d.rooms : []).map((r) => ({
      or: str(r.or), surgeon: str(r.surgeon), time: str(r.time), cases: str(r.cases), mda: str(r.mda),
      staff: str(r.staff), ja: str(r.ja), breaks: str(r.breaks), extra: str(r.extra),
    })).filter((r) => r.or || r.surgeon || r.staff),
    opsc: { rooms: str(d.opsc?.rooms), mdas: list(d.opsc?.mdas), residents: list(d.opsc?.residents) },
    procedures: (Array.isArray(d.procedures) ? d.procedures : []).map((p) => ({ name: str(p.name), count: str(p.count), mda: str(p.mda) })).filter((p) => p.name),
    meyers: { rooms: str(d.meyers?.rooms), mda: str(d.meyers?.mda) },
    pat: list(d.pat),
    ob: { mda: str(d.ob?.mda), residents: list(d.ob?.residents) },
    night: list(d.night),
    notes: list(d.notes),
    other: (Array.isArray(d.other) ? d.other : []).map((o) => ({ label: str(o.label), value: str(o.value) })).filter((o) => o.label || o.value),
    uncertain: list(d.uncertain),
    source: str(d.source) || "manual",
    hasPhoto: !!d.hasPhoto,
    savedAt: new Date().toISOString(),
  };
}

// Rewrites resident names on a saved daily sheet in reference-list spelling (roster surname),
// and role words such as "PAT" as the resident holding that role. Returns what changed.
export function canonicalizeDaily(ds, date) {
  const sheet = ds.daily[date];
  const model = createModel(ds);
  const dl = model.daily(date);
  if (!sheet || !dl) return [];
  const perLast = new Map();
  for (const p of model.people) perLast.set(p.last, (perLast.get(p.last) || 0) + 1);
  const label = (id) => {
    const p = model.person(id);
    return perLast.get(p.last) > 1 ? `${p.preferred || p.first} ${p.last}` : p.last;
  };
  const changes = [];
  const names = (list, where) => {
    const out = [];
    for (const s of list) {
      const name = s.id ? label(s.id) : s.name;
      if (s.id && name !== s.name) changes.push({ from: s.name, to: name, where, role: s.role || null });
      if (!out.includes(name)) out.push(name);
    }
    return out;
  };
  dl.rooms.forEach((r, i) => {
    const room = sheet.rooms[i];
    if (!r.crna) room.staff = names(r.staffIds, `OR ${r.or}`).join("/");
    room.ja = names(r.jaIds, `OR ${r.or} JA`).join("/");
    room.breaks = names(r.breakIds, `OR ${r.or} breaks`).join("/");
  });
  sheet.opsc.residents = names(dl.opsc, "OPSC");
  sheet.pat = names(dl.pat, "PAT");
  sheet.ob.residents = names(dl.ob, "OB");
  sheet.night = names(dl.night, "Night coverage");
  return changes;
}

export function setDaily(ds, date, daily) {
  ds.daily[date] = cleanDaily(daily, date);
  const changes = canonicalizeDaily(ds, date);
  touch(ds, { type: "daily", date });
  return { daily: ds.daily[date], changes };
}

// The directory is kept as plain text (see public/core/directory.js) and parsed on save.
// Residents listed with a class (e.g. a new intern) who aren't in the roster yet are added.
export function setDirectory(ds, { text }) {
  const parsed = parseDirectoryText(text);
  const roster = ds.people.filter((p) => !p.hidden);
  const upsert = (name, cls) => (cls ? upsertPerson(ds.people, name, { cls, authoritative: false }).person.id : null);
  const built = buildDirectory(parsed, roster, { upsert });
  ds.directory = { text: String(text ?? ""), people: built.people, staff: built.staff, places: built.places, dialing: built.dialing, updatedAt: new Date().toISOString() };
  touch(ds, { type: "directory" });
  return {
    residents: Object.keys(built.people).length,
    staff: built.staff.length,
    places: built.places.length,
    dialing: built.dialing.length,
    added: built.added,
    unmatched: built.unmatched,
    warnings: parsed.warnings,
  };
}

export function setSettings(ds, settings) {
  ds.settings = settings && typeof settings === "object" ? settings : {};
  touch(ds, { type: "settings" });
}
