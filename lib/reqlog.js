// The requests inbox the chiefs see in Admin › Requests: sick calls, agreed swaps and no-call
// lists, logged when a resident acts (the email still goes out as before). Alerts are tiered so
// nobody is swamped: a sick call reaches admins' phones right away; swaps and no-call lists wait
// for one evening summary, and only when something new came in. Every item clears itself once
// its dates pass.
import crypto from "node:crypto";
import { addDays, dow, fmtDate, fmtMonth, monthKey, todayLocal } from "../public/core/dates.js";
import { assignmentText, jeopardyOn, NO_CALL_REASONS } from "../public/core/requests.js";
import { dayName } from "../public/core/alerts.js";
import { sendToSubs, requestMode } from "./push.js";

const KEY = "reqlog";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
export const INBOX_URL = "/#/admin/requests";

const emptyLog = () => ({ list: [], digestAt: null });

export async function readLog(st) {
  return (await st.getJSON(KEY)) || emptyLog();
}
export const liveItems = (list, today) => list.filter((i) => i.expires >= today);

// Adds the item `same` finds, or updates it. An update counts as new again.
export async function upsert(st, item, same) {
  let next, isNew;
  await st.update(KEY, (saved) => {
    const log = saved || emptyLog();
    log.list = liveItems(log.list, addDays(todayLocal(), -14));
    const old = log.list.find(same);
    const now = new Date().toISOString();
    next = { ...old, ...item, id: old?.id || newId(), createdAt: old?.createdAt || now, updatedAt: now, done: null };
    isNew = !old;
    log.list = [...log.list.filter((i) => i !== old), next];
    return log;
  });
  return { item: next, isNew };
}

export async function markDone(st, ids, done) {
  return st.update(KEY, (saved) => {
    const log = saved || emptyLog();
    const now = new Date().toISOString();
    for (const i of log.list) if (ids.includes(i.id)) i.done = done ? now : null;
    return log;
  });
}

// ---- building items from what a resident sent (the server writes the text, not the phone) ----

export function sickItem(model, pid, date) {
  const p = model.person(pid);
  if (!p || !DATE.test(date || "")) return null;
  return {
    type: "sick", pid, cls: p.cls, date, expires: addDays(date, 1),
    what: assignmentText(model.day(pid, date)) || model.day(pid, date).label || "",
    jeopardy: p.cls === "PGY-1" ? [] : jeopardyOn(model, date).map((d) => d.pid).filter((id) => id !== pid),
  };
}

export function noCallItem(model, pid, month, picks, note) {
  const p = model.person(pid);
  if (!p || !MONTH.test(month || "")) return null;
  const clean_ = {};
  for (const [date, reason] of Object.entries(picks || {})) {
    if (DATE.test(date) && monthKey(date) === month && [5, 6, 0].includes(dow(date))) clean_[date] = NO_CALL_REASONS.includes(reason) ? reason : "Other";
  }
  return { type: "nocall", pid, cls: p.cls, month, picks: clean_, note: clean(note, 500), expires: `${month}-01` };
}

export function swapItem(r) {
  const last = [r.end, r.agreed?.end || r.agreed?.date || r.end].sort().pop();
  return {
    type: "swap", swapId: r.id, pid: r.pid, other: r.agreed.pid, cls: r.cls, date: r.date, end: r.end, label: r.label,
    agreed: { date: r.agreed.date, end: r.agreed.end, label: r.agreed.label }, expires: addDays(last, 1), cancelled: false,
  };
}

// A swap undone after it was agreed: gone if nobody acted on it yet, flagged if a chief already
// put it on the call sheet.
export async function swapUndone(st, swapId) {
  await st.update(KEY, (log) => {
    const it = log?.list.find((i) => i.type === "swap" && i.swapId === swapId);
    if (!it) return undefined;
    if (it.done) Object.assign(it, { cancelled: true, done: null, updatedAt: new Date().toISOString() });
    else log.list = log.list.filter((i) => i !== it);
    return log;
  });
}

