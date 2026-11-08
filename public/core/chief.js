// What a chief needs to decide: who is wearing down right now, who should get more or less of
// next month's call, and what the hours residents shared actually show. Built on the fairness
// scores; real logged hours replace estimates wherever a resident added them. It advises; the
// chiefs decide.
import { addDays, addMonths, academicYearOf, daysInMonth, diffDays, dow, monthKey, range } from "./dates.js";
import { CODES, rotationCode } from "./codes.js";
import { COLUMNS, NO_CALL_GROUPS, residentLoad, rosterOf, weightsOf, columnCount } from "./fairness.js";
import { hoursReport } from "./hours.js";
import { hoursByRotation, isAwayEntry, isWorkEntry } from "./logged.js";

const CLASSES = ["CA-1", "CA-2", "CA-3"];
const round = (n) => Math.round(n);

// ---------- logged hours ----------

// Hours per day from a resident's logged entries.
function dailyTotals(entries) {
  const work = new Map(), away = new Set();
  for (const e of entries || []) {
    if (isWorkEntry(e)) work.set(e.date, (work.get(e.date) || 0) + e.hours);
    else if (isAwayEntry(e)) away.add(e.date);
  }
  return { work, away };
}

// Average hours a week over 28 days ending `end`, leaving out days away (as ACGME does).
function avgEnding(t, end) {
  let hours = 0, away = 0;
  for (let i = 0; i < 28; i++) {
    const date = addDays(end, -i);
    hours += t.work.get(date) || 0;
    if (t.away.has(date)) away++;
  }
  const present = 28 - away;
  return present >= 7 ? hours / (present / 7) : null;
}

// The 4-week average now, the highest this academic year, and how current the record is.
export function loggedSummary(entries, today) {
  const dates = (entries || []).map((e) => e.date).sort();
  if (!dates.length) return null;
  const t = dailyTotals(entries);
  const through = dates[dates.length - 1];
  const end = through < today ? through : today;
  const yearStart = `${academicYearOf(today)}-07-01`;
  let peak = null, peakEnd = null;
  for (let d = addDays(yearStart, 27); d <= end; d = addDays(d, 1)) {
    const a = avgEnding(t, d);
    if (a !== null && (peak === null || a > peak)) { peak = a; peakEnd = d; }
  }
  const logged = [...t.work.keys()].filter((d) => d >= yearStart).length;
  return { avg4: avgEnding(t, end), end, through, stale: diffDays(through, today) > 14, peak, peakEnd, daysThisYear: logged };
}

// Average a week over a period, from logged hours only.
export function loggedPerWeek(entries, from, to) {
  const t = dailyTotals(entries);
  let hours = 0, days = 0;
  for (const date of range(from, to)) {
    if (t.away.has(date)) continue;
    days++;
    hours += t.work.get(date) || 0;
  }
  const covered = (entries || []).some((e) => e.date <= from) && (entries || []).some((e) => e.date >= to);
  return covered && days >= 7 ? hours / (days / 7) : null;
}

// Which rotations run longest, across everyone who added hours: the middle resident's hours a week.
export function rotationHours(shared) {
  const by = new Map();
  for (const entries of Object.values(shared || {})) {
    for (const r of hoursByRotation(entries)) {
      if (!r.name || r.weeks < 1) continue;
      if (!by.has(r.name)) by.set(r.name, []);
      by.get(r.name).push(r.perWeek);
    }
  }
  return [...by].map(([name, vals]) => {
    const a = [...vals].sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return { name, residents: a.length, median: a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2, low: a[0], high: a[a.length - 1] };
  }).sort((x, y) => y.median - x.median);
}

// ---------- burnout watch ----------

// Starting thresholds. Each signal is something a chief can act on in the next schedule.
export const WATCH = {
  hoursWarn: 68, hoursHigh: 75, // 4-week average, logged when the resident added hours
  heavyWarn: 3, heavyHigh: 4, // 24s and weekend 12s in 4 weeks
  weekendsWarn: 3, // of the last 4 weekends, any day worked
  offWarn: 5, // days fully off in 4 weeks (ACGME needs 4)
  streakWarn: 12, streakHigh: 14, // days worked in a row, looking 2 weeks ahead
  loadWarn: 1.5, loadHigh: 2, // points in 4 weeks against the class
};

