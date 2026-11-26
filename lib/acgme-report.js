// ACGME's "Anesthesiology Minimum" report (Case Logs › Download/Reports): the graduation minimums
// and the resident's totals as ACGME itself counts them, so the app shows real numbers, never an
// estimate. The Log cases button fetches it on ACGME's page (public/acgme.js) and sends the .xls;
// this keeps only when ACGME counted and each category's minimum and total, not the file, the
// resident's name or anything else in it.
import { readXls } from "./xls.js";

const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

// Rows as lib/xls.js reads them: a header (Category | Minimum | Total), then headings ("Cardiac"),
// the codes under each ("    Cardiac with CPB" with a total, sometimes a minimum of its own) and
// a "Total Cardiac" line with the heading's minimum. Null if it isn't that report.
export function minimumsFrom(rows) {
  let asOf = "", header = -1, cMin = -1, cTot = -1;
  rows.forEach((r, i) => {
    const cells = (r || []).map(text);
    const m = cells.join(" ").match(/\bAs of (\d{1,2})\/(\d{1,2})\/(\d{4})\b/i);
    if (m && !asOf) asOf = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (header < 0 && cells.includes("Category") && cells.includes("Minimum") && cells.includes("Total")) {
      header = i;
      cMin = cells.indexOf("Minimum");
      cTot = cells.indexOf("Total");
    }
  });
  if (header < 0) return null;
  const lines = [];
  let heading = "", parts = [];
  for (const r of rows.slice(header + 1)) {
    const label = (r || []).slice(0, cMin).map(text).find(Boolean);
    if (!label) continue;
    const min = num(r[cMin]), total = num(r[cTot]);
    if (min === null && total === null) { heading = label; parts = []; continue; } // a heading
    const totalLine = /^total\s+/i.test(label);
    if (totalLine) {
      lines.push({ heading, name: label.replace(/^total\s+/i, ""), minimum: min, total: total ?? 0, parts });
      parts = [];
    } else {
      if (min !== null) lines.push({ heading, name: label, minimum: min, total: total ?? 0 });
      parts.push({ name: label, total: total ?? 0 });
    }
  }
  const required = lines.filter((l) => l.minimum !== null && l.minimum > 0);
  return required.length ? { asOf, lines: required.map(({ parts: p, ...l }) => (p?.length > 1 ? { ...l, parts: p } : l)) } : null;
}

// The file as the Log cases button sends it (base64), read and boiled down; null if it isn't one.
export function minimumsFromFile(base64) {
  if (typeof base64 !== "string" || base64.length > 4e6) return null;
  try {
    return minimumsFrom(readXls(new Uint8Array(Buffer.from(base64, "base64"))));
  } catch {
    return null;
  }
}
