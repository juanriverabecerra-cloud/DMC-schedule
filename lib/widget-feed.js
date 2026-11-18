// What the home-screen and lock-screen widgets show. The server writes the words, so the widgets
// themselves hold no schedule logic: a change here reaches every phone without an app update.
// One resident's feed: the next week day by day, who's on, what's ahead, and which day a widget
// should be showing at each point in time.
import { headline } from "../public/core/model.js";
import { addDays, diffDays, DOW_LETTER, dow, fmtDate, fmtRange, nowMinutesLocal, todayLocal, zonedTime } from "../public/core/dates.js";
import { SITES } from "../public/core/codes.js";
import { examsFor } from "../public/core/exams.js";
import { goldenSummary } from "../public/core/daysoff.js";
import { shiftName } from "../public/core/requests.js";

const DAYS = 9; // a week strip stays full even once a widget has moved on to tomorrow
const plural = (n, one) => `${n} ${one}${String(n) === "1" ? "" : "s"}`;

function chipsFor(d) {
  const out = [];
  if (d.late) out.push("Late till 6p");
  if (d.call === "H1" || d.call === "24") out.push("24-hr call");
  if (d.call === "H2") out.push("12-hr call");
  if (d.call === "NF") out.push("Night float");
  if (d.call === "10-7") out.push("10a–7p");
  if (d.cardiac) out.push("Cardiac call");
  if (d.status === "vacation") out.push("Vacation");
  if (d.status === "postcall") out.push("Post-call");
  if (d.status === "holiday") out.push("Holiday");
  return out;
}

// A few characters for a week strip or a lock-screen circle.
function codeFor(d) {
  const room = d.roles.find((r) => r.kind === "room");
  if (room) return `OR ${room.or}`;
  if (d.call === "NF") return "NF";
  if (d.call === "10-7") return "10–7";
  if (d.call === "H1" || d.call === "24") return "24h";
  if (d.call === "H2") return "12h";
  if (d.status === "vacation") return "Vac";
  if (d.status === "postcall") return "PC";
  if (d.status === "holiday") return "Hol";
  if (d.status === "off") return "Off";
  if (d.status === "work") return d.code || d.raw || "•";
  return "";
}

const toneFor = (d) => (d.call === "NF" ? "night" : d.call ? "call" : d.late ? "late" : d.status === "vacation" ? "vacation"
  : ["off", "holiday", "postcall"].includes(d.status) ? "off" : d.status === "work" ? "work" : "none");

function linesFor(model, d) {
  const nm = (s) => (s.id ? model.person(s.id)?.last || model.name(s.id) : s.name);
  const names = (list) => list.map(nm).join(", ");
  const rooms = (list) => list.map((r) => `OR ${r.or}${r.surgeon ? ` ${r.surgeon}` : ""}`).join(", ");
  const lines = [];
  for (const r of d.roles) {
    if (r.kind === "room") {
      const first = [r.room.time ? `Starts ${r.room.time}` : "", r.room.cases ? plural(r.room.cases, "case") : ""].filter(Boolean).join(" · ");
      if (first) lines.push(first);
      if (r.room.mda) lines.push(`MDA ${r.room.mda}`);
      if (r.with.length) lines.push(`With ${names(r.with)}`);
      if (r.room.jaIds.length) lines.push(`JA ${names(r.room.jaIds)}`);
      if (r.room.breakIds.length) lines.push(`Breaks ${names(r.room.breakIds)}`);
    } else if (r.kind === "breaks") lines.push(`Breaks for ${rooms(r.rooms)}`);
    else if (r.kind === "ja") lines.push(`JA for ${rooms(r.rooms)}`);
    else if (r.kind === "opsc" && r.mdas?.length) lines.push(`MDA ${r.mdas.join(", ")}`);
    else if (r.kind === "ob" && r.mda) lines.push(`MDA ${r.mda}`);
  }
  return lines;
}

function whoIsOn(model, date) {
  if (!model.hasCall(date)) return [];
  const t = model.tonight(date);
  const names = (list) => list.map((d) => model.person(d.pid)?.last || model.name(d.pid)).join(", ");
  return [["Late", t.late], ["10a–7p", t.senior], ["Night float", t.night], ["24-hr call", t.call24], ["12-hr call", t.call12], ["Cardiac", t.cardiac]]
    .filter(([, list]) => list.length).map(([k, list]) => ({ k, v: names(list) }));
}

