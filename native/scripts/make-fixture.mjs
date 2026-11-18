// Writes a widget feed made from invented residents, in exactly the shape the server sends, for
// drawing the widgets (npm run snapshots). No real schedule is involved.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { widgetFeed } from "../../lib/widget-feed.js";
import { createModel } from "../../public/core/model.js";
import { zonedTime } from "../../public/core/dates.js";

const person = (id, last, first, cls) => ({ id, last, first, preferred: first, cls, canonical: `${last}, ${first}`, aliases: [] });
const people = [person("me", "Calloway", "Sam", "CA-1"), person("b", "Okafor", "Ada", "CA-1"), person("c", "Lindqvist-Aldana", "Noor", "CA-2"), person("d", "Marchetti", "Leo", "CA-3"), person("e", "Tanaka", "Mei", "CA-2")];
// March 2026: the 10th is a Tuesday.
const rows = {
  me: { rotation: "Basic Anesthesia - Vascular", days: { 9: { t: "BA-V" }, 10: { t: "BA-V" }, 11: { t: "BA-V" }, 12: { t: "BA-V", f: "00FF00" }, 13: { t: "BA-V", f: "C9DAF8" }, 16: { t: "BA-V" }, 17: { t: "BA-V" }, 21: { t: "H2" } } },
  b: { rotation: "Basic Anesthesia", days: { 8: { t: "NF" }, 9: { t: "NF" }, 10: { t: "NF" }, 11: { t: "NF" }, 12: { t: "NF" }, 14: { t: "H1" } } },
  c: { rotation: "Cardiac", days: { 8: { t: "NF" }, 9: { t: "NF" }, 10: { t: "NF", f: "FF00FF" }, 11: { t: "NF" }, 12: { t: "NF" }, 13: { t: "HC", f: "C9DAF8" }, 14: { t: "H2" }, 15: { t: "H2" } } },
  d: { rotation: "Junior Attending", days: { 10: { t: "10-7" }, 11: { t: "10-7" }, 12: { t: "10-7" }, 13: { t: "10-7" }, 14: { t: "H1" } } },
  e: { rotation: "Neuro", days: { 10: { t: "HN", f: "00FF00" }, 11: { t: "HN" }, 12: { t: "HN" }, 15: { t: "H2" } } },
};
const ds = {
  people, months: { "2026-03": { rows, days: 31 } }, settings: {}, rotations: {}, directory: { people: {}, places: [] },
  daily: { "2026-03-11": { date: "2026-03-11", rooms: [{ or: "12", surgeon: "Whitfield", time: "7:30", cases: "3", mda: "Abara", staff: "Calloway", ja: "Marchetti", breaks: "Tanaka" }], opsc: {}, pat: [], ob: {}, night: [] } },
};
const feed = widgetFeed(createModel(ds), "me", { now: zonedTime("2026-03-10", 10 * 60) });
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ios/ScheduleWidgets/Fixtures/feed.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(feed, null, 1)}\n`);
console.log(`wrote ${path.relative(process.cwd(), out)}: ${feed.days.map((d) => d.code).join(", ")}`);
