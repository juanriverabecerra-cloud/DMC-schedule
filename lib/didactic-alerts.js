// Lock-screen alerts for didactics, worked out for each resident from their own day.
//
//   Everyone a session is for: one heads-up as it's about to start. 10 minutes before an
//   in-person session (time to walk over), 5 before one that's only on Zoom, and 5 before with
//   the link for someone at another hospital who'd join by Zoom. Back-to-back sessions in the
//   same room are one sitting and one alert. Nothing for someone off, on vacation, post-call and
//   gone home, resting before night float, or working through it on call or a late shift
//   (didactics.where has the rules). This one can be turned off per phone.
//
//   Presenting: the evening before, with the time, place and moderator while there's still time
//   to sort anything out; then early enough to be set up before the sitting starts (30 minutes
//   ahead in person, 20 on Zoom), never a "starts in 5 minutes" when they should be at the podium.
//
//   A mock oral: the evening before, with the examiner, then 15 minutes before their own slot.
//
// A scheduled function (didactic-alerts) runs every 5 minutes. Each alert is claimed in the store
// before it's sent, so a late or doubled run can't send it twice.
import { createModel } from "../public/core/model.js";
import { KINDS, OWN_ROLES, SERIES, eventHeadline, facultyOf, isGenericTitle, relevantTo } from "../public/core/didactics.js";
import { addDays, fmtTime, nowMinutesLocal, todayLocal } from "../public/core/dates.js";
import { normalizeDataset } from "./dataset.js";
import { sendToSubs } from "./push.js";
import { env } from "./auth.js";

export const LEAD = { inPerson: 10, zoom: 5, present: 30, presentZoom: 20, mockOral: 15 };
const EVENING = 1140; // 7p the evening before
const EVENING_UNTIL = 1320; // a schedule changed later than 10p waits for the morning alert
const SLACK = 6; // runs are 5 minutes apart

const label = (e) => (KINDS[e.kind] || KINDS.other).label;
const seriesName = (e) => (e.series !== "other" && SERIES[e.series]) || label(e);
const minutes = (n) => `${n} minute${n === 1 ? "" : "s"}`;
const sentence = (t) => (t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "");

// Back-to-back sessions in the same room, or on the same Zoom, are one sitting.
export function sittings(events) {
  const out = [];
  for (const e of events.filter((x) => !x.cancelled && x.start != null).sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    const same = prev && prev.virtual === e.virtual && prev.place === e.place && (prev.zoomLink?.key || "") === (e.zoomLink?.key || "");
    if (same && e.start <= (prev.end ?? prev.start + 60) + 5) last.push(e); else out.push([e]);
  }
  return out;
}

// Every alert one resident should get for sessions on `date`. Each has `on` and `at` (the day and
// minute it's due), `until` (when it's no longer worth sending) and `payload(nowMin)`.
export function alertsFor(model, pid, date) {
  const D = model.didactics;
  if (!D?.has || model.day(pid, date).status === "vacation") return [];
  const out = [];
  for (const sitting of sittings(D.on(date))) {
    const mine = sitting.flatMap((e) => e.people.filter((p) => p.pid === pid && OWN_ROLES.has(p.role)).map((p) => ({ e, p, slot: p.start ?? e.start })));
    if (mine.length) {
      mine.sort((a, b) => a.slot - b.slot);
      out.push(...(mine[0].p.role === "examinee" ? mockOralAlerts : presenterAlerts)(model, pid, date, sitting, mine[0]));
      continue;
    }
    const theirs = sitting.filter((e) => relevantTo(e, pid));
    if (!theirs.length) continue;
    const start = theirs[0].start;
    const w = D.where(pid, date, start);
    if (w?.excused) continue;
    const zoomOnly = theirs.every((e) => e.virtual);
    if (w?.away && !zoomOnly && !theirs.some((e) => e.zoomLink)) continue; // in the room only, and they're elsewhere
    const lead = zoomOnly || w?.away ? LEAD.zoom : LEAD.inPerson;
    out.push({
      kind: "starting", optional: true, on: date, at: start - lead, until: Math.min(start, start - lead + SLACK), start, urgency: "high", ttl: 600,
      payload: (nowMin) => startingAlert(theirs, Math.max(1, start - nowMin), zoomOnly, w),
    });
  }
  return out;
}

function startingAlert(theirs, inMin, zoomOnly, w) {
  const list = theirs.slice(0, 2).map((e) => `${fmtTime(e.start)} ${eventHeadline(e)}`).join(", then ") + (theirs.length > 2 ? ", and more" : "");
  const body = zoomOnly ? `${list}. On Zoom: tap to join.`
    : w?.away ? `You're at ${w.away} today, so join by Zoom: tap for the link. ${list}.`
      : `${list}. ${theirs[0].place || "Usual room"}.`;
  return { title: `${seriesName(theirs[0])} starts in ${minutes(inMin)}`, body, url: "/#/didactics", tag: `did-${theirs[0].date}-${theirs[0].start}` };
}

const placeLine = (e) => (e.virtual ? "On Zoom" : `${e.place || "Usual room"}${e.zoomLink ? ", Zoom too" : ""}`);

