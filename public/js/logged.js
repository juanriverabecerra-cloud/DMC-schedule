// A resident's logged hours, kept in this browser only. They are never sent to the server.
import { local } from "./api.js";
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
