// Workload fairness. Every shift earns burden points (how heavy it feels, not just its hours),
// each resident is compared with their own class, and the result guides call swaps and sick
// coverage. This is a tool for the people making the schedule: it suggests, they decide.
import { addDays, addMonths, academicYearOf, dow, monthDates, monthKey, range, diffDays } from "./dates.js";
import { hoursReport, weekHours } from "./hours.js";
import { CODES, CALL_CODES } from "./codes.js";

// Scale: one late day = 1 point. Editable in Admin › Fairness.
export const WEIGHT_ROWS = [
  ["sat24", "24-hr call, Saturday", 10, "A whole extra day, and the weekend is gone"],
  ["sun24", "24-hr call, Sunday", 10, "A whole extra day, then back at work"],
  ["fri24", "24-hr call, Friday", 6, "You're already there for the first half; Saturday is lost post-call"],
  ["wk24", "24-hr call, Mon–Thu", 6, "Same reasoning as Friday"],
  ["h2sun", "12-hr call, Sunday", 6, "A full weekend day, work again Monday"],
  ["h2sat", "12-hr call, Saturday", 5, "A full weekend day"],
  ["h2wk", "12-hr call, weekday", 2, "A long day"],
  ["nf", "Night float, per night", 2.5, "A 5-night week is 12.5: hours match a day week, but nights wear you down"],
  ["seniorWe", "CA-3 10a–7p, weekend day", 4, "A weekend day worked"],
  ["senior", "CA-3 10a–7p, weekday", 1, "Late finish"],
  ["cardiacWe", "Cardiac home call, weekend day", 1.5, "Tied to your phone on your days off"],
  ["cardiac", "Cardiac home call, weekday", 0.5, "On call after a normal day"],
  ["late", "Late day (until 6p)", 1, "The baseline for the scale"],
  ["breaks", "Giving breaks", 0.5, "From the daily sheet"],
  ["stack", "Heavy shifts within 6 days", 2, "Extra points when one heavy shift follows another: recovery matters"],
];
export const DEFAULT_WEIGHTS = Object.fromEntries(WEIGHT_ROWS.map(([k, , v]) => [k, v]));

// Table columns: shift types added together for easy reading.
export const COLUMNS = [
  ["sat24", "Sat 24", ["sat24", "sun24"], 1],
  ["fri24", "Fri 24", ["fri24", "wk24"], 1],
  ["h2", "12-hr", ["h2sat", "h2sun", "h2wk"], 1],
  ["nf", "Nights", ["nf"], 5],
  ["late", "Late", ["late"], 2],
  ["senior", "10–7", ["senior", "seniorWe"], 7],
  ["cardiac", "Cardiac", ["cardiac", "cardiacWe"], 7],
  ["breaks", "Breaks", ["breaks"], 2],
];

// Rotations that have taken no call in any month reviewed. Editable once confirmed.
export const NO_CALL_GROUPS = ["Obstetrics", "Pediatrics", "9-ICU", "Sinai-Grace ICU"];
const HEAVY = 5;
const MIN_DAYS = 14; // too little time in the period to compare fairly

export const weightsOf = (model) => ({ ...DEFAULT_WEIGHTS, ...(model.fairness?.weights || {}) });
const noCallGroups = (model) => model.fairness?.noCallGroups || NO_CALL_GROUPS;
const rotationGroup = (d) => CODES[d.rotationCode]?.group || d.group || null;
export const isNoCallRotation = (model, d) => noCallGroups(model).includes(rotationGroup(d));

