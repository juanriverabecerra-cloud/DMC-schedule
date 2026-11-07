// Annual rotation workbook ("2026-2027 Rotations by site.xlsx"): one sheet per class,
// rows = residents, columns = JULY ... JUNE.
import { readXlsx } from "./xlsx.js";
import { CODES, rotationCode } from "../public/core/codes.js";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function academicYearFromName(fileName) {
  const m = String(fileName).match(/(20\d\d)\s*[-–_ ]\s*(20\d\d)/);
  return m ? Number(m[1]) : null;
}

export function parseRotationsWorkbook(u8, { fileName = "", ayStart = null } = {}) {
  const wb = readXlsx(u8);
  const warnings = [];
  const ay = Number(ayStart) || academicYearFromName(fileName);
  if (!ay) throw new Error("Could not tell the academic year. Include it in the file name (e.g. 2026-2027) or enter it.");

  const people = [];
  for (const sh of wb.sheets) {
    const cm = sh.name.trim().match(/^CA\s*-?\s*([123])$/i);
    if (cm) { parseClassSheet(sh, `CA-${cm[1]}`, ay, people); continue; }
    if (/^pgy-?\s*1$/i.test(sh.name.trim())) {
      const label = [sh.text(1, 1), sh.text(2, 1), sh.text(3, 1)].join(" ");
      const m = label.match(/AY\s*(\d{2})\s*-\s*(\d{2})/i);
      const sheetAy = m ? 2000 + Number(m[1]) : null;
      if (sheetAy && sheetAy !== ay) {
        warnings.push(`The PGY-1 sheet is labeled AY ${m[1]}-${m[2]}, not ${ay}-${String(ay + 1).slice(2)}. It was skipped; intern blocks come from the monthly call file instead.`);
      } else {
        warnings.push("The PGY-1 weekly sheet is not imported from this file; intern blocks come from the monthly call file.");
      }
    }
  }
  if (!people.length) warnings.push("No CA-1/CA-2/CA-3 sheets found.");
  const totals = wb.sheets.find((s) => /site\s*totals/i.test(s.name));
  return { ay, people, warnings, siteTotals: totals ? parseSiteTotals(totals, ay) : null };
}

// "Site Totals": how many residents of each class every service is planned to have, by month.
function parseSiteTotals(sh, ay) {
  let headerRow = 0;
  for (let r = 1; r <= 8 && !headerRow; r++) {
    let n = 0;
    for (let c = 2; c <= sh.maxCol; c++) if (MONTHS.includes(sh.text(r, c).toLowerCase())) n++;
    if (n >= 6) headerRow = r;
  }
  if (!headerRow) return null;
  const cols = [];
  let month = null;
  for (let c = 2; c <= sh.maxCol; c++) {
    const idx = MONTHS.indexOf(sh.text(headerRow, c).toLowerCase());
    if (idx >= 0) month = `${idx >= 6 ? ay : ay + 1}-${String(idx + 1).padStart(2, "0")}`;
    const cls = sh.text(headerRow + 1, c).match(/^CA\s*-?\s*([123])$/i);
    if (month && cls) cols.push({ c, month, cls: `CA-${cls[1]}` });
  }
  const out = {};
  for (let r = headerRow + 2; r <= sh.maxRow; r++) {
    const label = sh.text(r, 1);
    if (/^total/i.test(label)) break;
    const code = label && rotationCode(label.replace(/^harper\s*-?\s*/i, ""));
    if (!code) continue;
    const group = CODES[code].group;
    for (const { c, month: m, cls } of cols) {
      const n = Number(sh.text(r, c)) || 0;
      const slot = ((out[m] ||= {})[group] ||= { "CA-1": 0, "CA-2": 0, "CA-3": 0 });
      slot[cls] += n;
    }
  }
  return out;
}

function parseClassSheet(sh, cls, ay, people) {
  let headerRow = 0;
  const monthCols = [];
  for (let r = 1; r <= 5 && !headerRow; r++) {
    for (let c = 2; c <= sh.maxCol; c++) {
      const idx = MONTHS.indexOf(sh.text(r, c).toLowerCase());
      if (idx >= 0) monthCols.push({ c, key: `${idx >= 6 ? ay : ay + 1}-${String(idx + 1).padStart(2, "0")}` });
    }
    if (monthCols.length >= 6) headerRow = r;
    else monthCols.length = 0;
  }
  if (!headerRow) return;
  let seen = false;
  for (let r = headerRow + 1; r <= sh.maxRow; r++) {
    const name = sh.text(r, 1);
    if (!name || !name.includes(",")) {
      if (seen) break;
      continue;
    }
    seen = true;
    const months = {};
    for (const { c, key } of monthCols) {
      const cell = sh.get(r, c);
      const text = (cell?.text || "").trim();
      if (text) months[key] = { name: text, color: cell.fill || null };
    }
    people.push({ name, cls, months });
  }
}
