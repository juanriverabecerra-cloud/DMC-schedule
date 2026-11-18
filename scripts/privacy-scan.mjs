// Run before every commit:  node scripts/privacy-scan.mjs
// This repository is public. The real schedule lives only in .localdata/ and data/, which git
// ignores. This reads the real names and phone numbers from there and makes sure none of them
// appear in any file git would publish. It prints counts and file names, never the data itself.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, ".localdata/dataset");
if (!fs.existsSync(source)) {
  console.log("No local copy of the real data (.localdata/dataset), so there is nothing to compare against.");
  process.exit(0);
}
const ds = JSON.parse(fs.readFileSync(source, "utf8"));

// Words that are also somebody's name but can't be avoided in code or prose.
const ORDINARY = new Set(["first", "last", "call", "room", "board", "main", "work", "core", "team", "center", "stat", "port", "holding", "paging", "resident", "anesthesia", "crna", "opsc", "meyers", "floor", "bedside", "attending", "angio", "cath", "registration", "obstetrics", "lab", "desk", "pain", "unit", "line", "tech", "techs", "clinic", "office", "nursing", "pharmacy", "radiology", "surgery", "recovery", "blood", "bank", "page", "code", "rapid", "response", "security", "transport", "east", "west", "north", "south", "same", "tbd"]);
const names = new Set();
const add = (text) => { for (const w of String(text || "").split(/[^A-Za-zÀ-ÿ']+/)) if (w.length >= 4 && !ORDINARY.has(w.toLowerCase())) names.add(w.toLowerCase()); };
// Surnames only: first names like "Alex" or "John" match half of all sample text.
for (const p of ds.people || []) { add(p.last); for (const a of p.aliases || []) add(a.split(",")[0]); }
for (const s of ds.directory?.staff || []) add(s.last || s.name);
for (const day of Object.values(ds.daily || {})) for (const r of day.rooms || []) { add(r.surgeon); add(r.mda); }

const numbers = new Set();
const dir = ds.directory || {};
for (const entry of [...Object.values(dir.people || {}), ...(dir.staff || []), ...(dir.places || [])]) {
  for (const n of entry.numbers || []) if (String(n.value).length >= 5) numbers.add(String(n.value));
}

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean)
  .filter((f) => !/\.(png|jpg|jpeg|ico|pbxproj|lock)$|package-lock\.json$/.test(f) && f !== "scripts/privacy-scan.mjs");
const numberHits = [], nameHits = new Map();
for (const file of files) {
  let text;
  try { text = fs.readFileSync(path.join(root, file), "utf8"); } catch { continue; }
  const digits = text.replace(/[\s().-]/g, "");
  for (const n of numbers) if (n.length >= 7 && digits.includes(n)) numberHits.push(file);
  for (const word of new Set(text.split(/[^A-Za-zÀ-ÿ']+/))) {
    if (word.length >= 4 && /^[A-Z]/.test(word) && names.has(word.toLowerCase())) nameHits.set(word, [...(nameHits.get(word) || []), file]);
  }
}
console.log(`real numbers checked: ${numbers.size} | found in files to publish: ${numberHits.length}`);
console.log(`real names checked: ${names.size} | files scanned: ${files.length}`);
if (numberHits.length) console.log("NUMBERS FOUND IN:", [...new Set(numberHits)].join(", "));
for (const [word, where] of nameHits) console.log(`name: ${word} → ${[...new Set(where)].slice(0, 4).join(", ")}`);
if (!nameHits.size) console.log("no real names found");
process.exitCode = numberHits.length ? 1 : 0;