const worked = (d) => d.status === "work";

function longestStreak(model, pid, from, to) {
  let best = 0, run = 0, bestEnd = null;
  for (const date of range(from, to)) {
    const d = model.day(pid, date);
    run = worked(d) ? run + 1 : 0;
    if (run > best) { best = run; bestEnd = date; }
  }
  return { days: best, end: bestEnd };
}

function weekendsWorked(model, pid, today) {
  const lastSat = addDays(today, -((dow(today) + 1) % 7));
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const sat = addDays(lastSat, -7 * k);
    if (worked(model.day(pid, sat)) || (addDays(sat, 1) <= today && worked(model.day(pid, addDays(sat, 1))))) n++;
  }
  return n;
}

const heavyOf = (load) => load.items.filter((it) => it.key !== "stack" && it.key !== "nf" && it.pts >= 5);

export function burnoutWatch(model, today, { shared = {} } = {}) {
  const W = weightsOf(model);
  const from = addDays(today, -27), ahead = addDays(today, 14);
  const roster = Object.entries(rosterOf(model, academicYearOf(today))).filter(([pid, cls]) => CLASSES.includes(cls) && model.person(pid) && !model.person(pid).former);
  const rows = roster.map(([pid, cls]) => {
    const load = residentLoad(model, pid, from, today, W);
    const next = residentLoad(model, pid, addDays(today, 1), ahead, W);
    const logged = shared[pid] ? loggedSummary(shared[pid], today) : null;
    const useLogged = logged && !logged.stale && logged.avg4 !== null;
    const est = hoursReport(model, pid, addDays(today, -6), today).weeks.filter((w) => w.avg4 !== null).pop()?.avg4 ?? null;
    const flags = hoursReport(model, pid, from, ahead).flags.filter((f) => f.level === "gap" && f.date >= from);
    let off = 0, known = 0;
    for (const date of range(from, today)) {
      const d = model.day(pid, date);
      if (d.source !== "call") continue;
      known++;
      if (["off", "holiday", "vacation"].includes(d.status)) off++;
    }
    return {
      pid, cls, load, next, logged,
      hours: useLogged ? logged.avg4 : est, hoursLogged: !!useLogged,
      heavy: heavyOf(load), heavyNext: heavyOf(next), nights: load.counts.nf || 0,
      weekends: weekendsWorked(model, pid, today), off, known,
      streak: longestStreak(model, pid, from, ahead), flags,
    };
  });
  // Load against the class: this person's last 4 weeks of points over the class's middle.
  for (const cls of CLASSES) {
    const mine = rows.filter((r) => r.cls === cls && r.load.eligible >= 14);
    const avg = mine.length ? mine.reduce((s, r) => s + r.load.points, 0) / mine.length : 0;
    // Only when it's also a real amount: a Saturday 24's worth above the class.
    for (const r of rows.filter((x) => x.cls === cls)) {
      r.ratio = avg > 0 && r.load.eligible >= 14 && r.load.points - avg >= (W.sat24 || 10) ? r.load.points / avg : null;
    }
  }
  const T = WATCH;
  for (const r of rows) {
    const s = [];
    const add = (level, text) => s.push({ level, text });
    if (r.hours !== null && r.hours >= T.hoursWarn) add(r.hours >= T.hoursHigh ? "high" : "warn", `${round(r.hours)} h/wk over 4 weeks${r.hoursLogged ? ", logged" : ", estimated"}`);
    if (r.heavy.length >= T.heavyWarn) add(r.heavy.length >= T.heavyHigh ? "high" : "warn", `${r.heavy.length} heavy calls in 4 weeks`);
    if (r.weekends >= T.weekendsWarn) add(r.weekends === 4 ? "high" : "warn", `worked ${r.weekends} of the last 4 weekends`);
    if (r.known >= 21 && r.off <= T.offWarn) add(r.off < 4 ? "high" : "warn", `${r.off} days off in 4 weeks`);
    if (r.streak.days >= T.streakWarn) add(r.streak.days >= T.streakHigh ? "high" : "warn", `${r.streak.days} days in a row${r.streak.end > today ? " (scheduled)" : ""}`);
    if (r.ratio !== null && r.ratio >= T.loadWarn) add(r.ratio >= T.loadHigh ? "high" : "warn", `${r.ratio.toFixed(1)}× the class's load lately`);
    if (r.flags.length) add("high", `ACGME: ${r.flags[0].text}`);
    r.signals = s;
    r.score = s.reduce((n, x) => n + (x.level === "high" ? 2 : 1), 0);
    r.upcoming = r.heavyNext.map((it) => it.date);
  }
  return rows.sort((a, b) => b.score - a.score || (b.hours ?? 0) - (a.hours ?? 0));
}

