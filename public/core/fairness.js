// Workload fairness. Every shift earns burden points (how heavy it feels, not just its hours),
// each resident is compared with their own class, and the result guides call swaps and sick
// coverage. This is a tool for the people making the schedule: it suggests, they decide.
import { addDays, addMonths, academicYearOf, dow, monthDates, monthKey, range, diffDays } from "./dates.js";
import { hoursReport, weekHours } from "./hours.js";
import { CODES, CALL_CODES } from "./codes.js";

// Scale: one late day = 1 point. Editable in Admin › Fairness.
// The weekly pattern: 24-hr call (H1, or blue on a Friday) only on Friday and Saturday, 12-hr
// call (H2) only on Saturday and Sunday, and night float Sunday to Thursday nights. Friday's 24
// covers Friday night and Saturday's covers Saturday night. Holiday weekends shift this, so a 24
// on any other day counts as a weekend 24 and a 12 on a weekday counts as a Sunday.
export const WEIGHT_ROWS = [
  ["sat24", "24-hr call, Saturday", 10, "A whole weekend day and the night; Sunday is lost post-call. A 24 on a holiday counts here too"],
  ["fri24", "24-hr call, Friday", 6, "Covers Friday night, since night float doesn't; Saturday is lost post-call"],
  ["h2sun", "12-hr call, Sunday", 6, "A full weekend day, then work Monday. A 12 on a holiday counts here too"],
  ["h2sat", "12-hr call, Saturday", 5, "A full weekend day"],
  ["nf", "Night float, per night (Sun–Thu)", 2.5, "A 5-night week is 12.5: hours match a day week, but nights wear you down"],
  ["seniorWe", "CA-3 10a–7p, weekend day", 4, "A weekend day worked"],
  ["senior", "CA-3 10a–7p, weekday", 1, "Late finish"],
  ["cardiacWe", "Cardiac home call, weekend day", 1.5, "Tied to your phone on your days off"],
  ["cardiac", "Cardiac home call, weekday", 0.5, "On call after a normal day"],
  ["lateFri", "Late day, Friday", 2, "Runs into the weekend: it starts later and you start it tired"],
  ["late", "Late day, Mon–Thu (until 6p)", 1, "The baseline for the scale"],
  ["breaks", "Giving breaks", -1, "A lighter day: two rooms, usually done by 2–3p. Negative points take load off"],
  ["stack", "Heavy shifts within 6 days", 2, "Extra points when one heavy shift follows another: recovery matters"],
];
export const DEFAULT_WEIGHTS = Object.fromEntries(WEIGHT_ROWS.map(([k, , v]) => [k, v]));

// Table columns: shift types added together for easy reading.
export const COLUMNS = [
  ["sat24", "Sat 24", ["sat24"], 1],
  ["fri24", "Fri 24", ["fri24"], 1],
  ["h2", "12-hr", ["h2sat", "h2sun"], 1],
  ["nf", "Nights", ["nf"], 5],
  ["late", "Late", ["late", "lateFri"], 2],
  ["senior", "10–7", ["senior", "seniorWe"], 7],
  ["cardiac", "Cardiac", ["cardiac", "cardiacWe"], 7],
  ["breaks", "Breaks", ["breaks"], 2],
];

// Rotations that take no call (confirmed by the program's residents).
export const NO_CALL_GROUPS = ["Obstetrics", "Pediatrics", "9-ICU", "Sinai-Grace ICU"];
const HEAVY = 5;
const MIN_DAYS = 14; // too little time in the period to compare fairly

export const weightsOf = (model) => ({ ...DEFAULT_WEIGHTS, ...(model.fairness?.weights || {}) });
const noCallGroups = (model) => model.fairness?.noCallGroups || NO_CALL_GROUPS;

