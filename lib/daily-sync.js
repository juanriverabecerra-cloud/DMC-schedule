// Keeps the daily OR sheet current from the board runner's Google workbook. Every few minutes the
// app reads it; any change shows in the app right away, marked as still being finalized. Phones
// stay quiet until the sheet has settled: one alert per day, and after that only the residents
// whose own assignment changed hear about it, once.
//
// The link is stored on the server only (key daily-source). It never goes in the dataset, the
// backups, the app's code or the logs, because anyone holding it can open the sheet.
import crypto from "node:crypto";
import { readXlsx } from "./xlsx.js";
import { parseDailyWorkbook, looksComplete } from "./daily-sheet.js";
import { finalizeDaily, normalizeDataset, setDaily, withDataset, NO_CHANGE } from "./dataset.js";
import { sendToSubs } from "./push.js";
import { createModel } from "../public/core/model.js";
import { addDays, nowMinutesLocal, todayLocal } from "../public/core/dates.js";
import { dailyAlert, dayInSentence, whereLine } from "../public/core/alerts.js";

const SOURCE = "daily-source";
const STATE = "daily-sync";
const LOCK = "daily-sync-lock";
const LEASE = 45 * 1000; // longer than any run takes, so a crashed run can't block the next one
const MAX_BYTES = 8 * 1024 * 1024;

// Minutes the sheet must sit unchanged before phones hear about it.
export const QUIET = { complete: 45, partial: 90, followUp: 30 };
// The board runner's own steps: "Around 1400 adjust final schedule". Nothing buzzes overnight.
export const ALERT_HOURS = [14 * 60, 22 * 60];

export function sheetIdFrom(input) {
  const s = String(input ?? "").trim();
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/^([\w-]{25,})$/);
  return m ? m[1] : null;
}

export async function fetchSheet(id) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Google answered ${res.status}.`);
  if (/text\/html/i.test(res.headers.get("content-type") || "")) throw new Error("Google asked for a sign-in, so the app can no longer read the sheet.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("The file is too large to be the daily sheet.");
  return bytes;
}

// ---- is this version safe to show? ----

const key = (r) => `${r.or}|${String(r.surgeon).toLowerCase().replace(/\s+/g, "")}`;
function overlap(a, b) {
  const list = (a?.rooms || []).filter((r) => r.surgeon);
  if (!list.length) return 0;
  const other = new Set((b?.rooms || []).filter((r) => r.surgeon).map(key));
  return list.filter((r) => other.has(key(r))).length / list.length;
}

// The board runner's first step is "Clear yesterdays schedule", so the sheet can be half-empty,
// or full of tomorrow's cases under today's date. Those versions must not replace a good sheet.
export function importDecision(saved, next, today, earlier) {
  if (next.date < today) return { apply: false, why: "The sheet still shows a past date." };
  if (next.date > addDays(today, 10)) return { apply: false, why: "The date on the sheet is more than 10 days away." };
  if (next.rooms.filter((r) => r.surgeon).length < 3) return { apply: false, why: "The sheet looks mostly empty right now." };
  if (next.date === today && saved && overlap(saved, next) < 0.6) return { apply: false, why: "Today's rooms were mostly rewritten, so this looks like tomorrow's sheet before its date was changed." };
  if (earlier && overlap(next, earlier) >= 0.9) return { apply: false, why: "These are still the previous day's rooms under a new date." };
  return { apply: true };
}

const earlierSheet = (ds, date) => {
  const prior = Object.keys(ds.daily || {}).filter((d) => d < date).sort().pop();
  return prior ? ds.daily[prior] : null;
};

// ---- when phones hear about it ----

const minutesSince = (iso, now) => (now.getTime() - new Date(iso).getTime()) / 60000;
const inAlertHours = (now) => {
  const m = nowMinutesLocal(now);
  return m >= ALERT_HOURS[0] && m < ALERT_HOURS[1];
};

function hasSettled({ day, complete, staffed, now }) {
  const quiet = complete ? QUIET.complete : staffed >= 0.8 ? QUIET.partial : null;
  return !!day.changedAt && quiet !== null && minutesSince(day.changedAt, now) >= quiet;
}

export function readyToAnnounce({ date, today, day, complete, staffed, now }) {
  return date > today && !day.alertedAt && inAlertHours(now) && hasSettled({ day, complete, staffed, now });
}

// Past the evening cutoff nothing buzzes, so a sheet that settles late drops its "still being
// finalized" label by itself. Before 2p a quiet sheet stays a draft: it isn't final that early.
const pastCutoff = (now) => nowMinutesLocal(now) >= ALERT_HOURS[1];

const staffedShare = (daily) => {
  const cased = daily.rooms.filter((r) => r.surgeon);
  return cased.length ? cased.filter((r) => r.staff).length / cased.length : 0;
};

const linesFor = (model) => (date) => Object.fromEntries(model.people.map((p) => [p.id, whereLine(model.day(p.id, date))]));

// Records that a date has been announced, so nothing announces it a second time.
export function markAnnounced(state, ds, date, now = new Date()) {
  const day = (state.days[date] ||= {});
  day.alertedAt = now.toISOString();
  day.comparedAt = day.changedAt || day.alertedAt;
  day.lines = linesFor(createModel(ds))(date);
  finalizeDaily(ds, date);
}

// Recorded before sending: a run that dies halfway must not alert everyone a second time.
export async function announce(st, ds, state, date, { site, now = new Date() } = {}) {
  const model = createModel(ds);
  const today = todayLocal(now);
  await withDataset(st, (fresh) => markAnnounced(state, fresh, date, now));
  await saveState(st, state);
  return sendToSubs(st, () => true, (sub) => dailyAlert(model, date, sub.pid, today), { site, urgency: "high" });
}

// After the alert, a later correction reaches only the people it moved, and only once each.
async function followUp(st, ds, state, date, { site, now }) {
  const day = state.days[date];
  const today = todayLocal(now);
  if (!day?.alertedAt || date <= today || !inAlertHours(now)) return 0;
  if (!(day.changedAt > (day.comparedAt || day.alertedAt)) || minutesSince(day.changedAt, now) < QUIET.followUp) return 0;
  const model = createModel(ds);
  const lines = linesFor(model)(date);
  const moved = new Set(Object.keys(lines).filter((pid) => lines[pid] && day.lines?.[pid] !== lines[pid] && !(day.followed || []).includes(pid)));
  day.comparedAt = day.changedAt;
  day.lines = lines;
  if (!moved.size) return 0;
  const when = dayInSentence(date, today);
  const sent = await sendToSubs(st, (sub) => moved.has(sub.pid), (sub) => ({ title: `Your assignment changed for ${when}`, body: lines[sub.pid], url: `/#/day/${date}`, tag: `daily-${date}` }), { site, urgency: "high" });
  day.followed = [...(day.followed || []), ...moved];
  return sent;
}

