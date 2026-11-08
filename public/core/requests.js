// Requests a resident makes about the schedule: a sick call, a swap with a classmate, and the
// monthly "no call" weekend days. Each ends in an email draft to the schedule's inbox, since
// the call sheet stays the official schedule and changes go through that email.
import { addDays, addMonths, dow, fmtDate, fmtMonth, monthDates, monthKey } from "./dates.js";
import { headline } from "./model.js";

export const SCHEDULE_EMAIL = "dmc.ane.sch@gmail.com";

// A mailto link that opens a ready-to-send draft. Mail apps want CRLF line breaks.
export function mailto(subject, body, to = SCHEDULE_EMAIL) {
  const enc = (s) => encodeURIComponent(String(s).replace(/\r?\n/g, "\r\n"));
  return `mailto:${to}?subject=${enc(subject)}&body=${enc(body)}`;
}

const first = (model, pid) => model.person(pid)?.preferred || model.person(pid)?.first || model.name(pid);

// ---------- shifts that can change hands ----------

export function shiftName(d) {
  if (!d || d.status !== "work") return null;
  if (d.call === "H1") return "24-hr call (H1)";
  if (d.call === "24") return "24-hr call";
  if (d.call === "H2") return "12-hr call (H2)";
  if (d.call === "NF") return "Night float";
  if (d.call === "10-7") return "CA-3 10a–7p";
  if (d.late) return "Late day (until 6p)";
  return null;
}

// A shift name inside a sentence: "night float", but "12-hr call (H2)" and "CA-3 10a–7p" as is.
export const lc = (label) => String(label || "").replace(/^(Night float|Late day)/, (m) => m.toLowerCase());

// The shift on a date, as one piece: nights run on to the end of that night-float week.
export function shiftBlock(model, pid, date) {
  const d = model.day(pid, date);
  const label = shiftName(d);
  if (!label) return null;
  let end = date;
  if (d.call === "NF") while (model.day(pid, addDays(end, 1)).call === "NF") end = addDays(end, 1);
  return { date, end, label, kind: d.call || "late" };
}

// A resident's upcoming shifts that could be swapped, soonest first.
export function upcomingShifts(model, pid, from, days = 70) {
  const out = [];
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    const last = out[out.length - 1];
    if (last && date <= last.end) continue;
    const block = shiftBlock(model, pid, date);
    if (block) out.push(block);
  }
  return out;
}

export const when = (b) => (b.end && b.end !== b.date ? `${fmtDate(b.date, "long")} – ${fmtDate(b.end, "long")}` : fmtDate(b.date, "long"));
export const whenShort = (b) => (b.end && b.end !== b.date ? `${fmtDate(b.date)}–${fmtDate(b.end, "md")}` : fmtDate(b.date));

// ---------- swaps ----------

// The email once two residents agree. `req` is a swap request with `agreed` filled in.
export function swapEmail(model, req) {
  const a = req.pid, b = req.agreed.pid;
  const cls = model.person(a)?.cls;
  const lines = [`• ${when(req)}, ${lc(req.label)}: ${model.name(b)} will cover for ${model.name(a)}`];
  if (req.agreed.date) lines.push(`• ${when(req.agreed)}, ${lc(req.agreed.label)}: ${model.name(a)} will cover for ${model.name(b)}`);
  const subject = `Call swap: ${model.person(a)?.last} ↔ ${model.person(b)?.last}, ${whenShort(req)}${req.agreed.date ? ` and ${whenShort(req.agreed)}` : ""}`;
  const body = [
    "Hello,",
    "",
    `${model.name(a)} and ${model.name(b)}${cls ? ` (${cls})` : ""} have agreed to ${req.agreed.date ? "trade" : "switch"} call:`,
    "",
    ...lines,
    "",
    "We both agree to this change. Please update the call schedule.",
    "",
    "Thank you,",
    `${model.name(a)} and ${model.name(b)}`,
  ].join("\n");
  return { subject, body };
}