// ---- the no-call scorecard ----
// Requests clear out of the inbox once their month starts, so each list is also kept here for
// the year's scorecard. Only what was asked before the month's call sheet came out counts: a
// list sent or changed afterward couldn't have been honored.

const NO_CALL_HISTORY = "nocall-history";
const beforeSheet = (ds, month, at) => !ds.months?.[month] || (ds.months[month].uploadedAt && at <= ds.months[month].uploadedAt);

export async function keepNoCallList(st, ds, item) {
  if (!beforeSheet(ds, item.month, new Date().toISOString())) return;
  await st.update(NO_CALL_HISTORY, (saved) => {
    const history = saved || {};
    const month = (history[item.month] ||= {});
    if (Object.keys(item.picks).length) month[item.pid] = { picks: item.picks, at: new Date().toISOString() };
    else delete month[item.pid];
    return history;
  });
}

// The whole history, first bringing in any list from before the scorecard existed.
export async function noCallHistory(st, ds) {
  const log = await readLog(st);
  const saved = await st.update(NO_CALL_HISTORY, (current) => {
    const history = current || {};
    let added = false;
    for (const i of log.list) {
      if (i.type !== "nocall" || history[i.month]?.[i.pid] || !Object.keys(i.picks).length || !beforeSheet(ds, i.month, i.updatedAt)) continue;
      (history[i.month] ||= {})[i.pid] = { picks: i.picks, at: i.updatedAt };
      added = true;
    }
    return added ? history : undefined;
  });
  return saved || {};
}

export async function forgetNoCallLists(st, pid) {
  await st.update(NO_CALL_HISTORY, (history) => {
    if (!history) return undefined;
    for (const month of Object.values(history)) delete month[pid];
    return history;
  });
}

// ---- what the phones say ----

export function sickPayload(model, item, today) {
  const who = model.name(item.pid);
  const when = dayName(item.date, today);
  const jeop = item.jeopardy.map((id) => model.name(id)).join(" and ");
  return {
    title: `Sick call: ${who}`,
    body: `${when} (${fmtDate(item.date)})${item.what ? `: ${item.what}` : ""}.${jeop ? ` Jeopardy: ${jeop}.` : ""}`,
    url: INBOX_URL, tag: `sick-${item.pid}-${item.date}`,
  };
}

export function digestPayload(items) {
  const swaps = items.filter((i) => i.type === "swap");
  const lists = items.filter((i) => i.type === "nocall");
  const months = [...new Set(lists.map((i) => i.month))].sort().map((m) => fmtMonth(m).replace(/ \d+$/, ""));
  const parts = [];
  if (swaps.length) parts.push(`${swaps.length} ${swaps.length === 1 ? "swap" : "swaps"} for the call sheet${swaps.some((i) => i.cancelled) ? " (one was cancelled)" : ""}`);
  if (lists.length) parts.push(`${lists.length} no-call ${lists.length === 1 ? "list" : "lists"} for ${months.join(" and ")}`);
  return { title: "Requests waiting", body: `${parts.join(" · ")}. Tap to see them all in one place.`, url: INBOX_URL, tag: "requests-digest" };
}

export async function alertSick(st, model, item, site) {
  return sendToSubs(st, (sub) => sub.admin && requestMode(sub) !== "off", () => sickPayload(model, item, todayLocal()), { site, urgency: "high" });
}

// The evening summary: only what's new since the last one, and nothing at all if that's nothing.
export async function sendDigest(st, { site, today = todayLocal() } = {}) {
  let fresh = [];
  await st.update(KEY, (saved) => {
    const log = saved || emptyLog();
    const since = log.digestAt || "";
    fresh = liveItems(log.list, today).filter((i) => i.type !== "sick" && !i.done && i.updatedAt > since);
    log.digestAt = new Date().toISOString();
    return log;
  });
  if (!fresh.length) return { items: 0, sent: 0 };
  const sent = await sendToSubs(st, (sub) => sub.admin && requestMode(sub) === "smart", () => digestPayload(fresh), { site });
  return { items: fresh.length, sent };
}
