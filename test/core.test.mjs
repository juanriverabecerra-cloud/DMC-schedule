// Synthetic data only: the repository is public, so no real schedules or names here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatcher, splitName, sameName } from "../public/core/names.js";
import { createModel } from "../public/core/model.js";
import { hoursReport } from "../public/core/hours.js";
import { dayGaps } from "../public/core/gaps.js";
import { buildIcs } from "../public/core/ics.js";
import { upsertPerson } from "../lib/people.js";
import { setDaily } from "../lib/dataset.js";

const people = [
  { id: "doe-jane", last: "Doe", first: "Jane", preferred: "Jane", cls: "CA-1" },
  { id: "lee-sam", last: "Lee", first: "Sam", preferred: "Sam", cls: "CA-1" },
  { id: "leed-ana", last: "Leed", first: "Ana", preferred: "Ana", cls: "CA-2" },
  { id: "garcia-lopez-maria", last: "Garcia-Lopez", first: "Maria", preferred: "Maria", cls: "CA-2" },
  { id: "van-tran-kim", last: "Van Tran", first: "Kim", preferred: "Kim", cls: "CA-3" },
  { id: "ortiz-paul", last: "Ortiz", first: "Paul", preferred: "Paul", cls: "CA-3" },
];

test("name matching handles typos, initials, two-word surnames and near-duplicates", () => {
  const match = createMatcher(people);
  assert.equal(match("Lee"), "lee-sam");
  assert.equal(match("Leed"), "leed-ana");
  assert.equal(match("Garcia"), "garcia-lopez-maria");
  assert.equal(match("Garsia"), "garcia-lopez-maria");
  assert.equal(match("KVT"), "van-tran-kim");
  assert.equal(match("Van Tran"), "van-tran-kim");
  assert.equal(match("X"), null);
  assert.equal(match("Outside Resident"), null);
});

test("registry merges spelling variants of the same resident", () => {
  const reg = [];
  const a = upsertPerson(reg, "Smith, Alexandra (Alex)", { cls: "CA-1" });
  const b = upsertPerson(reg, "Smith, Alex", { cls: "CA-2", authoritative: true });
  assert.equal(reg.length, 1);
  assert.equal(a.person.id, b.person.id);
  assert.equal(reg[0].preferred, "Alex");
  assert.equal(reg[0].cls, "CA-2");
  assert.ok(sameName(splitName("Ruiz Perez, Juan"), splitName("Ruiz, Juan Carlos")));
});

function dataset() {
  const rows = {
    "doe-jane": { rotation: "Basic Anesthesia", next: "OPSC", days: { 2: { t: "BA" }, 3: { t: "BA", f: "00FF00" }, 6: { t: "BA", f: "C9DAF8" }, 7: {}, 8: { t: "H2" } } },
    "lee-sam": { rotation: "VA", days: { 1: { t: "NF" }, 2: { t: "NF" }, 3: { t: "NF" }, 7: { t: "H1" }, 9: { t: "PC", b: 1 } } },
    "leed-ana": { rotation: "Cardiac", days: { 2: { t: "HC", f: "FF00FF" }, 3: { t: "Vac" }, 4: { f: "FAE2D5" } } },
    "ortiz-paul": { rotation: "Elective", days: { 1: { t: "10-7" }, 2: { t: "10-7" } } },
    "van-tran-kim": { rotation: "PAT", days: { 3: { t: "PAT" }, 4: { t: "Vac" }, 5: { t: "Vac" } } },
    "garcia-lopez-maria": { rotation: "Neuro", days: { 5: { t: "PAT", b: 1 } } },
  };
  return {
    people,
    months: { "2026-11": { rows, days: 30, coverage: { PAT: { 6: "1" } } } },
    rotations: { "doe-jane": { "2026-12": "OPSC" } },
    daily: {},
    directory: { people: { "lee-sam": { phone: "313-555-0101" } }, places: [] },
    settings: {},
  };
}

