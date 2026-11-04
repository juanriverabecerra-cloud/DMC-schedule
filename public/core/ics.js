// iCalendar feed for one resident: timed shifts with the day's OR details and who to call,
// all-day blocks for vacation, post-call and cardiac call weeks, and planned rotations for
// months without a call sheet yet.
import { addDays, range, fmtRange, fmtDate, monthDates, addMonths, monthKey } from "./dates.js";
import { SITES } from "./codes.js";
import { headline } from "./model.js";

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:America/Detroit",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

function esc(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const compact = (date) => date.replace(/-/g, "");

function localStamp(date, minutes) {
  const day = addDays(date, Math.floor(minutes / 1440));
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${compact(day)}T${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}00`;
}

function utcStamp(iso) {
  return new Date(iso || Date.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function runs(dates) {
  const out = [];
  for (const d of dates) {
    const last = out[out.length - 1];
    if (last && addDays(last.end, 1) === d) last.end = d;
    else out.push({ start: d, end: d });
  }
  return out;
}

function withPhone(model, pid) {
  const ph = model.phone(pid);
  return ph ? `${model.name(pid)} (${ph})` : model.name(pid);
}

function roomLine(r) {
  const bits = [r.surgeon, r.time, r.cases ? `${r.cases} case${r.cases === "1" ? "" : "s"}` : "", r.mda ? `MDA ${r.mda}` : ""].filter(Boolean);
  return `OR ${r.or}${bits.length ? ` – ${bits.join(", ")}` : ""}`;
}

export function dayDescription(model, d, appUrl) {
  const lines = [];
  const site = SITES[d.site]?.name;
  lines.push([d.rotation || d.label, site].filter(Boolean).join(" · "));
  if (d.late) lines.push("Late resident: finish at your site, then help at Harper until 6p.");
  if (d.covering) lines.push(`Covering: ${d.raw}`);
  if (d.changed) lines.push("Recently changed on the call sheet.");
  for (const r of d.roles) {
    if (r.kind === "room") {
      lines.push(`Daily sheet: ${roomLine(r.room)}`);
      const others = r.with.map((x) => x.name);
      if (others.length) lines.push(`With: ${others.join(", ")}`);
      if (r.room.ja) lines.push(`JA: ${r.room.ja}`);
      if (r.room.breaks) lines.push(`Breaks: ${r.room.breaks}`);
    } else if (r.kind === "breaks" || r.kind === "ja") {
      lines.push(`Daily sheet: ${r.kind === "ja" ? "Junior attending" : "Breaks"} for`);
      for (const room of r.rooms) lines.push(`  ${roomLine(room)}${room.staff && !/^x$/i.test(room.staff) ? ` (${room.staff})` : room.crna ? " (CRNA)" : ""}`);
    } else if (r.kind === "opsc") lines.push(`Daily sheet: OPSC${r.mdas?.length ? ` – MDAs ${r.mdas.join(", ")}` : ""}`);
    else if (r.kind === "ob") lines.push(`Daily sheet: OB${r.mda ? ` – MDA ${r.mda}` : ""}`);
    else if (r.kind === "pat") lines.push("Daily sheet: PAT");
    else if (r.kind === "night") lines.push("Daily sheet: night coverage");
  }
  const t = model.tonight(d.date);
  const team = [];
  if (t.late.length) team.push(`Late: ${t.late.map((x) => withPhone(model, x.pid)).join(", ")}`);
  if (t.senior.length) team.push(`10a–7p: ${t.senior.map((x) => withPhone(model, x.pid)).join(", ")}`);
  if (t.night.length) team.push(`Night float: ${t.night.map((x) => withPhone(model, x.pid)).join(", ")}`);
  if (t.call24.length) team.push(`24-hr call: ${t.call24.map((x) => withPhone(model, x.pid)).join(", ")}`);
  if (t.call12.length) team.push(`12-hr call: ${t.call12.map((x) => withPhone(model, x.pid)).join(", ")}`);
  if (t.cardiac.length) team.push(`Cardiac call: ${t.cardiac.map((x) => withPhone(model, x.pid)).join(", ")}`);
  if (team.length) lines.push("", "Who's on:", ...team);
  lines.push("", "Hours are scheduled estimates.");
  if (appUrl) lines.push(`${appUrl}#/day/${d.date}`);
  return lines.join("\n");
}

function summaryFor(d) {
  if (d.call === "NF") return "Night float";
  if (d.call === "H1") return "H1 · 24-hr call";
  if (d.call === "H2") return "H2 · 12-hr call";
  if (d.call === "10-7") return "CA-3 10a–7p";
  const head = headline(d);
  if (d.call === "24") return `${head} + 24-hr call`;
  if (d.late) return `${head} · Late till 6p`;
  return head;
}

export function buildIcs(model, pid, { from, to, appUrl = "", calName } = {}) {
  const p = model.person(pid);
  const stamp = utcStamp(model.ds.updatedAt);
  const out = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DMC Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName || `DMC – ${model.name(pid)}`)}`, "X-WR-TIMEZONE:America/Detroit",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", ...VTIMEZONE,
  ];
  const event = (uid, fields) => {
    out.push("BEGIN:VEVENT", `UID:${uid}@dmc-schedule`, `DTSTAMP:${stamp}`, ...fields, "END:VEVENT");
  };
  const allDay = (uid, start, end, summary, description) => event(uid, [
    `DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(addDays(end, 1))}`,
    `SUMMARY:${esc(summary)}`, ...(description ? [`DESCRIPTION:${esc(description)}`] : []), "TRANSP:TRANSPARENT",
  ]);

  const vac = [], post = [], cardiac = [];
  const plannedMonths = new Set();
  const internWeeks = new Map();
  for (const date of range(from, to)) {
    const d = model.day(pid, date);
    if (d.cardiac) cardiac.push(date);
    if (d.source === "plan" || d.status === "planned") { plannedMonths.add(monthKey(date)); continue; }
    if (d.source === "intern") {
      const label = d.label;
      const key = `${label}`;
      const cur = internWeeks.get(key);
      if (cur && addDays(cur[cur.length - 1].end, 1) === date) cur[cur.length - 1].end = date;
      else internWeeks.set(key, [...(cur || []), { start: date, end: date }]);
      continue;
    }
    if (d.status === "vacation") { vac.push(date); continue; }
    if (d.status === "postcall") { post.push(date); continue; }
    if (d.status !== "work") continue;
    for (const s of d.shifts) {
      event(`${pid}-${date}-${s.kind}`, [
        `DTSTART;TZID=America/Detroit:${localStamp(date, s.start)}`,
        `DTEND;TZID=America/Detroit:${localStamp(date, s.end)}`,
        `SUMMARY:${esc(summaryFor(d))}`,
        `LOCATION:${esc(SITES[d.site]?.name || "")}`,
        `DESCRIPTION:${esc(`${fmtRange(s.start, s.end)} · ${dayDescription(model, d, appUrl)}`)}`,
      ]);
    }
  }
  for (const r of runs(vac)) allDay(`${pid}-vac-${r.start}`, r.start, r.end, "Vacation");
  for (const r of runs(post)) allDay(`${pid}-pc-${r.start}`, r.start, r.end, "Post-call (off)");
  for (const r of runs(cardiac)) allDay(`${pid}-cardiac-${r.start}`, r.start, r.end, "Cardiac call (home)", "Cardiac call week. Hours count only if called in.");
  for (const [label, rs] of internWeeks) for (const r of rs) allDay(`${pid}-intern-${r.start}`, r.start, r.end, `PGY-1: ${label}`);
  for (const month of plannedMonths) {
    const rot = model.rotationFor(pid, month);
    if (!rot) continue;
    const dates = monthDates(month);
    allDay(`${pid}-plan-${month}`, dates[0], dates[dates.length - 1], `Rotation: ${rot}`, "Planned rotation from the annual schedule. Daily shifts appear once the monthly call sheet is uploaded.");
  }
  out.push("END:VCALENDAR");
  return out.map(fold).join("\r\n") + "\r\n";
}

export function feedRange(model, today) {
  const from = addDays(today, -45);
  const lastPlanned = Object.values(model.ds.rotations || {}).flatMap((r) => Object.keys(r)).sort().pop();
  const lastMonth = [lastPlanned, model.months[model.months.length - 1], monthKey(addMonths(monthKey(today), 2) + "-01")].filter(Boolean).sort().pop();
  const dates = monthDates(lastMonth);
  return { from, to: dates[dates.length - 1] };
}

export { fmtDate };
