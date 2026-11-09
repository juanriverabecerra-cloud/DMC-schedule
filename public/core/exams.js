// Exam countdowns. Everyone takes the ITE; BASIC or ADVANCED depends on the resident. Dates are
// the American Board of Anesthesiology's published sessions; add new ones here as they're posted.
// When a call sheet marks someone's own exam day, that day is used.
import { academicYearOf, addDays, diffDays, fmtDate, fmtMonth, MONTH_SHORT, monthKey, parts, range } from "./dates.js";

export const EXAMS = {
  ite: {
    name: "ITE", long: "In-Training Exam",
    sessions: [
      { id: "2027", label: "2027", from: "2027-02-04", to: "2027-02-08" },
      { id: "2028", label: "2028", from: "2028-02-03", to: "2028-02-07" },
    ],
  },
  basic: {
    name: "BASIC", long: "ABA BASIC Exam",
    sessions: [
      { id: "2027-summer", label: "Summer 2027", from: "2027-06-04", to: "2027-06-05", regOpen: "2027-02-10", regClose: "2027-04-07", lateClose: "2027-04-22" },
      { id: "2027-fall", label: "Fall 2027", from: "2027-11-12", to: "2027-11-13", regOpen: "2027-07-21", regClose: "2027-09-15", lateClose: "2027-09-30" },
      { id: "2028-summer", label: "Summer 2028", from: "2028-06-09", to: "2028-06-10" },
      { id: "2028-fall", label: "Fall 2028", from: "2028-11-03", to: "2028-11-04" },
    ],
  },
  advanced: {
    name: "ADVANCED", long: "ABA ADVANCED Exam",
    sessions: [
      { id: "2027-winter", label: "Winter 2027", from: "2027-01-22", to: "2027-01-23", regOpen: "2026-09-30", regClose: "2026-11-25", lateClose: "2026-12-10" },
      { id: "2027-summer", label: "Summer 2027", from: "2027-07-16", to: "2027-07-17", regOpen: "2027-03-24", regClose: "2027-05-19", lateClose: "2027-06-03" },
      { id: "2028-winter", label: "Winter 2028", from: "2028-01-21", to: "2028-01-22" },
      { id: "2028-summer", label: "Summer 2028", from: "2028-07-14", to: "2028-07-15" },
    ],
  },
};

export const TRACKS = [["basic", "BASIC"], ["advanced", "ADVANCED"], ["none", "ITE only"]];
export const defaultTrack = (cls) => (cls === "CA-1" ? "basic" : cls === "CA-3" ? "advanced" : "none");

export const openSessions = (kind, today) => EXAMS[kind].sessions.filter((s) => s.to >= today);

// BASIC at the end of CA-1, ADVANCED after graduating: the usual first sitting.
export function expectedSession(kind, today) {
  const year = academicYearOf(today) + 1;
  const earliest = kind === "basic" ? `${year}-05-01` : kind === "advanced" ? `${year}-07-01` : today;
  return openSessions(kind, earliest > today ? earliest : today)[0] || null;
}

export function windowLabel(from, to) {
  const a = parts(from), b = parts(to);
  if (from === to) return `${MONTH_SHORT[a.m - 1]} ${a.d}, ${a.y}`;
  return a.m === b.m ? `${MONTH_SHORT[a.m - 1]} ${a.d}–${b.d}, ${a.y}` : `${MONTH_SHORT[a.m - 1]} ${a.d} – ${MONTH_SHORT[b.m - 1]} ${b.d}, ${a.y}`;
}

// Exam days a call sheet marks on this resident's own row, from today on.
export function sheetMarks(model, pid, today) {
  const marks = {};
  for (const month of model.months) {
    if (month < monthKey(today)) continue;
    const days = model.ds.months[month].rows?.[pid]?.days || {};
    for (const [d, cell] of Object.entries(days)) {
      const m = String(cell.t || "").match(/\b(ITE|BASIC|ADVANCED)\b/i);
      const date = `${month}-${String(d).padStart(2, "0")}`;
      if (!m || date < today) continue;
      const kind = m[1].toLowerCase();
      if (!marks[kind] || date < marks[kind]) marks[kind] = date;
    }
  }
  return marks;
}

function registration(s, today) {
  if (!s.regOpen) return null;
  if (today < s.regOpen) return `Registration opens ${fmtDate(s.regOpen, "year")}`;
  if (today <= s.regClose) return `Standard registration closes ${fmtDate(s.regClose, "year")}`;
  if (today <= s.lateClose) return `Late registration closes ${fmtDate(s.lateClose, "year")}, at a higher fee`;
  return null;
}

const callWord = { H1: "24-hr call", 24: "24-hr call", H2: "12-hr call", NF: "night float", "10-7": "the 10a–7p shift" };

// Anything on the schedule that gets in the way of the exam.
function scheduleNotes(model, pid, item) {
  const notes = [];
  const days = item.day ? [item.day] : item.kind === "ite" ? [] : range(item.from, item.to);
  if (days.length && !model.hasCall(days[0])) {
    notes.push({ level: "info", text: `The ${fmtMonth(monthKey(days[0]))} call sheet isn't out yet. Ask for these days as no-call days when the list opens.` });
    return notes;
  }
  for (const date of days) {
    const on = model.day(pid, date);
    const before = model.day(pid, addDays(date, -1));
    const marked = /\b(ITE|BASIC|ADVANCED)\b/i.test(on.raw) && !/H1/i.test(on.raw);
    if (on.call && !marked) notes.push({ level: "gap", text: `You're on ${callWord[on.call]} ${fmtDate(date)}. Ask for a swap.` });
    if (["H1", "24", "NF"].includes(before.call)) notes.push({ level: "warn", text: `You're on ${callWord[before.call]} the night before ${fmtDate(date)}.` });
  }
  return notes;
}

function build(model, pid, kind, session, day, source, today) {
  const item = { kind, name: EXAMS[kind].name, long: EXAMS[kind].long, session, from: session.from, to: session.to, window: windowLabel(session.from, session.to), day: day || null, source };
  item.days = diffDays(today, day || session.from);
  item.registration = registration(session, today);
  item.notes = scheduleNotes(model, pid, item);
  return item;
}

// A resident's exams, soonest first. `plan` is what they chose on this device; without one, the
// call sheet or their class decides.
export function examsFor(model, pid, plan, today) {
  const saved = plan?.pid === pid ? plan : {};
  const marks = sheetMarks(model, pid, today);
  const track = saved.track || (marks.advanced ? "advanced" : marks.basic ? "basic" : defaultTrack(model.person(pid)?.cls));
  const out = [];
  const ite = openSessions("ite", today)[0];
  if (ite) out.push(build(model, pid, "ite", ite, marks.ite && marks.ite <= ite.to ? marks.ite : null, marks.ite ? "sheet" : null, today));
  if (track !== "none") {
    const chosen = openSessions(track, today).find((s) => s.id === saved.session && saved.kind === track);
    const session = chosen || expectedSession(track, today);
    if (session) {
      const inside = (d) => d && d >= session.from && d <= session.to;
      const day = inside(saved.day) ? saved.day : inside(marks[track]) ? marks[track] : null;
      out.push(build(model, pid, track, session, day, day && day === saved.day ? "you" : day ? "sheet" : null, today));
    }
  }
  return { track, exams: out.sort((a, b) => a.days - b.days) };
}
