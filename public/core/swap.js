// "Who could take this shift?" — same-class residents who are free that day, not coming
// off or going onto nights/24-hr call, and would stay under 80 estimated hours that week.
import { addDays, monthDates, monthKey } from "./dates.js";
import { weekHours } from "./hours.js";
import { CALL_CODES, FRIDAY_24 } from "./codes.js";

export function swappableShift(d) {
  if (d.call) return d.call === "24" ? FRIDAY_24 : CALL_CODES[d.call];
  if (d.late) return { label: "Late (until 6p)", start: 360, end: 1080 };
  return null;
}

function callCount(model, pid, month) {
  return monthDates(month).filter((date) => {
    const d = model.day(pid, date);
    return d.call || d.late;
  }).length;
}

export function swapCandidates(model, pid, date) {
  const mine = model.day(pid, date);
  const shift = swappableShift(mine);
  if (!shift) return [];
  const me = model.person(pid);
  const hoursAdded = (shift.end - shift.start) / 60;
  const out = [];
  for (const p of model.people) {
    if (p.id === pid || p.cls !== me.cls) continue;
    const d = model.day(p.id, date);
    if (d.source !== "call") continue;
    const prev = model.day(p.id, addDays(date, -1));
    const next = model.day(p.id, addDays(date, 1));
    const reasons = [];
    if (["vacation", "postcall", "holiday"].includes(d.status)) continue;
    if (d.call || d.late || d.noCall) continue;
    if (prev.call === "NF" || next.call === "NF" || prev.call === "H1" || prev.call === "24") continue;
    if (mine.weekend && d.status !== "off") continue;
    if (!mine.weekend && mine.call === "NF" && d.status === "work") reasons.push("would need their day covered");
    if (next.call === "H1" || next.call === "24") reasons.push("24-hr call the next day");
    const wk = weekHours(model, p.id, date);
    const projected = (wk?.hours || 0) + (d.status === "off" ? hoursAdded : Math.max(0, hoursAdded - 11));
    if (projected > 80) continue;
    out.push({ pid: p.id, status: d.label, projected: Math.round(projected), calls: callCount(model, p.id, monthKey(date)), reasons });
  }
  return out.sort((a, b) => a.calls - b.calls || a.projected - b.projected);
}