function dayFor(model, pid, date, today) {
  const d = model.day(pid, date);
  const sheet = model.ds.daily?.[date];
  const site = SITES[d.site]?.short || "";
  // A Friday 24 is marked by color on the call sheet, so the app's headline is the rotation.
  // On a widget the call is the news, unless there's a room to show.
  const blue24 = d.call === "24" && !d.roles.length;
  const title = blue24 ? "24-hr call" : model.hasCall(date) || d.source === "intern" ? headline(d) : d.rotation || "No call sheet yet";
  const plain = (s) => String(s || "").replace(/\s*[–-]\s*/g, "-").toLowerCase();
  const rotation = d.rotation || d.label;
  const place = [plain(rotation) === plain(title) ? "" : rotation, site].filter(Boolean).join(" · ");
  const shift = d.shifts[0];
  return {
    date, letter: DOW_LETTER[dow(date)],
    title,
    sub: place, time: shift ? fmtRange(shift.start, shift.end) : "",
    chips: chipsFor(d).filter((c) => c !== title), tone: toneFor(d), color: d.status === "work" ? d.color : null, code: codeFor(d),
    lines: linesFor(model, d), on: whoIsOn(model, date),
    posted: !!sheet, draft: !!sheet?.draft && date > today,
  };
}

// When a widget with room for one day should move on to the next. Tomorrow matters once its OR
// sheet is final (from 2p), or once today's work is done; a night or a 24 keeps today till midnight.
export function switchMinute(model, pid, date) {
  const d = model.day(pid, date);
  const shift = d.shifts[d.shifts.length - 1];
  if (shift && (shift.end > 1440 || shift.start >= 900)) return 1440;
  const base = shift ? Math.min(shift.end, 18 * 60) : 17 * 60;
  const next = model.ds.daily?.[addDays(date, 1)];
  return next && !next.draft ? Math.min(base, 14 * 60) : base;
}

// [{ at, date }]: from each moment on, the day in focus.
function screensFor(model, pid, now) {
  const today = todayLocal(now);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const date = addDays(today, i);
    const at = switchMinute(model, pid, date);
    const midnight = i === 0 ? now : zonedTime(date, 0);
    const turn = zonedTime(date, at);
    if (i > 0 || nowMinutesLocal(now) < at) {
      if (out[out.length - 1]?.date !== date) out.push({ at: midnight.toISOString(), date });
      if (at < 1440) out.push({ at: turn.toISOString(), date: addDays(date, 1) });
    } else out.push({ at: now.toISOString(), date: addDays(date, 1) });
  }
  return out.filter((s, i) => i === 0 || s.date !== out[i - 1].date);
}

function aheadFor(model, pid, plan, today) {
  const out = [];
  for (let i = 1; i <= 45; i++) {
    const date = addDays(today, i);
    const name = shiftName(model.day(pid, date));
    if (!name) continue;
    out.push(name.startsWith("Late") ? { k: "Next late day", v: fmtDate(date) } : { k: "Next call", v: `${fmtDate(date)} · ${name.replace(/ \(.*\)$/, "")}` });
    break;
  }
  if (["CA-1", "CA-2", "CA-3"].includes(model.person(pid)?.cls)) {
    const golden = goldenSummary(model, pid, today).next;
    if (golden) {
      const n = diffDays(today, golden.sat);
      out.push({ k: "Golden weekend", v: n <= 0 ? "This weekend" : `${fmtDate(golden.sat, "md")}–${fmtDate(golden.sun, "md")}` });
    }
  }
  const exam = examsFor(model, pid, plan, today).exams[0];
  if (exam) out.push({ k: exam.name, v: exam.days <= 0 ? "This week" : plural(exam.days, "day") });
  return out;
}

// plan: the resident's own exam choice, when their phone sent one.
export function widgetFeed(model, pid, { now = new Date(), plan = null } = {}) {
  const person = model.person(pid);
  if (!person) return null;
  const today = todayLocal(now);
  return {
    v: 1, generatedAt: now.toISOString(), today,
    name: person.preferred || person.first || person.last,
    days: Array.from({ length: DAYS }, (_, i) => dayFor(model, pid, addDays(today, i), today)),
    screens: screensFor(model, pid, now),
    ahead: aheadFor(model, pid, plan, today),
  };
}

// "basic.2027-summer.2027-06-05" from the widget's address back into an exam plan.
export function planFromQuery(pid, text) {
  const [track, session, day] = String(text || "").split(".");
  if (!["basic", "advanced", "none"].includes(track)) return null;
  return { pid, track, kind: track, session: session || null, day: /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day : null };
}
