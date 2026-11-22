// Keeps the daily OR sheet current from the board runner's Google workbook. Every 3 minutes the
// app reads it, and again whenever someone opens the app and the last read is over a minute old;
// any change shows in the app right away, marked as still being finalized. Phones hear about it
// once it's ready: complete and unchanged for 10 minutes. After that, a correction reaches only
// the residents it moved.
//
// The link is stored on the server only (key daily-source). It never goes in the dataset, the
// backups, the app's code or the logs, because anyone holding it can open the sheet.
import crypto from "node:crypto";
import { readXlsx } from "./xlsx.js";
import { parseDailyWorkbook, looksComplete } from "./daily-sheet.js";
import { finalizeDaily, markPosted, normalizeDataset, setDaily, withDataset, NO_CHANGE } from "./dataset.js";
import { sendToSubs } from "./push.js";
import { createModel } from "../public/core/model.js";
import { addDays, nowMinutesLocal, todayLocal } from "../public/core/dates.js";
import { dailyAlert, dayInSentence, whereLine } from "../public/core/alerts.js";

const SOURCE = "daily-source";
const STATE = "daily-sync";
const LOCK = "daily-sync-lock";
const LEASE = 45 * 1000; // longer than any run takes, so a crashed run can't block the next one
const MAX_BYTES = 8 * 1024 * 1024;

// Minutes the sheet must sit unchanged before phones hear about it. Short, so the alert lands soon
// after the list goes to the group chat; anything fixed after that reaches only the people it moves.
export const QUIET = { complete: 10, partial: 30, followUp: 10 };
// A resident hears about at most this many corrections to one day's sheet.
export const MAX_FOLLOW_UPS = 3;
// Opening the app re-reads the sheet when the last read is older than this.
export const PEEK_EVERY = 60 * 1000;
// The board runner's own steps: "Around 1400 adjust final schedule". Nothing buzzes overnight.
export const ALERT_HOURS = [14 * 60, 22 * 60];

export function sheetIdFrom(input) {
  const s = String(input ?? "").trim();
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/^([\w-]{25,})$/);
  return m ? m[1] : null;
}

export async function fetchSheet(id, timeout = 15000) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow", signal: AbortSignal.timeout(timeout) });
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
  const cased = next.rooms.filter((r) => r.surgeon).length;
  if (cased < 3) return { apply: false, why: `The sheet looks mostly empty right now (${cased} ${cased === 1 ? "room" : "rooms"} with cases).` };
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
  markPosted(ds, date, now);
}

// Recorded before sending: a run that dies halfway must not alert everyone a second time.
export async function announce(st, ds, state, date, { site, now = new Date() } = {}) {
  const model = createModel(ds);
  const today = todayLocal(now);
  await withDataset(st, (fresh) => markAnnounced(state, fresh, date, now));
  await saveState(st, state);
  const reach = await sheetAudience(st, model, date, today);
  const sent = await sendToSubs(st, () => true, (sub) => dailyAlert(model, date, sub.pid, today), { site, urgency: "high" });
  state.days[date].reach = { ...reach, sent };
  await saveState(st, state);
  return sent;
}

// How many phones have alerts on, so the admin card can say how far an alert got.
// `phones`: the ones meant to hear about this sheet. `skipped`: the ones whose person the sheet
// doesn't concern that day (off, vacation, post-call, nights, another hospital).
export async function sheetAudience(st, model, date, today) {
  const subs = Object.values((await st.getJSON("push/subs")) || {});
  const phones = subs.filter((sub) => dailyAlert(model, date, sub.pid, today)).length;
  return { phones, skipped: subs.length - phones };
}

// Notes how far an alert sent from outside a run got (a saved photo, say).
export async function noteReach(st, date, reach) {
  await withSyncLock(st, async () => {
    const state = await readState(st);
    (state.days[date] ||= {}).reach = reach;
    await saveState(st, state);
  }, { wait: true });
}

