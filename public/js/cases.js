// This phone's copy of the resident's case log. Every tap saves here at once (an OR with no
// signal loses nothing) and goes to the server a moment later, which ACGME's page reads from.
import { api, local, deviceKey } from "./api.js";

const KEY = "caselog";
let log = local.get(KEY);
let timer = null;
let inFlight = null;
const listeners = new Set();

const blank = (pid) => ({ pid, cases: {}, days: {}, learned: {}, helper: "", helperSeenAt: "", naming: null, acgmeCount: null, owned: true, dirty: [], removed: [], dirtyDays: [], dirtyNaming: false, loadedAt: "", syncError: "" });
function current(pid) {
  if (!log || log.pid !== pid) log = blank(pid);
  return log;
}
const persist = () => local.set(KEY, log);
const notify = () => { for (const fn of listeners) fn(); };
export const onCaseLogChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);

export function caseLog(pid) {
  return current(pid);
}
export const allCases = (pid) => Object.values(current(pid).cases);
export const casesOnDay = (pid, day) => allCases(pid).filter((c) => c.day === day);

export function saveCase(pid, c) {
  const L = current(pid);
  const now = new Date().toISOString();
  const saved = { ...c, id: c.id || randomId(), updatedAt: now, createdAt: c.createdAt || c.updatedAt || now };
  delete saved.inherit;
  L.cases[saved.id] = saved;
  if (!L.dirty.includes(saved.id)) L.dirty.push(saved.id);
  persist();
  soon(pid);
  return saved;
}

export function removeCase(pid, id) {
  const L = current(pid);
  if (!L.cases[id]) return;
  delete L.cases[id];
  L.dirty = L.dirty.filter((x) => x !== id);
  if (!L.removed.includes(id)) L.removed.push(id);
  persist();
  soon(pid);
}

export function setDayNote(pid, date, note) {
  const L = current(pid);
  L.days[date] = { ...dayNote(pid, date), ...note };
  if (!L.dirtyDays.includes(date)) L.dirtyDays.push(date);
  persist();
  soon(pid);
}
export const dayNote = (pid, date) => current(pid).days[date] || { none: false, hidden: [] };

// The resident's Case ID style (see NAMING_STYLES in core/acgme.js).
export function setNaming(pid, naming) {
  const L = current(pid);
  L.naming = naming;
  L.dirtyNaming = true;
  persist();
  soon(pid);
}

// Server copy, with anything this phone hasn't sent yet laid on top.
function absorb(pid, body) {
  const L = current(pid);
  if (body.owned === false) {
    Object.assign(L, { owned: false, otherCount: body.count || 0 });
    persist();
    return;
  }
  const cases = Object.fromEntries((body.cases || []).map((c) => [c.id, c]));
  for (const id of L.dirty) if (L.cases[id]) cases[id] = L.cases[id];
  for (const id of L.removed) delete cases[id];
  const days = { ...(body.days || {}) };
  for (const d of L.dirtyDays) if (L.days[d]) days[d] = L.days[d];
  const naming = L.dirtyNaming ? L.naming : body.naming || null;
  // ACGME's count toward the minimums comes with a read of the log, not with each save.
  const minimums = body.minimums !== undefined ? body.minimums : L.minimums || null;
  Object.assign(L, { owned: true, cases, days, naming, minimums, acgmeCount: body.acgmeCount || null, learned: body.learned || {}, supervisorList: Array.isArray(body.supervisors) && body.supervisors.length ? body.supervisors : L.supervisorList || [], helper: body.helper || "", helperSeenAt: body.helperSeenAt || "", devices: body.devices || 1, loadedAt: new Date().toISOString(), syncError: "" });
  persist();
}

export async function loadCaseLog(pid) {
  if (!pid) return;
  try {
    const body = await api(`/api/cases/${encodeURIComponent(pid)}`, { headers: { "x-device-key": deviceKey() } });
    absorb(pid, body);
    notify();
    if (current(pid).owned && hasUnsent(pid)) soon(pid, 0);
  } catch (err) {
    current(pid).syncError = err.message;
    notify();
  }
}

export const hasUnsent = (pid) => { const L = current(pid); return !!(L.dirty.length || L.removed.length || L.dirtyDays.length || L.dirtyNaming); };

function soon(pid, wait = 1200) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncCaseLog(pid).catch(() => {}); }, wait);
}

// Sends what changed. `join` adds this device to a log that's kept on another one.
export async function syncCaseLog(pid, { join = false } = {}) {
  if (!pid) return;
  if (inFlight) { await inFlight.catch(() => {}); }
  const L = current(pid);
  if (!L.owned && !join) return;
  const sent = { dirty: [...L.dirty], removed: [...L.removed], days: [...L.dirtyDays], naming: L.dirtyNaming ? L.naming : null };
  const stamp = Object.fromEntries(sent.dirty.map((id) => [id, L.cases[id]?.updatedAt]));
  const body = {
    cases: sent.dirty.map((id) => L.cases[id]).filter(Boolean),
    removed: sent.removed,
    days: Object.fromEntries(sent.days.map((d) => [d, L.days[d]])),
    ...(sent.naming ? { naming: sent.naming } : {}),
    join,
  };
  inFlight = api(`/api/cases/${encodeURIComponent(pid)}`, { method: "PUT", body, headers: { "x-device-key": deviceKey() } });
  try {
    const res = await inFlight;
    // Only forget what was sent and hasn't changed since.
    L.dirty = L.dirty.filter((id) => !(sent.dirty.includes(id) && L.cases[id]?.updatedAt === stamp[id]));
    L.removed = L.removed.filter((id) => !sent.removed.includes(id));
    L.dirtyDays = L.dirtyDays.filter((d) => !sent.days.includes(d));
    if (sent.naming && L.naming === sent.naming) L.dirtyNaming = false;
    absorb(pid, res);
  } catch (err) {
    if (err.status === 409) Object.assign(L, { owned: false });
    L.syncError = err.status === 409 ? "" : navigator.onLine ? err.message : "offline";
    persist();
    throw err;
  } finally {
    inFlight = null;
    notify();
  }
}

export async function markCasesEntered(pid, ids, on = true) {
  const L = current(pid);
  const now = new Date().toISOString();
  for (const id of ids) {
    const c = L.cases[id];
    if (!c) continue;
    L.cases[id] = { ...c, enteredAt: on ? now : "", updatedAt: now, ...(on ? {} : { unentered: true }) };
    if (!L.dirty.includes(id)) L.dirty.push(id);
  }
  persist();
  notify();
  await syncCaseLog(pid).catch(() => {});
}

// The bookmark ACGME's page runs: a tiny loader for /acgme.js, which carries the private link.
export function bookmarklet(helperUrl) {
  if (!helperUrl) return "";
  const add = "https://apps.acgme.org/ads/CaseLogs/CaseEntry/Insert";
  return `javascript:(function(){if(/acgmecloud\\.org$/.test(location.hostname)){alert('Sign in to ACGME first, then tap Log cases again.');return}if(!/(^|\\.)acgme\\.org$/.test(location.hostname)){location.href='${add}';return}var s=document.createElement('script');s.src='${helperUrl}&t='+Date.now();document.body.appendChild(s)})()`;
}
