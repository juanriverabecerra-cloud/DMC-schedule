// A resident's logged hours, kept in this browser, with a copy in the app for the admin pages.
// Other residents never see them.
import { api, local, deviceKey } from "./api.js";
import { actualHours } from "../core/logged.js";

const KEY = "loggedHours";

export const loggedFor = (pid) => {
  const saved = local.get(KEY);
  return saved?.pid === pid && saved.entries?.length ? saved : null;
};

// False if this browser wouldn't keep it (private browsing, storage blocked).
export function saveLogged(pid, entries) {
  local.set(KEY, { pid, entries, importedAt: new Date().toISOString() });
  return loggedFor(pid)?.entries.length === entries.length;
}

export const clearLogged = () => local.del(KEY);
export const actualFor = (model, pid) => actualHours(model, pid, loggedFor(pid)?.entries);

// The word for a week: what's real, what's predicted, or the schedule's estimate.
export function hoursBasis(actual, week) {
  if (!actual) return "estimate";
  if (week.end <= actual.last) return "logged";
  return week.start > actual.last ? "predicted" : "logged + predicted";
}

// ---- a copy in the app ----
// Saved hours also go to the app's server, for the admin pages. Only the device that first sent
// a resident's hours can update or remove them.

const send = (pid, entries, replace) => api(`/api/hours/${pid}`, { method: "PUT", body: { key: deviceKey(), entries, replace } });

// `quiet` is the retry when the app opens: it never asks anything.
export async function uploadLogged(pid, entries, { quiet = false } = {}) {
  local.set("hoursSync", { pid, pending: true });
  try {
    await send(pid, entries, false);
  } catch (err) {
    if (err.status !== 409) throw err;
    local.set("hoursSync", { pid, pending: false });
    if (quiet || !confirm("Your hours were first added from another device, maybe Safari before you added the app to your Home Screen. Use the hours on this device from now on?")) return false;
    await send(pid, entries, true);
  }
  local.set("hoursSync", { pid, pending: false, at: new Date().toISOString() });
  return true;
}

// Hours saved while offline go up the next time the app opens.
export function retryUpload(pid) {
  const sync = local.get("hoursSync");
  const saved = loggedFor(pid);
  if (sync?.pending && sync.pid === pid && saved) uploadLogged(pid, saved.entries, { quiet: true }).catch(() => {});
}

export async function removeUploaded(pid) {
  await api(`/api/hours/${pid}`, { method: "DELETE", body: { key: deviceKey() } }).catch((err) => { if (err.status !== 404) throw err; });
  local.del("hoursSync");
}
