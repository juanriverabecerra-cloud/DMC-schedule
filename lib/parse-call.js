// Monthly call schedule workbook ("NOVEMBER 2026 Call Schedule.xlsx").
// One sheet per month (rows = residents, columns = days) plus an optional "PGY-1 PAT" sheet.
import { readXlsx } from "./xlsx.js";
import { daysInMonth, ymd } from "../public/core/dates.js";
import { normCode } from "../public/core/codes.js";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthFromText(text, yearHint) {
  const s = text.toLowerCase();
  const idx = MONTHS.findIndex((m) => s.includes(m) || new RegExp(`\\b${m.slice(0, 3)}\\b`).test(s));
  if (idx < 0) return null;
  const year = Number((s.match(/20\d\d/) || [])[0] || yearHint);
  if (!year) return null;
  return `${year}-${String(idx + 1).padStart(2, "0")}`;
}

function isRed(hex) {
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return r > 190 && g < 90 && b < 90;
}

export function parseCallWorkbook(u8, { fileName = "" } = {}) {
  const wb = readXlsx(u8);
  const warnings = [];
  const yearHint = (fileName.match(/20\d\d/) || [])[0];
  const months = [];
  for (const sh of wb.sheets) {
    if (/pgy|pat/i.test(sh.name)) continue;
    const month = monthFromText(sh.name, yearHint) || monthFromText(fileName, yearHint);
    if (!month) continue;
    const parsed = parseMonthSheet(sh, month, warnings);
    if (parsed) months.push(parsed);
  }
  let interns = null;
  const internSheet = wb.sheets.find((s) => /pgy-?\s*1/i.test(s.name));
  if (internSheet) interns = parseInternSheet(internSheet, months[0]?.month, warnings);
  if (!months.length) warnings.push("No month sheet found (expected a sheet named like \"NOVEMBER, 2026\").");
  return { months, interns, warnings };
}

function parseMonthSheet(sh, month, warnings) {
  const nDays = daysInMonth(month);
  let headerRow = 0, firstCol = 0;
  for (let r = 1; r <= Math.min(12, sh.maxRow) && !headerRow; r++) {
    for (let c = 1; c <= sh.maxCol; c++) {
      if (sh.text(r, c) === "1" && sh.text(r, c + 1) === "2" && sh.text(r, c + 2) === "3") { headerRow = r; firstCol = c; break; }
    }
  }
  if (!headerRow) {
    warnings.push(`${sh.name}: could not find the row of day numbers (1, 2, 3, ...).`);
    return null;
  }
  let n = 0;
  while (n < 31 && sh.text(headerRow, firstCol + n) === String(n + 1)) n++;
  if (n !== nDays) warnings.push(`${sh.name}: found ${n} day columns but the month has ${nDays} days.`);
  const lastCol = firstCol + n - 1;
  const rotCol = firstCol - 1 >= 3 ? firstCol - 1 : null;

  let lastUpdated = "";
  for (let r = 1; r <= 3; r++) {
    if (/last updated/i.test(sh.text(r, 1))) lastUpdated = sh.text(r, 2) || sh.text(r + 1, 1);
  }

  const rows = [];
  const coverage = {};
  let cls = null, lastPeopleRow = headerRow;
  for (let r = headerRow + 1; r <= sh.maxRow; r++) {
    const a = sh.text(r, 1);
    if (!a) continue;
    const clsMatch = a.match(/^(CA|PGY)\s*-?\s*(\d)\s*'?s?$/i);
    if (clsMatch) { cls = `${clsMatch[1].toUpperCase()}-${clsMatch[2]}`; continue; }
    if (/coverage needed/i.test(a)) {
      const label = a.replace(/coverage needed/i, "").trim() || "General";
      for (let d = 1; d <= n; d++) {
        const t = sh.text(r, firstCol + d - 1);
        if (t) (coverage[label] ||= {})[d] = t;
      }
      continue;
    }
    if (/total/i.test(a)) break;
    if (!a.includes(",") || Object.keys(coverage).length) continue;
    const days = {};
    for (let d = 1; d <= n; d++) {
      const cell = sh.get(r, firstCol + d - 1);
      if (!cell) continue;
      const t = (cell.text || "").trim();
      const f = cell.fill && cell.fill !== "FFFFFF" ? cell.fill : null;
      if (!t && !f) continue;
      const o = {};
      if (t) o.t = t;
      if (f) o.f = f;
      if (t && cell.bold) o.b = 1;
      if (t && isRed(cell.fontColor)) o.r = 1;
      days[d] = o;
    }
    rows.push({
      name: a,
      cls,
      number: sh.text(r, 2),
      rotation: rotCol ? sh.text(r, rotCol) : "",
      next: sh.text(r, lastCol + 1),
      days,
    });
    lastPeopleRow = r;
  }

  // Legend block at the bottom: a bold code, then its name, then a description.
  const legend = {};
  for (let r = lastPeopleRow + 1; r <= sh.maxRow; r++) {
    for (let c = 1; c <= sh.maxCol; c++) {
      const cell = sh.get(r, c);
      if (!cell || !cell.bold || cell.formula) continue;
      const code = (cell.text || "").trim();
      if (!code || code.length > 8 || !/[a-z]/i.test(code) || /error|total/i.test(code)) continue;
      const name = sh.text(r, c + 1), desc = sh.text(r, c + 2);
      if (name && desc && !legend[normCode(code)]) legend[normCode(code)] = { code, name, desc };
    }
  }

  if (!rows.length) warnings.push(`${sh.name}: no resident rows found.`);
  return { month, sheet: sh.name, lastUpdated, rows, coverage, legend, days: n };
}

const RANGE = /^(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})$/;

