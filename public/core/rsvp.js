// RSVPs: which program events ask for a reply, by when, and what's left. The email reader gives the
// deadline when an email names one (lib/mail-read.js, "RSVP by Friday" turned into a date). An event
// that asks for a reply without a date is due a week before it, or the day before when it's closer.
import { addDays, diffDays, fmtDate } from "./dates.js";

const ASKS = /\b(rsvp|r\.s\.v\.p|register|registration|sign[- ]?up|reply by|let us know if you)\b/i;
// A lecture's or meeting's link or "register" is usually an optional sign-up (for the stream, the
// recording), not a reply someone's counting: those need a deadline, or the email reader saying a
// reply is needed to attend.
const WORK = new Set(["lecture", "didactic", "conference", "meeting", "deadline"]);

// { by, implied, left (days), passed, link } for an event that wants a reply, else null.
export function rsvpFor(e, today) {
  if (!e || e.cancelled || e.date < today) return null;
  const casual = !WORK.has(e.kind) && (e.rsvpLink || ASKS.test(`${e.title || ""} ${e.note || ""}`));
  if (!(e.rsvpBy || e.rsvpNeeded || casual)) return null;
  let by = e.rsvpBy && e.rsvpBy <= e.date ? e.rsvpBy : "";
  const implied = !by;
  if (implied) by = addDays(e.date, -7) >= today ? addDays(e.date, -7) : addDays(e.date, -1) >= today ? addDays(e.date, -1) : e.date;
  const left = diffDays(today, by);
  return { by, implied, left, passed: left < 0, link: e.rsvpLink || "" };
}

// The replies still owed, soonest first: [{ e, r }] within `days` of their deadline.
export function rsvpsDue(events, today, { done = new Set(), days = 7 } = {}) {
  return events
    .map((e) => ({ e, r: rsvpFor(e, today) }))
    .filter(({ e, r }) => r && !r.passed && r.left <= days && !done.has(e.id))
    .sort((a, b) => a.r.by.localeCompare(b.r.by) || a.e.date.localeCompare(b.e.date));
}

// "today", "tomorrow", "in 3 days"
export const leftWord = (left) => (left <= 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`);

// Lock-screen reminders: 3 days before the deadline and on the morning of the last day, at 9a.
// { key, payload } for one resident at this minute.
const AT = 9 * 60, WINDOW = 60;
export function rsvpAlertsFor(events, pid, today, nowMin, done = new Set()) {
  if (nowMin < AT || nowMin >= AT + WINDOW) return [];
  const out = [];
  for (const { e, r } of rsvpsDue(events, today, { done, days: 3 })) {
    if (r.left !== 3 && r.left !== 0) continue;
    const last = r.left === 0;
    out.push({
      key: `${today}|rsvp|${e.id}|${last ? "last" : "soon"}|${pid}`,
      payload: {
        title: last ? `Last day to RSVP: ${e.title}` : `RSVP for ${e.title}`,
        body: last ? `${r.implied ? "Best to reply today" : "Replies close today"}. Tap to reply.` : `${r.implied ? "Best to reply" : "Replies are due"} by ${fmtDate(r.by)}. Tap to reply.`,
        url: `/#/events/${e.id}`, tag: `rsvp-${e.id}`,
      },
    });
  }
  return out;
}
