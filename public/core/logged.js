// Hours a resident logged in New Innovations, compared with what the schedule implies and used
// to predict what's ahead. New Innovations has no public way to connect, so a resident brings
// their own View Hours page: its Export To Excel file (really a web page) or a copy and paste.
// It runs on their device, and a copy goes to the app for the admin pages (never to other
// residents), so call, shifts and rotations can be split by real work, not just the schedule.
import { addDays, startOfWeek, toUTC } from "./dates.js";

const STAMP = "(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+(\\d{1,2}):(\\d{2})\\s*([AP])M";
const ROW = new RegExp(`${STAMP}\\s+${STAMP}\\s+(\\d+(?:\\.\\d+)?)(?![\\d/:])`, "gi");
const ROTATION = /Rotation on \d{1,2}\/\d{1,2}\/\d{4}\s+(.+?)\s+-\s+PRG-?\d/gi;
const NOT_WORK = /vacation|leave|sick|holiday|day off/i;
const NOT_CLINICAL = /conference|didactic/i;
export const isWorkEntry = (e) => !NOT_WORK.test(e.type);
export const isAwayEntry = (e) => /vacation|leave|sick/i.test(e.type);

const iso = (m, d, y) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
const minutes = (h, min, ap) => ((Number(h) % 12) + (ap.toUpperCase() === "P" ? 12 : 0)) * 60 + Number(min);