// The text a resident sends a classmate to ask.
export function swapAsk(model, req, toPid) {
  return `Hi ${first(model, toPid)}, could you take my ${lc(req.label)} on ${whenShort(req)}? I posted it in the DMC Schedule app under Swaps. Thanks! – ${first(model, req.pid)}`;
}

// ---------- sick call ----------

// The Jeopardy resident (one a month, first for sick calls) on a date, if any. A weekend shows
// them as off, but they're still the backup.
export function jeopardyOn(model, date) {
  return model.roster(date).filter((d) => (d.rotationCode === "ELECT-J" || /jeopardy/i.test(d.rotation || "")) && !["vacation", "postcall"].includes(d.status));
}

export function assignmentText(d) {
  if (!d || d.status !== "work") return "";
  const shift = shiftName(d);
  const where = headline(d).replace(/^OR (\S+) · (.+)$/, "OR $1 ($2)");
  return shift && shift !== where ? `${shift}${d.rotation ? `, ${d.rotation}` : ""}` : where;
}

export function sickText(model, pid, date, today, toPid) {
  const day = date === today ? `today (${fmtDate(date)})` : date === addDays(today, 1) ? `tomorrow (${fmtDate(date)})` : `on ${fmtDate(date)}`;
  const what = assignmentText(model.day(pid, date));
  return `Hi ${first(model, toPid)}, I'm sick and can't work ${day}.${what ? ` I'm on ${what}.` : ""} Could you cover? Thank you – ${first(model, pid)}`;
}

export function sickEmail(model, pid, date, { jeopardy = [] } = {}) {
  const what = assignmentText(model.day(pid, date));
  const subject = `Sick call: ${model.name(pid)}, ${fmtDate(date)}`;
  const body = [
    "Hello,",
    "",
    `I'm sick and won't be able to work on ${fmtDate(date, "long")}.${what ? ` I was scheduled for ${what}.` : ""}`,
    jeopardy.length ? `I've reached out to ${jeopardy.map((id) => model.name(id)).join(" and ")} (Jeopardy) to cover.` : "",
    "",
    "Thank you,",
    model.name(pid),
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
  return { subject, body };
}

// ---------- no-call weekend days ----------

export const NO_CALL_REASONS = [
  "Wedding",
  "Family event",
  "Travel",
  "Conference or exam",
  "Religious observance",
  "Medical appointment",
  "Childcare",
  "Personal / wellness",
  "Other",
];

// The month the request is usually for: next month.
export const noCallMonth = (today) => addMonths(monthKey(today), 1);

// Each weekend of the month as Friday, Saturday and Sunday (a Friday 24 takes the weekend too).
// A weekend that starts in the month before or ends in the next keeps only this month's days.
export function weekendsOf(month) {
  const out = new Map();
  for (const date of monthDates(month)) {
    const back = { 5: 0, 6: 1, 0: 2 }[dow(date)];
    if (back === undefined) continue;
    const fri = addDays(date, -back);
    if (!out.has(fri)) out.set(fri, { fri, days: [] });
    out.get(fri).days.push(date);
  }
  return [...out.values()];
}

// picks: { "2026-12-05": "Wedding", ... }
export function noCallEmail(model, pid, month, picks, note = "") {
  const dates = Object.keys(picks).filter((d) => monthKey(d) === month).sort();
  const p = model.person(pid);
  const subject = `No-call request, ${fmtMonth(month)}: ${model.name(pid)}${p?.cls ? ` (${p.cls})` : ""}`;
  const body = [
    "Hello,",
    "",
    dates.length
      ? `For ${fmtMonth(month)}, I'd prefer not to have call on these days:`
      : `I don't have any no-call requests for ${fmtMonth(month)}.`,
    ...(dates.length ? ["", ...dates.map((d) => `• ${fmtDate(d, "long")}${picks[d] && picks[d] !== "Other" ? `: ${picks[d]}` : ""}`)] : []),
    ...(String(note).trim() ? ["", String(note).trim()] : []),
    "",
    "Thank you,",
    `${model.name(pid)}${p?.cls ? `, ${p.cls}` : ""}`,
  ].join("\n");
  return { subject, body };
}