function rangeToDates(text, baseMonth) {
  const m = text.trim().match(RANGE);
  if (!m) return null;
  const [by, bm] = baseMonth ? baseMonth.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const yearFor = (month) => (month < bm - 6 ? by + 1 : month > bm + 6 ? by - 1 : by);
  const [sm, sd, em, ed] = m.slice(1).map(Number);
  return { start: ymd(yearFor(sm), sm, sd), end: ymd(yearFor(em), em, ed) };
}

// "PGY-1 PAT": interns' weekly blocks plus the weekly list of interns in the anesthesia PAT clinic.
function parseInternSheet(sh, baseMonth, warnings) {
  let headerRow = 0, weekCols = [];
  for (let r = 1; r <= Math.min(15, sh.maxRow) && !headerRow; r++) {
    const cols = [];
    for (let c = 2; c <= sh.maxCol && RANGE.test(sh.text(r, c)); c++) cols.push(c);
    if (cols.length >= 2) { headerRow = r; weekCols = cols; }
  }
  if (!headerRow) {
    warnings.push(`${sh.name}: could not find the week date ranges.`);
    return null;
  }
  const weeks = weekCols.map((c) => rangeToDates(sh.text(headerRow, c), baseMonth));
  const rows = [];
  for (let r = headerRow + 1; r <= sh.maxRow; r++) {
    const name = sh.text(r, 1);
    if (!name) continue;
    if (!name.includes(",")) continue;
    rows.push({ name, cls: "PGY-1", weeks: weekCols.map((c) => sh.text(r, c)) });
  }
  const pat = [];
  const lastWeekCol = weekCols[weekCols.length - 1];
  for (let c = lastWeekCol + 1; c <= sh.maxCol; c++) {
    for (let r = 1; r <= sh.maxRow; r++) {
      const range = rangeToDates(sh.text(r, c), baseMonth);
      if (!range) continue;
      const people = [];
      for (let rr = r + 1; rr <= sh.maxRow; rr++) {
        const t = sh.text(rr, c);
        if (!t || RANGE.test(t)) break;
        people.push({ name: t, number: sh.text(rr, c + 1) });
      }
      pat.push({ ...range, people });
    }
  }
  return { sheet: sh.name, weeks, rows, pat };
}
