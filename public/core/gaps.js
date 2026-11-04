// Coverage gaps: staffing rules (editable in Settings), the call sheet's own
// "coverage needed" rows, and conflicts between the call sheet and the daily OR sheet.
import { monthDates, addDays, dow } from "./dates.js";

const MATCHERS = {
  late: (d) => d.late,
  NF: (d) => d.call === "NF",
  "10-7": (d) => d.call === "10-7",
  call24: (d) => d.call === "H1" || d.call === "24",
  H1: (d) => d.call === "H1",
  H2: (d) => d.call === "H2",
  cardiac: (d) => d.cardiac,
};

export function dayGaps(model, date) {
  const items = [];
  if (!model.hasCall(date)) return items;
  const roster = model.roster(date).filter((d) => d.source === "call");
  const holiday = roster.some((d) => d.status === "holiday");
  if (holiday) {
    items.push({ date, level: "info", kind: "holiday", title: "Holiday — covered by CRNAs" });
    return items;
  }
  const wd = dow(date);
  for (const rule of model.S.staffing) {
    if (rule.enabled === false || !rule.days.includes(wd)) continue;
    const test = MATCHERS[rule.match];
    if (!test) continue;
    const found = roster.filter(test);
    if (found.length < rule.min) {
      items.push({ date, level: "gap", kind: "staffing", title: `${rule.label}: ${found.length} of ${rule.min} scheduled`, people: found.map((d) => d.pid) });
    }
  }
  for (const c of model.coverageNeeded(date)) {
    items.push({ date, level: "gap", kind: "sheet", title: `${c.label} coverage needed (call sheet)` });
  }
  for (const d of roster) {
    if (d.call === "H1" || d.call === "24") {
      const next = model.day(d.pid, addDays(date, 1));
      if (next.status === "work" && !next.weekend && !next.call) {
        items.push({ date: addDays(date, 1), level: "warn", kind: "postcall", title: `${model.name(d.pid)} is scheduled the day after 24-hr call`, people: [d.pid] });
      }
    }
  }
  const dl = model.daily(date);
  if (dl) {
    for (const u of dl.unmatched) items.push({ date, level: "warn", kind: "daily", title: `Daily sheet: "${u.name}" (${u.where}) doesn't match a resident` });
    for (const [pid, roles] of dl.roles) {
      const d = model.day(pid, date);
      const busy = roles.some((r) => r.kind === "room" || r.kind === "breaks" || r.kind === "ja");
      if (busy && ["vacation", "postcall", "off"].includes(d.status)) {
        items.push({ date, level: "warn", kind: "conflict", title: `${model.name(pid)} is on the daily sheet but the call sheet says ${d.label.toLowerCase()}`, people: [pid] });
      }
      if (busy && d.call === "NF") {
        items.push({ date, level: "warn", kind: "conflict", title: `${model.name(pid)} is in an OR but on night float`, people: [pid] });
      }
    }
    for (const room of dl.rooms) {
      if (!room.crna && !room.staffIds.length && room.surgeon) {
        items.push({ date, level: "warn", kind: "daily", title: `OR ${room.or} (${room.surgeon}) has no resident or CRNA listed` });
      }
    }
  }
  return items;
}

export function monthGaps(model, month) {
  return monthDates(month).flatMap((date) => dayGaps(model, date));
}
