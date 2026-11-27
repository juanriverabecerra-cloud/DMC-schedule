// A small picture for a day that's more than a workday: a holiday from the calendar, or a program
// party or meal from the office's emails. Shown in a corner of the day on the month calendar, the
// week strip, Coming up, Events and Today. Lectures, deadlines and meetings get none: only the
// days people look forward to.
import { addDays, dow, parts, ymd } from "./dates.js";

// The nth weekday of a month (n = -1 for the last one).
function nthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = ymd(y, m, 1);
    return addDays(first, ((weekday - dow(first) + 7) % 7) + (n - 1) * 7);
  }
  const last = addDays(ymd(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
  return addDays(last, -((dow(last) - weekday + 7) % 7));
}

// Easter Sunday (the Gregorian computus).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

const FIXED = {
  "01-01": ["New Year's Day", "🎆"],
  "02-14": ["Valentine's Day", "💝"],
  "03-17": ["St. Patrick's Day", "☘️"],
  "03-30": ["Doctors' Day", "🩺"],
  "07-04": ["Independence Day", "🇺🇸"],
  "10-16": ["Ether Day: the first public anesthetic, 1846", "💤"],
  "10-31": ["Halloween", "🎃"],
  "11-11": ["Veterans Day", "🎖️"],
  "12-24": ["Christmas Eve", "🎄"],
  "12-25": ["Christmas", "🎅"],
  "12-31": ["New Year's Eve", "🥂"],
};

// The holiday on a date, if any: { name, emoji }.
export function holidayOf(date) {
  const { y } = parts(date);
  const fixed = FIXED[date.slice(5)];
  if (fixed) return { name: fixed[0], emoji: fixed[1] };
  const moving = [
    [easter(y), "Easter", "🐣"],
    [nthWeekday(y, 5, 0, 2), "Mother's Day", "💐"],
    [nthWeekday(y, 5, 1, -1), "Memorial Day", "🇺🇸"],
    [nthWeekday(y, 6, 0, 3), "Father's Day", "👔"],
    [nthWeekday(y, 9, 1, 1), "Labor Day", "🛠️"],
    [nthWeekday(y, 11, 4, 4), "Thanksgiving", "🦃"],
  ];
  const hit = moving.find(([d]) => d === date);
  return hit ? { name: hit[1], emoji: hit[2] } : null;
}

// What kind of get-together an event is, from its title: the first that fits.
const EVENT_PICTURES = [
  [/graduat|commencement/i, "🎓"],
  [/holiday party|christmas party|winter party|ugly sweater/i, "🎄"],
  [/halloween|costume/i, "🎃"],
  [/thanksgiving|friendsgiving|potluck/i, "🦃"],
  [/dinner|banquet|gala/i, "🍽️"],
  [/lunch(eon)?\b/i, "🥪"],
  [/breakfast|brunch|coffee/i, "🥐"],
  [/happy hour|mixer|drinks|toast/i, "🥂"],
  [/bbq|barbecue|cookout|picnic/i, "🌭"],
  [/wellness|retreat|yoga|hike/i, "🌿"],
  [/bowling/i, "🎳"],
  [/trivia/i, "🧠"],
  [/kickball|softball|basketball|volleyball|soccer|tournament|game night/i, "🏆"],
  [/welcome|orientation/i, "👋"],
  [/farewell|send-?off|goodbye/i, "👋"],
  [/\b(resident|residency|residents')\b.*\b(party|celebration|night|social)\b|\b(party|celebration)\b.*\b(resident|residency)\b/i, "🎊"],
  [/party|celebration|bash|social|festival/i, "🎉"],
];

// A picture for a program event, or null for the ones that are work (lectures, deadlines…).
export function eventPicture(e) {
  if (!e || e.cancelled) return null;
  const title = `${e.title || ""}`;
  const hit = EVENT_PICTURES.find(([re]) => re.test(title));
  if (hit) return hit[1];
  return e.kind === "social" ? "🎉" : null;
}

// The day's picture for someone: the holiday first, then a get-together that day for them.
// { emoji, label } or null.
export function dayDecor(model, pid, date) {
  const holiday = holidayOf(date);
  const events = (model.events?.(date, date, pid) || []).filter((e) => e.date === date && !e.cancelled);
  const party = events.map((e) => ({ e, emoji: eventPicture(e) })).find((x) => x.emoji);
  if (holiday) return { emoji: holiday.emoji, label: [holiday.name, party?.e.title].filter(Boolean).join(" · ") };
  return party ? { emoji: party.emoji, label: party.e.title } : null;
}
