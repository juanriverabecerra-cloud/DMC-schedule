// Real occasions in a resident's year, read from their own schedule: the one line Today's day card
// says, and the milestones worth a little confetti. Plain functions of the model and a date (the
// browser side is public/js/delight.js), so the rules are tested without a phone.
import { academicYearOf, addDays, addMonths, diffDays, dow, isFixedHoliday, monthKey, parts, range, ymd } from "./dates.js";
import { goldenDays, weekendsFor } from "./daysoff.js";

const is24 = (d) => d.call === "H1" || d.call === "24";
const isCall = (d) => is24(d) || d.call === "H2"; // the calls people count: 24s and 12s
const anyShift = (d) => isCall(d) || d.call === "NF";
const RESIDENTS = ["CA-1", "CA-2", "CA-3"];

// Graduation is June 30 of the year someone finishes CA-3.
const YEARS_LEFT = { "CA-3": 0, "CA-2": 1, "CA-1": 2, "PGY-1": 3 };
export function graduationDay(cls, date) {
  return cls in YEARS_LEFT ? ymd(academicYearOf(date) + 1 + YEARS_LEFT[cls], 6, 30) : null;
}

// The Sundays the clocks change in the US: the second Sunday of March, the first of November.
export function dstSunday(year, season) {
  const first = season === "spring" ? ymd(year, 3, 1) : ymd(year, 11, 1);
  const sunday = addDays(first, (7 - dow(first)) % 7);
  return season === "spring" ? addDays(sunday, 7) : sunday;
}

// Whether the call sheets run to the end of this academic year, so "the last one" can be said.
const sheetsToJune = (model, date) => model.months.includes(`${academicYearOf(date) + 1}-06`);
const yearEnd = (date) => ymd(academicYearOf(date) + 1, 6, 30);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

// The class someone is in on a date: the month's call sheet says, after a July changeover.
export const classOn = (model, pid, date) => model.classAt?.(pid, monthKey(date)) || model.person(pid)?.cls;

