// A made-up program for people who should see how the app works but not the real schedule:
// Apple's and Google's app reviewers, or anyone being shown the app. Signing in with
// DEMO_PASSCODE gets invented residents on an invented schedule built around today's date.
// Nothing here reads or writes the real data: what a demo visitor saves goes under "demo/".
import { addDays, addMonths, daysInMonth, dow, monthKey, todayLocal } from "../public/core/dates.js";
import { normalizeDataset, setDaily } from "./dataset.js";

const PEOPLE = [
  ["Stone", "Avery", "CA-1"], ["Okafor", "Ada", "CA-1"], ["Lindqvist", "Noor", "CA-1"], ["Tanaka", "Mei", "CA-1"],
  ["Marchetti", "Leo", "CA-2"], ["Abara", "Chidi", "CA-2"], ["Novak", "Petra", "CA-2"], ["Reyes", "Dani", "CA-2"],
  ["Whitfield", "Sam", "CA-3"], ["Hadley", "Rami", "CA-3"], ["Kowalski", "Jo", "CA-3"], ["Brennan", "Tess", "CA-3"],
  ["Ito", "Kai", "PGY-1"], ["Mensah", "Efua", "PGY-1"],
].map(([last, first, cls]) => ({ id: `demo-${last.toLowerCase()}`, last, first, preferred: first, cls, canonical: `${last}, ${first}`, aliases: [] }));

const ROTATIONS = {
  "CA-1": [["Basic Anesthesia", "BA"], ["OPSC", "OPSC"], ["PACU", "PACU"], ["VA", "VA"]],
  "CA-2": [["Cardiac", "HC"], ["Neuro", "HN"], ["Thoracic", "TH"], ["Acute Pain", "AP"]],
  "CA-3": [["Junior Attending", "JA"], ["Board Runner", "BD"], ["Vascular", "VASC"], ["Elective", "ELECT"]],
};
const SURGEONS = ["Alder", "Birch", "Cedar", "Dunmore", "Ellery", "Fenwick", "Garland", "Hollis"];
const MDAS = ["Quill", "Rook", "Sable", "Thorne"];
const BLUE = "C9DAF8", GREEN = "00FF00";

const of = (cls) => PEOPLE.filter((p) => p.cls === cls);
const weekOf = (date) => Math.floor((Date.parse(`${date}T00:00:00Z`) / 86400000 + 4) / 7); // weeks start Sunday
const monthIndex = (month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5));

// What one resident's call-sheet cell says on one date, following the real weekly pattern:
// nights Sunday to Thursday, 24s on Friday and Saturday, 12s on Saturday and Sunday.
function cellFor(person, date, code) {
  const [ca1, ca2, ca3] = [of("CA-1"), of("CA-2"), of("CA-3")];
  const w = weekOf(date), wd = dow(date);
  const is = (list, n) => list[((n % 4) + 4) % 4] === person;
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  if (wd <= 4 && (is(ca1, w) || is(ca2, w + 1))) return { t: "NF" };
  if (wd === 5 && (is(ca1, w) || is(ca2, w + 1))) return null; // off after a week of nights
  if (wd === 5 && (is(ca1, w + 1) || is(ca2, w + 2))) return { t: code, f: BLUE };
  if (wd === 6 && (is(ca1, w + 2) || is(ca3, w))) return { t: "H1" };
  if (wd === 6 && is(ca2, w + 3)) return { t: "H2" };
  if (wd === 0 && (is(ca1, w + 2) || is(ca2, w + 2))) return { t: "H2" };
  if (wd === 0 || wd === 6) return null;
  if (is(ca2, 3) && w % 6 === 2) return { t: "Vac" };
  if (is(ca3, day)) return { t: "10-7" };
  if (is(ca1, day + 2)) return { t: code, f: GREEN };
  return { t: code };
}

