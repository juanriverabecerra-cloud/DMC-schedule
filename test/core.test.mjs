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
