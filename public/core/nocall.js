// The no-call scorecard: of the weekend days each resident asked to keep free, how many the call
// sheet honored. A request can only be judged once that month's call sheet is out, and one on a
// day the resident couldn't have been called anyway doesn't count either way.
import { addDays } from "./dates.js";
import { isNoCallRotation } from "./fairness.js";

const CALL = { H1: "24-hr call", 24: "24-hr call", H2: "12-hr call", NF: "Night float", "10-7": "10a–7p shift" };

export function noCallOutcome(model, pid, date) {
  const d = model.day(pid, date);
  if (d.source !== "call") return { result: "waiting", why: "Call sheet not out yet" };
  if (d.status === "vacation") return { result: "excluded", why: "On vacation" };
  if (isNoCallRotation(model, d)) return { result: "excluded", why: "On a rotation with no call" };
  if (d.call) return { result: "missed", why: CALL[d.call] };
  if (d.cardiac) return { result: "missed", why: "Cardiac call" };
  const before = model.day(pid, addDays(date, -1));
  if (before.call === "H1" || before.call === "24") return { result: "missed", why: "Post-call from a 24" };
  return { result: "honored", why: "" };
}

// history: { "2026-12": { [pid]: { picks: { date: reason } } } }. Lowest rate first in each class.
export function noCallScorecard(model, history, ay) {
  const rows = new Map();
  for (const [month, people] of Object.entries(history || {})) {
    if (month < `${ay}-07` || month > `${ay + 1}-06`) continue;
    for (const [pid, rec] of Object.entries(people)) {
      const person = model.person(pid);
      if (!person || person.hidden) continue;
      if (!rows.has(pid)) rows.set(pid, { pid, cls: model.classAt(pid, month) || person.cls, days: [], honored: 0, missed: 0, excluded: 0, waiting: 0 });
      const row = rows.get(pid);
      for (const [date, reason] of Object.entries(rec.picks || {})) {
        const outcome = noCallOutcome(model, pid, date);
        row.days.push({ date, reason, ...outcome });
        row[outcome.result]++;
      }
    }
  }
  const rate = (honored, missed) => (honored + missed ? Math.round((honored / (honored + missed)) * 100) : null);
  const classes = [];
  for (const cls of ["CA-1", "CA-2", "CA-3"]) {
    const list = [...rows.values()].filter((r) => r.cls === cls);
    if (!list.length) continue;
    for (const r of list) { r.rate = rate(r.honored, r.missed); r.days.sort((a, b) => a.date.localeCompare(b.date)); }
    list.sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.missed - a.missed);
    const honored = list.reduce((s, r) => s + r.honored, 0), missed = list.reduce((s, r) => s + r.missed, 0);
    classes.push({ cls, rows: list, honored, missed, rate: rate(honored, missed) });
  }
  return classes;
}
