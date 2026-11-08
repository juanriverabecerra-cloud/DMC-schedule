// What the lock-screen alert says when a day's OR sheet is posted: which day, and where the
// person who turned alerts on is that day.
import { addDays, diffDays, dow, fmtDate } from "./dates.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dayWord(date, today) {
  const ahead = diffDays(today, date);
  if (ahead === 0) return "Today's";
  if (ahead === 1) return "Tomorrow's";
  if (ahead > 1 && ahead < 7) return `${DAY_NAMES[dow(date)]}'s`;
  return `The ${fmtDate(date)}`;
}

// Alerts go out for today or later, never for a sheet typed in after the fact.
export const shouldAlert = (date, today) => date >= today && date <= addDays(today, 14);

const ors = (rooms) => rooms.map((r) => r.or).join(", ");

export function whereLine(d) {
  if (!d) return "";
  const room = d.roles.find((r) => r.kind === "room");
  const breaks = d.roles.find((r) => r.kind === "breaks");
  if (d.alsoBreaks && breaks) return `You're in ${d.roles.some((r) => r.kind === "pat") ? "PAT clinic" : d.label}, plus breaks for OR ${ors(breaks.rooms)}.`;
  if (room) return `You're in OR ${room.or}${room.room.surgeon ? ` with ${room.room.surgeon}` : ""}.`;
  if (breaks) return `You're giving breaks: OR ${ors(breaks.rooms)}.`;
  const ja = d.roles.find((r) => r.kind === "ja");
  if (ja) return `You're junior attending for OR ${ors(ja.rooms)}.`;
  if (d.roles.some((r) => r.kind === "opsc")) return "You're at OPSC.";
  if (d.roles.some((r) => r.kind === "ob")) return "You're at Hutzel OB.";
  if (d.roles.some((r) => r.kind === "pat")) return "You're in PAT clinic.";
  if (d.roles.some((r) => r.kind === "night")) return "You're on night coverage.";
  if (d.status === "vacation") return "You're on vacation.";
  if (d.status === "postcall") return "You're post-call.";
  if (d.status === "off" || d.status === "holiday") return "You're off.";
  if (d.status === "work" && d.label) return `You're on ${d.label}.`;
  return "";
}

export function dailyAlert(model, date, pid, today) {
  const title = `${dayWord(date, today)} OR schedule is posted`;
  const mine = pid && model.person(pid) ? whereLine(model.day(pid, date)) : "";
  return { title, body: mine || "Tap to see the rooms and who's where.", url: `/#/day/${date}`, tag: `daily-${date}` };
}