// ---- one pass ----

export const readSource = (st) => st.getJSON(SOURCE);
export const saveSource = (st, id) => st.setJSON(SOURCE, { id, addedAt: new Date().toISOString() });
export const readState = async (st) => (await st.getJSON(STATE)) || { days: {} };
export const saveState = (st, state) => st.setJSON(STATE, state);
export async function disconnect(st) {
  await st.delete(SOURCE);
  await st.delete(STATE);
}

// Only one thing works on the live sheet's state at a time, so a scheduled run, "Check now" and
// a save can't each announce the same day. With `wait`, it waits its turn; without, it gives up.
export async function withSyncLock(st, work, { wait = false } = {}) {
  const giveUp = Date.now() + (wait ? 12000 : 0);
  const token = crypto.randomUUID();
  for (;;) {
    const lock = await st.update(LOCK, (held) => (held && Date.now() - held.at < LEASE ? undefined : { token, at: Date.now() }));
    if (lock?.token === token) break;
    if (Date.now() >= giveUp) {
      if (!wait) return null;
      break; // an admin's save still goes through
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    return await work();
  } finally {
    await st.delete(LOCK).catch(() => {});
  }
}

export async function syncDaily(st, { wait = false, ...options } = {}) {
  const src = await readSource(st);
  if (!src?.id) return null;
  return withSyncLock(st, () => readAndApply(st, src, options), { wait });
}

async function readAndApply(st, src, { now = new Date(), fetchBytes = fetchSheet, site } = {}) {
  const state = await readState(st);
  const today = todayLocal(now);
  state.checkedAt = now.toISOString();
  let wb, parsed;
  try {
    wb = readXlsx(await fetchBytes(src.id));
    parsed = parseDailyWorkbook(wb);
  } catch (err) {
    state.error = err?.name === "TimeoutError" ? "Google took too long to answer." : err?.message || "The sheet couldn't be read.";
    state.errorSince ||= now.toISOString();
    await saveState(st, state);
    return state;
  }
  state.error = null;
  state.errorSince = null;
  for (const d of Object.keys(state.days)) if (d < addDays(today, -3)) delete state.days[d];

  let ds = normalizeDataset(await st.getJSON("dataset"));
  const date = parsed.date;
  const hash = crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("base64url");
  const day = (state.days[date] ||= {});
  if (hash !== state.hash) {
    state.hash = hash;
    let decision;
    ({ ds } = await withDataset(st, (fresh) => {
      decision = importDecision(fresh.daily[date], parsed, today, earlierSheet(fresh, date));
      if (!decision.apply) return NO_CHANGE;
      setDaily(fresh, date, { ...parsed, source: "sheet", hasPhoto: !!fresh.daily[date]?.hasPhoto, draft: !day.alertedAt && date > today, sheetAt: now.toISOString() });
      return true;
    }));
    state.held = decision.apply ? null : decision.why;
    if (decision.apply) day.changedAt = now.toISOString();
  }
  state.date = date;
  state.complete = looksComplete(wb, parsed);
  if (!state.held && ds.daily[date]) {
    const sheet = { day, complete: state.complete, staffed: staffedShare(parsed), now };
    if (readyToAnnounce({ date, today, ...sheet })) {
      await announce(st, ds, state, date, { site, now });
    } else {
      if (ds.daily[date].draft && pastCutoff(now) && hasSettled(sheet)) await withDataset(st, (fresh) => finalizeDaily(fresh, date) || NO_CHANGE);
      await followUp(st, ds, state, date, { site, now });
    }
  }
  await saveState(st, state);
  return state;
}

// What an admin sees. Never includes the link.
export function publicStatus(src, state) {
  const day = state?.date ? state.days?.[state.date] : null;
  return {
    connected: !!src?.id, addedAt: src?.addedAt || null, checkedAt: state?.checkedAt || null, error: state?.error || null, errorSince: state?.errorSince || null,
    date: state?.date || null, held: state?.held || null, complete: !!state?.complete, changedAt: day?.changedAt || null, alertedAt: day?.alertedAt || null,
  };
}
