// Duty-hour ESTIMATES from scheduled shift times, checked against the ACGME requirements for
// anesthesiology (2025, sections 6.20-6.28). "must" limits:
//   6.20    80 h/week averaged over 4 weeks (the anesthesiology committee allows no exceptions)
//   6.21.a  14 h free after 24 h of in-house call
//   6.21.b  1 day in 7 free averaged over 4 weeks; a day off is 24 continuous hours
//   6.22    24 h of continuous work, plus up to 4 h for transitions
//   6.27    in-house call no more often than every third night, averaged over 4 weeks
// and one "should": 6.21, 8 h off between work periods.
import { addDays, toUTC, startOfWeek, range } from "./dates.js";

const DAY = 1440;

// `actual` (core/logged.js) swaps in logged shifts for dates someone recorded, and their own
// averages for the days after that. Inside the logged dates, a day with no entry wasn't worked.
export function intervals(model, pid, from, to, actual = null) {
  const raw = [];
  for (const date of range(addDays(from, -2), to)) {
    const base = toUTC(date) / 60000;
    if (actual && date >= actual.first && date <= actual.last) {
      for (const e of actual.byDate[date] || []) raw.push({ start: base + e.start, end: toUTC(e.endDate) / 60000 + e.end, kinds: ["logged"], dates: [date] });
      continue;
    }
    const d = model.day(pid, date);
    const avg = actual && date > actual.last && d.shifts.length === 1 ? actual.expected(d) : null;
    for (const s of d.shifts) raw.push({ start: base + s.start, end: base + (avg ? s.start + avg * 60 : s.end), kinds: [s.kind], dates: [date] });
  }
  raw.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
      last.kinds.push(...iv.kinds);
      last.dates.push(...iv.dates);
    } else merged.push({ ...iv, kinds: [...iv.kinds], dates: [...iv.dates] });
  }
  return merged;
}

function overlap(iv, a, b) {
  return Math.max(0, Math.min(iv.end, b) - Math.max(iv.start, a));
}

// Whole 24-hour stretches with no work between two moments.
function freeDays(ivs, a, b) {
  let n = 0, cursor = a;
  for (const iv of ivs) {
    if (iv.end <= a) continue;
    if (iv.start >= b) break;
    n += Math.floor(Math.max(0, iv.start - cursor) / DAY);
    cursor = Math.max(cursor, iv.end);
  }
  return n + Math.floor(Math.max(0, b - cursor) / DAY);
}

// Weekly summary (Sunday-Saturday) for every week touching [from, to].
export function hoursReport(model, pid, from, to, { actual = null } = {}) {
  const firstWeek = startOfWeek(addDays(from, -21)); // three earlier weeks feed the 4-week average
  const lastDay = addDays(startOfWeek(to), 6);
  const ivs = intervals(model, pid, firstWeek, lastDay, actual);
  const weeks = [];
  for (let ws = firstWeek; ws <= lastDay; ws = addDays(ws, 7)) {
    const a = toUTC(ws) / 60000, b = a + 7 * DAY;
    const minutes = ivs.reduce((s, iv) => s + overlap(iv, a, b), 0);
    let daysOff = 0, known = true, away = 0, calls = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      const d = model.day(pid, date);
      const logged = actual && date >= actual.first && date <= actual.last;
      if (d.source !== "call" && !logged) known = false; // a logged day needs no call sheet
      if (d.status === "vacation" || (logged && actual.away.has(date))) away++;
      if (d.call === "H1" || d.call === "24") calls++;
      const da = a + i * DAY;
      if (!ivs.some((iv) => overlap(iv, da, da + DAY) > 0)) daysOff++;
    }
    weeks.push({ start: ws, end: addDays(ws, 6), hours: minutes / 60, daysOff, known, away, calls });
  }
  for (let i = 0; i < weeks.length; i++) {
    const window = weeks.slice(Math.max(0, i - 3), i + 1);
    const full = window.length === 4 && window.every((w) => w.known);
    // Vacation days are left out of the average, so a week away can't hide three heavy ones.
    const present = 28 - window.reduce((s, w) => s + w.away, 0);
    weeks[i].avg4 = full && present >= 7 ? window.reduce((s, w) => s + w.hours, 0) / (present / 7) : null;
    weeks[i].daysOff4 = full ? freeDays(ivs, toUTC(window[0].start) / 60000, toUTC(window[3].end) / 60000 + DAY) : null;
    weeks[i].calls4 = full ? window.reduce((s, w) => s + w.calls, 0) : null;
  }

  const flags = [];
  const inRange = (date) => date >= from && date <= lastDay;
  for (const w of weeks) {
    if (!w.known || !inRange(w.end)) continue;
    if (w.hours > 80) flags.push({ level: "warn", rule: "week", date: w.start, text: `About ${Math.round(w.hours)} h scheduled the week of ${w.start.slice(5)}; the limit is the 4-week average` });
    if (w.avg4 !== null && w.avg4 > 80) flags.push({ level: "gap", rule: "6.20", date: w.start, text: `4-week average about ${Math.round(w.avg4)} h ending ${w.end.slice(5)} (limit 80)` });
    if (w.daysOff4 !== null && w.daysOff4 < 4) flags.push({ level: "gap", rule: "6.21.b", date: w.start, text: `Only ${w.daysOff4} days off in the 4 weeks ending ${w.end.slice(5)} (need 4)` });
    if (w.calls4 !== null && w.calls4 > 9) flags.push({ level: "gap", rule: "6.27", date: w.start, text: `${w.calls4} in-house calls in the 4 weeks ending ${w.end.slice(5)} (every third night allows 9)` });
  }
  for (const date of range(from, lastDay)) {
    const d = model.day(pid, date);
    if (d.afterCall) flags.push({ level: "warn", rule: "postcall", date, text: `Listed for ${d.afterCall} on ${date.slice(5)}, the morning after a 24-h call` });
  }
  let nights = 0, nightStart = null;
  for (let i = 0; i < ivs.length; i++) {
    const iv = ivs[i];
    const len = (iv.end - iv.start) / 60;
    const date = iv.dates[0];
    if (!inRange(date)) continue;
    if (len > 28) flags.push({ level: "gap", rule: "6.22", date, text: `Continuous duty of about ${Math.round(len)} h starting ${date.slice(5)} (limit 24 + 4)` });
    const next = ivs[i + 1];
    if (next) {
      const gap = (next.start - iv.end) / 60;
      if (len >= 24 && gap < 14) flags.push({ level: "gap", rule: "6.21.a", date: next.dates[0], text: `Only ${Math.round(gap)} h off after 24-h call before ${next.dates[0].slice(5)} (need 14)` });
      else if (gap < 8) flags.push({ level: "warn", rule: "6.21", date: next.dates[0], text: `Only ${Math.round(gap)} h off before the shift on ${next.dates[0].slice(5)} (should be 8)` });
    }
    if (iv.kinds.includes("night")) {
      nights = nightStart && (iv.start - ivs[i - 1]?.start) <= DAY + 60 ? nights + 1 : 1;
      if (nights === 1) nightStart = date;
      if (nights === 7) flags.push({ level: "info", date: nightStart, text: `More than 6 nights in a row starting ${nightStart.slice(5)}` });
    } else { nights = 0; nightStart = null; }
  }
  return { weeks: weeks.filter((w) => w.end >= from && w.start <= to), flags, intervals: ivs };
}

export function weekHours(model, pid, date, opts) {
  const ws = startOfWeek(date);
  const rep = hoursReport(model, pid, ws, addDays(ws, 6), opts);
  return rep.weeks.find((w) => w.start === ws) || null;
}
