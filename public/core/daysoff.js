// Days off: golden weekends (Saturday and Sunday both truly free) and the days a group of
// residents are all off together. Everything comes from the uploaded call sheets.
import { academicYearOf, addDays, dow, monthDates, range } from "./dates.js";

const SHIFT = { H1: "24-hr call", 24: "24-hr call", H2: "12-hr call", NF: "Night float", "10-7": "10a–7p" };
export const NO_SHEET = "No call sheet";

// Why someone isn't free on a date, or null if they are. A blank weekend cell after a 24 reads
// as off on the call sheet, but that person is post-call.
export function busyReason(model, pid, date) {
  const d = model.day(pid, date);
  if (d.source !== "call") return NO_SHEET;
  if (d.status === "postcall") return "Post-call";
  if (d.status === "work") return SHIFT[d.call] || d.label || "Working";
  if (d.cardiac) return "Cardiac call";
  const before = model.day(pid, addDays(date, -1));
  return before.call === "H1" || before.call === "24" ? "Post-call" : null;
}

// Every weekend from `from` to `to` that the call sheets cover, including one already under way.
export function weekendsFor(model, pid, from, to) {
  const out = [];
  let sat = dow(from) === 0 ? addDays(from, -1) : addDays(from, 6 - dow(from));
  for (; sat <= to; sat = addDays(sat, 7)) {
    const sun = addDays(sat, 1);
    const satWhy = busyReason(model, pid, sat), sunWhy = busyReason(model, pid, sun);
    if (satWhy === NO_SHEET || sunWhy === NO_SHEET) continue;
    const golden = !satWhy && !sunWhy;
    const why = [satWhy && `Sat: ${satWhy}`, sunWhy && `Sun: ${sunWhy}`].filter(Boolean);
    const long = golden && (!busyReason(model, pid, addDays(sat, -1)) || !busyReason(model, pid, addDays(sat, 2)));
    out.push({ sat, sun, golden, long, why, vacation: golden && model.day(pid, sat).status === "vacation" });
  }
  return out;
}

const lastSheetDay = (model) => {
  const month = model.months[model.months.length - 1];
  return month ? monthDates(month).pop() : null;
};

// This academic year so far, what's ahead, and the next one.
export function goldenSummary(model, pid, today) {
  const end = lastSheetDay(model);
  if (!end) return { past: 0, ahead: 0, next: null, upcoming: [], through: null };
  const all = weekendsFor(model, pid, `${academicYearOf(today)}-07-01`, end);
  const upcoming = all.filter((w) => w.sun >= today);
  const ahead = upcoming.filter((w) => w.golden);
  return { past: all.filter((w) => w.sun < today && w.golden).length, ahead: ahead.length, next: ahead[0] || null, upcoming, through: end };
}

// The stretches when everyone in `pids` is free, and, for groups of three or more, the days only
// one person can't make.
export function sharedOff(model, pids, from, to) {
  const days = [], almost = [];
  for (const date of range(from, to)) {
    const busy = pids.map((pid) => [pid, busyReason(model, pid, date)]).filter(([, why]) => why);
    if (busy.some(([, why]) => why === NO_SHEET)) continue;
    if (!busy.length) days.push(date);
    else if (busy.length === 1 && pids.length >= 3) almost.push({ date, pid: busy[0][0], why: busy[0][1] });
  }
  const runs = [];
  for (const date of days) {
    const last = runs[runs.length - 1];
    if (last && addDays(last.to, 1) === date) { last.to = date; last.dates.push(date); } else runs.push({ from: date, to: date, dates: [date] });
  }
  for (const r of runs) {
    r.wholeWeekend = r.dates.some((d) => dow(d) === 6 && r.dates.includes(addDays(d, 1)));
    r.away = pids.filter((pid) => r.dates.some((d) => model.day(pid, d).status === "vacation"));
  }
  return { runs, almost };
}
