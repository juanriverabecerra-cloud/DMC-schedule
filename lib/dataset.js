// The stored dataset and how each kind of upload is merged into it.
import { upsertPerson } from "./people.js";
import { parseCallWorkbook } from "./parse-call.js";
import { parseRotationsWorkbook } from "./parse-rotations.js";
import { CODES, CALL_CODES, normCode } from "../public/core/codes.js";
import { createMatcher } from "../public/core/names.js";
import { createModel } from "../public/core/model.js";
import { parseDirectoryText, buildDirectory } from "../public/core/directory.js";
import { cleanDidacticsMonth, cleanPersonName, OWN_ROLES } from "../public/core/didactics.js";

export function emptyDataset() {
  return {
    version: 1,
    updatedAt: null,
    people: [],
    rotations: {},
    rosters: {},
    rotationColors: {},
    months: {},
    interns: { weeks: {}, pat: {} },
    daily: {},
    didactics: {},
    siteTotals: {},
    fairness: {},
    directory: { people: {}, places: [] },
    settings: {},
    log: [],
  };
}

export function normalizeDataset(ds) {
  const base = emptyDataset();
  const out = { ...base, ...(ds || {}) };
  for (const k of ["rotations", "rosters", "rotationColors", "months", "daily", "didactics", "siteTotals", "fairness", "settings"]) out[k] = out[k] || {};
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
    // An older month must not put anyone back in the class they were in then.
    const newest = !Object.keys(ds.months).some((k) => k > m.month);
    for (const row of m.rows) {
      const { person, added: isNew } = upsertPerson(ds.people, row.name, { cls: row.cls, authoritative: newest });
      if (isNew) added.push(person.canonical);
      rows[person.id] = { cls: row.cls, rotation: row.rotation, next: row.next, number: row.number, days: row.days };
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
    const newestSheet = !parsed.months.length || parsed.months.every((m) => !Object.keys(ds.months).some((k) => k > m.month));
    for (const row of iv.rows) {
      const { person, added: isNew } = upsertPerson(ds.people, row.name, { cls: "PGY-1", authoritative: newestSheet });
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
  markFormer(ds);
  touch(ds, { type: "call", fileName, months: parsed.months.map((m) => m.month) });
  return {
    months: parsed.months.map((m) => ({ month: m.month, residents: m.rows.length, lastUpdated: m.lastUpdated })),
    interns: internCount,
    added,
    unknownCodes: [...unknownCodes].sort(),
    warnings: parsed.warnings,
  };
}

// Someone on an older sheet but not the newest one has left: they stop appearing on the
// roster, and their rows stay so past months still read correctly.
function markFormer(ds) {
  const months = Object.keys(ds.months).sort();
  const latest = months[months.length - 1];
  if (!latest) return;
  const older = new Set(months.slice(0, -1).flatMap((m) => Object.keys(ds.months[m].rows)));
  const current = new Set(Object.keys(ds.months[latest].rows));
  const weeks = Object.entries(ds.interns?.weeks || {});
  const latestWeeks = weeks.filter(([start, w]) => start.slice(0, 7) === latest || w.end?.slice(0, 7) === latest);
  for (const [, w] of weeks) for (const id of Object.keys(w.rows || {})) older.add(id);
  for (const [, w] of latestWeeks) for (const id of Object.keys(w.rows || {})) current.add(id);
  for (const p of ds.people) {
    const unknownInterns = p.cls === "PGY-1" && !latestWeeks.length;
    if (older.has(p.id) && !current.has(p.id) && !unknownInterns) p.former = true;
    else delete p.former;
  }
}

export function mergeRotationsWorkbook(ds, bytes, fileName, ayStart) {
  const parsed = parseRotationsWorkbook(bytes, { fileName, ayStart });
  const added = [];
  // Who was in which class that year. The annual file is the program's own list, so visiting
  // rotators on a call sheet (and interns listed early in June) aren't counted as residents.
  const roster = {};
  for (const entry of parsed.people) {
    const { person, added: isNew } = upsertPerson(ds.people, entry.name, { cls: entry.cls });
    if (isNew) added.push(person.canonical);
    roster[person.id] = entry.cls;
    const plan = (ds.rotations[person.id] ||= {});
    for (const [month, v] of Object.entries(entry.months)) {
      plan[month] = v.name;
      if (v.color && !ds.rotationColors[v.name]) ds.rotationColors[v.name] = v.color;
    }
  }
  ds.rosters = { ...(ds.rosters || {}), [parsed.ay]: roster };
  if (parsed.siteTotals) ds.siteTotals = { ...(ds.siteTotals || {}), ...parsed.siteTotals };
  markFormer(ds);
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
    draft: !!d.draft, // read from the live sheet and still being finalized
    sheetAt: str(d.sheetAt),
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
  // Someone known only from an earlier directory (no schedule anywhere) who is no longer listed has left.
  const removed = [];
  for (const p of [...ds.people]) {
    if (built.people[p.id] || hasSchedule(ds, p.id)) continue;
    removed.push(`${p.last}, ${p.preferred || p.first}`);
    removePerson(ds, p.id);
  }
  touch(ds, { type: "directory" });
  return {
    residents: Object.keys(built.people).length,
    staff: built.staff.length,
    places: built.places.length,
    dialing: built.dialing.length,
    added: built.added,
    removed,
    unmatched: built.unmatched,
    warnings: parsed.warnings,
  };
}

// Fairness scoring: point weights (a negative value marks a lighter-than-normal day) and the
// service minimums an admin types in, { service: { "CA-1": 2 } }. Send only what changed.
export function setFairness(ds, body) {
  const b = body && typeof body === "object" ? body : {};
  const next = { ...(ds.fairness || {}) };
  if (b.weights) {
    next.weights = {};
    for (const [k, v] of Object.entries(b.weights)) if (v !== "" && v !== null && Number.isFinite(Number(v))) next.weights[k] = Number(v);
  }
  if (b.minimums) {
    next.minimums = {};
    for (const [service, classes] of Object.entries(b.minimums)) {
      for (const [cls, v] of Object.entries(classes || {})) {
        if (v === "" || v === null || !Number.isFinite(Number(v)) || Number(v) < 0) continue;
        (next.minimums[service] ||= {})[cls] = Math.floor(Number(v));
      }
    }
  }
  ds.fairness = next;
  touch(ds, { type: "fairness" });
  return ds.fairness;
}

export function setSettings(ds, settings) {
  ds.settings = settings && typeof settings === "object" ? settings : {};
  touch(ds, { type: "settings" });
}

// Monthly didactics (conference schedule). Residents with an assignment (presenting, mock
// orals) are saved in reference-list spelling; returns what was renamed.
export function setDidactics(ds, month, data, { hasPdf = false } = {}) {
  const clean = cleanDidacticsMonth(data, month);
  const model = createModel(ds);
  const perLast = new Map();
  for (const p of model.people) perLast.set(p.last, (perLast.get(p.last) || 0) + 1);
  const changes = [];
  for (const e of clean.events) {
    for (const p of e.people) {
      if (!OWN_ROLES.has(p.role) || /^\s*dr\.?\s/i.test(p.name)) continue;
      const id = model.match(cleanPersonName(p.name));
      const person = id && model.person(id);
      if (!person) continue;
      const name = perLast.get(person.last) > 1 ? `${person.preferred || person.first} ${person.last}` : person.last;
      if (name !== p.name) changes.push({ from: p.name, to: name, where: `${e.date} ${e.title}` });
      p.name = name;
    }
  }
  ds.didactics ||= {};
  ds.didactics[month] = { ...clean, hasPdf, savedAt: new Date().toISOString() };
  touch(ds, { type: "didactics", month });
  return { didactics: ds.didactics[month], changes };
}

export function deleteDidactics(ds, month) {
  delete ds.didactics[month];
  touch(ds, { type: "didactics-deleted", month });
}

// Removes someone from the app (e.g. left the program): their roster entry, call-sheet rows,
// planned rotations, intern blocks and phone numbers. A file uploaded later can add them back.
export function removePerson(ds, id) {
  const i = ds.people.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [person] = ds.people.splice(i, 1);
  delete ds.rotations?.[id];
  for (const m of Object.values(ds.months || {})) delete m.rows?.[id];
  for (const w of Object.values(ds.interns?.weeks || {})) delete w.rows?.[id];
  for (const b of Object.values(ds.interns?.pat || {})) b.people = (b.people || []).filter((x) => x.id !== id);
  delete ds.directory?.people?.[id];
  touch(ds, { type: "person-removed", id });
  return person;
}

// True when anything besides the phone directory places this person in the program.
function hasSchedule(ds, id) {
  return Object.values(ds.months || {}).some((m) => m.rows?.[id])
    || !!ds.rotations?.[id]
    || Object.values(ds.interns?.weeks || {}).some((w) => w.rows?.[id])
    || Object.values(ds.interns?.pat || {}).some((b) => (b.people || []).some((x) => x.id === id));
}
