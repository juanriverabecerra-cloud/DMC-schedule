// Monthly didactics: the department's conference schedule (Wednesday CME conference, Monday
// board review, Friday mock oral boards). One stored month looks like
//   { month, events: [...], zoom: [...], location, notes: [], hasPdf }
// and each event names its people with a role, so the app can tell residents what is theirs.
// Shared by the app, the admin editor and the calendar feed.
import { addDays, monthKey, dow } from "./dates.js";

export const KINDS = {
  pbld: { label: "PBLD", long: "Problem-based learning discussion" },
  lecture: { label: "Lecture", long: "Lecture" },
  "grand-rounds": { label: "Grand Rounds", long: "Grand Rounds" },
  mm: { label: "M&M", long: "Morbidity and mortality conference" },
  "board-review": { label: "Board review", long: "Board review" },
  "mock-oral": { label: "Mock orals", long: "Mock oral board examination" },
  "journal-club": { label: "Journal club", long: "Journal club" },
  simulation: { label: "Simulation", long: "Simulation" },
  other: { label: "Session", long: "Session" },
  none: { label: "No session", long: "No session" },
};

export const SERIES = {
  wednesday: "Wednesday conference",
  monday: "Monday board review",
  friday: "Friday mock orals",
  other: "Other sessions",
};

// presenter / examinee are the residents' own assignments; the rest are faculty roles.
export const ROLES = {
  presenter: "Presenting",
  examinee: "Mock oral",
  moderator: "Moderator",
  faculty: "Faculty",
  examiner: "Examiner",
};
export const OWN_ROLES = new Set(["presenter", "examinee"]);

// "Dr. Smith" -> "Smith", "Jane Doe, MD" -> "Jane Doe".
export function cleanPersonName(s) {
  return String(s ?? "")
    .replace(/^\s*dr\.?\s+/i, "")
    .replace(/,?\s*\b(MD|DO|PhD|CRNA|MBBS|FASA|MPH|MS)\b\.?/gi, "")
    .replace(/\s+/g, " ").trim().replace(/[,;]$/, "");
}
const isDoctor = (s) => /^\s*dr\.?\s/i.test(String(s ?? ""));