function presenterAlerts(model, pid, date, sitting, { e, p, slot }) {
  const D = model.didactics;
  const topic = p.topic || (isGenericTitle(e) ? label(e) : e.title);
  const moderator = facultyOf(e).find((f) => f.role === "moderator" || f.role === "faculty")?.display;
  const begins = sitting[0].start;
  const ready = begins - (e.virtual ? 5 : 10);
  const lead = e.virtual ? LEAD.presentZoom : LEAD.present;
  const w = D.where(pid, date, slot);
  const before = slot > begins ? ` before the ${label(sitting[0])} at ${fmtTime(begins)}` : "";
  const setup = e.virtual ? `Join by ${fmtTime(ready)} to test sharing your screen. Tap to join.`
    : w?.away && e.zoomLink ? `You're at ${w.away} today: be in ${e.place || "the room"} or on the Zoom by ${fmtTime(ready)} to set up your slides.`
      : `Be in ${e.place || "the room"} by ${fmtTime(ready)} to load your slides${before}.`;
  const tag = `present-${date}-${slot}`;
  return [
    {
      kind: "present-eve", on: addDays(date, -1), at: EVENING, until: EVENING_UNTIL, start: slot, urgency: "normal", ttl: 7200,
      payload: () => ({
        title: `Tomorrow you present at ${fmtTime(slot)}`,
        body: [topic, placeLine(e), moderator ? `Moderator: ${moderator}` : "", e.virtual ? "Have your slides ready to share" : "Bring your slides on a USB drive or have them in your email"].filter(Boolean).join(". ") + ".",
        url: "/#/didactics", tag,
      }),
    },
    {
      kind: "present", on: date, at: begins - lead, until: Math.min(begins, begins - lead + SLACK), start: slot, urgency: "high", ttl: 900,
      payload: () => ({ title: `You present at ${fmtTime(slot)}`, body: setup, url: "/#/didactics", tag }),
    },
  ];
}

function mockOralAlerts(model, pid, date, sitting, { e, slot }) {
  const examiner = facultyOf(e).filter((f) => f.role === "examiner").map((f) => f.display).join(" and ");
  const where = e.virtual ? "on Zoom" : e.place ? `in ${e.place}` : "";
  const tag = `mock-${date}-${slot}`;
  return [
    {
      kind: "mock-eve", on: addDays(date, -1), at: EVENING, until: EVENING_UNTIL, start: slot, urgency: "normal", ttl: 7200,
      payload: () => ({ title: `Tomorrow: your mock oral at ${fmtTime(slot)}`, body: sentence([examiner ? `With ${examiner}` : "", where].filter(Boolean).join(", ")), url: "/#/didactics", tag }),
    },
    {
      kind: "mock", on: date, at: slot - LEAD.mockOral, until: Math.min(slot, slot - LEAD.mockOral + SLACK), start: slot, urgency: "high", ttl: 600,
      payload: (nowMin) => ({
        title: `Your mock oral is in ${minutes(Math.max(1, slot - nowMin))}`,
        body: `${fmtTime(slot)}${examiner ? ` with ${examiner}` : ""}${where ? `, ${where}` : ""}.${e.virtual ? " Tap to join." : ""}`,
        url: "/#/didactics", tag,
      }),
    },
  ];
}

// Alerts due now for everyone who has alerts on, claimed and sent. Returns how many were due and
// how many phones heard.
export async function sendDidacticAlerts(st, { now = new Date(), site = env("URL") } = {}) {
  const today = todayLocal(now);
  const nowMin = nowMinutesLocal(now);
  const model = createModel(normalizeDataset(await st.getJSON("dataset")));
  if (!model.didactics?.has) return { due: 0, sent: 0 };
  const subs = Object.values((await st.getJSON("push/subs")) || {});
  const pids = [...new Set(subs.map((s) => s.pid).filter((pid) => pid && model.person(pid)))];
  const due = [];
  for (const pid of pids) {
    for (const date of [today, addDays(today, 1)]) {
      for (const a of alertsFor(model, pid, date)) {
        if (a.on === today && nowMin >= a.at - 1 && nowMin < a.until) due.push({ ...a, pid, key: `${date}|${a.kind}|${pid}|${a.start}` });
      }
    }
  }
  if (!due.length) return { due: 0, sent: 0 };
  let claimed = new Set();
  await st.update("push/didactic-alerts", (saved) => {
    claimed = new Set();
    const done = saved || {};
    for (const a of due) if (!done[a.key]) { done[a.key] = now.toISOString(); claimed.add(a.key); }
    for (const k of Object.keys(done)) if (k.slice(0, 10) < addDays(today, -14)) delete done[k];
    return claimed.size ? done : undefined;
  });
  // One alert per person per send; someone with two due at once gets the second right after.
  const left = due.filter((a) => claimed.has(a.key));
  let sent = 0;
  while (left.length) {
    const round = new Map();
    for (let i = 0; i < left.length;) {
      if (round.has(left[i].pid)) i++; else round.set(left[i].pid, left.splice(i, 1)[0]);
    }
    const all = [...round.values()];
    sent += await sendToSubs(st,
      (sub) => round.has(sub.pid) && (!round.get(sub.pid).optional || sub.lectures !== false),
      (sub) => round.get(sub.pid).payload(nowMin),
      { site, urgency: all.some((a) => a.urgency === "high") ? "high" : "normal", ttl: Math.max(...all.map((a) => a.ttl)) });
  }
  return { due: due.length, sent };
}