// Today's line, if anything: { text, icon, gold?, confetti? (a key: confetti once) }. One line,
// the most important. `birthday` is "MM-DD" (kept on the phone only), `exams` from core/exams.js,
// `now` minutes after midnight.
export function occasion(model, pid, date, { now = 0, birthday = null, exams = [] } = {}) {
  const p = model.person(pid);
  if (!p) return null;
  const d = model.day(pid, date);
  const yesterday = model.day(pid, addDays(date, -1));
  const { y, m, d: dd } = parts(date);
  const ay = academicYearOf(date);
  const cls = classOn(model, pid, date);
  const first = p.preferred || p.first || "";
  const line = (text, icon = "sparkle", extra = {}) => ({ text, icon, ...extra });

  if (cls === "CA-3" && m === 6 && dd === 30) return line(`Last day of residency. Congratulations, Dr. ${p.last}.`, "sparkle", { gold: true, confetti: `grad:${pid}:${y}` });
  if (birthday && birthday === date.slice(5)) return line(`Happy birthday${first ? `, ${first}` : ""}.`, "sparkle", { confetti: `birthday:${pid}:${y}` });
  const exam = exams.find((e) => e.day === date);
  if (exam) return now < 12 * 60 + 30 ? line(`Good luck on the ${exam.name} today.`, "book") : line(`${exam.name} done. Go celebrate.`);
  if (m === 7 && dd === 1) {
    if (cls === "CA-1") return line("One year down. Welcome to anesthesia.", "sparkle", { confetti: `year1:${pid}:${y}` });
    if (cls === "CA-2") return line("Halfway through residency.", "sparkle", { confetti: `half:${pid}:${y}` });
    if (cls === "CA-3") return line("Final year. Make it count.");
    if (cls === "PGY-1") return line("Welcome to residency.");
    return line("Happy new academic year.");
  }
  if (m === 1 && dd === 1 && anyShift(d)) return line("Happy New Year. Someone has to keep them asleep.");
  if (dow(date) === 6 && is24(d)) {
    if (addDays(date, 1) === dstSunday(y, "fall")) return line("Clocks go back tonight: this call is 25 hours.", "clock");
    if (addDays(date, 1) === dstSunday(y, "spring")) return line("Clocks go forward tonight: this call is 23 hours.", "clock");
  }
  if (is24(d) && !range(`${ay}-07-01`, addDays(date, -1)).some((x) => is24(model.day(pid, x)))) return line("First 24 of the year tonight. You've got this.");
  if (cls === "CA-3" && anyShift(d) && sheetsToJune(model, date) && !range(addDays(date, 1), yearEnd(date)).some((x) => anyShift(model.day(pid, x)))) {
    return line("Last call of residency.", "sparkle", { confetti: `lastcall:${pid}:${y}` });
  }
  if (d.status === "holiday" || (isFixedHoliday(date) && d.status === "off")) return line("Enjoy the day. The CRNAs have it.");
  if (m === 3 && dd === 30) return line("Happy Doctors' Day.");
  if (m === 10 && dd === 16) return line(`Happy Ether Day: ${y - 1846} years of anesthesia.`);
  if (dow(date) === 5 && goldenDays(model, pid, addDays(date, 1), addDays(date, 2)).has(addDays(date, 1))) {
    const again = goldenDays(model, pid, addDays(date, -6), addDays(date, -5)).has(addDays(date, -6));
    const text = yesterday.call === "NF" ? "Nights done. Your golden weekend starts now."
      : again ? "Second golden weekend in a row. Enjoy it." : d.status === "work" ? "Golden weekend starts after work." : "Your golden weekend starts now.";
    return line(text, "sparkle", { gold: true });
  }
  if (d.status === "work") {
    // The next (or last) day that isn't a plain day off, within a long weekend's reach.
    const near = (step) => { for (let i = 1; i <= 4; i++) { const x = model.day(pid, addDays(date, i * step)); if (x.status !== "off") return x; } return null; };
    if (near(1)?.status === "vacation") return line("Last day before vacation. Enjoy it.");
    if (near(-1)?.status === "vacation") return line("Welcome back.");
    const rot = model.rotationFor(pid, monthKey(date));
    const before = model.rotationFor(pid, addMonths(monthKey(date), -1));
    const firstWorkday = range(`${monthKey(date)}-01`, addDays(date, -1)).every((x) => model.day(pid, x).status !== "work");
    if (rot && before && rot !== before && firstWorkday) return line(`First day of ${rot}.`);
  }
  if (yesterday.call === "NF" && d.call !== "NF") {
    const lastOfYear = sheetsToJune(model, date) && !range(date, yearEnd(date)).some((x) => model.day(pid, x).call === "NF");
    return lastOfYear ? line("Last nights of the year done. Sleep well.", "moon", { confetti: `lastnights:${pid}:${ay}` }) : line("Nights done. Sleep well.", "moon");
  }
  const soon = exams.find((e) => e.days === 100);
  if (soon) return line(`100 days to the ${soon.name}.`, "book");
  if (cls === "CA-3") {
    const left = diffDays(date, yearEnd(date));
    if (left === 100) return line("100 days to graduation.");
    if (left === 30) return line("30 days to graduation.");
    if (left === 7) return line("One week to graduation.", "sparkle", { confetti: `grad7:${pid}:${y}` });
  }
  if (d.status === "postcall") return line("Post-call: go home and sleep.", "moon");
  return null;
}

// Milestones from the schedule on a date: { key, text, gold? }. The app celebrates each key once.
export function dayMilestones(model, pid, date) {
  const out = [];
  const ay = academicYearOf(date);
  const from = `${ay}-07-01`;
  if (RESIDENTS.includes(classOn(model, pid, date))) {
    const golden = weekendsFor(model, pid, from, date).filter((w) => w.golden && w.sat <= date);
    const n = golden.length;
    const w = golden[n - 1];
    if ((n === 5 || n === 10) && (w.sat === date || w.sun === date)) out.push({ key: `golden${n}:${pid}:${ay}`, text: `Your ${ordinal(n)} golden weekend this year.`, gold: true });
  }
  if (isCall(model.day(pid, date))) {
    const n = range(from, date).filter((x) => isCall(model.day(pid, x))).length;
    if (n === 25 || n === 50) out.push({ key: `calls${n}:${pid}:${ay}`, text: `Call number ${n} this year.` });
  }
  return out;
}

