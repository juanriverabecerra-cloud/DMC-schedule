// Each resident's case log on the server (Blobs `cases/<pid>`): cases not yet in ACGME, a few
// days of the ones that are, and a short summary of habits so the app can suggest. Nothing about
// a patient beyond ACGME's age group and ASA class.
//
// The devices that may read and change a log are listed by a hash of their device key. ACGME's
// page reads the ready cases through the resident's private link (see /api/acgme/ in api.mjs).
import crypto from "node:crypto";
import { ACGME_SITES, AGES, CASE_ID_MAX, ITEMS, isReady, order, summarize, mergeSummaries, toAcgme, cleanNaming, lastUsed } from "../public/core/acgme.js";
import { addDays } from "../public/core/dates.js";

// ACGME's Supervisor list, as the Log cases button reads it off ACGME's page: the program's
// attendings, every one of them, which the app's phone directory doesn't have. Kept for the whole
// program (Blobs acgme-supervisors), never in the code or the dataset.
export const SUPERVISORS_KEY = "acgme-supervisors";
export function cleanSupervisorList(raw) {
  if (!Array.isArray(raw)) return null;
  const seen = new Set();
  const out = [];
  for (const x of raw.slice(0, 400)) {
    const t = String(x ?? "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 60 || /select/i.test(t) || !/^[\p{L}' .-]+(,[\p{L}' .-]*)?$/u.test(t)) continue;
    const [last, first = ""] = t.split(",").map((s) => s.trim());
    const k = `${last}|${first}`.toLowerCase();
    if (!last || seen.has(k)) continue;
    seen.add(k);
    out.push({ last, first });
  }
  return out.length >= 3 ? out : null; // a real list, not one stray name
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]{8,32}$/;
const KINDS = new Set(["or", "ob", "cardiac", "thoracic", "vascular", "neuro", "peds", "regional", "pain", "nora", "call", "procedure"]);
const MAX_CASES = 800;
const MAX_DEVICES = 8; // as many as lib/devices.js links
const KEEP_ENTERED_DAYS = 7;

export const caseKey = (pid) => `cases/${pid}`;
export const deviceHash = (key) => crypto.createHash("sha256").update(`cases:${key}`).digest("base64url");
const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const iso = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : "");

export function cleanCase(raw) {
  if (!raw || typeof raw !== "object" || !ID.test(raw.id || "") || !DATE.test(raw.date || "")) return null;
  const sup = raw.supervisor && typeof raw.supervisor === "object" && text(raw.supervisor.last, 40)
    ? { last: text(raw.supervisor.last, 40), first: text(raw.supervisor.first, 40), name: text(raw.supervisor.name, 90) } : null;
  const group = raw.group === "pain" ? "pain" : "proc";
  return {
    id: raw.id,
    day: DATE.test(raw.day || "") ? raw.day : raw.date,
    date: raw.date,
    kind: KINDS.has(raw.kind) ? raw.kind : "or",
    slot: text(raw.slot, 40),
    seq: Math.max(1, Math.min(99, parseInt(raw.seq, 10) || 1)),
    or: text(raw.or, 12),
    surgeon: text(raw.surgeon, 40),
    word: text(raw.word, 20).replace(/[^A-Za-z0-9-]/g, ""),
    caseId: text(raw.caseId, CASE_ID_MAX),
    customId: raw.customId === true,
    num: Math.max(0, Math.min(999999, parseInt(raw.num, 10) || 0)),
    site: ACGME_SITES[raw.site] ? raw.site : "harper",
    supervisor: sup,
    age: AGES.some((a) => a.key === raw.age) ? raw.age : "",
    asa: /^[1-6]$/.test(String(raw.asa)) ? String(raw.asa) : "",
    emergency: raw.emergency === true && String(raw.asa) !== "6",
    group,
    codes: order((Array.isArray(raw.codes) ? raw.codes : []).filter((k) => typeof k === "string" && ITEMS.has(k))),
    ltp: ["nontrauma", "trauma"].includes(raw.ltp) ? raw.ltp : "",
    airway: ["anticipated", "unanticipated"].includes(raw.airway) ? raw.airway : "",
    comments: text(raw.comments, 500),
    updatedAt: iso(raw.updatedAt) || new Date().toISOString(),
    createdAt: iso(raw.createdAt) || iso(raw.updatedAt) || new Date().toISOString(),
    enteredAt: iso(raw.enteredAt),
  };
}

// A day's own notes: "no cases", sheet cases taken off, and a supervisor or site for the whole day.
const cleanDay = (v) => {
  if (!v || typeof v !== "object") return null;
  const sup = v.supervisor && typeof v.supervisor === "object" && text(v.supervisor.last, 40)
    ? { last: text(v.supervisor.last, 40), first: text(v.supervisor.first, 40), name: text(v.supervisor.name, 90) } : null;
  return {
    none: v.none === true,
    hidden: (Array.isArray(v.hidden) ? v.hidden : []).map((s) => text(s, 40)).filter(Boolean).slice(0, 40),
    ...(sup ? { supervisor: sup } : {}),
    ...(ACGME_SITES[v.site] ? { site: v.site } : {}),
  };
};
const dayHasNotes = (d) => d && (d.none || d.hidden.length || d.supervisor || d.site);

