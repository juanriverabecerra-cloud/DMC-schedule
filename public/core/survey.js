// Residents rate how heavy each shift feels. Two fixed points make everyone's answers line up:
// a regular OR day is 0 and a Saturday 24-hr call is 10. Only combined numbers are ever shown,
// and an admin decides whether to use them as the points in Admin › Fairness.
import { WEIGHT_ROWS } from "./fairness.js";

export const ANCHOR_KEY = "sat24";
export const ANCHOR_VALUE = 10;
export const SCALE = { min: -3, max: 15, step: 0.5 };
export const SURVEY_ROWS = WEIGHT_ROWS.filter(([key]) => key !== "stack" && key !== ANCHOR_KEY);
const KEYS = new Set(SURVEY_ROWS.map(([key]) => key));
export const MIN_RATINGS = 3; // fewer answers than this would show one person's own answer

export function cleanScores(input) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    const n = Number(value);
    if (KEYS.has(key) && value !== "" && value !== null && Number.isFinite(n)) out[key] = Math.min(SCALE.max, Math.max(SCALE.min, n));
  }
  return out;
}

function median(list) {
  const a = [...list].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
const toHalf = (n) => Math.round(n * 2) / 2;

// responses: [{ cls, scores }]. Returns numbers only, never anyone's own answers.
export function summarizeSurvey(responses) {
  const list = (responses || []).filter((r) => Object.keys(r.scores || {}).length);
  const byClass = {};
  for (const r of list) byClass[r.cls] = (byClass[r.cls] || 0) + 1;
  const shifts = {};
  for (const [key] of SURVEY_ROWS) {
    const rated = list.filter((r) => r.scores[key] != null);
    if (rated.length < MIN_RATINGS) continue;
    const vals = rated.map((r) => r.scores[key]);
    const classes = {};
    for (const cls of new Set(rated.map((r) => r.cls))) {
      const own = rated.filter((r) => r.cls === cls).map((r) => r.scores[key]);
      if (own.length >= MIN_RATINGS) classes[cls] = toHalf(median(own));
    }
    shifts[key] = { n: vals.length, median: toHalf(median(vals)), low: Math.min(...vals), high: Math.max(...vals), classes };
  }
  return { count: list.length, byClass, shifts };
}