// What a resident-day is worth. Returns [{ key, pts }].
export function dayItems(d, W) {
  const items = [];
  const add = (key) => items.push({ key, pts: W[key] ?? 0 });
  if (d.status === "work") {
    if (d.call === "H1" || d.call === "24") add(d.dow === 6 ? "sat24" : d.dow === 0 ? "sun24" : d.dow === 5 ? "fri24" : "wk24");
    else if (d.call === "H2") add(d.dow === 6 ? "h2sat" : d.dow === 0 ? "h2sun" : "h2wk");
    else if (d.call === "NF") add("nf");
    else if (d.call === "10-7") add(d.weekend ? "seniorWe" : "senior");
    if (d.late) add("late");
    if (d.roles?.some((r) => r.kind === "breaks")) add("breaks");
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
  for (const cls of ["CA-1", "CA-2", "CA-3"]) {
    const rows = model.people.filter((p) => p.cls === cls).map((p) => residentLoad(model, p.id, from, to, W)).filter((r) => r.eligible + r.noCallDays > 0);
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

// Months of the academic year so far: which have a call sheet and which don't.
export function academicMonths(model, today) {
  const start = `${academicYearOf(today)}-07`;
  const now = monthKey(today);
  const out = [];
  for (let m = start; m <= now; m = addMonths(m, 1)) out.push({ month: m, loaded: model.months.includes(m) });
  return out;
}

export function yearRange(model, today) {
  const months = academicMonths(model, today);
  const last = [...model.months].filter((m) => m >= months[0].month).sort().pop() || months[months.length - 1].month;
  const dates = monthDates(last);
  return { from: `${months[0].month}-01`, to: dates[dates.length - 1] };
}

// ---------- coverage: who could take a shift ----------

const SHIFT_LABEL = { sat24: "Saturday 24-hr call", sun24: "Sunday 24-hr call", fri24: "Friday 24-hr call", wk24: "24-hr call", h2sat: "Saturday 12-hr call", h2sun: "Sunday 12-hr call", h2wk: "12-hr call", nf: "Night float", senior: "CA-3 10a–7p", seniorWe: "CA-3 10a–7p", late: "Late" };

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

// Ranked options to cover a resident's shift. Backup (jeopardy) residents first, then whoever
// is furthest under their fair share. Everyone left out is listed with the reason.
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
    if (p.id === pid || p.cls === "PGY-1" || (!allClasses && p.cls !== me.cls)) continue;
    const c = model.day(p.id, date);
    let why = blockedBy(model, c, shift);
    const week = weekHours(model, p.id, date);
    const adds = c.status === "off" ? shift.hours : Math.max(0, shift.hours - 11);
    const projected = Math.round((week?.hours || 0) + adds);
    if (!why && projected > 80) why = `Would reach about ${projected} h that week`;
    // On a weekend the shift needs someone who is off; a regular day needs someone working.
    if (!why && d.weekend && c.status !== "off") why = c.label || "Working";
    if (why) { blocked.push({ pid: p.id, why }); continue; }
    const cautions = [];
    const next = model.day(p.id, addDays(date, 1));
    const prev = model.day(p.id, addDays(date, -1));
    if (next.call === "H1" || next.call === "24") cautions.push("24-hr call the next day");
    if (["H1", "24", "H2"].includes(prev.call)) cautions.push("On call the day before");
    if (projected >= 70) cautions.push(`About ${projected} h that week`);
    if (shift.key === "nf" && c.status === "work") cautions.push("Their days need covering");
    if (shift.key === "regular" && !isBackup(c) && c.status === "work") cautions.push(`Leaves ${rotationGroup(c) || "their service"} short`);
    const r = load.get(p.id);
    options.push({ pid: p.id, status: c.label, balance: r?.balance ?? 0, load: r?.load ?? null, projected, backup: isBackup(c), cautions, after: (r?.balance ?? 0) + shift.pts });
  }
  options.sort((a, b) => Number(b.backup) - Number(a.backup) || a.cautions.length - b.cautions.length || a.balance - b.balance);
  return { shift, options, blocked };
}

// Upcoming shifts that could move from someone over their fair share to someone under it,
// largest improvement first. One suggestion per shift.
export function suggestMoves(model, today, { report, limit = 8 } = {}) {
  const rep = report || fairnessReport(model, yearRange(model, today));
  const W = rep.W;
  const out = [];
  const last = rep.to;
  for (const c of rep.classes) {
    const byId = new Map(c.rows.map((r) => [r.pid, r]));
    for (const r of c.rows) {
      if (r.balance <= 0) continue;
      for (const it of r.items) {
        if (it.date < today || it.date > last || !SHIFT_LABEL[it.key] || it.key === "nf" || it.key.startsWith("senior")) continue;
        const { shift, options } = coverOptions(model, r.pid, it.date, { report: rep });
        const best = options.find((o) => !o.cautions.length && o.balance < 0);
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
// short because someone was on vacation or nights. `need` is the confirmed minimum once there
// is one, otherwise the plan, capped at the number assigned (the plan sheet counts the NORA
// resident under Thoracic, so a planned seat with nobody assigned isn't treated as a gap).
export function serviceCoverage(model, month) {
  if (!model.months.includes(month)) return { services: [], weekdays: 0 };
  const plan = model.ds.siteTotals?.[month] || {};
  const mins = model.fairness?.minimums || {};
  const dates = monthDates(month).filter((date) => dow(date) % 6 !== 0 && !model.roster(date).some((d) => d.status === "holiday"));
  const rows = new Map();
  const slot = (group, cls) => {
    const key = `${group}|${cls}`;
    if (!rows.has(key)) rows.set(key, { group, cls, plan: plan[group]?.[cls] || 0, assigned: 0, days: [], zero: [] });
    return rows.get(key);
  };
  const assigned = new Map();
  for (const p of model.people) {
    if (!CLASSES.includes(p.cls)) continue;
    const g = rotationGroup(model.day(p.id, `${month}-15`));
    if (!g) continue;
    slot(g, p.cls).assigned++;
    assigned.set(p.id, g);
  }
  for (const date of dates) {
    const present = {};
    for (const [pid, g] of assigned) {
      const d = model.day(pid, date);
      if (d.status === "work" && d.call !== "NF") present[`${g}|${model.person(pid).cls}`] = (present[`${g}|${model.person(pid).cls}`] || 0) + 1;
    }
    for (const [key, row] of rows) {
      const need = mins[row.group]?.[row.cls] ?? (row.plan ? Math.min(row.plan, row.assigned) : row.assigned);
      const have = present[key] || 0;
      if (have < need) row.days.push(date);
      if (!have && need) row.zero.push(date);
    }
  }
  const services = [...rows.values()].sort((a, b) => b.zero.length - a.zero.length || b.days.length - a.days.length);
  return { services, weekdays: dates.length };
}

// Plain-language findings for the top of the screen.
export function insights(model, report, today) {
  const out = [];
  for (const c of report.classes) {
    const compared = c.rows.filter((r) => r.load != null && r.eligible >= MIN_DAYS);
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
      for (const w of hoursReport(model, r.pid, today, report.to).weeks) {
        if (w.known && w.end >= today && w.start <= report.to && w.hours > 80) {
          out.push({ level: "gap", text: `${model.person(r.pid).last}: about ${Math.round(w.hours)} hours scheduled the week of ${w.start.slice(5).replace("-", "/")}.`, pid: r.pid });
        }
      }
    }
  }
  return out.sort((a, b) => ["gap", "warn", "info"].indexOf(a.level) - ["gap", "warn", "info"].indexOf(b.level));
}

// Months of each rotation over the year's plan, for spotting uneven rotation mixes.
export function rotationBalance(model) {
  const out = [];
  for (const cls of ["CA-1", "CA-2", "CA-3"]) {
    const people = model.people.filter((p) => p.cls === cls && model.ds.rotations?.[p.id]);
    if (!people.length) continue;
    const tally = new Map(people.map((p) => [p.id, {}]));
    for (const p of people) {
      for (const [month] of Object.entries(model.ds.rotations[p.id])) {
        const name = model.rotationFor(p.id, month);
        const d = model.day(p.id, `${month}-15`);
        const g = CODES[d.rotationCode]?.group || name || "Other";
        const t = tally.get(p.id);
        t[g] = (t[g] || 0) + 1;
      }
    }
    const groups = new Set([...tally.values()].flatMap((t) => Object.keys(t)));
    const rows = [...groups].map((g) => {
      const vals = people.map((p) => ({ pid: p.id, n: tally.get(p.id)[g] || 0 }));
      const nums = vals.map((v) => v.n);
      return { group: g, min: Math.min(...nums), max: Math.max(...nums), most: vals.filter((v) => v.n === Math.max(...nums)).map((v) => v.pid), least: vals.filter((v) => v.n === Math.min(...nums)).map((v) => v.pid) };
    }).filter((r) => r.max - r.min >= 2).sort((a, b) => (b.max - b.min) - (a.max - a.min));
    out.push({ cls, rows });
  }
  return out;
}