// The export is an HTML table with an .xls name.
function tableToText(html) {
  return html.replace(/<(style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<\/t[dh]>/gi, "\t").replace(/<\/tr>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
}

// Reads the exported file or a pasted page, whether the copy kept the table's tabs or put each
// cell on its own line.
export function parseLoggedHours(text) {
  const raw = String(text ?? "");
  const src = /<td[\s>]/i.test(raw) ? tableToText(raw) : raw;
  const rotations = [...src.matchAll(ROTATION)].map((m) => ({ at: m.index, name: m[1].trim() }));
  const seen = new Set();
  const entries = [];
  let end = 0;
  for (const m of src.matchAll(ROW)) {
    end = m.index + m[0].length;
    const date = iso(m[1], m[2], m[3]);
    const start = minutes(m[4], m[5], m[6]);
    const key = `${date}|${start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type = (src.slice(end, end + 160).match(/^\s*([^\t\n]+)/)?.[1] || "").split(/\s{2,}|\s+Res\b|\s+\d{1,2}\/\d/)[0].trim();
    const rotation = rotations.filter((r) => r.at < m.index).pop()?.name || "";
    entries.push({ date, start, endDate: iso(m[7], m[8], m[9]), end: minutes(m[10], m[11], m[12]), hours: Number(m[13]), type, rotation });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const summed = Math.round(entries.reduce((s, e) => s + e.hours, 0) * 100) / 100;
  const worked = Math.round(entries.filter((e) => !NOT_WORK.test(e.type)).reduce((s, e) => s + e.hours, 0) * 100) / 100;
  // The page ends with a total, which is a good check that nothing was missed.
  const tail = src.slice(end).replace(new RegExp(STAMP, "gi"), " ").match(/(?:^|\s)(\d{1,4}\.\d{1,2})(?=\s|$)/);
  return { entries, summed, worked, total: tail ? Number(tail[1]) : null, first: entries[0]?.date || null, last: entries[entries.length - 1]?.date || null };
}

// Entries as the server accepts them from a resident's device: the same fields
// the parser makes, checked and trimmed.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function cleanEntries(list) {
  if (!Array.isArray(list)) return [];
  const minute = (n) => Number.isInteger(n) && n >= 0 && n < 1440;
  const text = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
  const seen = new Set();
  const out = [];
  for (const e of list.slice(0, 5000)) {
    if (!e || !DATE_RE.test(e.date) || !DATE_RE.test(e.endDate) || !minute(e.start) || !minute(e.end)) continue;
    const hours = Number(e.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 36) continue;
    const key = `${e.date}|${e.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: e.date, start: e.start, endDate: e.endDate, end: e.end, hours, type: text(e.type, 40), rotation: text(e.rotation, 80) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

// Each file adds to the running record. Only days the new file includes are updated, so a
// corrected day carries through and every other day stays, however partial the file is.
export function mergeEntries(old, incoming) {
  if (!incoming.length) return old || [];
  const updated = new Set(incoming.map((e) => e.date));
  return [...(old || []).filter((e) => !updated.has(e.date)), ...incoming]
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

// What kind of day the schedule had, so like is compared with like.
export function dayKind(d) {
  if (d.call === "H1" || d.call === "24") return { key: "call24", label: "24-hr call" };
  if (d.call === "H2") return { key: "call12", label: "12-hr call" };
  if (d.call === "NF") return { key: "night", label: "Night float" };
  if (d.call === "10-7") return { key: "senior", label: "10a–7p" };
  if (d.status !== "work") return null;
  if (d.breaksDay) return { key: "breaks", label: "Breaks day" };
  if (d.late) return { key: "late", label: "Late day" };
  const name = d.rotation || d.label;
  return name ? { key: `rot:${name}`, label: name } : null;
}

const scheduledHours = (d) => d.shifts.reduce((s, x) => s + (x.end - x.start) / 60, 0);
const round1 = (n) => Math.round(n * 10) / 10;
const isCall = (e) => /call/i.test(e.type);
// A logged 24 counts as one even from a year the app has no call sheet for.
const longCall = (list, logged) => list.some(isCall) && logged >= 20;

export function compareLogged(model, pid, entries) {
  const byDate = new Map();
  for (const e of entries || []) {
    if (NOT_WORK.test(e.type)) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const groups = new Map();
  const add = (key, label, logged, est) => {
    if (!groups.has(key)) groups.set(key, { key, label, days: 0, logged: 0, est: 0 });
    const g = groups.get(key);
    g.days++; g.logged += logged; g.est += est;
  };
  const days = [];
  let conference = 0, noSheet = 0;
  const offDays = [];
  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    const logged = list.reduce((s, e) => s + e.hours, 0);
    const d = model.day(pid, date);
    const sheet = d.source === "call";
    const est = sheet ? scheduledHours(d) : 24;
    const kind = sheet ? dayKind(d) : longCall(list, logged) ? { key: "call24", label: "24-hr call" } : null;
    const clinical = list.some((e) => !NOT_CLINICAL.test(e.type));
    days.push({ date, logged, est, kind: kind?.key || null, clinical, sheet });
    // Only compare days with something to compare against. A conference or a shift the sheet
    // doesn't show says nothing about how long a rotation runs.
    if (!clinical) conference++;
    else if (kind) add(kind.key, kind.label, logged, est);
    else if (sheet) offDays.push(date);
    else noSheet++;
  }
  const rows = [...groups.values()].map((g) => ({ ...g, avg: round1(g.logged / g.days), estAvg: round1(g.est / g.days), diff: round1((g.logged - g.est) / g.days) }))
    .sort((a, b) => b.days - a.days);
  const compared = rows.reduce((s, g) => ({ days: s.days + g.days, logged: s.logged + g.logged, est: s.est + g.est }), { days: 0, logged: 0, est: 0 });
  return { rows, days, conference, offDays, noSheet, compared };
}

// Real hours per week on each rotation, from the rotation names New Innovations puts on the log.
export function hoursByRotation(entries) {
  const runs = [];
  for (const e of [...(entries || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!e.rotation || NOT_WORK.test(e.type) || /vacation/i.test(e.rotation)) continue;
    const last = runs[runs.length - 1];
    if (last?.name === e.rotation) { last.hours += e.hours; last.to = e.endDate; } else runs.push({ name: e.rotation, hours: e.hours, from: e.date, to: e.endDate });
  }
  const totals = new Map();
  for (const r of runs) {
    const t = totals.get(r.name) || { name: r.name, hours: 0, days: 0 };
    t.hours += r.hours;
    t.days += (toUTC(r.to) - toUTC(r.from)) / 86400000 + 1;
    totals.set(r.name, t);
  }
  return [...totals.values()].map((t) => ({ ...t, hours: round1(t.hours), weeks: round1(t.days / 7), perWeek: round1((t.hours / t.days) * 7) }))
    .sort((a, b) => b.perWeek - a.perWeek);
}

// With at least this many days of a kind, your own average replaces the schedule's assumption.
const MIN_DAYS = 3;

// What hoursReport needs: real shifts for the dates that were logged, your averages after that.
export function actualHours(model, pid, entries) {
  const list = (entries || []).filter((e) => !NOT_WORK.test(e.type));
  if (!list.length) return null;
  const byDate = {};
  for (const e of list) (byDate[e.date] ||= []).push(e);
  const away = new Set((entries || []).filter((e) => /vacation/i.test(e.type)).map((e) => e.date));
  const dates = Object.keys(byDate).sort();
  const learned = {};
  const { rows } = compareLogged(model, pid, list);
  for (const g of rows) if (g.days >= MIN_DAYS) learned[g.key] = g.avg;
  // A rotation you haven't done yet starts from your usual regular day, not the flat assumption.
  const regular = rows.filter((g) => g.key.startsWith("rot:"));
  const days = regular.reduce((s, g) => s + g.days, 0);
  const usual = days >= MIN_DAYS * 2 ? round1(regular.reduce((s, g) => s + g.logged, 0) / days) : null;
  const expected = (d) => {
    const key = dayKind(d)?.key;
    return learned[key] ?? (key?.startsWith("rot:") ? usual : null);
  };
  return { first: dates[0], last: dates[dates.length - 1], byDate, away, learned, usual, expected };
}

// Where the 4-week average stands now and its highest point ahead. `allLogged` is false when
// the current average still leans on estimates because fewer than four weeks were logged.
export function outlook(report, today, actual) {
  const past = report.weeks.filter((w) => w.end <= today);
  const ahead = report.weeks.filter((w) => w.end > today && w.known);
  const peak = ahead.reduce((top, w) => (w.avg4 !== null && (!top || w.avg4 > top.avg4) ? w : top), null);
  const current = [...past].reverse().find((w) => w.avg4 !== null) || null;
  const allLogged = !!current && addDays(current.start, -21) >= startOfWeek(actual.first);
  return { current, peak, allLogged };
}