test("day resolution reads codes and fill colors", () => {
  const m = createModel(dataset());
  const late = m.day("doe-jane", "2026-11-03");
  assert.equal(late.late, true);
  assert.deepEqual([late.shifts[0].start, late.shifts[0].end], [360, 1080]);
  const fri = m.day("doe-jane", "2026-11-06");
  assert.equal(fri.call, "24");
  assert.equal(fri.shifts[0].end - fri.shifts[0].start, 24 * 60);
  assert.equal(m.day("doe-jane", "2026-11-07").status, "off");
  assert.equal(m.day("doe-jane", "2026-11-08").call, "H2");
  assert.equal(m.day("doe-jane", "2026-11-04").status, "work"); // blank weekday = regular rotation day
  assert.equal(m.day("lee-sam", "2026-11-09").status, "postcall");
  assert.equal(m.day("leed-ana", "2026-11-02").cardiac, true);
  assert.equal(m.day("leed-ana", "2026-11-04").status, "vacation"); // peach block next to "Vac"
  assert.equal(m.day("ortiz-paul", "2026-11-01").call, "10-7");
  assert.equal(m.rotationFor("doe-jane", "2026-12"), "OPSC");
  assert.equal(m.day("doe-jane", "2026-12-02").status, "planned");
});

test("tonight lists night float, seniors and cardiac call", () => {
  const t = createModel(dataset()).tonight("2026-11-02");
  assert.deepEqual(t.night.map((d) => d.pid), ["lee-sam"]);
  assert.deepEqual(t.senior.map((d) => d.pid), ["ortiz-paul"]);
  assert.deepEqual(t.cardiac.map((d) => d.pid), ["leed-ana"]);
});

test("daily sheet roles: rooms, JA by initials, breaks, CRNA rooms", () => {
  const ds = dataset();
  setDaily(ds, "2026-11-03", {
    rooms: [
      { or: "5", surgeon: "Surgeon A", time: "8:00", cases: "2", mda: "Attending A", staff: "Doe/Leed", ja: "PO", breaks: "Lee" },
      { or: "6", surgeon: "Surgeon B", time: "9:00", cases: "1", mda: "Attending B", staff: "X" },
    ],
    night: ["Lee"],
  });
  const m = createModel(ds);
  const doe = m.day("doe-jane", "2026-11-03");
  assert.equal(doe.roles[0].kind, "room");
  assert.equal(doe.roles[0].with[0].id, "leed-ana");
  assert.equal(m.day("ortiz-paul", "2026-11-03").roles[0].kind, "ja");
  assert.equal(m.day("lee-sam", "2026-11-03").roles.find((r) => r.kind === "breaks").rooms[0].or, "5");
  assert.equal(m.daily("2026-11-03").rooms[1].crna, true);
  assert.equal(m.daily("2026-11-03").unmatched.length, 0);
});

test("hours: merges overlapping shifts and flags long stretches", () => {
  const m = createModel(dataset());
  const rep = hoursReport(m, "doe-jane", "2026-11-01", "2026-11-07");
  const week = rep.weeks.find((w) => w.start === "2026-11-01");
  // Mon 11 + Tue 12 (late) + Wed 11 + Thu 11 + Fri 24 (6a Fri - 6a Sat, all inside the week)
  assert.equal(Math.round(week.hours), 69);
  assert.ok(rep.intervals.some((iv) => iv.end - iv.start === 24 * 60));
});

test("gaps: staffing rules, sheet coverage rows", () => {
  const m = createModel(dataset());
  const fri = dayGaps(m, "2026-11-06");
  assert.ok(fri.some((g) => g.kind === "sheet" && /PAT/.test(g.title)));
  assert.ok(fri.some((g) => g.kind === "staffing" && /Friday 24-hr call: 1 of 2/.test(g.title)));
});

