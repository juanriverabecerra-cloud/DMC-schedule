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
  // Mon 12 + Tue 12 (late) + Wed 12 + Thu 12 + Fri 24 (6a Fri - 6a Sat, all inside the week)
  assert.equal(Math.round(week.hours), 72);
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

import { parseDirectoryText, buildDirectory, dialDigits } from "../public/core/directory.js";
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
  assert.equal(ana.primary.label, "Mobile"); // the mobile is called first
  assert.equal(m.dir.resident("doe-jane").primary.label, "Mobile"); // even when Cisco is listed first
  assert.deepEqual(m.dir.resident("doe-jane").numbers.map((n) => n.label), ["Mobile", "Cisco", "Pager"]);
  assert.equal(m.dir.primary(built.staff[0].numbers).label, "Mobile");
  assert.deepEqual(m.dir.inCallOrder(built.staff[0].numbers).map((n) => n.label), ["Mobile", "Cisco"]); // the default comes first on screen too
  assert.equal(ana.work.label, "Cisco"); // calendar feeds keep to the work phone
  assert.equal(m.dir.workPhone(built.staff[0].numbers).label, "Cisco");
  assert.equal(ana.mobile.value, "2485550112");
  assert.equal(m.phone("leed-ana"), "2485550112");
  assert.equal(numberText(ana.cisco), "Cisco (313) 555-0102");
  assert.equal(numberText(ana.mobile), "Mobile (248) 555-0112");
  assert.deepEqual(m.dir.search("mobile").map((c) => c.name).sort(), ["Ana Leed", "Jane Doe", "Smith, Alex"].sort());
});

const LOGGED_ROWS = [
  ["Rotation on 11/1/2026 ROTATION - PRG-2"],
  ["M", "11/2/2026 6:00 AM", "11/2/2026 4:00 PM", "10", "Rotation Daily Duties & Assignments", "Res", "Res", "11/5/2026 7:51 AM"],
  ["Tu", "11/3/2026 6:00 AM", "11/3/2026 5:30 PM", "11.5", "Rotation Daily Duties & Assignments", "Res", "Res", "Never - See Details"],
  ["W", "11/4/2026 6:00 AM", "11/4/2026 2:30 PM", "8.5", "Rotation Daily Duties & Assignments", "Res", "Res", "Never - See Details"],
  ["Th", "11/5/2026 8:00 AM", "11/5/2026 6:00 PM", "10", "Conference/Didactics", "Res", "Res", "Never - See Details"],
  ["F", "11/6/2026 6:00 PM", "11/7/2026 6:00 AM", "12", "Rotation Daily Duties & Assignments", "Res", "Res", "Never - See Details"],
  ["52"], ["52.00"], ["Export To Excel"],
];

test("logged hours: reads the page however it was copied, and checks the total", async () => {
  const { parseLoggedHours, mergeEntries } = await import("../public/core/logged.js");
  const copies = [
    LOGGED_ROWS.map((r) => r.join("\t")).join("\n"), // the table's tabs survive
    LOGGED_ROWS.flat().join("\n"), // each cell on its own line, as phones tend to copy
    LOGGED_ROWS.flat().join(" "), // one long line
  ];
  for (const copy of copies) {
    const p = parseLoggedHours(copy);
    assert.equal(p.entries.length, 5);
    assert.equal(p.summed, 52);
    assert.equal(p.total, 52);
    assert.equal(p.entries[3].type, "Conference/Didactics");
    assert.equal(p.entries[0].type, "Rotation Daily Duties & Assignments");
    assert.deepEqual([p.entries[4].date, p.entries[4].start, p.entries[4].endDate, p.entries[4].end], ["2026-11-06", 1080, "2026-11-07", 360]);
  }
  assert.equal(parseLoggedHours("Nothing useful here 10/21/2026 7:51 AM").entries.length, 0);

  const first = parseLoggedHours(copies[0]).entries;
  const fixed = parseLoggedHours("M 11/2/2026 6:00 AM 11/2/2026 3:00 PM 9 Rotation").entries;
  const merged = mergeEntries(first, fixed);
  assert.equal(merged.length, 5);
  assert.equal(merged[0].hours, 9); // a corrected day carries through
  const older = parseLoggedHours("M 10/5/2026 6:00 AM 10/5/2026 4:00 PM 10 Rotation").entries;
  assert.equal(mergeEntries(first, older).length, 6); // an older file adds to the record
  const newer = parseLoggedHours("M 12/7/2026 6:00 AM 12/7/2026 4:00 PM 10 Rotation").entries;
  assert.equal(mergeEntries(first, newer).length, 6); // so does a newer one
  const spread = parseLoggedHours(`M 11/2/2026 6:00 AM 11/2/2026 3:00 PM 9 Rotation
F 11/6/2026 6:00 AM 11/6/2026 3:00 PM 9 Rotation`).entries;
  assert.equal(mergeEntries(first, spread).length, 5); // days between the file's first and last stay
  assert.equal(mergeEntries(mergeEntries(first, older), older).length, 6); // the same file twice changes nothing
});

