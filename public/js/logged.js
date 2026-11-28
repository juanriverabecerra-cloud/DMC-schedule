// A resident's logged hours, kept in this browser, with a copy in the app for the admin pages.
// Other residents never see them.
import { api, local, deviceKey } from "./api.js";
import { actualHours, rangesOf } from "../core/logged.js";
import { linkHere } from "./me.js";

const KEY = "loggedHours";

export const loggedFor = (pid) => {
  const saved = local.get(KEY);
  return saved?.pid === pid && saved.entries?.length ? saved : null;
};

// False if this browser wouldn't keep it (private browsing, storage blocked). `ranges`: the days
// the files covered (core/logged.js mergeRanges), so a gap between two files isn't read as days off.
export function saveLogged(pid, entries, ranges = null) {
  local.set(KEY, { pid, entries, ranges: rangesOf(entries, ranges), importedAt: new Date().toISOString() });
  return loggedFor(pid)?.entries.length === entries.length;
}

export const clearLogged = () => local.del(KEY);
export const actualFor = (model, pid) => { const saved = loggedFor(pid); return actualHours(model, pid, saved?.entries, saved?.ranges); };

// The word for a week: what's real, what's predicted, or the schedule's estimate.
export function hoursBasis(actual, week) {
  if (!actual) return "estimate";
  if (week.end <= actual.last) return "logged";
  return week.start > actual.last ? "predicted" : "logged + predicted";
}

// ---- a copy in the app ----
// Saved hours also go to the app's server, for the admin pages. Only the resident's own devices
// (lib/devices.js) can update or remove them.

const send = (pid, entries, ranges) => api(`/api/hours/${pid}`, { method: "PUT", body: { key: deviceKey(), entries, ranges } });

// Never asks anything, so the retry when the app opens can use it too. When the app's copy holds
// more than this device (hours added from Safari before the Home Screen app, or from a computer),
// and this device has shown it's theirs, the whole record comes back and is kept here too.
// { history: true } when it did; { held: { entries, from } } when the app keeps more it won't
// hand over yet (this device brought nothing it already had).
export async function uploadLogged(pid, entries, ranges = null) {
  local.set("hoursSync", { pid, pending: true });
  let res;
  try {
    res = await send(pid, entries, ranges);
  } catch (err) {
    if (err.status !== 409) {
      // Offline or the server is down: try again when the app next opens. Anything else is an
      // answer, and asking again won't change it.
      if (err.status && err.status < 500) local.set("hoursSync", { pid, pending: false, error: err.message });
      throw err;
    }
    // Added from another of their devices (Safari before the Home Screen app, say): whoever has
    // their New Innovations export is them, so this device becomes theirs too and the hours add up.
    await linkHere(pid);
    res = await send(pid, entries, ranges);
  }
  const history = res?.history;
  if (history?.entries?.length && history.entries.length >= entries.length) saveLogged(pid, history.entries, history.ranges);
  local.set("hoursSync", { pid, pending: false, at: new Date().toISOString(), held: res?.held || null });
  return { history: !!history, held: res?.held || null };
}

// Hours saved while offline go up the next time the app opens.
export function retryUpload(pid) {
  const sync = local.get("hoursSync");
  const saved = loggedFor(pid);
  if (sync?.pending && sync.pid === pid && saved) uploadLogged(pid, saved.entries, saved.ranges).catch(() => {});
}

export async function removeUploaded(pid) {
  await api(`/api/hours/${pid}`, { method: "DELETE", body: { key: deviceKey() } }).catch((err) => { if (err.status !== 404) throw err; });
  local.del("hoursSync");
}
