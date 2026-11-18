// Case log nudges, only for residents who have started a case log (and haven't turned these off):
//
//   After a case day with nothing logged (not for interns, who log a line now and then): 15 minutes after their shift ends (7:30 the next
//   morning after an overnight one), saying where they were and how many cases the sheet had.
//   Partly logged days get "finish" instead. Days marked "no cases" get nothing.
//
//   Sunday evening, when ready cases have been waiting for ACGME five days or more.
//
// A scheduled function (caselog-nudges) runs every 15 minutes; each nudge is claimed before it's
// sent, so a late or doubled run can't send it twice.
import { createModel } from "../public/core/model.js";
import { dayCases, nudgeAt, isReady } from "../public/core/acgme.js";
import { addDays, dow, fmtDate, nowMinutesLocal, startOfWeek, todayLocal } from "../public/core/dates.js";
import { normalizeDataset } from "./dataset.js";
import { caseKey } from "./caselog.js";
import { sendToSubs } from "./push.js";
import { env } from "./auth.js";

const WINDOW = 60; // minutes a nudge stays worth sending
const WEEKLY = 1140; // Sunday 7p
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The nudges one resident is due at this minute. `rec` is their case log record.
export function nudgesFor(model, pid, rec, today, nowMin) {
  if (!rec) return [];
  const cases = Object.values(rec.cases || {});
  const out = [];
  // Interns log now and then, not every case day: they only hear when something waits for ACGME.
  const intern = model.person(pid)?.cls === "PGY-1";
  for (const date of intern ? [] : [today, addDays(today, -1)]) {
    const day = dayCases(model, pid, date);
    if (!day.kind || rec.days?.[date]?.none) continue;
    const at = nudgeAt(day.d) - (date === today ? 0 : 1440);
    if (date !== today && at < 0) continue; // yesterday's nudge was yesterday's business
    if (nowMin < at || nowMin >= at + WINDOW) continue;
    const logged = cases.filter((c) => c.day === date);
    const ready = logged.filter(isReady).length;
    const expected = Math.max(day.expected, logged.length);
    if (logged.length && ready >= expected) continue;
    const which = date === today ? "today's" : day.overnight ? "last night's" : "yesterday's";
    out.push({
      key: `${date}|log|${pid}`,
      payload: logged.length
        ? { title: `${ready} of ${expected} cases logged`, body: `Finish ${which} cases: ${expected - ready} left. Tap to finish.`, url: `/#/cases/${date}`, tag: `cases-${date}` }
        : { title: `Log ${which} cases`, body: `${[day.where, day.expected ? plural(day.expected, "case") + ", already laid out" : ""].filter(Boolean).join(" · ") || "About a minute"}. Tap to log.`, url: `/#/cases/${date}`, tag: `cases-${date}` },
    });
  }
  if (dow(today) === 0 && nowMin >= WEEKLY && nowMin < WEEKLY + WINDOW) {
    const waiting = cases.filter((c) => !c.enteredAt && isReady(c)).sort((a, b) => (a.date > b.date ? 1 : -1));
    if (waiting.length && waiting[0].date <= addDays(today, -5)) {
      out.push({
        key: `${startOfWeek(today)}|acgme|${pid}`,
        payload: {
          title: `${plural(waiting.length, "case")} waiting for ACGME`,
          body: `The oldest is from ${fmtDate(waiting[0].date)}. About ${Math.max(1, Math.round(waiting.length * 0.4))} min: tap Log cases in Safari for each one.`,
          url: "/#/cases/acgme", tag: "cases-acgme",
        },
      });
    }
  }
  return out;
}

export async function sendCaseNudges(st, { now = new Date(), site = env("URL") } = {}) {
  const today = todayLocal(now);
  const nowMin = nowMinutesLocal(now);
  const subs = Object.values((await st.getJSON("push/subs")) || {}).filter((s) => s.pid && s.cases !== false);
  if (!subs.length) return { due: 0, sent: 0 };
  const model = createModel(normalizeDataset(await st.getJSON("dataset")));
  const due = [];
  for (const pid of new Set(subs.map((s) => s.pid))) {
    if (!model.person(pid)) continue;
    const rec = await st.getJSON(caseKey(pid));
    for (const n of nudgesFor(model, pid, rec, today, nowMin)) due.push({ ...n, pid });
  }
  if (!due.length) return { due: 0, sent: 0 };
  let claimed = new Set();
  await st.update("push/caselog-nudges", (saved) => {
    claimed = new Set();
    const done = saved || {};
    for (const n of due) if (!done[n.key]) { done[n.key] = now.toISOString(); claimed.add(n.key); }
    for (const k of Object.keys(done)) if (k.slice(0, 10) < addDays(today, -21)) delete done[k];
    return claimed.size ? done : undefined;
  });
  const left = due.filter((n) => claimed.has(n.key));
  let sent = 0;
  while (left.length) {
    const round = new Map();
    for (let i = 0; i < left.length;) {
      if (round.has(left[i].pid)) i++; else round.set(left[i].pid, left.splice(i, 1)[0]);
    }
    sent += await sendToSubs(st, (sub) => round.has(sub.pid) && sub.cases !== false, (sub) => round.get(sub.pid).payload, { site, urgency: "normal", ttl: 3600 });
  }
  return { due: due.length, sent };
}