test("calendar feed is valid iCalendar with folded lines", () => {
  const m = createModel(dataset());
  const ics = buildIcs(m, "doe-jane", { from: "2026-11-01", to: "2026-12-31" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(ics.includes("DTSTART;TZID=America/Detroit:20261103T060000"));
  assert.ok(ics.includes("DTEND;TZID=America/Detroit:20261107T060000"));
  assert.ok(ics.includes("SUMMARY:Rotation: OPSC"));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test("\"PAT\" in a name cell becomes that day's PAT resident", () => {
  const ds = dataset();
  // 11/3: the call sheet has Van Tran on PAT; the sheet's PAT box is empty.
  setDaily(ds, "2026-11-03", { rooms: [{ or: "5", surgeon: "Surgeon A", staff: "Doe", breaks: "PAT" }] });
  // 11/5: Van Tran is on vacation and Garcia-Lopez covers PAT (bold on the call sheet).
  setDaily(ds, "2026-11-05", { rooms: [{ or: "7", surgeon: "Surgeon B", staff: "Lee", breaks: "PAT" }] });
  const m = createModel(ds);
  assert.equal(m.daily("2026-11-03").rooms[0].breakIds[0].id, "van-tran-kim");
  assert.equal(m.daily("2026-11-05").rooms[0].breakIds[0].id, "garcia-lopez-maria");
  assert.equal(m.day("garcia-lopez-maria", "2026-11-05").roles[0].kind, "breaks");
});

test("the sheet's own PAT box wins over the call sheet", () => {
  const ds = dataset();
  setDaily(ds, "2026-11-03", { rooms: [{ or: "5", staff: "Doe", breaks: "PAT" }], pat: ["Ortiz"] });
  assert.equal(createModel(ds).daily("2026-11-03").rooms[0].breakIds[0].id, "ortiz-paul");
});

test("saved sheets use reference-list spelling and report what changed", () => {
  const ds = dataset();
  const { daily, changes } = setDaily(ds, "2026-11-03", {
    rooms: [{ or: "5", surgeon: "Surgeon A", staff: "Garsia/Leed", ja: "PO", breaks: "PAT" }, { or: "6", staff: "X" }],
    ob: { mda: "Attending C", residents: ["Outside Resident"] },
  });
  assert.equal(daily.rooms[0].staff, "Garcia-Lopez/Leed");
  assert.equal(daily.rooms[0].ja, "Ortiz");
  assert.equal(daily.rooms[0].breaks, "Van Tran");
  assert.equal(daily.rooms[1].staff, "X");
  assert.deepEqual(daily.ob.residents, ["Outside Resident"]);
  assert.deepEqual(changes.map((c) => `${c.from}>${c.to}`).sort(), ["Garsia>Garcia-Lopez", "PAT>Van Tran", "PO>Ortiz"]);
});

test("PAT resident pulled for breaks stays in PAT", () => {
  const ds = dataset();
  setDaily(ds, "2026-11-03", { rooms: [{ or: "5", surgeon: "Surgeon A", staff: "Doe", breaks: "PAT" }], pat: ["Van Tran"] });
  const m = createModel(ds);
  const d = m.day("van-tran-kim", "2026-11-03");
  assert.equal(d.alsoBreaks, true);
  assert.equal(d.roles[0].kind, "pat");
  assert.equal(m.boardGroup(d), "PAT");
  assert.match(headline(d), /^PAT clinic · breaks OR 5$/);
});

import { parseDirectoryText, buildDirectory, createDirectory, dialDigits } from "../public/core/directory.js";
import { headline } from "../public/core/model.js";

const DIR_TEXT = `## Dialing
Ext 5xxxx = 313-555-xxxx
## Residents
Doe, Jane | 313-555-0101 | Pager 7001
Leed, Ana | 313-555-0102
New, Intern | Pager 80001 | PGY-1
Nobody, Here | 313-555-0199
## Anesthesiologists — Harper
Smith, Alex | Cisco 313-555-0201 | Cell 248-555-0202
Patel, Raj | Cisco 313-555-0203
## Anesthesiologists — Sinai-Grace
Patel, Mira | Cisco 313-555-0204
## Harper OR rooms
OR 5 | Ext 51234
OR 18 | Ext 31234
## OPSC rooms
OPSC OR 2 | 555-0300
## Anesthesia lines
Resident board runner | 313-555-0400
On-call fellow | Pager 9999`;

test("directory: parsing, extensions, rooms, residents and attendings", () => {
  const parsed = parseDirectoryText(DIR_TEXT);
  assert.equal(parsed.warnings.length, 0);
  const added = [];
  const built = buildDirectory(parsed, people, { upsert: (name, cls) => { if (!cls) return null; added.push(`${name}|${cls}`); return "new-intern"; } });
  assert.deepEqual(added, ["New, Intern|PGY-1"]);
  assert.deepEqual(built.unmatched, ["Nobody, Here"]);
  assert.equal(built.people["doe-jane"].numbers[1].kind, "pager");
  const ds = { ...dataset(), directory: built };
  const m = createModel(ds);
  const dir = m.dir;
  assert.equal(m.phone("doe-jane"), "3135550101");
  assert.equal(dir.dial(dir.room(5).numbers[0]), "3135551234");
  assert.equal(dir.dial(dir.room(18).numbers[0]), null); // no rule for 3xxxx
  assert.equal(dir.dial(dir.opscRoom(2).numbers[0]), "3135550300"); // 7 digits get 313
  assert.equal(dir.staff("Patel").name, "Patel, Raj"); // the Harper list wins on a Harper sheet
  assert.equal(dir.staff("Patel", { site: "sinai" }).name, "Patel, Mira");
  assert.equal(dir.staff("Smyth").name, "Smith, Alex");
  assert.equal(dialDigits({ kind: "pager", value: "9999" }, built.dialing), null);
  assert.deepEqual(dir.search("board").map((c) => c.name), ["Resident board runner"]);
  assert.deepEqual(dir.search("1234").map((c) => c.name), ["OR 5", "OR 18"]);
});

test("CA-1 obstetrics is the 11 to 9 rotation: Monday to Friday, 11a-9p", async () => {
  const { normCode, rotationCode } = await import("../public/core/codes.js");
  assert.equal(rotationCode("11 to 9"), "11-9");
  assert.equal(rotationCode("11a-9p"), "11-9");
  assert.equal(normCode("11 to 9"), "11-9");
  assert.equal(normCode("9-Nov"), "11-9"); // Excel's date version of "11-9"
  const ds = {
    people,
    months: { "2026-11": { days: 30, rows: {
      "doe-jane": { rotation: "Obstetrics", days: { 2: {}, 3: { t: "OB" }, 4: { t: "11 to 9" }, 7: {} } },
      "leed-ana": { rotation: "Obstetrics", days: { 2: { t: "OB" } } },
    } } },
    rotations: { "lee-sam": { "2026-12": "Obstetrics" } },
    daily: {}, settings: {},
  };
  const model = createModel(ds);
  for (const date of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
    const d = model.day("doe-jane", date);
    assert.equal(d.code, "11-9", date);
    assert.equal(d.label, "11 to 9");
    assert.equal(d.site, "hutzel");
    assert.deepEqual([d.shifts[0].start, d.shifts[0].end], [660, 1260]);
  }
  assert.equal(model.day("doe-jane", "2026-11-07").status, "off"); // Saturday
  assert.equal(model.rotationFor("doe-jane", "2026-11"), "11 to 9");
  assert.equal(model.rotationFor("lee-sam", "2026-12"), "11 to 9"); // planned month, before the call sheet
  const ca2 = model.day("leed-ana", "2026-11-02");
  assert.equal(ca2.code, "OB"); // CA-2 OB is unchanged
  assert.equal(model.rotationFor("leed-ana", "2026-11"), "Obstetrics");
  const t = model.tonight("2026-11-02");
  assert.deepEqual(t.elevenNine.map((d) => d.pid), ["doe-jane"]);
  assert.deepEqual(t.ob.map((d) => d.pid), ["leed-ana"]);
});

test("directory keeps Cisco phones and personal mobiles apart", async () => {
  const { numberText, parseNumber } = await import("../public/core/directory.js");
  assert.equal(parseNumber("Cell 248-555-0202").label, "Mobile"); // "Cell" and "Mobile" are one kind
  assert.equal(parseNumber("cisco 313-555-0201").label, "Cisco");
  const text = `## Residents
Doe, Jane | Cisco 313-555-0101 | Pager 7001
## Resident mobiles
Doe, Jane | 248-555-0111
Leed, Ana | Mobile 248-555-0112 | Cisco 313-555-0102
## Anesthesiologists — Harper
Smith, Alex | Cisco 313-555-0201
## Anesthesiologists — Harper mobiles
Smith, Alex | 248-555-0202`;
  const built = buildDirectory(parseDirectoryText(text), people);
  assert.deepEqual(built.people["doe-jane"].numbers.map((n) => `${n.label} ${n.value}`), ["Cisco 3135550101", "Pager 7001", "Mobile 2485550111"]);
  assert.equal(built.staff.length, 1); // listed twice, one attending
  assert.deepEqual(built.staff[0].numbers.map((n) => n.label), ["Cisco", "Mobile"]);
  const m = createModel({ ...dataset(), directory: built });
  const ana = m.dir.resident("leed-ana");
  assert.equal(ana.primary.label, "Cisco"); // the work phone is the default even if the mobile is listed first
  assert.equal(ana.mobile.value, "2485550112");
  assert.equal(m.phone("leed-ana"), "3135550102");
  assert.equal(numberText(ana.cisco), "Cisco (313) 555-0102");
  assert.equal(numberText(ana.mobile), "Mobile (248) 555-0112");
  assert.deepEqual(m.dir.search("mobile").map((c) => c.name).sort(), ["Ana Leed", "Jane Doe", "Smith, Alex"].sort());
});

const DIDACTICS = {
  month: "2026-11",
  location: "Main Auditorium",
  zoom: [{ key: "wednesday", label: "Wednesday Zoom", url: "https://example.zoom.us/j/111", phones: ["800-555-0100"], meetingId: "111 222 333", passcode: "4444" }],
  events: [
    { date: "2026-11-04", start: "06:00", end: "06:30", series: "wednesday", kind: "pbld", title: "Problem Based Learning Discussion (PBLD)", people: [{ name: "Dr. Lee", role: "faculty" }], zoom: "wednesday" },
    { date: "2026-11-04", start: "06:30", end: "07:30", series: "wednesday", kind: "grand-rounds", title: "Airway Fires", people: [{ name: "J. DOE", role: "presenter" }], zoom: "wednesday", cme: true },
    { date: "2026-11-03", start: "17:00", end: "18:00", series: "other", kind: "board-review", title: "Review", people: [{ name: "Leed", role: "presenter", topic: "Acid-base" }, { name: "Dr. Smith", role: "moderator" }], virtual: true },
    { date: "2026-11-06", start: "06:10", end: "06:45", series: "friday", kind: "mock-oral", title: "Mock Oral Board Examination", people: [{ name: "Dr. Smith", role: "examiner" }, { name: "Ortiz", role: "examinee", start: "06:00", end: "06:30" }, { name: "KVT", role: "examinee", start: "6:30am", end: "7:00am" }] },
    { date: "2026-11-25", start: "06:00", end: "07:30", series: "wednesday", kind: "none", title: "No Lecture" },
    { date: "2026-12-01", start: "06:00", kind: "lecture", title: "Wrong month" },
  ],
};

test("didactics: cleaning, roster names, assignments, conflicts and the calendar", async () => {
  const { setDidactics } = await import("../lib/dataset.js");
  const { zoomTelHref, eventHeadline, residentsOf, relevantTo, parseClock } = await import("../public/core/didactics.js");
  assert.equal(parseClock("5:00 PM"), 1020);
  assert.equal(parseClock("6:30am"), 390);
  const ds = { ...dataset() };
  const { didactics, changes } = setDidactics(ds, "2026-11", DIDACTICS);
  assert.equal(didactics.events.length, 5); // December row dropped
  assert.deepEqual(changes.map((c) => `${c.from}>${c.to}`).sort(), ["J. DOE>Doe", "KVT>Van Tran"]);
  const m = createModel(ds);
  const D = m.didactics;
  const wed = D.on("2026-11-04");
  assert.equal(eventHeadline(wed[0]), "PBLD · Dr. Lee");
  assert.equal(wed[0].people[0].pid, null); // "Dr. Lee" is faculty, not resident Lee
  assert.equal(eventHeadline(wed[1]), "Grand Rounds: Airway Fires");
  assert.equal(wed[1].place, "Main Auditorium");
  assert.equal(D.on("2026-11-03")[0].place, "Virtual (Zoom)");
  const mock = D.on("2026-11-06")[0];
  assert.deepEqual(residentsOf(mock).map((p) => [p.pid, p.start]), [["ortiz-paul", 360], ["van-tran-kim", 390]]);
  assert.equal(relevantTo(mock, "ortiz-paul"), true);
  assert.equal(relevantTo(mock, "doe-jane"), false); // mock orals only for those examined
  assert.deepEqual(D.forPerson("doe-jane", "2026-11-01", "2026-11-30").map((a) => [a.event.date, a.role]), [["2026-11-04", "presenter"]]);
  assert.equal(D.conflict("leed-ana", "2026-11-03", 1020), "You're on vacation that day");
  assert.equal(zoomTelHref(wed[0].zoomLink), "tel:+18005550100,,111222333%23,,,,*4444%23");
  assert.equal(D.upcoming("2026-11-25", 0).length, 0); // the cancelled week is skipped

  const ics = buildIcs(m, "doe-jane", { from: "2026-11-01", to: "2026-11-30" });
  assert.match(ics, /SUMMARY:You present: Grand Rounds: Airway Fires/);
  assert.match(ics, /SUMMARY:PBLD · Dr. Lee/);
  assert.match(ics, /URL:https:\/\/example.zoom.us\/j\/111/);
  assert.doesNotMatch(ics, /Mock orals/);
  assert.match(buildIcs(m, "ortiz-paul", { from: "2026-11-01", to: "2026-11-30" }), /SUMMARY:Your mock oral · Dr. Smith/);
  assert.doesNotMatch(buildIcs(m, "doe-jane", { from: "2026-11-01", to: "2026-11-30", didactics: false }), /Airway Fires/);

  // Saving the stored month again (as the editor does) keeps everything, slots included.
  const before = JSON.stringify(ds.didactics["2026-11"].events);
  setDidactics(ds, "2026-11", ds.didactics["2026-11"]);
  assert.equal(JSON.stringify(ds.didactics["2026-11"].events), before);
});

test("didactics reader sends the PDF to Claude and returns the parsed schedule", async () => {
  const { readDidacticsPdf } = await import("../lib/didactics-parse.js");
  let sent;
  const client = { beta: { messages: { stream: (params) => { sent = params; return { finalMessage: async () => ({ stop_reason: "end_turn", model: "claude-opus-5-5", usage: {}, parsed_output: DIDACTICS }) }; } } } };
  const out = await readDidacticsPdf({ bytes: new Uint8Array([37, 80, 68, 70]), today: "2026-11-05", residents: [{ last: "Doe", name: "Jane Doe", cls: "CA-1" }], client });
  assert.equal(out.didactics.month, "2026-11");
  assert.equal(sent.model, "claude-opus-5-5");
  assert.equal(sent.output_config.format.type, "json_schema");
  const [doc, text] = sent.messages[0].content;
  assert.deepEqual([doc.type, doc.source.type, doc.source.media_type, doc.source.data], ["document", "base64", "application/pdf", "JVBERg=="]);
  assert.match(text.text, /Doe: Jane Doe, CA-1/);
});

test("people who left: directory cleanup and removing someone", async () => {
  const { setDirectory, removePerson } = await import("../lib/dataset.js");
  const ds = { ...dataset(), people: people.map((p) => ({ ...p })), log: [] };
  // An intern added from an older card, with no schedule anywhere.
  setDirectory(ds, { text: "## Residents\nGone, Former | Pager 80001 | PGY-1\nDoe, Jane | Cisco 313-555-0101" });
  assert.ok(ds.people.some((p) => p.last === "Gone"));
  const s = setDirectory(ds, { text: "## Residents\nDoe, Jane | Cisco 313-555-0101" });
  assert.deepEqual(s.removed, ["Gone, Former"]);
  assert.ok(!ds.people.some((p) => p.last === "Gone"));
  assert.ok(ds.people.some((p) => p.id === "lee-sam")); // not listed, but on the call sheet: kept
  // Removing someone also drops their call-sheet rows, rotations and numbers.
  assert.equal(removePerson(ds, "doe-jane").id, "doe-jane");
  assert.equal(ds.months["2026-11"].rows["doe-jane"], undefined);
  assert.equal(ds.rotations["doe-jane"], undefined);
  assert.equal(ds.directory.people["doe-jane"], undefined);
  assert.equal(createModel(ds).person("doe-jane"), undefined);
  assert.equal(removePerson(ds, "nobody"), null);
});
