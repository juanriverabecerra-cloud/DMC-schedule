// The program's emails, brought in automatically. A small Google Apps Script in the owner's Gmail
// (shown to admins under Admin › Email intake) sends each new email from the program office to
// POST /api/mail/<token>. What's in it goes where it belongs:
//   - the monthly call schedule (.xlsx / .xlsm): merged like an admin upload, for this month or
//     later only, never over a newer copy, and a "DRAFT" is marked as one until the final comes;
//   - calendar invites (.ics): events, as written;
//   - the monthly conference schedule (PDF) and any other email: read by Claude in the background
//     (lib/mail-read.js) for the conference schedule, or for events: a party, a lecture, a deadline.
// Only emails sent to the program are used (the residents, a class, the faculty): one sent to a
// resident or two is personal, and isn't kept at all (not even its subject).
import crypto from "node:crypto";
import { mergeCallWorkbook, withDataset, touch, NO_CHANGE } from "./dataset.js";
import { addDays, monthKey, nowMinutesLocal, todayLocal } from "../public/core/dates.js";
import { env } from "./auth.js";

// The program office's two coordinators. The repository is public, so their addresses are kept
// as salted hashes: the server and the Gmail script compare hashes, never names. MAIL_SENDERS (a
// server setting: addresses, comma-separated) adds more.
export const SENDER_SALT = "dmc-schedule-sender:";
const PROGRAM_SENDER_HASHES = [
  "c34d15a5e6f10db8436a5c926bf7cd04a95642281c4c6d5577fcfeb42e500002",
  "d739c43ec94534be1c854ede592ceaee89db37cde6b190adcef9ec77bf5e92a0",
];
const PROGRAM_DOMAINS = ["wayne.edu"];
export const senderHash = (address) => crypto.createHash("sha256").update(SENDER_SALT + String(address).toLowerCase()).digest("hex");
const extraSenders = () => String(env("MAIL_SENDERS") || "").toLowerCase().split(/[,\s]+/).filter((a) => a.includes("@"));
// What the Gmail script needs: the domains to search, and the hashes of who counts.
export function senderRules() {
  const extra = extraSenders();
  return {
    hashes: [...new Set([...PROGRAM_SENDER_HASHES, ...extra.map(senderHash)])],
    domains: [...new Set([...PROGRAM_DOMAINS, ...extra.map((a) => a.split("@")[1])])],
  };
}
export const isProgramSender = (address) => !!address && senderRules().hashes.includes(senderHash(address));
export const addressOf = (from) => (String(from ?? "").match(/[\w.+-]+@[\w.-]+\.\w+/) || [""])[0].toLowerCase();
// The program's own emails go to a class (14+ addresses) or everyone (100+); a personal one has
// the resident's two addresses and a cc or two.
export const MIN_RECIPIENTS = 10;

const str = (v, n) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, n);
const isoOr = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : "");

// What the script sends, checked: { id, from, subject, date, recipients, text, attachments: [{ name, type, data }] }.
export function cleanMail(body) {
  const b = body && typeof body === "object" ? body : {};
  if (!/^[\w-]{6,64}$/.test(b.id || "")) return null;
  const date = isoOr(b.date);
  if (!date) return null;
  const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 8).map((a) => {
    const name = str(a?.name, 160);
    const data = typeof a?.data === "string" ? Buffer.from(a.data, "base64") : null;
    return name && data && data.length && data.length <= 6 * 1024 * 1024 ? { name, type: str(a.type, 80), bytes: new Uint8Array(data) } : null;
  }).filter(Boolean);
  return {
    id: b.id, from: str(b.from, 200), subject: str(b.subject, 300), date,
    recipients: Math.max(0, Math.min(5000, parseInt(b.recipients, 10) || 0)),
    text: str(b.text, 30000), attachments,
  };
}

export const isProgramMail = (mail) => isProgramSender(addressOf(mail.from)) && mail.recipients >= MIN_RECIPIENTS;