function monthFor(month) {
  const rows = {};
  for (const p of PEOPLE.filter((x) => x.cls !== "PGY-1")) {
    const list = ROTATIONS[p.cls];
    const slot = (monthIndex(month) + of(p.cls).indexOf(p)) % list.length;
    const [rotation, code] = list[slot];
    const days = {};
    for (let d = 1; d <= daysInMonth(month); d++) {
      const cell = cellFor(p, `${month}-${String(d).padStart(2, "0")}`, code);
      if (cell) days[d] = cell;
    }
    rows[p.id] = { cls: p.cls, rotation, next: list[(slot + 1) % list.length][0], number: "", days };
  }
  return { sheet: "Demo", fileName: "demo", uploadedAt: `${month}-01T12:00:00.000Z`, lastUpdated: "", days: daysInMonth(month), rows, coverage: {}, legend: {} };
}

// The OR sheet for one day: everyone working at the main hospital gets a room.
function sheetFor(ds, date) {
  if (dow(date) === 0 || dow(date) === 6) return null;
  const month = ds.months[monthKey(date)];
  const working = PEOPLE.filter((p) => {
    const cell = month?.rows[p.id]?.days[Number(date.slice(8))];
    return cell && ["BA", "HC", "HN", "TH", "VASC"].includes(cell.t);
  });
  const ja = PEOPLE.find((p) => month?.rows[p.id]?.days[Number(date.slice(8))]?.t === "JA");
  const rooms = working.map((p, i) => ({
    or: String(i * 2 + 3), surgeon: SURGEONS[(i + Number(date.slice(8))) % SURGEONS.length], time: i % 3 ? "7:30" : "8:30", cases: String((i % 3) + 1),
    mda: MDAS[i % MDAS.length], staff: p.last, ja: ja && i < 2 ? ja.last : "", breaks: "",
  }));
  return { rooms, opsc: { rooms: "", mdas: [], residents: [] }, procedures: [], meyers: {}, pat: [], ob: {}, night: [], notes: [], source: "manual" };
}

let cache = { day: "", ds: null };
export function demoDataset(today = todayLocal()) {
  if (cache.day === today) return cache.ds;
  const ds = normalizeDataset({ people: PEOPLE.map((p) => ({ ...p })) });
  const month = monthKey(today);
  for (const m of [addMonths(month, -1), month, addMonths(month, 1)]) ds.months[m] = monthFor(m);
  for (const p of of("PGY-1")) {
    const sunday = addDays(today, -dow(today));
    for (let k = -1; k <= 4; k++) (ds.interns.weeks[addDays(sunday, k * 7)] ||= { end: addDays(sunday, k * 7 + 6), rows: {} }).rows[p.id] = (k + of("PGY-1").indexOf(p)) % 2 ? "Clinic" : "SICU";
  }
  ds.directory = {
    text: "", dialing: [], places: [],
    people: Object.fromEntries(PEOPLE.map((p, i) => [p.id, { numbers: [{ kind: "phone", label: "Mobile", value: `31355501${String(i + 10)}` }], notes: [] }])),
    staff: MDAS.map((name, i) => ({ id: `mda-${name.toLowerCase()}`, name: `Dr. ${name}`, last: name, first: "", preferred: "", site: "harper", group: "Anesthesiologists", numbers: [{ kind: "phone", label: "Mobile", value: `31355502${String(i + 10)}` }], notes: [] })),
  };
  for (const date of [today, addDays(today, 1)]) {
    const sheet = sheetFor(ds, date);
    if (sheet) setDaily(ds, date, sheet);
  }
  ds.log = [];
  ds.updatedAt = `${today}T00:00:00.000Z`;
  cache = { day: today, ds };
  return ds;
}

// The same storage, fenced off: the dataset is always the invented one and can't be changed, and
// everything a demo visitor saves (a swap, a rating, alerts) lives under its own prefix.
export function demoStore(real) {
  const key = (k) => `demo/${k}`;
  return {
    getJSON: async (k) => (k === "dataset" ? structuredClone(demoDataset()) : real.getJSON(key(k))),
    setJSON: async (k, v) => (k === "dataset" ? undefined : real.setJSON(key(k), v)),
    getBytes: async () => null,
    setBytes: async () => {},
    delete: async (k) => real.delete(key(k)),
    update: async (k, change) => (k === "dataset" ? structuredClone(demoDataset()) : real.update(key(k), change)),
  };
}
