// Annual rotation workbook ("2026-2027 Rotations by site.xlsx"): one sheet per class,
// rows = residents, columns = JULY ... JUNE.
import { readXlsx } from "./xlsx.js";

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
  return { ay, people, warnings };
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