export const ownsLog = (rec, key) => !!(rec && typeof key === "string" && key.length >= 16 && (rec.keys || []).includes(deviceHash(key)));

// What a device sees of its own log.
export function logView(rec, today) {
  const cases = Object.values(rec?.cases || {}).sort((a, b) => (a.day + a.or + String(a.seq).padStart(2, "0") > b.day + b.or + String(b.seq).padStart(2, "0") ? 1 : -1));
  return {
    owned: true, cases, days: rec?.days || {},
    learned: mergeSummaries(rec?.archive, summarize(cases)),
    helperSeenAt: rec?.helperSeenAt || "",
    naming: rec?.naming ? cleanNaming(rec.naming) : null,
    acgmeCount: rec?.acgmeCount || null,
    devices: (rec?.keys || []).length,
    waiting: cases.filter((c) => !c.enteredAt && isReady(c)).length,
    today,
  };
}

// Folds entered cases older than a week into the habits summary, and forgets old day notes.
export function prune(rec, today) {
  const cutoff = addDays(today, -KEEP_ENTERED_DAYS);
  const gone = Object.values(rec.cases).filter((c) => c.enteredAt && c.enteredAt.slice(0, 10) < cutoff);
  if (gone.length) {
    rec.archive = mergeSummaries(rec.archive, summarize(gone));
    for (const c of gone) delete rec.cases[c.id];
  }
  for (const d of Object.keys(rec.days || {})) if (d < addDays(today, -60)) delete rec.days[d];
  return rec;
}

// A device's changes: newer edits win case by case, and "in ACGME" sticks unless it's undone.
export function mergeLog(saved, { key, cases = [], removed = [], days = {}, join = false, naming }, today) {
  const rec = saved ? { ...saved, cases: { ...saved.cases }, days: { ...(saved.days || {}) }, keys: [...(saved.keys || [])] } : { keys: [], cases: {}, days: {}, archive: null, createdAt: new Date().toISOString() };
  const hash = deviceHash(key);
  if (!rec.keys.includes(hash)) {
    if (rec.keys.length && !join) return { conflict: true };
    rec.keys = [...rec.keys, hash].slice(-MAX_DEVICES);
  }
  for (const raw of Array.isArray(cases) ? cases.slice(0, 200) : []) {
    const c = cleanCase(raw);
    if (!c) continue;
    const was = rec.cases[c.id];
    if (was && was.updatedAt > c.updatedAt) continue;
    if (was?.enteredAt && !c.enteredAt && raw.unentered !== true) c.enteredAt = was.enteredAt;
    rec.cases[c.id] = c;
  }
  for (const id of Array.isArray(removed) ? removed : []) if (typeof id === "string") delete rec.cases[id];
  for (const [date, v] of Object.entries(days && typeof days === "object" ? days : {}).slice(0, 60)) {
    if (!DATE.test(date)) continue;
    const day = cleanDay(v);
    if (dayHasNotes(day)) rec.days[date] = day; else delete rec.days[date];
  }
  if (Object.keys(rec.cases).length > MAX_CASES) return { full: true };
  if (naming && typeof naming === "object") rec.naming = mergeNaming(saved?.naming, naming);
  keepLast(rec);
  rec.updatedAt = new Date().toISOString();
  return { rec: prune(rec, today) };
}

// The resident's Case ID style. A newer "start at" resets the running number; otherwise the
// highest number used only goes up, so none is handed out twice.
function mergeNaming(saved, incoming) {
  const inc = cleanNaming(incoming);
  if (!saved) return inc;
  const was = cleanNaming(saved);
  return inc.setAt > was.setAt ? inc : { ...inc, start: was.start, setAt: was.setAt, last: Math.max(was.last, inc.last) };
}
// Notes the highest running number in ACGME before entered cases are pruned (and forgotten).
function keepLast(rec) {
  if (!rec.naming) return;
  const last = lastUsed(rec.naming, Object.values(rec.cases || {}));
  if (last !== rec.naming.last) rec.naming = { ...rec.naming, last };
}

export function markEntered(rec, ids, on = true) {
  const now = new Date().toISOString();
  let changed = 0;
  for (const id of ids || []) {
    const c = rec.cases?.[id];
    if (!c || !!c.enteredAt === on) continue;
    c.enteredAt = on ? now : "";
    c.updatedAt = now;
    changed++;
  }
  if (changed) keepLast(rec);
  return changed;
}

// What ACGME's page gets: the ready cases not yet entered, oldest first, already in ACGME's terms.
export function helperPayload(rec, first) {
  const all = Object.values(rec?.cases || {}).filter((c) => !c.enteredAt);
  // Running numbers set the order when the resident's style has them (so IDs follow ACGME's count).
  const key = (c) => (c.num ? String(c.num).padStart(7, "0") : "9999999") + c.date + c.or + String(c.seq).padStart(2, "0");
  const ready = all.filter(isReady).sort((a, b) => (key(a) > key(b) ? 1 : -1));
  return { first, cases: ready.map(toAcgme), notReady: all.length - ready.length };
}