// "6:00", "06:00", "6:00am", "5:00 PM", "17:00" -> minutes from midnight, or null.
export function parseClock(s) {
  const m = String(s ?? "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === "p" && h < 12) h += 12;
  if (m[3] === "a" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
// Stored times are minutes; the reader and the editor send "HH:MM".
const minutesOf = (v) => (typeof v === "number" && Number.isFinite(v) ? v : parseClock(v));
export const clock = (min) => (min == null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);

const str = (v) => String(v ?? "").trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanPerson(p) {
  const name = str(p?.name);
  if (!name) return null;
  const role = ROLES[p.role] ? p.role : "presenter";
  const start = minutesOf(p.start), end = minutesOf(p.end);
  return { name, role, topic: str(p.topic), ...(start != null ? { start } : {}), ...(end != null ? { end } : {}) };
}

function cleanZoom(z, i) {
  const key = str(z?.key).toLowerCase().replace(/[^a-z0-9-]/g, "") || `zoom${i + 1}`;
  const url = str(z?.url);
  return {
    key, label: str(z?.label) || key,
    url: /^https:\/\//i.test(url) ? url : "",
    phones: (Array.isArray(z?.phones) ? z.phones : String(z?.phones ?? "").split(/[;,]/)).map(str).filter(Boolean),
    meetingId: str(z?.meetingId), passcode: str(z?.passcode),
  };
}

// Validates and tidies a month from the reader or the editor. Times may be "HH:MM" or minutes.
export function cleanDidacticsMonth(input, month) {
  const d = input || {};
  const zoom = (Array.isArray(d.zoom) ? d.zoom : []).map(cleanZoom).filter((z) => z.url || z.meetingId || z.phones.length);
  const zoomKeys = new Set(zoom.map((z) => z.key));
  const events = [];
  for (const e of Array.isArray(d.events) ? d.events : []) {
    const date = str(e?.date);
    if (!DATE.test(date) || (month && monthKey(date) !== month)) continue;
    const start = minutesOf(e.start);
    const end = minutesOf(e.end);
    const kind = KINDS[e.kind] ? e.kind : "other";
    const series = SERIES[e.series] ? e.series : guessSeries(date);
    events.push({
      date, start: start ?? null, end: end != null && start != null && end > start ? end : (start != null ? start + 60 : null),
      series, kind, title: str(e.title) || KINDS[kind].long,
      people: (Array.isArray(e.people) ? e.people : []).map(cleanPerson).filter(Boolean),
      location: str(e.location), virtual: !!e.virtual,
      zoom: zoomKeys.has(str(e.zoom)) ? str(e.zoom) : "",
      cancelled: !!e.cancelled || kind === "none",
      cme: !!e.cme, audience: str(e.audience), objectives: str(e.objectives), note: str(e.note),
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));
  events.forEach((e, i) => { e.id = `${e.date}-${clock(e.start).replace(":", "") || "x"}-${i}`; });
  return {
    month: month || str(d.month),
    events, zoom,
    location: str(d.location),
    notes: (Array.isArray(d.notes) ? d.notes : []).map(str).filter(Boolean),
  };
}

function guessSeries(date) {
  const wd = dow(date);
  return wd === 3 ? "wednesday" : wd === 1 ? "monday" : wd === 5 ? "friday" : "other";
}

// One-tap Zoom dial-in: rings the number, then enters the meeting ID and passcode.
export function zoomDialDigits(z, i = 0) {
  const phone = String(z?.phones?.[i] || "").replace(/\D/g, "");
  if (!phone) return "";
  const id = String(z.meetingId || "").replace(/\D/g, "");
  const pass = String(z.passcode || "").replace(/\D/g, "");
  const num = phone.length === 10 ? `+1${phone}` : `+${phone}`;
  return `${num}${id ? `,,${id}#` : ""}${id && pass ? `,,,,*${pass}#` : ""}`;
}
export const zoomTelHref = (z, i = 0) => {
  const d = zoomDialDigits(z, i);
  return d ? `tel:${d.replace(/#/g, "%23")}` : "";
};

const AWAY = { va: "the VA", chm: "Children's (CHM)", hvsh: "Huron Valley", sinai: "Sinai-Grace", offservice: "an off-service rotation", pain: "Chronic Pain" };

// Lookups for the screens and the calendar feed. `model` is the schedule model.
export function createDidactics(ds, model) {
  const store = ds.didactics || {};
  const months = Object.keys(store).sort();
  const cache = new Map();

  function resolvePerson(p) {
    let pid = null, staff = null;
    const name = cleanPersonName(p.name);
    if (OWN_ROLES.has(p.role) && !isDoctor(p.name)) {
      const id = model.match(name);
      if (id && model.person(id)) pid = id;
    }
    if (!pid) staff = model.dir?.staff(name) || null;
    const display = pid ? model.name(pid) : isDoctor(p.name) || staff || !OWN_ROLES.has(p.role) ? `Dr. ${name}` : name;
    return { ...p, display, pid, staff };
  }

  function monthEvents(month) {
    if (cache.has(month)) return cache.get(month);
    const m = store[month];
    const list = (m?.events || []).map((e) => ({
      ...e,
      month,
      people: e.people.map(resolvePerson),
      zoomLink: (m.zoom || []).find((z) => z.key === e.zoom) || null,
      place: e.location || (e.virtual ? "Virtual (Zoom)" : m.location || ""),
    }));
    cache.set(month, list);
    return list;
  }

  const all = () => months.flatMap(monthEvents);

  function between(from, to) {
    return all().filter((e) => e.date >= from && e.date <= to);
  }

  function on(date) {
    return monthEvents(monthKey(date)).filter((e) => e.date === date);
  }

  // A resident's own assignments: presenting, mock orals.
  function forPerson(pid, from, to) {
    const out = [];
    for (const e of between(from, to)) {
      if (e.cancelled) continue;
      for (const p of e.people) {
        if (p.pid === pid && OWN_ROLES.has(p.role)) out.push({ event: e, role: p.role, topic: p.topic, start: p.start ?? e.start, end: p.end ?? e.end });
      }
    }
    return out;
  }

  // Next sessions from a moment on (date + minutes), skipping ones that have ended.
  function upcoming(date, nowMin = 0, days = 14) {
    return between(date, addDays(date, days)).filter((e) => !e.cancelled && (e.date > date || (e.end ?? 1440) > nowMin));
  }

  // Why someone might not make a session, from their schedule that day.
  function conflict(pid, date, start = 360) {
    const d = model.day(pid, date);
    if (d.status === "vacation") return "You're on vacation that day";
    if (d.status === "postcall") return "You're post-call that day";
    if (d.status === "off" && !d.weekend) return "You're off that day";
    if (start < 720 && model.day(pid, addDays(date, -1)).call === "NF") return "You're coming off night float that morning";
    if (start >= 1080 && d.call === "NF") return "You're on night float that evening";
    if (d.status === "work" && AWAY[d.site]) return `You're at ${AWAY[d.site]} that day; join by Zoom if you can`;
    return null;
  }

  return {
    months, has: months.length > 0, raw: store,
    month: monthEvents, all, between, on, forPerson, upcoming, conflict,
    zoom: (month) => store[month]?.zoom || [],
    info: (month) => store[month] || null,
  };
}

// Short line for a session: "Grand Rounds: Opioid-free anesthesia", "PBLD · Dr. Smith".
export function isGenericTitle(e) {
  const k = KINDS[e.kind] || KINDS.other;
  const t = e.title || "";
  return !t || [k.long, k.label].some((x) => x.toLowerCase() === t.toLowerCase())
    || /^(problem[- ]based learning|mock oral|board review|mortality (and|&) morbidity|m&m|review\b|no lecture)/i.test(t);
}

export function eventHeadline(e) {
  if (e.cancelled) return "No session";
  const k = KINDS[e.kind] || KINDS.other;
  const fac = facultyOf(e).filter((p) => p.role !== "presenter").map((p) => p.display);
  const t = e.title || "";
  if (isGenericTitle(e)) return `${k.label}${fac.length ? ` · ${fac.join(", ")}` : ""}`;
  if (e.kind === "other" || t.toLowerCase().includes(k.label.toLowerCase())) return t;
  return `${k.label}: ${t}`;
}

// Residents with a part in a session (presenting, mock orals), in slot order.
export const residentsOf = (e) => e.people.filter((p) => p.pid && OWN_ROLES.has(p.role))
  .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
// Faculty and outside speakers.
export const facultyOf = (e) => e.people.filter((p) => !p.pid);

// Whether a session belongs on a resident's calendar: everyone gets conference and review
// sessions; mock orals only go to the residents examined.
export function relevantTo(e, pid) {
  if (e.cancelled) return false;
  if (e.kind === "mock-oral") return !pid || e.people.some((p) => p.pid === pid);
  return true;
}
