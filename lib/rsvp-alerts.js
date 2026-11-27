// RSVP reminders on the lock screen (public/core/rsvp.js decides when): 3 days before an event's
// reply deadline and on the morning of the last day, for everyone the event is for, until they say
// they've replied (Blobs `rsvp/done`, from the app's "I've replied"). Runs with the case log nudges,
// every 15 minutes; each reminder is claimed before it's sent, so a doubled run can't send it twice.
import { createModel } from "../public/core/model.js";
import { addDays, nowMinutesLocal, todayLocal } from "../public/core/dates.js";
import { rsvpAlertsFor } from "../public/core/rsvp.js";
import { normalizeDataset } from "./dataset.js";
import { sendToSubs } from "./push.js";
import { env } from "./auth.js";

export const RSVP_DONE = "rsvp/done";

// Who has said they replied: { [eventId]: [pid, ...] } → a Set of event ids for one resident.
export const repliedBy = (rec, pid) => new Set(Object.entries(rec || {}).filter(([, pids]) => pids.includes(pid)).map(([id]) => id));

export async function sendRsvpAlerts(st, { now = new Date(), site = env("URL") } = {}) {
  const today = todayLocal(now);
  const nowMin = nowMinutesLocal(now);
  const subs = Object.values((await st.getJSON("push/subs")) || {}).filter((s) => s.pid);
  if (!subs.length) return { due: 0, sent: 0 };
  const model = createModel(normalizeDataset(await st.getJSON("dataset")));
  const done = await st.getJSON(RSVP_DONE);
  const due = [];
  for (const pid of new Set(subs.map((s) => s.pid))) {
    if (!model.person(pid)) continue;
    const events = model.events(today, addDays(today, 120), pid);
    for (const n of rsvpAlertsFor(events, pid, today, nowMin, repliedBy(done, pid))) due.push({ ...n, pid });
  }
  if (!due.length) return { due: 0, sent: 0 };
  let claimed = new Set();
  await st.update("push/rsvp-alerts", (saved) => {
    claimed = new Set();
    const sent = saved || {};
    for (const n of due) if (!sent[n.key]) { sent[n.key] = now.toISOString(); claimed.add(n.key); }
    for (const k of Object.keys(sent)) if (k.slice(0, 10) < addDays(today, -30)) delete sent[k];
    return claimed.size ? sent : undefined;
  });
  const left = due.filter((n) => claimed.has(n.key));
  let sent = 0;
  // One reminder per person per round, so two due the same morning both arrive.
  while (left.length) {
    const round = new Map();
    for (let i = 0; i < left.length;) {
      if (round.has(left[i].pid)) i++; else round.set(left[i].pid, left.splice(i, 1)[0]);
    }
    sent += await sendToSubs(st, (sub) => round.has(sub.pid), (sub) => round.get(sub.pid).payload, { site, urgency: "normal", ttl: 6 * 3600 });
  }
  return { due: due.length, sent };
}