// Who was in each class in an academic year: the program's annual rotations file, or the call
// sheets when that year's file wasn't uploaded. Balances reset each year, so years never mix.
export function rosterOf(model, ay) {
  const listed = model.ds.rosters?.[ay];
  if (listed && Object.keys(listed).length) return Object.fromEntries(Object.entries(listed).filter(([pid]) => !model.person(pid)?.hidden));
  const out = {};
  for (const m of model.months) {
    if (academicYearOf(`${m}-15`) !== ay) continue;
    for (const [pid, r] of Object.entries(model.ds.months[m].rows)) {
      if (!model.person(pid)?.hidden) out[pid] ||= r.cls || model.person(pid)?.cls;
    }
  }
  return out;
}
const rotationGroup = (d) => CODES[d.rotationCode]?.group || d.group || null;
export const isNoCallRotation = (model, d) => noCallGroups(model).includes(rotationGroup(d));

// What a resident-day is worth. Returns [{ key, pts }].
export function dayItems(d, W) {
  const items = [];
  const add = (key) => items.push({ key, pts: W[key] ?? 0 });
  if (d.status === "work") {
    if (d.call === "H1" || d.call === "24") add(d.dow === 5 ? "fri24" : "sat24");
    else if (d.call === "H2") add(d.dow === 6 ? "h2sat" : "h2sun");
    else if (d.call === "NF") add("nf");
    else if (d.call === "10-7") add(d.weekend ? "seniorWe" : "senior");
    if (d.late) add(d.dow === 5 ? "lateFri" : "late");
    // Everyone pulled for breaks is counted; only a day spent on breaks earns the lighter score.
    if (d.roles?.some((r) => r.kind === "breaks")) items.push({ key: "breaks", pts: d.breaksDay ? W.breaks ?? 0 : 0 });
  }
  if (d.cardiac) add(d.weekend ? "cardiacWe" : "cardiac");
  return items;
}

// Days in the period that have a call sheet.
function scheduledDates(model, from, to) {
  return range(from, to).filter((date) => model.hasCall(date));
}

