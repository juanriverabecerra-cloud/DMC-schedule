// What the lock-screen alert says when a day's OR sheet is posted: which day, and where the
// person who turned alerts on is that day.
import { addDays, diffDays, dow, fmtDate } from "./dates.js";
import { dayMdas, inCharge, mdaNames, spotOf } from "./attendings.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "Today", "Tomorrow", "Monday", or "Mon 11/23" further out.
export function dayName(date, today) {
  const ahead = diffDays(today, date);
  if (ahead === 0) return "Today";
  if (ahead === 1) return "Tomorrow";
  return ahead > 1 && ahead < 7 ? DAY_NAMES[dow(date)] : fmtDate(date);
}

export function dayWord(date, today) {
  const ahead = diffDays(today, date);
  return ahead >= 0 && ahead < 7 ? `${dayName(date, today)}'s` : `The ${dayName(date, today)}`;
}

// The same inside a sentence: "for tomorrow", "for Monday".
export const dayInSentence = (date, today) => dayName(date, today).replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase());

// Alerts go out for today or later, never for a sheet typed in after the fact.
export const shouldAlert = (date, today) => date >= today && date <= addDays(today, 14);

const ors = (rooms) => rooms.map((r) => r.or).join(", ");

// "Quill", "Rook and Sable"
const both = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "");
// " with Quill" for a room's MDA cell (it's understood the name is the MDA), or nothing when the
// sheet leaves it blank.
const withMda = (raw) => {
  const names = Array.isArray(raw) ? raw : mdaNames(raw);
  return names.length ? ` with ${both(names)}` : "";
};

// Where someone is that day and the MDA they're with: the MDA is who the day is spent with.
export function whereLine(d) {
  if (!d) return "";
  const room = d.roles.find((r) => r.kind === "room");
  const breaks = d.roles.find((r) => r.kind === "breaks");
  if (d.alsoBreaks && breaks) return `You're in ${d.roles.some((r) => r.kind === "pat") ? "PAT clinic" : d.label}, plus breaks for OR ${ors(breaks.rooms)}.`;
  if (room) return `You're in OR ${room.or}${withMda(room.room.mda)}.`;
  if (breaks) return `You're giving breaks: OR ${ors(breaks.rooms)}.`;
  const ja = d.roles.find((r) => r.kind === "ja");
  if (ja) return `You're junior attending for OR ${ors(ja.rooms)}${withMda(dayMdas(d).map((m) => m.name))}.`;
  const proc = d.roles.find((r) => r.kind === "proc");
  if (proc) return `You're in ${proc.name}${proc.asJa ? " as JA" : ""}${withMda(proc.mda)}.`;
  const spot = spotOf(d);
  if (spot === "PACU") return "You're in the PACU today (no room assignment).";
  if (spot === "OPSC") return `You're at OPSC${withMda(dayMdas(d).map((m) => m.name))}. Rooms are handed out there.`;
  if (spot === "VA") return "You're at the VA.";
  if (d.roles.some((r) => r.kind === "ob")) return `You're at Hutzel OB${withMda(d.roles.find((r) => r.kind === "ob").mda)}.`;
  if (d.roles.some((r) => r.kind === "pat")) return "You're in PAT clinic.";
  if (d.roles.some((r) => r.kind === "night")) return "You're on night coverage.";
  const placed = d.roles.find((r) => r.kind === "where");
  if (placed) return `You're in ${placed.where}${withMda(placed.mda)}.`;
  if (d.status === "vacation") return "You're on vacation.";
  if (d.status === "postcall") return "You're post-call.";
  if (d.status === "off" || d.status === "holiday") return "You're off.";
  if (d.status === "work" && d.label) return `You're on ${d.label}.`;
  return "";
}

// The day's board runner and the MDA on call that night, in one line: "Board runner Quill · On call Rook."
export function chargeLine(dl, d = null) {
  const who = inCharge(dl, d);
  if (!who) return "";
  const bits = [
    who.runner ? `Board runner ${who.runner.name}` : who.resident ? `Board runner ${who.resident.name}` : "",
    who.call ? `${who.ob ? "OB on call" : "On call"} ${who.call.name}` : "",
  ].filter(Boolean);
  return bits.length ? `${bits.join(" · ")}.` : "";
}

// Hospitals the Harper OR sheet doesn't cover.
const OFF_SHEET = new Set(["va", "chm", "hvsh", "sinai", "pain", "offservice"]);

// Whether the posted sheet says anything about this person's day. It doesn't for someone off, on
// vacation or post-call, working nights (night float, the 10p–7a), or at another hospital, unless the sheet names them for
// something in the day. They aren't buzzed for it (a night float resident is asleep at 2p).
export function sheetConcerns(d) {
  if (!d) return true;
  if (d.roles.some((r) => r.kind !== "night")) return true;
  if (["vacation", "off", "holiday", "postcall"].includes(d.status)) return false;
  if (d.call === "NF" || d.call === "10-7" || d.roles.some((r) => r.kind === "night")) return false;
  return !(d.status === "work" && OFF_SHEET.has(d.site));
}

// null: this person isn't alerted (see sheetConcerns). Phones with nobody picked always are.
export function dailyAlert(model, date, pid, today) {
  const d = pid && model.person(pid) ? model.day(pid, date) : null;
  if (d && !sheetConcerns(d)) return null;
  const title = `${dayWord(date, today)} OR schedule is posted`;
  const mine = d ? whereLine(d) : "";
  // The VA's day isn't Harper's: its board runner isn't theirs.
  const charge = spotOf(d) === "VA" ? "" : chargeLine(model.daily(date), d);
  const body = [mine || "Tap to see the rooms and who's where.", charge].filter(Boolean).join(" ");
  return { title, body, url: `/#/day/${date}`, tag: `daily-${date}` };
}
