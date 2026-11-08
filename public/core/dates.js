// Calendar-date helpers. Dates are "YYYY-MM-DD" strings handled in UTC so that
// day arithmetic never shifts with the viewer's time zone.

export const TZ = "America/Detroit";
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

const pad = (n) => String(n).padStart(2, "0");

export function ymd(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parts(date) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

export function toUTC(date) {
  const { y, m, d } = parts(date);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms) {
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date, n) {
  return fromUTC(toUTC(date) + n * 86400000);
}

export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function dow(date) {
  return new Date(toUTC(date)).getUTCDay();
}

export function monthKey(date) {
  return date.slice(0, 7);
}

export function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthDates(month) {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export function startOfWeek(date) {
  return addDays(date, -dow(date)); // weeks run Sunday-Saturday, like the call sheet
}

export function range(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayLocal(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(now);
}

export function nowMinutesLocal(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" });
  const [h, m] = f.format(now).split(":").map(Number);
  return h * 60 + m;
}

export function academicYearOf(date) {
  const { y, m } = parts(date);
  return m >= 7 ? y : y - 1;
}

export function fmtDate(date, style = "short") {
  const { y, m, d } = parts(date);
  const wd = DOW_SHORT[dow(date)];
  if (style === "long") return `${wd}, ${MONTH_NAMES[m - 1]} ${d}`;
  if (style === "md") return `${m}/${d}`;
  if (style === "year") return `${MONTH_SHORT[m - 1]} ${d}, ${y}`;
  return `${wd} ${m}/${d}`;
}

export function fmtMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Minutes from the start of a day (may exceed 1440 for shifts ending tomorrow) -> "6a", "6:30p".
export function fmtTime(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  const suffix = h < 12 ? "a" : "p";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm ? `${h12}:${pad(mm)}${suffix}` : `${h12}${suffix}`;
}

export function fmtRange(start, end) {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

export function relDay(date, today) {
  const n = diffDays(today, date);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return DOW_SHORT[dow(date)];
  return fmtDate(date);
}

// The hospital holidays that fall on a set day (and the weekday they're observed on), for
// reading call sheets that leave a holiday column blank.
export function isFixedHoliday(date) {
  const { y, m, d } = parts(date);
  const wd = dow(date);
  const nth = Math.ceil(d / 7);
  const observed = (mm, dd) => {
    const real = ymd(y, mm, dd);
    const rd = dow(real);
    return date === (rd === 6 ? addDays(real, -1) : rd === 0 ? addDays(real, 1) : real);
  };
  if (m === 5 && wd === 1 && d + 7 > 31) return true; // Memorial Day: last Monday of May
  if (m === 9 && wd === 1 && nth === 1) return true; // Labor Day
  if (m === 11 && wd === 4 && nth === 4) return true; // Thanksgiving
  return observed(1, 1) || observed(7, 4) || observed(12, 25) || (m === 12 && d === 31 && dow(ymd(y + 1, 1, 1)) === 6);
}