// ---------- planning next month ----------

const groupOf = (rotation) => CODES[rotationCode(rotation)]?.group || null;

// The next month's call sheet, person by person: how much each should carry, and which kinds of
// shift each is due for or has had plenty of. Each month closes a third of the gap (or all of it
// in June), so the class evens out within a few months without anyone being swung hard.
export function planMonth(model, today, report, { shared = {}, watch = [] } = {}) {
  const month = addMonths(monthKey(today), 1);
  const ay = academicYearOf(`${month}-15`);
  const newYear = ay !== academicYearOf(today);
  const left = Math.max(1, 12 - ((Number(month.slice(5)) + 5) % 12)); // months to June, this one included
  const payback = Math.min(left, 3);
  const days = daysInMonth(month);
  const noCall = model.fairness?.noCallGroups || NO_CALL_GROUPS;
  const W = weightsOf(model);
  const watchBy = new Map(watch.map((w) => [w.pid, w]));
  const classes = [];
  for (const c of report.classes) {
    const compared = c.rows.filter((r) => r.eligible >= 14);
    const eligibleAll = compared.reduce((s, r) => s + r.eligible, 0);
    const perDay = Object.fromEntries(COLUMNS.map(([key, , keys]) => [key, eligibleAll ? compared.reduce((s, r) => s + columnCount(r, keys), 0) / eligibleAll : 0]));
    const rows = c.rows.filter((r) => model.person(r.pid) && !model.person(r.pid).former).map((r) => {
      const rotation = model.rotationFor(r.pid, month);
      const group = groupOf(rotation);
      const callable = !noCall.includes(group);
      const avg = callable ? c.rate * days : 0;
      const balance = newYear ? 0 : r.balance;
      const target = callable ? Math.max(0, avg - balance / payback) : 0;
      const due = [], plenty = [];
      if (!newYear && callable && r.eligible >= 14) {
        for (const [key, label, keys, unit] of COLUMNS) {
          if (!perDay[key]) continue;
          const diff = perDay[key] * r.eligible - columnCount(r, keys);
          const n = Math.round(diff / unit);
          if (diff >= unit * 0.75) due.push({ key, label, n });
          else if (diff <= -unit * 0.75) plenty.push({ key, label, n: -n });
        }
      }
      const w = watchBy.get(r.pid);
      return {
        pid: r.pid, cls: c.cls, rotation, group, callable, balance, load: r.load, avg, target, diff: target - avg,
        nudge: callable ? nudgeText(target - avg, W) : `No call on ${group || rotation}`,
        due, plenty, easy: w && w.score >= 2 ? w.signals.slice(0, 2).map((x) => x.text) : [],
        logged: shared[r.pid] ? loggedSummary(shared[r.pid], today) : null,
      };
    });
    rows.sort((a, b) => Number(b.callable) - Number(a.callable) || a.balance - b.balance);
    classes.push({ cls: c.cls, rows, perMonth: c.rate * days });
  }
  return { month, newYear, left, payback, classes };
}

// Points turned into shifts a chief can picture.
export function nudgeText(diff, W) {
  const abs = Math.abs(diff);
  const more = diff > 0 ? "more" : "fewer";
  if (abs < Math.max(2, W.late * 2)) return "About average";
  for (const [key, one, many] of [["sat24", "Saturday 24", "Saturday 24s"], ["fri24", "Friday 24", "Friday 24s"], ["late", "late day", "late days"]]) {
    const n = Math.round(abs / W[key]);
    if (W[key] > 0 && abs >= W[key] * 0.75 && n >= 1) return `About ${n} ${n === 1 ? one : many} ${more} than average`;
  }
  return diff > 0 ? "A little more than average" : "A little less than average";
}