// ---- ACGME's numbers (the Log cases button brings them back) ----
// What's new since the last look: `seen` and `now` are { totals: {name: n}, lines: [{ name,
// minimum, total }], count, waiting }. The first look is only a starting line, so nothing reached
// before is celebrated after the fact. Returns { said: [texts], quiet, gold, key } or null.
const CASE_COUNTS = [100, 250, 500, 750, 1000, 1250, 1500, 2000];
const caseWord = (name) => {
  const age = name.match(/^[a-c]\.\s*<\s*(.+)$/i);
  return age ? `case under ${age[1].toLowerCase()}` : name;
};
export function acgmeNews(seen, now) {
  if (!seen) return null;
  const said = [];
  const keys = [];
  let loud = false;
  const lines = now.lines || [];
  const met = (l) => l.total >= l.minimum;
  const was = (name) => seen.totals?.[name];
  // Minimums met since last time (only once there was a report to compare with).
  const fresh = seen.totals ? lines.filter((l) => met(l) && was(l.name) !== undefined && was(l.name) < l.minimum) : [];
  if (fresh.length && lines.every(met)) { said.push("Every ACGME minimum met"); loud = true; }
  else if (fresh.length === 1) { said.push(`${fresh[0].name} minimum met · ${fresh[0].total} of ${fresh[0].minimum}`); loud = true; }
  else if (fresh.length > 1) { said.push(`${fresh.length} ACGME minimums met`); loud = true; }
  keys.push(...fresh.map((l) => `met:${l.name}`));
  // A first case in a category ACGME counts.
  const firsts = seen.totals ? Object.entries(now.totals || {}).filter(([name, n]) => n >= 1 && was(name) === 0).map(([name]) => name) : [];
  if (firsts.length === 1) { said.push(`First ${caseWord(firsts[0])} in ACGME`); loud = true; }
  else if (firsts.length > 1) { said.push(`Firsts in ${firsts.length} ACGME categories`); loud = true; }
  keys.push(...firsts.map((n) => `first:${n}`));
  // Halfway to a minimum: a quiet note, no confetti.
  const half = seen.totals ? lines.filter((l) => !met(l) && was(l.name) !== undefined && was(l.name) < l.minimum / 2 && l.total >= l.minimum / 2) : [];
  if (half.length) said.push(`Halfway to the ${half[0].name} minimum · ${half[0].total} of ${half[0].minimum}`);
  keys.push(...half.map((l) => `half:${l.name}`));
  // ACGME's own case count passing a round number.
  const crossed = now.count != null && seen.count != null ? CASE_COUNTS.filter((n) => seen.count < n && now.count >= n) : [];
  if (crossed.length) { said.push(`${crossed.at(-1).toLocaleString("en-US")} cases in ACGME`); loud = true; keys.push(`count:${crossed.at(-1)}`); }
  // Caught up after falling behind (ten or more waiting at some point).
  if (now.waiting === 0 && (seen.peak || 0) >= 10) { said.push("All caught up with ACGME"); loud = true; keys.push(`caughtup:${seen.peak}`); }
  if (!said.length) return null;
  return { said, quiet: !loud, gold: lines.length > 0 && fresh.length > 0 && lines.every(met), key: keys.join("|") };
}

// What to remember for next time: every count by name (lines and the codes under them).
export function acgmeSnapshot(minimums, count, waiting, seen) {
  const totals = {};
  for (const l of minimums?.lines || []) {
    totals[l.name] = l.total;
    for (const part of l.parts || []) totals[part.name] = part.total;
  }
  const peak = waiting === 0 ? 0 : Math.max(seen?.peak || 0, waiting);
  return { totals: minimums?.lines?.length ? totals : seen?.totals || null, count: count ?? seen?.count ?? null, peak };
}