// ---- calendar invites ----
const unfold = (t) => String(t).replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
const icsText = (v) => String(v ?? "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();
// "TZID=Eastern Standard Time:20261207T170000" is wall-clock time in Detroit (the program's own
// invites); "...Z" is UTC; "VALUE=DATE:20261207" is all day.
function icsWhen(params, value) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{0,2}(Z?))?$/);
  if (!m) return null;
  if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: "" };
  if (m[6] === "Z") {
    const at = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    const mins = nowMinutesLocal(at);
    return { date: todayLocal(at), time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` };
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}
export function parseIcs(text) {
  const src = unfold(text);
  const cancelAll = /^METHOD:CANCEL/m.test(src);
  const out = [];
  for (const block of src.split(/BEGIN:VEVENT/).slice(1)) {
    const body = block.split(/END:VEVENT/)[0];
    const field = (name) => {
      const m = body.match(new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, "m"));
      return m ? { params: m[1], value: m[2].trim() } : null;
    };
    // The time is after the last colon (a TZID can carry colons of its own: "(UTC-05:00) Eastern").
    const when = (name) => (body.match(new RegExp(`^${name}[^\\n]*:(\\d{8}(?:T\\d{4,6}Z?)?)\\s*$`, "m")) || [])[1];
    const s = when("DTSTART") && icsWhen("", when("DTSTART"));
    if (!s) continue;
    const e = when("DTEND") && icsWhen("", when("DTEND"));
    const location = icsText(field("LOCATION")?.value);
    const isLink = /^https?:\/\//i.test(location);
    out.push({
      title: icsText(field("SUMMARY")?.value) || "Event",
      date: s.date, start: s.time, end: e && e.date === s.date ? e.time : "",
      place: isLink ? (/zoom\.us/i.test(location) ? "Zoom" : "Online") : location,
      link: isLink ? location : icsText(field("URL")?.value),
      cancelled: cancelAll || /CANCELLED/i.test(field("STATUS")?.value || ""),
    });
  }
  return out;
}

// ---- events ----
const KINDS = new Set(["social", "lecture", "didactic", "conference", "deadline", "meeting", "other"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const httpsOnly = (u) => (/^https:\/\/[^\s<>"']+$/i.test(String(u || "").trim()) ? String(u).trim().slice(0, 500) : "");
const keyOf = (e) => `${String(e.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${e.date}`;
// Two emails about one event rarely name it the same way ("Holiday Party", "Anesthesia Holiday
// Party"). Same day and mostly the same words is the same event, even at a new time (the email
// that moves the party to 8p updates it); "CA-1 Simulation" and "CA-2 Simulation" are not.
const FILLER = new Set(["the", "and", "for", "with", "our", "your", "dmc", "wsu", "anesthesia", "anesthesiology", "department", "program", "resident", "residents", "annual", "event", "save", "date", "invite", "invitation", "reminder", "please", "attend", "join", "us"]);
const wordsOf = (title) => new Set(String(title).toLowerCase().replace(/([a-z]+)-(\d)/g, "$1$2").split(/[^a-z0-9]+/)
  .filter((w) => (w.length > 2 || /\d/.test(w)) && !FILLER.has(w) && !/^20\d\d$/.test(w)));
export function sameEvent(a, b) {
  if (a.date !== b.date) return false;
  if (keyOf(a) === keyOf(b)) return true;
  const x = wordsOf(a.title), y = wordsOf(b.title);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.6 && shared / Math.max(x.size, y.size) >= 0.34;
}
export function cleanEvent(e, mail) {
  if (!e || !DATE.test(e.date || "")) return null;
  const title = str(e.title, 120);
  if (!title) return null;
  return {
    id: crypto.createHash("sha256").update(`${mail.id}|${keyOf({ title, date: e.date })}`).digest("base64url").slice(0, 16),
    title, date: e.date,
    start: TIME.test(e.start || "") ? e.start : "", end: TIME.test(e.end || "") ? e.end : "",
    place: str(e.place, 120), link: httpsOnly(e.link),
    rsvpBy: DATE.test(e.rsvpBy || "") ? e.rsvpBy : "", rsvpLink: httpsOnly(e.rsvpLink),
    rsvpNeeded: e.rsvpNeeded === true || DATE.test(e.rsvpBy || ""),
    kind: KINDS.has(e.kind) ? e.kind : "other", note: str(e.note, 240),
    who: str(e.who, 60).replace(/^(all|everyone|all residents?)$/i, ""),
    movedFrom: DATE.test(e.movedFrom || "") && e.movedFrom !== e.date ? e.movedFrom : "",
    cancelled: e.cancelled === true,
    from: str(String(mail.from).replace(/<[^>]*>/g, "").replace(/"/g, ""), 80) || addressOf(mail.from),
    subject: str(mail.subject, 160), mailId: mail.id, mailAt: mail.date,
  };
}
// Adds or updates events in the dataset (see sameEvent; a newer email wins, and one that moves an
// event takes it off its old day). Old ones are dropped after a month.
export function upsertEvents(ds, events, today) {
  let list = Array.isArray(ds.events) ? ds.events.slice() : [];
  let changed = 0;
  for (const e of events) {
    if (e.movedFrom) {
      const before = list.length;
      list = list.filter((x) => !(sameEvent(x, { ...e, date: e.movedFrom, start: "" }) && (x.mailAt || "") <= e.mailAt));
      changed += before - list.length;
    }
    const i = list.findIndex((x) => sameEvent(x, e));
    if (i < 0) { list.push({ ...e, addedAt: new Date().toISOString() }); changed++; }
    else if ((list[i].mailAt || "") <= e.mailAt) {
      // A short follow-up ("Reminder: the party is tonight") mustn't erase what the invitation said.
      const keep = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== "" && v != null));
      list[i] = { ...list[i], ...keep, id: list[i].id, addedAt: list[i].addedAt, cancelled: e.cancelled };
      changed++;
    }
  }
  ds.events = list.filter((e) => e.date >= addDays(today, -31)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(-200);
  // Phones only download the dataset again when its stamp moves.
  if (changed) touch(ds, { type: "events", count: changed });
  return changed;
}

// ---- the monthly call schedule ----
// "1st DRAFT of DECEMBER Call & PAT Schedule" with "DECEMBER 2026 Call Schedule (1st draft).xlsm".
// Not "ASA 2026 Presentation schedule.xlsx", a voucher or an expense grid.
const CALL_FILE = /\.(xlsx|xlsm)$/i;
export const isCallSchedule = (mail, att) => CALL_FILE.test(att.name)
  && (/\bcall\b/i.test(att.name) || /\bcall\b[^]*\bschedule|\bschedule\b[^]*\bcall\b/i.test(mail.subject))
  && !/presentation|reimburs|expense|voucher|travel|evaluation/i.test(att.name);
// Merges a mailed call schedule into `ds`. Only months from this one on; never over a copy that's
// newer (an admin's upload, or a later email); never a draft over a final.
export function mergeMailedCallSheet(ds, mail, att, today) {
  const draft = /\bdraft\b/i.test(`${mail.subject} ${att.name}`);
  const before = JSON.parse(JSON.stringify(ds.months || {}));
  const trial = JSON.parse(JSON.stringify(ds));
  const probe = mergeCallWorkbook(trial, att.bytes, att.name);
  const accepted = [], skipped = [];
  for (const { month } of probe.months) {
    const was = before[month];
    const wasAt = was ? was.mailAt || was.uploadedAt || "" : "";
    if (month < monthKey(today)) skipped.push({ month, why: "past month" });
    else if (was && wasAt >= mail.date) skipped.push({ month, why: "a newer copy is already in" });
    else if (was && !was.draft && draft) skipped.push({ month, why: "the final is already in" });
    else accepted.push(month);
  }
  if (!accepted.length) return { months: [], skipped, draft };
  const summary = mergeCallWorkbook(ds, att.bytes, att.name);
  for (const { month } of summary.months) {
    if (!accepted.includes(month)) { if (before[month]) ds.months[month] = before[month]; else delete ds.months[month]; continue; }
    Object.assign(ds.months[month], { draft, mailAt: mail.date, mailSubject: str(mail.subject, 160) });
  }
  return { months: accepted, skipped, draft, residents: summary.months.find((m) => accepted.includes(m.month))?.residents || 0, unknownCodes: summary.unknownCodes };
}

// What Claude should read for this email (in the background): a conference schedule PDF, or the
// text for events. Nothing when an invite or a call schedule already said it all.
// The conference schedule comes as "November 2026 Conference Schedule.pdf" in "November Didactic
// Schedules"; a call schedule PDF, a PBLD case or the ASA program isn't it.
export const isDidacticsPdf = (mail, a) => /\.pdf$/i.test(a.name)
  && /didactic|conference/i.test(`${a.name} ${mail.subject}`)
  && !/\bcall\b|\bpat\b|pbld|presentation|asa\b/i.test(`${a.name} ${mail.subject}`);
export function readingFor(mail, handled) {
  const pdf = mail.attachments.find((a) => isDidacticsPdf(mail, a));
  if (pdf) return { kind: "didactics", attachment: pdf.name };
  if (handled.ics || handled.call) return null;
  if (mail.text.length < 40) return null;
  return { kind: "events" };
}

// ---- one email ----
export async function ingestMail(st, mail, { now = new Date(), queueRead } = {}) {
  const today = todayLocal(now);
  const log = (await st.getJSON("mail-log")) || { list: [] };
  if (log.list.some((x) => x.id === mail.id)) return { ok: true, already: true };
  const entry = { id: mail.id, from: addressOf(mail.from), subject: str(mail.subject, 160), date: mail.date, at: now.toISOString(), actions: [] };
  if (!isProgramMail(mail)) {
    // A personal email: admins see that one was skipped, never what it was about.
    entry.subject = "";
    entry.personal = true;
    const office = isProgramSender(entry.from);
    if (!office) entry.from = "";
    entry.actions.push(office ? "Skipped: a personal email, not one sent to the program" : "Skipped: not from the program office");
  } else {
    const handled = { ics: false, call: false };
    for (const att of mail.attachments.filter((a) => isCallSchedule(mail, a))) {
      handled.call = true;
      try {
        let out = null;
        await withDataset(st, (ds) => { out = mergeMailedCallSheet(ds, mail, att, today); return out.months.length ? true : NO_CHANGE; });
        entry.actions.push(out.months.length
          ? `Call schedule${out.draft ? " (draft)" : ""} saved for ${out.months.join(", ")}${out.unknownCodes?.length ? `. New codes: ${out.unknownCodes.join(", ")}` : ""}`
          : `Call schedule not used: ${out.skipped.map((s) => `${s.month} ${s.why}`).join("; ") || "no months found"}`);
      } catch (err) {
        entry.actions.push(`Couldn't read ${att.name}: ${err?.message || err}`);
      }
    }
    const invites = mail.attachments.filter((a) => /\.ics$/i.test(a.name) || /calendar/i.test(a.type))
      .flatMap((a) => parseIcs(Buffer.from(a.bytes).toString("utf8"))).map((e) => cleanEvent(e, mail)).filter(Boolean);
    if (invites.length) {
      let n = 0;
      await withDataset(st, (ds) => { n = upsertEvents(ds, invites, today); return n ? true : NO_CHANGE; });
      handled.ics = true;
      entry.actions.push(`${invites.length} event${invites.length === 1 ? "" : "s"} from the invite: ${invites.map((e) => e.title).join("; ")}`);
    }
    const reading = readingFor(mail, handled);
    if (reading && queueRead) {
      const pdf = reading.attachment ? mail.attachments.find((a) => a.name === reading.attachment) : null;
      if (pdf) await st.setBytes(`mailq/${mail.id}.pdf`, pdf.bytes, "application/pdf");
      await st.setJSON(`mailq/${mail.id}`, { ...mail, attachments: [], reading, queuedAt: now.toISOString() });
      const queued = await queueRead(mail.id);
      // Nothing will come for it: don't leave the email sitting on the server.
      if (!queued) { await st.delete(`mailq/${mail.id}`); await st.delete(`mailq/${mail.id}.pdf`); }
      entry.actions.push(queued ? (reading.kind === "didactics" ? "Conference schedule sent to be read" : "Sent to be read for events") : "Not read: Claude isn't set up on the server");
    }
    if (!entry.actions.length) entry.actions.push("Nothing to add");
  }
  await st.update("mail-log", (saved) => ({ list: [entry, ...((saved?.list) || []).filter((x) => x.id !== mail.id)].slice(0, 150), lastAt: now.toISOString() }));
  return { ok: true, actions: entry.actions };
}

// Adds a line to an email's log entry (the background reader's result).
export async function noteMail(st, id, line) {
  await st.update("mail-log", (saved) => {
    if (!saved?.list) return undefined;
    return { ...saved, list: saved.list.map((x) => (x.id === id ? { ...x, actions: [...x.actions, line] } : x)) };
  });
}