// One resident's load over a period.
export function residentLoad(model, pid, from, to, W = weightsOf(model)) {
  const counts = {};
  const items = [];
  let eligible = 0, weekendDays = 0, vacation = 0, noCallDays = 0;
  for (const date of scheduledDates(model, from, to)) {
    const d = model.day(pid, date);
    if (d.source !== "call") continue;
    if (d.status === "vacation") vacation++;
    if (d.status === "work" && d.weekend) weekendDays++;
    const away = d.status === "vacation" || d.status === "holiday" || isNoCallRotation(model, d);
    if (!away) eligible++;
    if (isNoCallRotation(model, d)) noCallDays++;
    for (const it of dayItems(d, W)) {
      counts[it.key] = (counts[it.key] || 0) + 1;
      items.push({ ...it, date });
    }
  }
  // Heavy shifts close together: a block of nights counts as one, ending on its last night.
  const blocks = [];
  for (const it of items) {
    if (it.key !== "nf" && it.pts < HEAVY) continue;
    const last = blocks[blocks.length - 1];
    if (last?.key === "nf" && it.key === "nf" && diffDays(last.end, it.date) <= 1) last.end = it.date;
    else blocks.push({ key: it.key, start: it.date, end: it.date });
  }
  for (let i = 1; i < blocks.length; i++) {
    if (diffDays(blocks[i - 1].end, blocks[i].start) <= 6) {
      counts.stack = (counts.stack || 0) + 1;
      items.push({ key: "stack", pts: W.stack ?? 0, date: blocks[i].start });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  const points = items.reduce((s, it) => s + it.pts, 0);

  // Heaviest stretch: the most points in any 14 days.
  let peak = 0, peakFrom = null;
  for (const it of items) {
    const end = addDays(it.date, 13);
    const sum = items.filter((x) => x.date >= it.date && x.date <= end).reduce((s, x) => s + x.pts, 0);
    if (sum > peak) { peak = sum; peakFrom = it.date; }
  }
  const weeks = hoursReport(model, pid, from, to).weeks.filter((w) => w.known && w.start >= addDays(from, -6) && w.end <= addDays(to, 6));
  const hoursAvg = weeks.length ? weeks.reduce((s, w) => s + w.hours, 0) / weeks.length : null;
  const hoursMax = weeks.length ? Math.max(...weeks.map((w) => w.hours)) : null;
  return { pid, counts, items, points, eligible, noCallDays, weekendDays, vacation, peak, peakFrom, hoursAvg, hoursMax };
}

export const columnCount = (row, keys) => keys.reduce((s, k) => s + (row.counts[k] || 0), 0);

// A letter for how evenly a class shares the work, from the spread of its load index.
export function gradeOf(cv) {
  if (cv == null) return "—";
  return cv <= 0.1 ? "A" : cv <= 0.2 ? "B" : cv <= 0.3 ? "C" : cv <= 0.45 ? "D" : "F";
}
const GRADE_POINTS = { A: 4, B: 3, C: 2, D: 1, F: 0 };
const fromPoints = (n) => (n >= 3.5 ? "A" : n >= 2.5 ? "B" : n >= 1.5 ? "C" : n >= 0.5 ? "D" : "F");

function spreadGrade(spread, unit) {
  const u = spread / unit;
  return u <= 1 ? "A" : u <= 2 ? "B" : u <= 3 ? "C" : u <= 4 ? "D" : "F";
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

// The whole program over a period, class by class. "Fair share" is what a resident would have
// if the class's points were spread evenly over the days each one could actually take call,
// so vacation and no-call rotations don't count against anyone.
export function fairnessReport(model, { from, to } = {}) {
  const W = weightsOf(model);
  const classes = [];
  const roster = Object.entries(rosterOf(model, academicYearOf(from)));
  for (const cls of ["CA-1", "CA-2", "CA-3"]) {
    const rows = roster.filter(([, c]) => c === cls).map(([pid]) => residentLoad(model, pid, from, to, W)).filter((r) => r.eligible + r.noCallDays > 0);
    if (!rows.length) continue;
    const total = rows.reduce((s, r) => s + r.points, 0);
    const days = rows.reduce((s, r) => s + r.eligible, 0);
    const rate = days ? total / days : 0;
    for (const r of rows) {
      r.fairShare = rate * r.eligible;
      r.balance = r.points - r.fairShare;
      r.load = r.fairShare > 0 ? (r.points / r.fairShare) * 100 : null;
    }
    const compared = rows.filter((r) => r.eligible >= MIN_DAYS && r.load != null);
    const cv = compared.length > 1 && mean(compared.map((r) => r.load)) ? sd(compared.map((r) => r.load)) / mean(compared.map((r) => r.load)) : null;
    const columns = COLUMNS.map(([key, label, keys, unit]) => {
      const vals = compared.map((r) => columnCount(r, keys));
      const used = vals.some((v) => v > 0);
      const min = used ? Math.min(...vals) : 0, max = used ? Math.max(...vals) : 0;
      return { key, label, keys, unit, min, max, avg: used ? mean(vals) : 0, used, grade: used ? spreadGrade(max - min, unit) : "—" };
    });
    rows.sort((a, b) => b.balance - a.balance);
    classes.push({ cls, rows, total, rate, cv, grade: gradeOf(cv), columns, rate28: rate * 28 });
  }
  const graded = classes.filter((c) => c.grade !== "—");
  const overall = graded.length ? fromPoints(mean(graded.map((c) => GRADE_POINTS[c.grade]))) : "—";
  return { from, to, classes, overall, W };
}

// Academic years with at least one call sheet, newest first.
export function academicYears(model) {
  return [...new Set(model.months.map((m) => academicYearOf(`${m}-15`)))].sort((a, b) => b - a);
}
export const yearLabel = (ay) => `${ay}–${String(ay + 1).slice(2)}`;

// Months of an academic year up to today: which have a call sheet and which don't.
export function academicMonths(model, today, ay = academicYearOf(today)) {
  const end = [`${ay + 1}-06`, monthKey(today)].sort()[0];
  const out = [];
  for (let m = `${ay}-07`; m <= end; m = addMonths(m, 1)) out.push({ month: m, loaded: model.months.includes(m) });
  return out;
}

export function yearRange(model, today, ay = academicYearOf(today)) {
  const months = academicMonths(model, today, ay);
  const inYear = model.months.filter((m) => m >= `${ay}-07` && m <= `${ay + 1}-06`);
  const dates = monthDates(inYear[inYear.length - 1] || months[months.length - 1].month);
  return { from: `${ay}-07-01`, to: dates[dates.length - 1] };
}

// One line per academic year, for comparing them side by side.
export function yearsSummary(model, today) {
  return academicYears(model).map((ay) => {
    const rep = fairnessReport(model, yearRange(model, today, ay));
    const row = { ay, label: yearLabel(ay), overall: rep.overall, classes: rep.classes.map((c) => ({ cls: c.cls, grade: c.grade, rate28: c.rate28 })), months: academicMonths(model, today, ay).filter((m) => m.loaded).length };
    return row;
  });
}

// A past year stopped at the same point in the year as today, so a part-year can be read
// fairly: grades climb as a year fills in.
export function samePointLastYear(model, today) {
  const ay = academicYearOf(today);
  const to = yearRange(model, today, ay).to;
  const last = model.months.includes(`${Number(to.slice(0, 4)) - 1}-${to.slice(5, 7)}`) ? `${Number(to.slice(0, 4)) - 1}${to.slice(4)}` : null;
  if (!last) return null;
  const rep = fairnessReport(model, { from: `${ay - 1}-07-01`, to: last });
  const final = fairnessReport(model, yearRange(model, today, ay - 1)).overall;
  return { label: `${yearLabel(ay - 1)} at this point`, overall: rep.overall, final, classes: rep.classes.map((c) => ({ cls: c.cls, grade: c.grade, rate28: c.rate28 })), months: (Number(to.slice(5, 7)) + 5) % 12 + 1 };
}

// ---------- coverage: who could take a shift ----------

const SHIFT_LABEL = { sat24: "Weekend 24-hr call", fri24: "Friday 24-hr call", h2sat: "Saturday 12-hr call", h2sun: "Weekend 12-hr call", nf: "Night float", senior: "CA-3 10a–7p", seniorWe: "CA-3 10a–7p", late: "Late" };

// The shift someone holds that day, or their regular day.
export function shiftOf(d, W) {
  const it = dayItems(d, W).find((x) => SHIFT_LABEL[x.key]);
  if (it) {
    const c = d.call && d.call !== "24" ? CALL_CODES[d.call] : null;
    const span = d.late && !d.call ? 12 : c ? (c.end - c.start) / 60 : 24;
    return { key: it.key, label: SHIFT_LABEL[it.key], pts: it.pts, hours: span };
  }
  if (d.status === "work") return { key: "regular", label: d.label || "Regular day", pts: 0, hours: 0 };
  return null;
}

const isBackup = (d) => d.rotationCode === "ELECT-J" || /jeopardy/i.test(d.rotation || "");

// A copy of the schedule with this resident also working those hours. A 24 leaves them
// post-call the next day, so that day's regular work comes off.
function withShift(model, pid, date, source) {
  const next = addDays(date, 1);
  const is24 = source.call === "H1" || source.call === "24";
  return {
    ...model,
    day(p, dt) {
      const d = model.day(p, dt);
      if (p !== pid) return d;
      if (dt === date) return { ...d, status: "work", call: source.call, late: source.late, shifts: source.shifts };
      if (is24 && dt === next && !d.call) return { ...d, status: "postcall", shifts: [] };
      return d;
    },
  };
}

// What taking this shift would break: ACGME "must" limits block it, the rest are warnings.
function limitCheck(model, pid, date, source) {
  const from = addDays(date, -28), to = addDays(date, 28);
  const seen = new Set(hoursReport(model, pid, from, to).flags.map((f) => f.text));
  const sim = withShift(model, pid, date, source);
  const fresh = hoursReport(sim, pid, from, to).flags.filter((f) => !seen.has(f.text));
  return { blocks: fresh.filter((f) => f.level === "gap"), notes: fresh.filter((f) => f.level === "warn"), week: weekHours(sim, pid, date) };
}

// Why this resident can't take the shift, or null.
function blockedBy(model, d, shift) {
  const prev = model.day(d.pid, addDays(d.date, -1));
  const next = model.day(d.pid, addDays(d.date, 1));
  if (d.source !== "call") return "No schedule this month";
  if (d.status === "vacation") return "On vacation";
  if (d.status === "postcall") return d.label;
  if (d.noCall) return "Marked no call";
  if (d.call) return `Already on ${SHIFT_LABEL[dayItems(d, weightsOf(model)).find((x) => SHIFT_LABEL[x.key])?.key] || d.call}`;
  if (d.late && shift.key !== "regular") return "Already late that day";
  if (prev.call === "NF") return "Coming off night float";
  if (next.call === "NF" && shift.key !== "nf") return "Starts night float the next day";
  if (prev.call === "H1" || prev.call === "24") return "Post-call";
  if (isNoCallRotation(model, d) && shift.key !== "regular") return `${rotationGroup(d)} takes no call`;
  return null;
}

// Ranked options to cover a resident's shift. Coverage stays within the class, except the
// jeopardy resident, who is always first for a sick call. After that, fewest warnings, then
// whoever is furthest under their fair share. Everyone left out is listed with the reason.
export function coverOptions(model, pid, date, { allClasses = false, report } = {}) {
  const W = weightsOf(model);
  const d = model.day(pid, date);
  const shift = shiftOf(d, W);
  if (!shift) return { shift: null, options: [], blocked: [] };
  const me = model.person(pid);
  const rep = report || fairnessReport(model, yearRange(model, date));
  const load = new Map(rep.classes.flatMap((c) => c.rows.map((r) => [r.pid, r])));
  const options = [], blocked = [];
  for (const p of model.people) {
    if (p.id === pid || p.cls === "PGY-1") continue;
    const c = model.day(p.id, date);
    const backup = isBackup(c);
    if (!allClasses && !backup && p.cls !== me.cls) continue;
    let why = blockedBy(model, c, shift);
    // On a weekend the shift needs someone who is off; a regular day needs someone working.
    if (!why && d.weekend && c.status !== "off") why = c.label || "Working";
    const limits = why ? null : limitCheck(model, p.id, date, d);
    if (limits?.blocks.length) why = `ACGME: ${limits.blocks[0].text}`;
    if (why) { blocked.push({ pid: p.id, why, backup }); continue; }
    const cautions = limits.notes.map((f) => f.text);
    const next = model.day(p.id, addDays(date, 1));
    const prev = model.day(p.id, addDays(date, -1));
    if (next.call === "H1" || next.call === "24") cautions.push("24-hr call the next day");
    if (["H1", "24", "H2"].includes(prev.call)) cautions.push("On call the day before");
    if ((d.call === "H1" || d.call === "24") && next.status === "work" && !next.call) cautions.push("Post-call the next day: that day needs covering");
    if (shift.key === "nf" && c.status === "work") cautions.push("Their days need covering");
    if (shift.key === "regular" && !backup && c.status === "work") cautions.push(`Leaves ${rotationGroup(c) || "their service"} short`);
    const r = load.get(p.id);
    options.push({ pid: p.id, cls: p.cls, status: c.label, balance: r?.balance ?? 0, load: r?.load ?? null, projected: Math.round(limits.week?.hours || 0), backup, cautions, after: (r?.balance ?? 0) + shift.pts });
  }
  options.sort((a, b) => Number(b.backup) - Number(a.backup) || a.cautions.length - b.cautions.length || a.balance - b.balance);
  blocked.sort((a, b) => Number(!!b.backup) - Number(!!a.backup));
  return { shift, options, blocked };
}

// Upcoming shifts that could move from someone over their fair share to someone under it,
// largest improvement first. One suggestion per shift.
export function suggestMoves(model, today, { report, limit = 8 } = {}) {
  const rep = report || fairnessReport(model, yearRange(model, today));
  const out = [];
  const last = rep.to;
  for (const c of rep.classes) {
    const byId = new Map(c.rows.map((r) => [r.pid, r]));
    for (const r of c.rows) {
      if (r.balance <= 0) continue;
      for (const it of r.items) {
        if (it.date < today || it.date > last || !SHIFT_LABEL[it.key] || it.key === "nf" || it.key.startsWith("senior")) continue;
        const { shift, options } = coverOptions(model, r.pid, it.date, { report: rep });
        const best = options.find((o) => o.cls === c.cls && !o.cautions.length && o.balance < 0);
        if (!shift || !best) continue;
        const a = r.balance, b = byId.get(best.pid)?.balance ?? best.balance;
        const gain = a ** 2 + b ** 2 - (a - shift.pts) ** 2 - (b + shift.pts) ** 2;
        if (gain <= 0) continue;
        out.push({ date: it.date, cls: c.cls, shift, from: r.pid, to: best.pid, fromBalance: a, toBalance: b, gain });
      }
    }
  }
  // Spread the suggestions: nobody should appear as the answer to every swap.
  const seen = new Map();
  const count = (id) => { seen.set(id, (seen.get(id) || 0) + 1); return seen.get(id); };
  return out.sort((a, b) => b.gain - a.gain).filter((m) => {
    const ok = (seen.get(m.to) || 0) < 2 && (seen.get(m.from) || 0) < 2;
    if (ok) { count(m.to); count(m.from); }
    return ok;
  }).slice(0, limit);
}

// ---------- services: who's assigned against who's actually there ----------

const CLASSES = ["CA-1", "CA-2", "CA-3"];

// For each service and class: the plan, who's assigned that month, and the weekdays it ran
// short because someone was on vacation or nights. `need` is the minimum an admin typed in
// when there is one, otherwise the plan, capped at the number assigned (the plan sheet counts
// the NORA resident under Thoracic, so a planned seat with nobody assigned isn't a gap).
export function serviceCoverage(model, month) {
  if (!model.months.includes(month)) return { services: [], weekdays: 0 };
  const plan = model.ds.siteTotals?.[month] || {};
  const mins = model.fairness?.minimums || {};
  const roster = rosterOf(model, academicYearOf(`${month}-15`));
  const holidays = model.holidays(month);
  const dates = monthDates(month).filter((date) => dow(date) % 6 !== 0 && !holidays.has(Number(date.slice(8))));
  const rows = new Map();
  const slot = (group, cls) => {
    const key = `${group}|${cls}`;
    if (!rows.has(key)) rows.set(key, { group, cls, plan: plan[group]?.[cls] || 0, min: mins[group]?.[cls] ?? null, assigned: 0, days: [], zero: [] });
    return rows.get(key);
  };
  const assigned = new Map();
  for (const pid of Object.keys(model.ds.months[month].rows)) {
    const cls = roster[pid];
    if (!CLASSES.includes(cls)) continue;
    const g = rotationGroup(model.day(pid, `${month}-15`));
    if (!g) continue;
    slot(g, cls).assigned++;
    assigned.set(pid, { g, cls });
  }
  for (const [group, classes] of Object.entries(mins)) for (const cls of Object.keys(classes)) slot(group, cls);
  for (const date of dates) {
    const present = {};
    for (const [pid, { g, cls }] of assigned) {
      const d = model.day(pid, date);
      if (d.status === "work" && d.call !== "NF") present[`${g}|${cls}`] = (present[`${g}|${cls}`] || 0) + 1;
    }
    for (const [key, row] of rows) {
      const need = row.min ?? (row.plan ? Math.min(row.plan, row.assigned) : row.assigned);
      const have = present[key] || 0;
      if (have < need) row.days.push(date);
      if (!have && need) row.zero.push(date);
    }
  }
  const services = [...rows.values()].sort((a, b) => b.zero.length - a.zero.length || b.days.length - a.days.length);
  return { services, weekdays: dates.length };
}

// Every service a class has been on in the loaded months, for the minimums table.
export function serviceList(model) {
  const groups = new Set(Object.keys(model.fairness?.minimums || {}));
  const last = model.months[model.months.length - 1];
  if (last) {
    const roster = rosterOf(model, academicYearOf(`${last}-15`));
    for (const pid of Object.keys(model.ds.months[last].rows)) {
      const g = roster[pid] && rotationGroup(model.day(pid, `${last}-15`));
      if (g) groups.add(g);
    }
  }
  for (const plan of Object.values(model.ds.siteTotals || {})) for (const g of Object.keys(plan)) groups.add(g);
  return [...groups].sort();
}

// Services under a typed-in minimum on one date, with who's actually there.
export function shortOn(model, date) {
  const mins = model.fairness?.minimums || {};
  if (!Object.keys(mins).length || !model.hasCall(date)) return [];
  const roster = rosterOf(model, academicYearOf(date));
  const have = {};
  for (const pid of Object.keys(model.ds.months[monthKey(date)].rows)) {
    const d = model.day(pid, date);
    if (d.status === "work" && d.call !== "NF" && roster[pid]) {
      const key = `${rotationGroup(d)}|${roster[pid]}`;
      have[key] = (have[key] || 0) + 1;
    }
  }
  const out = [];
  for (const [group, classes] of Object.entries(mins)) {
    for (const [cls, min] of Object.entries(classes)) {
      const n = have[`${group}|${cls}`] || 0;
      if (n < min) out.push({ group, cls, min, have: n });
    }
  }
  return out;
}

// ---------- ACGME limits ----------

export const LIMITS = [
  ["6.20", "80 hours a week, averaged over 4 weeks", "must"],
  ["6.21.a", "14 hours off after 24-hour call", "must"],
  ["6.21.b", "1 day in 7 off, averaged over 4 weeks", "must"],
  ["6.22", "24 hours of continuous work, plus 4 for transitions", "must"],
  ["6.27", "In-house call at most every third night, averaged over 4 weeks", "must"],
  ["6.21", "8 hours off between shifts", "should"],
  ["postcall", "Something listed the morning after a 24", "watch"],
  ["week", "Single weeks over 80 hours (allowed if the average holds)", "watch"],
];

// Every limit for the whole program over a period, worst first within each rule.
export function limitsReport(model, { from, to }) {
  const roster = Object.entries(rosterOf(model, academicYearOf(from))).filter(([, c]) => CLASSES.includes(c));
  const found = new Map(LIMITS.map(([rule]) => [rule, []]));
  for (const [pid, cls] of roster) {
    for (const f of hoursReport(model, pid, from, to).flags) {
      if (found.has(f.rule) && f.date >= from && f.date <= to) found.get(f.rule).push({ ...f, pid, cls });
    }
  }
  return LIMITS.map(([rule, label, kind]) => ({ rule, label, kind, items: found.get(rule).sort((a, b) => b.date.localeCompare(a.date)) }));
}

// Plain-language findings for the top of the screen.
export function insights(model, report, today) {
  const out = [];
  for (const c of report.classes) {
    const compared = c.rows.filter((r) => r.load != null && r.eligible >= MIN_DAYS).sort((a, b) => b.load - a.load);
    if (compared.length < 2) continue;
    const top = compared[0], low = compared[compared.length - 1];
    out.push({ level: "info", text: `${c.cls}: ${model.person(top.pid).last} carries the most (${Math.round(top.load)}% of fair share), ${model.person(low.pid).last} the least (${Math.round(low.load)}%).` });
    const uneven = c.columns.filter((x) => "CDF".includes(x.grade) && x.used);
    if (uneven.length) out.push({ level: "warn", text: `${c.cls}: uneven mix in ${uneven.map((x) => `${x.label} (${x.min}–${x.max})`).join(", ")}.` });
  }
  const rates = report.classes.filter((c) => c.rate28 > 0).sort((a, b) => b.rate28 - a.rate28);
  if (rates.length > 1 && rates[0].rate28 > rates[rates.length - 1].rate28 * 1.3) {
    out.push({ level: "info", text: `Per 4 available weeks, ${rates.map((c) => `${c.cls} earn ${c.rate28.toFixed(1)}`).join(", ")} points.` });
  }
  for (const c of report.classes) {
    for (const r of c.rows) {
      for (const f of hoursReport(model, r.pid, today, report.to).flags) {
        if (f.level === "gap" && f.date >= addDays(today, -21)) out.push({ level: "gap", text: `${model.person(r.pid).last}: ${f.text}.`, pid: r.pid });
      }
    }
  }
  // The daily sheet disagreeing with the call sheet, from today on.
  const upcoming = report.to >= today ? Object.keys(model.ds.daily || {}).filter((x) => x >= today).sort() : [];
  for (const date of upcoming) {
    for (const [pid, roles] of model.daily(date)?.roles || []) {
      const d = model.day(pid, date);
      if (["vacation", "postcall"].includes(d.status) && roles.some((r) => r.kind !== "night")) {
        out.push({ level: "warn", text: `${model.person(pid).last} is on the daily sheet for ${date.slice(5).replace("-", "/")}, but the call sheet says ${d.label.toLowerCase()}.`, pid });
      }
    }
  }
  return out.sort((a, b) => ["gap", "warn", "info"].indexOf(a.level) - ["gap", "warn", "info"].indexOf(b.level));
}

// Months of each rotation over the year's plan, for spotting uneven rotation mixes.
export function rotationBalance(model, ay = academicYears(model)[0]) {
  const out = [];
  const roster = Object.entries(rosterOf(model, ay));
  const inYear = (m) => m >= `${ay}-07` && m <= `${ay + 1}-06`;
  for (const cls of ["CA-1", "CA-2", "CA-3"]) {
    const people = roster.filter(([pid, c]) => c === cls && model.ds.rotations?.[pid]).map(([pid]) => pid);
    if (!people.length) continue;
    const tally = new Map(people.map((pid) => [pid, {}]));
    for (const pid of people) {
      for (const month of Object.keys(model.ds.rotations[pid]).filter(inYear)) {
        const d = model.day(pid, `${month}-15`);
        const g = CODES[d.rotationCode]?.group || model.rotationFor(pid, month) || "Other";
        const t = tally.get(pid);
        t[g] = (t[g] || 0) + 1;
      }
    }
    const groups = new Set([...tally.values()].flatMap((t) => Object.keys(t)));
    const rows = [...groups].map((g) => {
      const vals = people.map((pid) => ({ pid, n: tally.get(pid)[g] || 0 }));
      const nums = vals.map((v) => v.n);
      return { group: g, min: Math.min(...nums), max: Math.max(...nums), most: vals.filter((v) => v.n === Math.max(...nums)).map((v) => v.pid), least: vals.filter((v) => v.n === Math.min(...nums)).map((v) => v.pid) };
    }).filter((r) => r.max - r.min >= 2).sort((a, b) => (b.max - b.min) - (a.max - a.min));
    out.push({ cls, rows });
  }
  return out;
}