test("logged hours: the export file, vacation, rotations and years with no call sheet", async () => {
  const { parseLoggedHours, compareLogged, hoursByRotation, actualHours } = await import("../public/core/logged.js");
  const row = (w, a, b, hrs, type) => `<tr data-log-id="1" data-sel="0"><td data-chk="1"></td><td data-wkday="1" style="mso-number-format:0\\.00;">${w}</td><td data-sdate="1">${a}</td><td data-edate="1">${b}</td><td data-hrs="1">${hrs}</td><td data-dt="1">${type}</td><td data-src="1">Res</td><td data-apr="1">Res</td><td data-chkdate="1">&nbsp;</td></tr>`;
  const html = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML//EN"><html><head><style>td { color: red }</style></head><body><table><thead><tr><th>Start</th><th>End</th></tr></thead><tbody>
<tr><td colspan="9">Rotation on 7/1/2025 WARDS-A - PRG-1</td></tr>
${row("Su", "7/6/2025 7:00 AM", "7/7/2025 7:30 AM", "24.5", "Call")}
${row("W", "7/9/2025 6:00 AM", "7/9/2025 6:00 PM", "12", "Rotation Daily Duties &amp; Assignments")}
${row("Th", "7/10/2025 12:00 AM", "7/11/2025 12:00 AM", "24", "Vacation")}
<tr><td colspan="9">Rotation on 7/14/2025 CLINIC-B - PRG-1</td></tr>
${row("M", "7/14/2025 8:00 AM", "7/14/2025 5:00 PM", "9", "Rotation Daily Duties &amp; Assignments")}
</tbody><tfoot><tr><td>&nbsp;</td><td>69.50</td><td>&nbsp;</td></tr></tfoot></table></body></html>`;
  const p = parseLoggedHours(html);
  assert.equal(p.entries.length, 4);
  assert.equal(p.total, 69.5); // the page's total includes vacation
  assert.equal(p.summed, 69.5);
  assert.equal(p.worked, 45.5); // work doesn't
  assert.equal(p.entries[1].type, "Rotation Daily Duties & Assignments");
  assert.deepEqual(p.entries.map((e) => e.rotation), ["WARDS-A", "WARDS-A", "WARDS-A", "CLINIC-B"]);

  const m = createModel(fairnessDataset()); // this resident has no call sheet in 2025
  const cmp = compareLogged(m, "c", p.entries);
  assert.equal(cmp.noSheet, 2);
  assert.deepEqual(cmp.offDays, []); // no sheet isn't the same as a day off
  assert.deepEqual(cmp.rows.map((r) => [r.label, r.days, r.avg]), [["24-hr call", 1, 24.5]]); // a logged 24 counts anyway

  const wards = hoursByRotation(p.entries).find((r) => r.name === "WARDS-A");
  assert.equal(wards.hours, 36.5); // vacation isn't work

  const actual = actualHours(m, "c", p.entries);
  const week = hoursReport(m, "c", "2025-07-06", "2025-07-12", { actual }).weeks.find((w) => w.start === "2025-07-06");
  assert.equal(week.known, true); // logged days need no call sheet
  assert.equal(week.hours, 36.5);
  assert.equal(week.away, 1);
});

test("logged hours replace the estimate, and your averages shape what's ahead", async () => {
  const { actualHours, compareLogged, outlook, parseLoggedHours } = await import("../public/core/logged.js");
  const ds = fairnessDataset();
  const rows = ds.months["2026-11"].rows;
  for (const day of [2, 3, 4, 5, 9, 10, 11, 12]) rows.c.days[day] = { t: "BA" };
  const m = createModel(ds);
  const text = `M 11/2/2026 6:00 AM 11/2/2026 4:00 PM 10 Rotation Daily Duties
Tu 11/3/2026 6:00 AM 11/3/2026 4:00 PM 10 Rotation Daily Duties
W 11/4/2026 6:00 AM 11/4/2026 4:00 PM 10 Rotation Daily Duties
Th 11/5/2026 8:00 AM 11/5/2026 6:00 PM 10 Conference/Didactics
Sa 11/7/2026 6:00 AM 11/7/2026 2:00 PM 8 Rotation Daily Duties`;
  const { entries } = parseLoggedHours(text);
  const cmp = compareLogged(m, "c", entries);
  assert.equal(cmp.conference, 1); // counted in hours, not in the rotation's average
  assert.deepEqual(cmp.offDays, ["2026-11-07"]); // the sheet shows Saturday off
  assert.deepEqual(cmp.rows.map((r) => [r.label, r.days, r.avg, r.estAvg, r.diff]), [["Basic Anesthesia", 3, 10, 12, -2]]);

  const actual = actualHours(m, "c", entries);
  assert.deepEqual([actual.first, actual.last], ["2026-11-02", "2026-11-07"]);
  assert.equal(actual.learned["rot:Basic Anesthesia"], 10);

  const estimate = hoursReport(m, "c", "2026-11-01", "2026-11-14");
  const real = hoursReport(m, "c", "2026-11-01", "2026-11-14", { actual });
  const week = (rep, start) => rep.weeks.find((w) => w.start === start);
  assert.equal(week(estimate, "2026-11-01").hours, 60); // five 12-hour days on the schedule
  assert.equal(week(real, "2026-11-01").hours, 48); // 10 + 10 + 10 + 10 + 8 as logged; Friday wasn't
  assert.equal(week(estimate, "2026-11-08").hours, 60);
  assert.equal(week(real, "2026-11-08").hours, 50); // the same five days at your 10-hour average
  const view = outlook(real, "2026-11-07", actual);
  assert.equal(view.allLogged, false); // under four weeks logged, so the average leans on estimates
  assert.equal(actual.expected(m.day("d", "2026-11-02")), null); // too few days to guess at a new rotation

  const more = parseLoggedHours(`${text}
M 11/9/2026 6:00 AM 11/9/2026 4:00 PM 10 Rotation Daily Duties
Tu 11/10/2026 6:00 AM 11/10/2026 4:00 PM 10 Rotation Daily Duties
W 11/11/2026 6:00 AM 11/11/2026 4:00 PM 10 Rotation Daily Duties`).entries;
  const later = actualHours(m, "c", more);
  assert.equal(later.usual, 10);
  assert.equal(later.expected(m.day("d", "2026-11-02")), 10); // a new rotation starts from your usual day
});

test("anesthesia techs are one list for every room, and 3xxxx extensions dial", () => {
  const text = `## Dialing
Ext 3xxxx = 313-993-xxxx
## Harper OR rooms
OR 17 | Ext 30001
## Anesthesia techs
Alex | Cisco 313-555-0301
Sam | Cisco 313-555-0302
## Pharmacy
Pharmacy OR | Ext 30002 | Open 6a to 2:15p
## Harper units
2 Webber North | 313-555-0303 | Rooms 2201-2220`;
  const built = buildDirectory(parseDirectoryText(text), people);
  const m = createModel({ ...dataset(), directory: built });
  assert.deepEqual(m.dir.techs().map((t) => t.name), ["Alex", "Sam"]);
  assert.deepEqual(m.dir.search("tech").map((c) => c.name), ["Alex", "Sam"]);
  assert.equal(m.dir.dial(m.dir.room("17").numbers[0]), "3139930001");
  const pharmacy = m.dir.place(/^pharmacy or/i);
  assert.deepEqual(pharmacy.notes, ["Open 6a to 2:15p"]);
  assert.deepEqual(m.dir.place(/^2 webber/i).notes, ["Rooms 2201-2220"]); // a room range is a note, not a number
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

// Sunday-Saturday in November 2026: the 1st is a Sunday.
function fairnessDataset() {
  const ca1 = (id, last) => ({ id, last, first: "Test", preferred: "Test", cls: "CA-1", canonical: `${last}, Test`, aliases: [] });
  const rows = {
    a: { rotation: "Basic Anesthesia", days: { 2: { t: "BA" }, 7: { t: "H1" }, 13: { t: "BA", f: "C9DAF8" }, 15: { t: "H2" }, 3: { t: "BA", f: "00FF00" } } },
    b: { rotation: "Basic Anesthesia", days: { 1: { t: "NF" }, 2: { t: "NF" }, 3: { t: "NF" }, 4: { t: "NF" }, 5: { t: "NF" }, 6: {} } },
    c: { rotation: "Basic Anesthesia", days: { 2: { t: "BA" } } },
    d: { rotation: "Obstetrics", days: { 2: { t: "11-9" } } },
    e: { rotation: "Elective - Jeopardy", days: { 2: { t: "ELECT-J" } } },
    f: { rotation: "Basic Anesthesia", days: { 9: { f: "FFCFB3" }, 10: { f: "FFCFB3" }, 11: { f: "FFCFB3" }, 12: { f: "FFCFB3" } } },
  };
  return {
    people: ["a", "b", "c", "d", "e", "f"].map((id) => ca1(id, `Res${id.toUpperCase()}`)),
    months: { "2026-11": { rows, days: 30 } },
    daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] },
  };
}

test("reading call sheets: colors by family, Friday markers, and the day off after nights", async () => {
  const { fillFamily, normCode } = await import("../public/core/codes.js");
  assert.equal(fillFamily("FFCFB3"), "off");
  assert.equal(fillFamily("A4C2F4"), "call24");
  assert.equal(fillFamily("11EE11"), "late");
  assert.equal(fillFamily("F3F3F3"), null);
  assert.equal(normCode("BA1"), "BA");
  assert.equal(normCode("OB1"), "OB1"); // its own code
  assert.equal(normCode("PEDS"), "CHM");
  const m = createModel(fairnessDataset());
  assert.equal(m.day("b", "2026-11-06").status, "postcall"); // blank Friday after nights
  assert.equal(m.day("a", "2026-11-13").call, "24");
  assert.equal(m.day("f", "2026-11-10").status, "vacation"); // a peach block with nothing written
});

test("fairness: weighted shifts, fair share, grades and who can cover", async () => {
  const { residentLoad, fairnessReport, coverOptions, gradeOf, weightsOf, dayItems, DEFAULT_WEIGHTS } = await import("../public/core/fairness.js");
  const { setFairness } = await import("../lib/dataset.js");
  const ds = fairnessDataset();
  const m = createModel(ds);
  const period = { from: "2026-11-01", to: "2026-11-30" };
  // A Saturday 24 is worth more than a Friday 24.
  assert.ok(DEFAULT_WEIGHTS.sat24 > DEFAULT_WEIGHTS.fri24);
  const a = residentLoad(m, "a", period.from, period.to);
  assert.deepEqual(a.counts, { sat24: 1, fri24: 1, h2sun: 1, late: 1, stack: 2 });
  assert.equal(a.points, 10 + 6 + 6 + 1 + 2 * 2);
  assert.equal(residentLoad(m, "b", period.from, period.to).points, 12.5); // five nights
  // Time on a no-call rotation doesn't count as available.
  assert.equal(residentLoad(m, "d", period.from, period.to).eligible, 0);
  const rep = fairnessReport(m, period);
  const row = (id) => rep.classes[0].rows.find((r) => r.pid === id);
  assert.ok(Math.abs(rep.classes[0].rows.reduce((s, r) => s + r.balance, 0)) < 1e-9); // balances net to zero
  assert.ok(row("a").balance > 0 && row("c").balance < 0);
  assert.equal(row("d").load, null); // nothing to compare
  assert.equal(gradeOf(0.05), "A");
  assert.equal(gradeOf(0.6), "F");
  // Sick on Saturday: backup first, people on nights or no-call rotations left out with a reason.
  const c = coverOptions(m, "a", "2026-11-07", { report: rep });
  assert.equal(c.shift.key, "sat24");
  assert.equal(c.options[0].pid, "e");
  assert.equal(c.options[0].backup, true);
  assert.match(c.blocked.find((b) => b.pid === "d").why, /takes no call/);
  // Nights earlier in the week don't block a Saturday: the ACGME limit is the 4-week average.
  assert.equal(c.options.find((o) => o.pid === "b").projected, 78);
  // Editing the points changes the score; bad values are ignored.
  setFairness(ds, { weights: { sat24: 20, late: "x" } });
  const m2 = createModel(ds);
  assert.equal(weightsOf(m2).sat24, 20);
  assert.equal(weightsOf(m2).late, 1);
  assert.deepEqual(dayItems(m2.day("a", "2026-11-07"), weightsOf(m2)), [{ key: "sat24", pts: 20 }]);
});

test("someone only on older sheets leaves the roster but keeps their history", async () => {
  const { mergeCallWorkbook } = await import("../lib/dataset.js");
  assert.equal(typeof mergeCallWorkbook, "function");
  const ds = fairnessDataset();
  ds.months["2026-10"] = { rows: { z: { rotation: "VA", days: { 5: { t: "VA" } } } }, days: 31 };
  ds.people.push({ id: "z", last: "ResZ", first: "Test", preferred: "Test", cls: "CA-1", former: true, canonical: "ResZ, Test", aliases: [] });
  const m = createModel(ds);
  assert.ok(!m.people.some((p) => p.id === "z"));
  assert.ok(!m.roster("2026-11-02").some((d) => d.pid === "z"));
  assert.equal(m.person("z").last, "ResZ");
  assert.equal(m.day("z", "2026-10-05").code, "VA");
});

test("the jeopardy resident is first for any class; everyone else stays in their class", async () => {
  const { coverOptions } = await import("../public/core/fairness.js");
  const ds = fairnessDataset();
  ds.people.find((p) => p.id === "e").cls = "CA-3";
  ds.people.find((p) => p.id === "c").cls = "CA-2";
  const c = coverOptions(createModel(ds), "a", "2026-11-07");
  assert.equal(c.options[0].pid, "e");
  assert.equal(c.options[0].cls, "CA-3");
  assert.ok(!c.options.some((o) => o.pid === "c")); // a CA-2 doesn't cover a CA-1
  const wide = coverOptions(createModel(ds), "a", "2026-11-07", { allClasses: true });
  assert.ok(wide.options.some((o) => o.pid === "c"));
});

test("a Friday late day scores on its own, because it runs into the weekend", async () => {
  const { dayItems, DEFAULT_WEIGHTS, WEIGHT_ROWS, COLUMNS } = await import("../public/core/fairness.js");
  const { SURVEY_ROWS } = await import("../public/core/survey.js");
  assert.ok(DEFAULT_WEIGHTS.lateFri > DEFAULT_WEIGHTS.late);
  const late = (dow) => ({ status: "work", late: true, dow, shifts: [], roles: [] });
  assert.deepEqual(dayItems(late(5), DEFAULT_WEIGHTS).map((i) => i.key), ["lateFri"]);
  assert.deepEqual(dayItems(late(4), DEFAULT_WEIGHTS).map((i) => i.key), ["late"]);
  assert.ok(SURVEY_ROWS.some(([key]) => key === "lateFri")); // residents rate it separately
  assert.ok(WEIGHT_ROWS.some(([key]) => key === "lateFri")); // admins can change it
  assert.deepEqual(COLUMNS.find(([key]) => key === "late")[2], ["late", "lateFri"]); // tables still show one Late column
});

test("reminders: one at a time, for residents who haven't done it, and Later comes back", async () => {
  const { nextReminder, pendingReminders, snoozeReminder } = await import("../public/core/reminders.js");
  const today = "2026-11-07";
  assert.deepEqual(pendingReminders({ cls: "CA-1" }), ["hours", "rate"]);
  assert.deepEqual(pendingReminders({ cls: "CA-1", hasHours: true }), ["rate"]);
  assert.deepEqual(pendingReminders({ cls: "CA-1", hasHours: true, hasRated: true }), []);
  assert.deepEqual(pendingReminders({ cls: "PGY-1" }), []);
  assert.deepEqual(pendingReminders({}), []); // nobody picked yet
  const both = ["hours", "rate"];
  assert.equal(nextReminder(both, {}, today), "hours");
  const later = snoozeReminder({}, "hours", today);
  assert.equal(later.hours, "2026-11-10");
  assert.equal(nextReminder(both, later, today), "rate"); // the other one takes its turn
  assert.equal(nextReminder(["hours"], later, "2026-11-09"), null);
  assert.equal(nextReminder(["hours"], later, "2026-11-10"), "hours"); // and it comes back
});

test("a breaks day is lighter and ends early; someone pulled from their post keeps their day", async () => {
  const { dayItems, DEFAULT_WEIGHTS } = await import("../public/core/fairness.js");
  const ds = fairnessDataset();
  ds.months["2026-11"].rows.c.rotation = "PAT";
  ds.months["2026-11"].rows.c.days[3] = { t: "PAT" };
  ds.months["2026-11"].rows.a.days[3] = { t: "BA" };
  ds.daily["2026-11-03"] = { date: "2026-11-03", rooms: [{ or: "1", staff: "X", ja: "", breaks: "ResA" }, { or: "2", staff: "X", ja: "", breaks: "PAT" }], opsc: {}, ob: {}, pat: [], night: [] };
  const m = createModel(ds);
  const giver = m.day("a", "2026-11-03");
  assert.equal(giver.breaksDay, true);
  assert.equal(giver.shifts[0].end, 900); // done by 3p
  assert.ok(DEFAULT_WEIGHTS.breaks < 0);
  assert.deepEqual(dayItems(giver, DEFAULT_WEIGHTS), [{ key: "breaks", pts: DEFAULT_WEIGHTS.breaks }]);
  const post = m.day("c", "2026-11-03");
  assert.equal(post.alsoBreaks, true);
  assert.deepEqual(dayItems(post, DEFAULT_WEIGHTS), [{ key: "breaks", pts: 0 }]); // counted, not scored
});

test("AP in the Breaks column means the most senior on Acute Pain who isn't on a call shift", () => {
  const ds = fairnessDataset();
  const cls = { a: "CA-1", c: "CA-2", e: "CA-3" };
  for (const p of ds.people) if (cls[p.id]) p.cls = cls[p.id];
  for (const id of Object.keys(cls)) {
    ds.months["2026-11"].rows[id].rotation = "Acute Pain";
    ds.months["2026-11"].rows[id].days[3] = { t: "AP" };
  }
  const sheet = { date: "2026-11-03", rooms: [{ or: "1", staff: "X", ja: "", breaks: "AP" }], opsc: {}, ob: {}, pat: [], night: [] };
  ds.daily["2026-11-03"] = sheet;
  let m = createModel(ds);
  assert.equal(m.day("e", "2026-11-03").alsoBreaks, true); // the CA-3 keeps their post
  assert.equal(m.day("a", "2026-11-03").roles.some((r) => r.kind === "breaks"), false);

  ds.months["2026-11"].rows.e.days[3] = { t: "10-7" };
  m = createModel(ds);
  assert.equal(m.day("e", "2026-11-03").call, "10-7");
  assert.equal(m.day("e", "2026-11-03").code, "AP");
  assert.equal(m.day("e", "2026-11-03").roles.some((r) => r.kind === "breaks"), false);
  assert.equal(m.day("c", "2026-11-03").alsoBreaks, true); // next most senior
});

test("after a 24: a blank day is post-call, and anything listed is flagged, not a 36-hour shift", () => {
  const ds = fairnessDataset();
  const days = { 6: { t: "BA", f: "C9DAF8" }, 7: { t: "SIM" } };
  ds.months["2026-11"].rows.c.days = days;
  ds.months["2026-11"].rows.f.days = { 1: { t: "H1" } };
  const m = createModel(ds);
  assert.equal(m.day("f", "2026-11-02").status, "postcall");
  const rep = hoursReport(m, "c", "2026-11-01", "2026-11-14");
  assert.ok(!rep.flags.some((f) => f.rule === "6.22"));
  assert.ok(rep.flags.some((f) => f.rule === "postcall" && /SIM/.test(f.text)));
});

test("ACGME: rolling limits use the 4-week window", () => {
  const ds = fairnessDataset();
  const week = {};
  // In-house call every other night for four weeks is over the every-third-night limit.
  for (let d = 1; d <= 28; d += 2) week[d] = { t: "H1" };
  ds.months["2026-11"].rows.c.days = week;
  const rep = hoursReport(createModel(ds), "c", "2026-11-01", "2026-11-30");
  assert.ok(rep.flags.some((f) => f.rule === "6.27" && f.level === "gap"));
  // A single heavy week is a warning, not a broken limit.
  assert.ok(rep.flags.filter((f) => f.rule === "week").every((f) => f.level === "warn"));
});

test("years stay apart: class comes from that year's list, rotators and interns aren't scored", async () => {
  const { fairnessReport, rosterOf, academicYears, yearRange } = await import("../public/core/fairness.js");
  const ds = fairnessDataset();
  ds.months["2026-06"] = { days: 30, rows: { a: { cls: "PGY-1", rotation: "", days: { 3: { t: "H" } } }, visitor: { cls: "CA-3", rotation: "Obstetrics", days: {} } } };
  ds.people.push({ id: "visitor", last: "Visitor", first: "Test", preferred: "Test", cls: "CA-3", former: true, canonical: "Visitor, Test", aliases: [] });
  ds.rosters = { 2026: { a: "CA-1", b: "CA-1", c: "CA-1" }, 2025: { b: "CA-3" } };
  const m = createModel(ds);
  assert.deepEqual(academicYears(m), [2026, 2025]);
  assert.equal(rosterOf(m, 2025).visitor, undefined);
  assert.equal(m.classAt("a", "2026-06"), "PGY-1");
  assert.equal(m.classAt("a", "2026-11"), "CA-1");
  assert.equal(fairnessReport(m, yearRange(m, "2026-11-06", 2026)).classes[0].rows.length, 3);
  assert.deepEqual(yearRange(m, "2026-11-06", 2025), { from: "2025-07-01", to: "2026-06-30" });
});

test("sheets write holidays and names many ways", async () => {
  const { sameName, splitName } = await import("../public/core/names.js");
  const { isHolidayText, normCode } = await import("../public/core/codes.js");
  assert.ok(sameName(splitName("Smith Jones, Alexander"), splitName("Smith, Alexandor")));
  assert.ok(!sameName(splitName("Smith, Adam"), splitName("Smith, Betty")));
  for (const t of ["HOLIDAY", "HOLIDA", "Holiday", "LABOR **  DAY **   HOL IDAY"]) assert.ok(isHolidayText(t), t);
  assert.ok(!isHolidayText("H1"));
  assert.equal(normCode("post call"), "PC");
  assert.equal(normCode("OSPC"), "OPSC");
  assert.equal(normCode("ITE-H1"), "H1");
  const ds = fairnessDataset();
  const rows = ds.months["2026-11"].rows;
  "HOLIDAY".split("").slice(0, 6).forEach((ch, i) => { rows["abcdef"[i]].days[26] = { t: ch }; });
  const m = createModel(ds);
  assert.ok(m.holidays("2026-11").has(26));
  assert.equal(m.day("a", "2026-11-26").status, "holiday");
});

test("minimums are typed in, saved and checked against the day", async () => {
  const { setFairness } = await import("../lib/dataset.js");
  const { serviceCoverage, shortOn } = await import("../public/core/fairness.js");
  const ds = fairnessDataset();
  ds.fairness = {};
  ds.log = [];
  setFairness(ds, { weights: { breaks: -2 } });
  setFairness(ds, { minimums: { Obstetrics: { "CA-1": "2", "CA-2": "" }, "Acute Pain": { "CA-1": "1" } } });
  assert.equal(ds.fairness.weights.breaks, -2); // saving one kind leaves the other alone
  assert.deepEqual(ds.fairness.minimums, { Obstetrics: { "CA-1": 2 }, "Acute Pain": { "CA-1": 1 } });
  const m = createModel(ds);
  assert.deepEqual(shortOn(m, "2026-11-02").map((x) => [x.group, x.have, x.min]), [["Obstetrics", 1, 2], ["Acute Pain", 0, 1]]);
  const row = serviceCoverage(m, "2026-11").services.find((x) => x.group === "Acute Pain");
  assert.equal(row.min, 1);
  assert.equal(row.zero.length, 20); // 21 weekdays, less Thanksgiving
});

test("shift ratings: combined only, and small groups stay hidden", async () => {
  const { cleanScores, summarizeSurvey, SURVEY_ROWS } = await import("../public/core/survey.js");
  assert.deepEqual(cleanScores({ fri24: "7", nope: 3, late: 99, nf: "", sat24: 12 }), { fri24: 7, late: 15, sat24: 12 });
  assert.equal(SURVEY_ROWS[0][0], "sat24"); // residents rate the Saturday 24 too; some find it worse than others
  assert.ok(!SURVEY_ROWS.some(([key]) => key === "stack"));
  assert.deepEqual(summarizeSurvey([8, 12, 14].map((sat24) => ({ cls: "CA-1", scores: { sat24 } }))).shifts.sat24, { n: 3, median: 12, low: 8, high: 14, classes: { "CA-1": 12 } });
  const res = summarizeSurvey([
    { cls: "CA-1", scores: { fri24: 4 } }, { cls: "CA-1", scores: { fri24: 6 } }, { cls: "CA-1", scores: { fri24: 8 } },
    { cls: "CA-3", scores: { fri24: 10 } }, { cls: "CA-2", scores: {} },
  ]);
  assert.equal(res.count, 4);
  assert.deepEqual(res.shifts.fri24, { n: 4, median: 7, low: 4, high: 10, classes: { "CA-1": 6 } });
  // One or two answers would be someone's own, so they stay hidden.
  assert.deepEqual(summarizeSurvey([{ cls: "CA-1", scores: { fri24: 4 } }, { cls: "CA-1", scores: { fri24: 6 } }]).shifts, {});
});

test("the weekly call pattern: 24s on Fri/Sat, 12s on Sat/Sun, nights Sun-Thu; anything else is flagged", async () => {
  const { dayItems, DEFAULT_WEIGHTS, WEIGHT_ROWS } = await import("../public/core/fairness.js");
  const { isFixedHoliday } = await import("../public/core/dates.js");
  const keys = WEIGHT_ROWS.map(([k]) => k);
  for (const gone of ["sun24", "wk24", "h2wk"]) assert.ok(!keys.includes(gone)); // shifts that don't exist
  const shift = (call, dow) => dayItems({ status: "work", call, dow, roles: [] }, DEFAULT_WEIGHTS)[0].key;
  assert.equal(shift("24", 5), "fri24");
  assert.equal(shift("H1", 6), "sat24");
  assert.equal(shift("H1", 0), "sat24"); // the Sunday of a holiday weekend counts like a Saturday
  assert.equal(shift("H2", 6), "h2sat");
  assert.equal(shift("H2", 1), "h2sun"); // a holiday Monday counts like a Sunday
  // Labor Day, Memorial Day, Thanksgiving and observed fixed holidays.
  assert.ok(isFixedHoliday("2026-09-07") && isFixedHoliday("2026-05-25") && isFixedHoliday("2026-11-26") && isFixedHoliday("2026-07-03"));
  assert.ok(!isFixedHoliday("2026-09-14") && !isFixedHoliday("2026-05-18"));
  // H1 typed on a Tuesday is flagged; on a holiday weekend it isn't.
  const ds = fairnessDataset();
  ds.months["2026-11"].rows.c.days[10] = { t: "H1" }; // Tuesday
  ds.months["2026-11"].rows.c.days[29] = { t: "H1" }; // Sunday after Thanksgiving week: not near a holiday
  ds.months["2026-11"].rows.c.days[27] = { t: "H2" }; // Friday after Thanksgiving: next to a holiday
  const m = createModel(ds);
  assert.equal(dayGaps(m, "2026-11-10").filter((g) => g.kind === "pattern").length, 1);
  assert.match(dayGaps(m, "2026-11-10").find((g) => g.kind === "pattern").title, /only runs Friday and Saturday/);
  assert.equal(dayGaps(m, "2026-11-29").filter((g) => g.kind === "pattern").length, 1);
  assert.equal(dayGaps(m, "2026-11-27").filter((g) => g.kind === "pattern").length, 0);
  assert.equal(m.day("c", "2026-11-26").status, "holiday"); // a blank Thanksgiving column
});

test("the alert says which day and where you are", async () => {
  const { dailyAlert, dayWord, shouldAlert } = await import("../public/core/alerts.js");
  assert.equal(dayWord("2026-11-10", "2026-11-09"), "Tomorrow's");
  assert.equal(dayWord("2026-11-09", "2026-11-09"), "Today's");
  assert.equal(dayWord("2026-11-16", "2026-11-13"), "Monday's"); // posted Friday for Monday
  assert.equal(shouldAlert("2026-11-08", "2026-11-09"), false); // never for a past day
  const ds = fairnessDataset();
  ds.daily["2026-11-02"] = { date: "2026-11-02", rooms: [{ or: "4", surgeon: "Surgeon", staff: "ResA", ja: "", breaks: "" }], opsc: {}, ob: {}, pat: [], night: [] };
  const m = createModel(ds);
  const a = dailyAlert(m, "2026-11-02", "a", "2026-11-01");
  assert.deepEqual(a, { title: "Tomorrow's OR schedule is posted", body: "You're in OR 4 with Surgeon.", url: "/#/day/2026-11-02", tag: "daily-2026-11-02" });
  assert.equal(dailyAlert(m, "2026-11-02", "b", "2026-11-01").body, "You're on Night float.".replace("Night float", m.day("b", "2026-11-02").label));
  assert.equal(dailyAlert(m, "2026-11-02", null, "2026-11-01").body, "Tap to see the rooms and who's where.");
});

test("reminders include alerts, for interns too, only where they can be turned on", async () => {
  const { pendingReminders } = await import("../public/core/reminders.js");
  assert.deepEqual(pendingReminders({ cls: "CA-2", hasHours: true, hasRated: true, alerts: "off" }), ["alerts"]);
  assert.deepEqual(pendingReminders({ cls: "PGY-1", alerts: "install" }), ["alerts"]);
  assert.deepEqual(pendingReminders({ cls: "PGY-1", alerts: "unsupported" }), []);
  assert.deepEqual(pendingReminders({ cls: "CA-1", alerts: "on" }), ["hours", "rate"]);
});

test("chiefs: burnout signals, next month's targets, and logged hours", async () => {
  const { burnoutWatch, planMonth, loggedSummary, loggedPerWeek, rotationHours, nudgeText } = await import("../public/core/chief.js");
  const { fairnessReport, DEFAULT_WEIGHTS } = await import("../public/core/fairness.js");
  // Resident a works every day for two weeks, with a Saturday 24 and a Sunday 12.
  const ds = fairnessDataset();
  for (let d = 1; d <= 21; d++) ds.months["2026-11"].rows.a.days[d] ||= { t: "BA" };
  ds.months["2026-11"].rows.a.days[14] = { t: "H1" };
  ds.months["2026-11"].rows.a.days[21] = { t: "H1" };
  ds.months["2026-11"].rows.a.days[22] = { t: "H2" };
  for (const id of ["c", "e", "f"]) for (let d = 2; d <= 20; d++) if (![7, 8, 14, 15].includes(d)) ds.months["2026-11"].rows[id].days[d] ||= { t: "BA" };
  ds.rotations = { d: { "2026-12": "Obstetrics" } }; // from the annual schedule
  const m = createModel(ds);
  const watch = burnoutWatch(m, "2026-11-22");
  const a = watch.find((w) => w.pid === "a");
  assert.equal(watch[0].pid, "a"); // the most worn down comes first
  assert.ok(a.signals.some((s) => /heavy calls/.test(s.text)));
  assert.ok(a.signals.some((s) => /days in a row/.test(s.text)));
  assert.ok(a.score >= 2);
  // Logged hours replace the estimate when they're current.
  const entries = [];
  for (let i = 0; i < 28; i++) entries.push({ date: addDaysT("2026-10-26", i), start: 360, endDate: addDaysT("2026-10-26", i), end: 1200, hours: 11, type: "Duty Hours", rotation: "TEST ROT" });
  const s = loggedSummary(entries, "2026-11-22");
  assert.equal(Math.round(s.avg4), 77);
  assert.equal(s.stale, false);
  assert.equal(Math.round(loggedPerWeek(entries, "2026-10-27", "2026-11-20")), 77);
  const withLogged = burnoutWatch(m, "2026-11-22", { shared: { c: entries } }).find((w) => w.pid === "c");
  assert.ok(withLogged.signals.some((x) => x.level === "high" && /logged/.test(x.text)));
  assert.deepEqual(rotationHours({ c: entries }).map((r) => [r.name, Math.round(r.median)]), [["TEST ROT", 77]]);
  // Next month: whoever is under their share should carry more, no-call rotations carry none.
  const rep = fairnessReport(m, { from: "2026-11-01", to: "2026-11-30" });
  const plan = planMonth(m, "2026-11-22", rep, { watch });
  assert.equal(plan.month, "2026-12");
  const rows = plan.classes[0].rows;
  const ra = rows.find((r) => r.pid === "a"), rc = rows.find((r) => r.pid === "c");
  assert.ok(ra.target < rc.target);
  assert.ok(ra.easy.length > 0); // flagged by the burnout watch
  assert.equal(rows.find((r) => r.pid === "d").callable, false); // Obstetrics
  assert.equal(nudgeText(10, DEFAULT_WEIGHTS), "About 1 Saturday 24 more than average");
  assert.equal(nudgeText(-6, DEFAULT_WEIGHTS), "About 1 Friday 24 fewer than average");
  assert.equal(nudgeText(1, DEFAULT_WEIGHTS), "About average");
});

function addDaysT(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test("requests: shifts to swap, and the emails for a swap, a sick call and no-call days", async () => {
  const R = await import("../public/core/requests.js");
  const m = createModel(fairnessDataset());
  // Nights are one piece; a regular day isn't something to swap.
  assert.deepEqual(R.shiftBlock(m, "b", "2026-11-02"), { date: "2026-11-02", end: "2026-11-05", label: "Night float", kind: "NF" });
  assert.equal(R.shiftBlock(m, "c", "2026-11-02"), null);
  assert.deepEqual(R.upcomingShifts(m, "a", "2026-11-01").map((b) => [b.date, b.label]),
    [["2026-11-03", "Late day (until 6p)"], ["2026-11-07", "24-hr call (H1)"], ["2026-11-13", "24-hr call"], ["2026-11-15", "12-hr call (H2)"]]);
  assert.equal(R.lc("Night float"), "night float");
  assert.equal(R.lc("12-hr call (H2)"), "12-hr call (H2)");
  // A trade, agreed: both shifts in the email, to the schedule's inbox, signed by both.
  const req = { pid: "a", ...R.shiftBlock(m, "a", "2026-11-07"), agreed: { pid: "c", date: "2026-11-15", end: "2026-11-15", label: "12-hr call (H2)" } };
  const e = R.swapEmail(m, req);
  assert.equal(e.subject, "Call swap: ResA ↔ ResC, Sat 11/7 and Sun 11/15");
  assert.match(e.body, /• Sat, November 7, 24-hr call \(H1\): Test ResC will cover for Test ResA/);
  assert.match(e.body, /• Sun, November 15, 12-hr call \(H2\): Test ResA will cover for Test ResC/);
  assert.match(e.body, /have agreed to trade call/);
  assert.match(e.body, /Test ResA and Test ResC$/);
  const link = R.mailto(e.subject, e.body);
  assert.ok(link.startsWith("mailto:dmc.ane.sch@gmail.com?subject="));
  assert.ok(link.includes("%0D%0A")); // line breaks mail apps understand
  // Sick call: the Jeopardy resident is found and named in the email.
  assert.deepEqual(R.jeopardyOn(m, "2026-11-02").map((d) => d.pid), ["e"]);
  const sick = R.sickEmail(m, "a", "2026-11-03", { jeopardy: ["e"] });
  assert.equal(sick.subject, "Sick call: Test ResA, Tue 11/3");
  assert.match(sick.body, /I was scheduled for Late day \(until 6p\), Basic Anesthesia\./);
  assert.match(sick.body, /reached out to Test ResE \(Jeopardy\)/);
  assert.match(R.sickText(m, "a", "2026-11-03", "2026-11-02", "e"), /^Hi Test, I'm sick and can't work tomorrow \(Tue 11\/3\)\./);
  // No-call days: Friday to Sunday, each weekend split at the month's edges, reasons in the email.
  assert.deepEqual(R.weekendsOf("2026-11")[0].days, ["2026-11-01"]);
  assert.deepEqual(R.weekendsOf("2026-12")[0].days, ["2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.equal(R.noCallMonth("2026-11-20"), "2026-12");
  const nc = R.noCallEmail(m, "a", "2026-12", { "2026-12-05": "Wedding", "2026-12-06": "Other", "2027-01-02": "Travel" }, "Out of state");
  assert.equal(nc.subject, "No-call request, December 2026: Test ResA (CA-1)");
  assert.match(nc.body, /• Sat, December 5: Wedding\n• Sun, December 6\n\nOut of state/);
  assert.ok(!nc.body.includes("January")); // only that month's days
  assert.match(R.noCallEmail(m, "a", "2026-12", {}).body, /don't have any no-call requests/);
});

test("a blank day after night float is off, even across the end of a month", () => {
  const person = { id: "a", last: "Ana", first: "T", preferred: "T", cls: "CA-1" };
  const model = createModel({ people: [person], daily: {}, settings: {}, directory: { people: {}, places: [] }, months: {
    "2026-04": { days: 30, rows: { a: { rotation: "Basic Anesthesia", days: { 30: { t: "NF" } } } } },
    "2026-05": { days: 31, rows: { a: { rotation: "Basic Anesthesia", days: { 4: { t: "BA" } } } } },
  } });
  assert.equal(model.day("a", "2026-05-01").status, "postcall");
});

test("saving a daily sheet keeps marks that aren't people", () => {
  const ds = { people, months: {}, daily: {}, settings: {}, directory: { people: {}, places: [] } };
  setDaily(ds, "2026-11-03", { rooms: [
    { or: "1", surgeon: "A", staff: "TBD", ja: "Same team" },
    { or: "2", surgeon: "B", staff: "Lee/X" },
    { or: "3", surgeon: "C", staff: "X" },
  ], night: ["Doe", "TBD"] });
  const saved = ds.daily["2026-11-03"];
  assert.equal(saved.rooms[0].staff, "TBD");
  assert.equal(saved.rooms[0].ja, "Same team");
  assert.equal(saved.rooms[1].staff, "Lee/X");
  assert.equal(saved.rooms[2].staff, "X");
  assert.deepEqual(saved.night, ["Doe", "TBD"]);
});

test("settings: a blank time falls back to the default instead of breaking every shift", async () => {
  const { setSettings } = await import("../lib/dataset.js");
  const ds = { settings: {}, log: [] };
  setSettings(ds, { dayHours: [null, 1080], lateEnd: null, codeHours: { PAT: [420, 960], BAD: [null, 5] }, staffing: [] });
  assert.equal(ds.settings.dayHours, undefined);
  assert.equal(ds.settings.lateEnd, undefined);
  assert.deepEqual(ds.settings.codeHours, { PAT: [420, 960] });
});

test("logged hours: fewer than four weeks gives no 4-week average, and sick days count as away", async () => {
  const { loggedSummary } = await import("../public/core/chief.js");
  const { actualHours } = await import("../public/core/logged.js");
  const day = (date, hours, type = "Clinical") => ({ date, start: 360, endDate: date, end: 1080, hours, type, rotation: "" });
  const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => day(d, 14));
  assert.equal(loggedSummary(week, "2026-11-06").avg4, null); // 70 hours in one week isn't 17.5 a week
  const month = Array.from({ length: 28 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, 10));
  assert.equal(Math.round(loggedSummary(month, "2026-10-28").avg4), 70);
  const model = createModel({ people, months: {}, daily: {}, settings: {}, directory: { people: {}, places: [] } });
  assert.ok(actualHours(model, "doe-jane", [...week, day("2026-11-09", 8, "Sick Leave")]).away.has("2026-11-09"));
});

test("alert wording reads properly inside a sentence", async () => {
  const { dayInSentence, dayWord } = await import("../public/core/alerts.js");
  assert.equal(dayInSentence("2026-11-09", "2026-11-08"), "tomorrow");
  assert.equal(dayInSentence("2026-11-16", "2026-11-13"), "Monday");
  assert.equal(dayWord("2026-11-09", "2026-11-08"), "Tomorrow's");
  assert.match(dayWord("2026-11-30", "2026-11-08"), /^The Mon 11\/30$/);
});

test("the fairness roster leaves out anyone an admin hid", async () => {
  const { rosterOf } = await import("../public/core/fairness.js");
  const hidden = people.map((p) => (p.id === "lee-sam" ? { ...p, hidden: true } : p));
  const model = createModel({ people: hidden, months: {}, daily: {}, settings: {}, directory: { people: {}, places: [] }, rosters: { 2026: { "doe-jane": "CA-1", "lee-sam": "CA-1" } } });
  assert.deepEqual(Object.keys(rosterOf(model, 2026)), ["doe-jane"]);
});