// After the alert, a later correction reaches only the people it moved: each time their own line
// changes, up to MAX_FOLLOW_UPS times a day, so a busy evening of fixes can't keep buzzing anyone.
const followCount = (day, pid) => (Array.isArray(day.followed) ? (day.followed.includes(pid) ? 1 : 0) : day.followed?.[pid] || 0);
async function followUp(st, ds, state, date, { site, now }) {
  const day = state.days[date];
  const today = todayLocal(now);
  if (!day?.alertedAt || date <= today || !inAlertHours(now)) return 0;
  if (!(day.changedAt > (day.comparedAt || day.alertedAt)) || minutesSince(day.changedAt, now) < QUIET.followUp) return 0;
  const model = createModel(ds);
  const lines = linesFor(model)(date);
  const moved = new Set(Object.keys(lines).filter((pid) => lines[pid] && day.lines?.[pid] !== lines[pid] && followCount(day, pid) < MAX_FOLLOW_UPS));
  day.comparedAt = day.changedAt;
  day.lines = lines;
  if (!moved.size) return 0;
  const when = dayInSentence(date, today);
  const sent = await sendToSubs(st, (sub) => moved.has(sub.pid), (sub) => ({ title: `Your assignment changed for ${when}`, body: lines[sub.pid], url: `/#/day/${date}`, tag: `daily-${date}` }), { site, urgency: "high" });
  const counts = Array.isArray(day.followed) ? Object.fromEntries(day.followed.map((pid) => [pid, 1])) : { ...(day.followed || {}) };
  for (const pid of moved) counts[pid] = (counts[pid] || 0) + 1;
  day.followed = counts;
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

// Someone opened the app (or it refreshed): if nobody has read the sheet in the last minute, read
// it now, so the latest version reaches them without waiting for the next scheduled check. It
// only reads and saves; alerts stay with the scheduled checks, so loading the app never waits on
// notifications. Same hours as the scheduled checks; at most one read a minute however many open it.
const recentlyRead = (state, now) => [state.checkedAt, state.peekAt].some((t) => t && now.getTime() - new Date(t).getTime() < PEEK_EVERY);
export async function peekDaily(st, { now = new Date(), fetchBytes = (id) => fetchSheet(id, 5000) } = {}) {
  if (nowMinutesLocal(now) < 5 * 60) return null;
  if (recentlyRead(await readState(st), now)) return null;
  const src = await readSource(st);
  if (!src?.id) return null;
  return withSyncLock(st, () => readAndApply(st, src, { now, fetchBytes, peek: true }));
}

async function readAndApply(st, src, { now = new Date(), fetchBytes = fetchSheet, site, peek = false } = {}) {
  const state = await readState(st);
  if (peek && recentlyRead(state, now)) return null; // someone else just read it
  const today = todayLocal(now);
  let wb, parsed;
  try {
    wb = readXlsx(await fetchBytes(src.id));
    parsed = parseDailyWorkbook(wb);
  } catch (err) {
    // A read for someone opening the app leaves the error to the scheduled check (Google may just
    // have been slow for a moment), but notes the try so the next minute's openers don't wait too.
    if (peek) {
      state.peekAt = now.toISOString();
      await saveState(st, state);
      return state;
    }
    state.checkedAt = now.toISOString();
    state.error = err?.name === "TimeoutError" ? "Google took too long to answer." : err?.message || "The sheet couldn't be read.";
    state.errorSince ||= now.toISOString();
    await saveState(st, state);
    return state;
  }
  state.checkedAt = now.toISOString();
  state.error = null;
  state.errorSince = null;
  for (const d of Object.keys(state.days)) if (d < addDays(today, -3)) delete state.days[d];

  let ds = normalizeDataset(await st.getJSON("dataset"));
  const date = parsed.date;
  const hash = crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("base64url");
  const day = (state.days[date] ||= {});
  if (hash !== state.hash) {
    state.hash = hash;
    let decision, replacedOther = false;
    ({ ds } = await withDataset(st, (fresh) => {
      decision = importDecision(fresh.daily[date], parsed, today, earlierSheet(fresh, date));
      if (!decision.apply) return NO_CHANGE;
      const was = fresh.daily[date];
      replacedOther = !!was && was.source !== "sheet";
      // The same announced sheet read from the workbook instead of a photo isn't an edit (below).
      const quiet = replacedOther && !!day.alertedAt;
      setDaily(fresh, date, {
        ...parsed, source: "sheet", hasPhoto: !!was?.hasPhoto, draft: !day.alertedAt && date > today, sheetAt: now.toISOString(),
        postedAt: was?.postedAt || "", editedAt: quiet ? was.editedAt || was.postedAt || "" : now.toISOString(),
      });
      return true;
    }));
    state.held = decision.apply ? null : decision.why;
    if (decision.apply) {
      day.changedAt = now.toISOString();
      // The day was already announced from a photo or typed in, and this is the same sheet read
      // from the workbook. Spelling differences between the two aren't changes: nobody hears.
      if (replacedOther && day.alertedAt) {
        day.lines = linesFor(createModel(ds))(date);
        day.comparedAt = day.changedAt;
      }
    }
  }
  state.rooms = parsed.rooms.filter((r) => r.surgeon).length;
  state.date = date;
  state.complete = looksComplete(wb, parsed);
  if (!state.held && ds.daily[date] && !peek) {
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
    date: state?.date || null, held: state?.held || null, complete: !!state?.complete, rooms: state?.rooms ?? null, changedAt: day?.changedAt || null, alertedAt: day?.alertedAt || null, reach: day?.reach || null,
  };
}
