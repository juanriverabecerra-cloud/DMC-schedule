// ACGME case log, anesthesiology: the Add Case form's choices, and how the app works out each
// day's cases from the schedule so a resident only taps what the sheet can't know.
//
// ACGME takes no imports. The resident logs here (mostly prefilled), then a bookmark on ACGME's
// own Add Case page fills one case per tap and the resident checks it and presses Submit there.
// Nothing here holds anything about a patient beyond ACGME's age group and ASA class.
import { addDays, parts } from "./dates.js";
import { fold } from "./names.js";

export const ACGME_ADD = "https://apps.acgme.org/ads/CaseLogs/CaseEntry/Insert";
export const CASE_ID_MAX = 25;

// Form ids are ACGME's own codes for the anesthesiology form (the same for every resident).
export const ACGME_SITES = {
  harper: { id: 12634, name: "Harper-Hutzel Hospital", short: "Harper-Hutzel", code: "HH" },
  drh: { id: 12633, name: "Detroit Receiving Hospital and University Health Center", short: "DRH", code: "DRH" },
  chm: { id: 12657, name: "Children's Hospital of Michigan", short: "Children's", code: "CHM" },
  va: { id: 12632, name: "John D. Dingell Department of Veterans Affairs Medical Center", short: "VA", code: "VA" },
  sinai: { id: 12647, name: "Sinai-Grace Hospital", short: "Sinai-Grace", code: "SG" },
  hvsh: { id: 12677, name: "Huron Valley-Sinai Hospital", short: "Huron Valley", code: "HVS" },
  karmanos: { id: 14246, name: "Barbara Ann Karmanos Cancer Institute - Detroit", short: "Karmanos", code: "KCI" },
  other: { id: 19367, name: "Other Site", short: "Other site", code: "Other" },
};
// The schedule's site -> ACGME's site. OPSC and the pain clinic aren't separate on ACGME's list;
// a resident's own choice for that kind of day is remembered and wins next time.
const SITE_FOR = { harper: "harper", hutzel: "harper", opsc: "harper", pain: "harper", va: "va", chm: "chm", hvsh: "hvsh", sinai: "sinai" };

export const AGES = [
  { key: "a", id: 30, short: "<3 mo", label: "Under 3 months" },
  { key: "b", id: 31, short: "<3 y", label: "3 months to 3 years" },
  { key: "c", id: 32, short: "<12 y", label: "3 to 12 years" },
  { key: "d", id: 33, short: "12–65", label: "12 to 65 years" },
  { key: "e", id: 34, short: "65+", label: "65 and over" },
];
export const ASA_IDS = { 1: 156628, 2: 156632, 3: 156634, 4: 156636, 5: 156630, 6: 156631, "1E": 156629, "2E": 156633, "3E": 156635, "4E": 156637, "5E": 156626 };
export const GROUPS = { proc: 681, pain: 680 };
export const CASE_TYPES = {
  ltp: { nontrauma: 46, trauma: 134 }, // life-threatening pathology
  airway: { anticipated: 148, unanticipated: 149 }, // difficult airway
};

// [key, ACGME label, short label, id, sub-heading]. The label is what ACGME prints beside the box.
const S = (key, title, items, { group = "proc", optional = false } = {}) => ({ key, title, group, optional, items: items.map(([k, label, short, id, sub]) => ({ key: k, label, short, id, sub: sub || "" })) });
export const SECTIONS = [
  S("type", "Anesthesia / Analgesia type", [
    ["general", "General Maintenance", "GA", 1256330],
    ["mac", "MAC &/or Sedation", "MAC", 156641],
    ["spinal", "Spinal", "Spinal", 1256331],
    ["epidural", "Epidural", "Epidural", 1256332],
    ["cse", "CSE", "CSE", 156646],
    ["pnb", "Single shot", "Block", 156648, "Peripheral nerve block"],
    ["pnb-cath", "Continuous", "Block catheter", 156647, "Peripheral nerve block"],
  ]),
  S("airway", "Airway Management Techniques", [
    ["dl", "Direct", "DL", 1256334, "Laryngoscope"],
    ["vl", "Indirect", "Video", 1256335, "Laryngoscope"],
    ["ett", "Oral ETT", "Oral tube", 156654, "Intubation"],
    ["nasal", "Nasal ETT", "Nasal tube", 156655, "Intubation"],
    ["fob", "Flexible Bronchoscopic", "Fiberoptic", 2298046, "Intubation"],
    ["awake", "Awake", "Awake", 2298047, "Intubation"],
    ["sga", "Supraglottic Airway", "LMA", 1256333],
    ["mask", "Mask", "Mask", 156650, "Other (airway management)"],
    ["dlt", "DLT", "DLT", 1256336, "Lung Isolation"],
    ["blocker", "Bronchial blocker", "Blocker", 156674, "Lung Isolation"],
    ["jet", "Jet ventilation", "Jet vent", 156666, "Other (airway management)"],
    ["airway-other", "Airway Mgmt - Other", "Other airway", 1256337, "Other (airway management)"],
  ]),
  S("category", "Procedure category", [
    ["cpb", "With CPB", "Cardiac, on pump", 156681, "Cardiac"],
    ["no-cpb", "W/out CPB", "Cardiac, off pump", 156682, "Cardiac"],
    ["vessels", "Procs on major vessels", "Major vessels", 156684, "Procedures Major Vessels"],
    ["vessels-endo", "Procs on maj vessels (endo)", "Major vessels, endo", 156685, "Procedures Major Vessels"],
    ["crani", "Nonvascular open", "Intracerebral, open", 156689, "Intracerebral"],
    ["crani-vasc", "Vascular (open)", "Intracerebral, vascular", 156687, "Intracerebral"],
    ["neuro-endo", "Endovascular", "Intracerebral, endo", 156688, "Intracerebral"],
    ["thoracic", "Intrathoracic non-cardiac", "Intrathoracic", 156683, "Other (procedure cat)"],
    ["cs", "Cesarean del", "C-section", 156692, "Delivery"],
    ["cs-hr", "Cesarean del high-risk", "C-section, high-risk", 156686, "Delivery"],
    ["vag", "Vag del", "Vaginal delivery", 156690, "Delivery"],
    ["vag-hr", "Vag del high-risk", "Vaginal del, high-risk", 156691, "Delivery"],
  ]),
  S("access", "Specialized Vascular Access", [
    ["art", "Arterial Catheter", "Art line", 1256338],
    ["cvc", "Central Venous Catheter", "Central line", 1256339],
    ["pa", "Pulmonary artery cath", "PA catheter", 156700, "Other (vasc access/mon)"],
    ["us", "Ultrasound for line place", "Ultrasound for line", 156693, "Other (vasc access/mon)"],
  ]),
  S("monitoring", "Specialized Monitoring Techniques / Procedures", [
    ["tee", "TEE", "TEE", 156707],
    ["ep", "Electrophysiologic mon", "Neuromonitoring", 156708],
    ["csf", "CSF Drain", "CSF drain", 1256341],
  ]),
  S("neuraxial", "Neuraxial Blockade Site (Optional)", [
    ["lumbar", "Lumbar", "Lumbar", 156722],
    ["t8-12", "T 8-12", "T8–12", 156721],
    ["t1-7", "T 1-7", "T1–7", 156720],
    ["cervical", "Cervical", "Cervical", 156719],
    ["caudal", "Caudal", "Caudal", 156723],
  ], { optional: true }),
  S("block", "Peripheral Nerve Blockade Site (Optional)", [
    ["interscalene", "Interscalene", "Interscalene", 156731],
    ["supraclavicular", "Supraclavicular", "Supraclavicular", 156733],
    ["infraclavicular", "Infraclavicular", "Infraclavicular", 156732],
    ["axillary", "Axillary", "Axillary", 156734],
    ["femoral", "Femoral", "Femoral", 156735],
    ["adductor", "Adductor Canal", "Adductor canal", 1911477],
    ["popliteal", "Popliteal", "Popliteal", 156729],
    ["saphenous", "Saphenous", "Saphenous", 156740],
    ["sciatic", "Sciatic", "Sciatic", 156736],
    ["ankle", "Ankle", "Ankle", 156730],
    ["lumbar-plexus", "Lumbar Plexus", "Lumbar plexus", 156737],
    ["tap", "Transverse Abdominal Plane", "TAP", 1911475],
    ["esp", "Erector Spinae Plane", "ESP", 1911478],
    ["ql", "Quadratus Lumborum", "QL", 1911476],
    ["paravertebral", "Paravertebral", "Paravertebral", 156739],
    ["retrobulbar", "Retrobulbar", "Retrobulbar", 156738],
    ["block-other", "Other-per nerve block sit", "Other block", 1256340],
  ], { optional: true }),
  S("pain-new", "Pain Evaluation - New Patient", [
    ["acute-consult", "Acute pain consult", "Acute pain consult", 156750],
    ["chronic-consult", "Chronic pain consult", "Chronic pain consult", 156751],
    ["cancer-consult", "Cancer pain consult", "Cancer pain consult", 156752],
  ], { group: "pain" }),
  S("pain-postop", "Pain evaluation - Post-op evaluation", [
    ["pca", "PCA", "PCA", 156754],
    ["pcea", "PCEA", "PCEA", 156753],
    ["perineural", "Nerve cath-perineural PCA", "Perineural catheter", 156755],
    ["postop-other", "Other-post op pain eval", "Other post-op eval", 156756],
  ], { group: "pain" }),
  S("pain-proc", "Pain Procedures", [
    ["epidural-pain", "Epidural (pain proc)", "Epidural injection", 156757],
    ["facet", "Facet Procedure", "Facet", 156758],
    ["nerve-root", "Nerve Root", "Nerve root", 156767],
    ["trigger", "Trigger Point", "Trigger point", 156763],
    ["stellate", "Stellate Ganglion", "Stellate ganglion", 156769],
    ["lumbar-symp", "Lumbar Sympathetic", "Lumbar sympathetic", 156766],
    ["intercostal", "Intercostal", "Intercostal", 156762],
    ["suprascapular", "Suprascapular", "Suprascapular", 156770],
    ["ilioinguinal", "Ilioinguinal", "Ilioinguinal", 156761],
    ["iliohypogastric", "Iliohypogastric", "Iliohypogastric", 156760],
    ["genitofemoral", "Genitofemorial", "Genitofemoral", 156759],
    ["lfcn", "Lateral Femoral Cutaneous", "Lat. femoral cutaneous", 156765],
    ["pudendal", "Pudendal", "Pudendal", 156768],
    ["pain-other", "Other - Pain Procedures", "Other pain procedure", 156764],
  ], { group: "pain" }),
];
export const ITEMS = new Map(SECTIONS.flatMap((s) => s.items.map((i) => [i.key, { ...i, section: s.key, area: s.title, group: s.group }])));

// ---- presets: one tap sets what was done (age and ASA stay as they are) ----
export const PRESETS = {
  "ga-dl": { label: "GA · tube · DL", codes: ["general", "dl", "ett"] },
  "ga-vl": { label: "GA · tube · video", codes: ["general", "vl", "ett"] },
  "ga-lma": { label: "GA · LMA", codes: ["general", "sga"] },
  mac: { label: "MAC", codes: ["mac"] },
  spinal: { label: "Spinal", codes: ["spinal", "lumbar"] },
  "labor-epi": { label: "Labor epidural", codes: ["epidural", "vag", "lumbar"] },
  "labor-cse": { label: "Labor CSE", codes: ["cse", "vag", "lumbar"] },
  "cs-spinal": { label: "C-section · spinal", codes: ["spinal", "cs", "lumbar"] },
  "cs-epi": { label: "C-section · epidural", codes: ["epidural", "cs", "lumbar"] },
  "cs-cse": { label: "C-section · CSE", codes: ["cse", "cs", "lumbar"] },
  "cs-ga": { label: "C-section · GA", codes: ["general", "ett", "cs"] },
  "on-pump": { label: "On pump", codes: ["general", "ett", "cpb", "art", "cvc", "us", "tee"] },
  "off-pump": { label: "Off pump", codes: ["general", "ett", "no-cpb", "art", "cvc", "us", "tee"] },
  "lung-dlt": { label: "Lung · DLT", codes: ["general", "dlt", "thoracic", "art"] },
  "lung-blocker": { label: "Lung · blocker", codes: ["general", "ett", "blocker", "thoracic", "art"] },
  "vasc-open": { label: "Open vascular", codes: ["general", "ett", "vessels", "art"] },
  "vasc-endo": { label: "Endovascular", codes: ["general", "ett", "vessels-endo", "art"] },
  crani: { label: "Craniotomy", codes: ["general", "ett", "crani", "art"] },
  "crani-vasc": { label: "Aneurysm / AVM, open", codes: ["general", "ett", "crani-vasc", "art"] },
  "neuro-endo": { label: "Neuro endovascular", codes: ["general", "ett", "neuro-endo", "art"] },
  "peds-mask": { label: "Mask induction · tube", codes: ["general", "mask", "ett"] },
  "peds-lma": { label: "Mask induction · LMA", codes: ["general", "mask", "sga"] },
  "block-ga": { label: "Block + GA", codes: ["pnb", "general", "sga"] },
  "block-mac": { label: "Block + MAC", codes: ["pnb", "mac"] },
  "acute-consult": { label: "Acute pain consult", codes: ["acute-consult"], group: "pain" },
  "pca-pcea": { label: "PCA / PCEA check", codes: ["pcea"], group: "pain" },
  "chronic-consult": { label: "Chronic pain consult", codes: ["chronic-consult"], group: "pain" },
  "cancer-consult": { label: "Cancer pain consult", codes: ["cancer-consult"], group: "pain" },
  "esi": { label: "Epidural injection", codes: ["epidural-pain"], group: "pain" },
  facet: { label: "Facet", codes: ["facet"], group: "pain" },
  "nerve-root": { label: "Nerve root", codes: ["nerve-root"], group: "pain" },
  trigger: { label: "Trigger point", codes: ["trigger"], group: "pain" },
  // Procedures on their own (an intern's art line on the floor, a line in the ICU): no anesthetic,
  // so no ASA needed. `word` goes in the Case ID.
  "proc-art": { label: "Art line", codes: ["art"], word: "Aline" },
  "proc-cvc": { label: "Central line", codes: ["cvc", "us"], word: "CVC" },
  "proc-us": { label: "Ultrasound-guided IV", codes: ["us"], word: "USIV" },
  "proc-ett": { label: "Intubation", codes: ["ett", "dl"], word: "Intubation" },
  "proc-pa": { label: "PA catheter", codes: ["pa", "cvc"], word: "PAC" },
  "proc-block": { label: "Nerve block", codes: ["pnb"], word: "Block" },
};
export const PROCEDURES = ["proc-art", "proc-cvc", "proc-us", "proc-ett", "proc-pa", "proc-block"];

// What each kind of day offers first: presets (one tap sets the case) and extras (one tap adds or
// removes a box). Everything else on ACGME's form is one more tap away under "All options".
const KINDS = {
  or: { label: "OR", presets: ["ga-dl", "ga-vl", "ga-lma", "mac", "spinal"], extras: ["art", "cvc", "pnb", "awake", "fob"] },
  ob: { label: "OB", presets: ["labor-epi", "labor-cse", "cs-spinal", "cs-epi", "cs-ga", "cs-cse"], extras: ["high-risk", "art"], add: true },
  cardiac: { label: "Cardiac", presets: ["on-pump", "off-pump", "ga-dl", "ga-vl"], extras: ["pa", "tee", "art", "cvc", "us"] },
  thoracic: { label: "Thoracic", presets: ["lung-dlt", "lung-blocker", "ga-dl", "ga-vl"], extras: ["art", "paravertebral", "esp", "fob", "epidural"] },
  vascular: { label: "Vascular", presets: ["vasc-open", "vasc-endo", "ga-dl", "ga-vl", "mac"], extras: ["art", "cvc", "csf", "us"] },
  neuro: { label: "Neuro", presets: ["crani", "crani-vasc", "neuro-endo", "ga-dl", "ga-vl"], extras: ["art", "ep", "cvc", "awake", "fob"] },
  peds: { label: "Peds", presets: ["peds-mask", "peds-lma", "ga-vl", "ga-dl", "mac"], extras: ["caudal", "pnb", "nasal", "art"] },
  regional: { label: "Regional", presets: ["block-ga", "block-mac", "spinal", "ga-lma", "acute-consult"], extras: ["pnb-cath", "interscalene", "supraclavicular", "adductor", "popliteal", "femoral", "tap", "esp", "ql"], add: true },
  pain: { label: "Pain clinic", presets: ["chronic-consult", "cancer-consult", "esi", "facet", "nerve-root", "trigger"], extras: ["stellate", "lumbar-symp", "pain-other"], add: true, group: "pain" },
  nora: { label: "NORA", presets: ["mac", "ga-vl", "ga-dl", "ga-lma"], extras: ["art", "awake"] },
  call: { label: "Call", presets: ["ga-dl", "ga-vl", "ga-lma", "mac", "spinal", "cs-spinal", "labor-epi"], extras: ["trauma", "art", "cvc", "high-risk"], add: true },
  procedure: { label: "Procedure", presets: PROCEDURES, extras: ["us", "vl", "fob", "awake", "art", "cvc", "mask", "sga"], add: true },
};
export const kindInfo = (kind) => KINDS[kind] || KINDS.or;

const KIND_OF_CODE = {
  BA: "or", "BA-V": "vascular", OPSC: "or", VA: "or", AP: "regional", CP: "pain", P: "pain", HC: "cardiac", TEE: "cardiac",
  HN: "neuro", "HN/ACC": "neuro", ACC: "neuro", TH: "thoracic", VASC: "vascular", VAS: "vascular", NORA: "nora",
  CHM: "peds", HVSH: "regional", OB: "ob", OB1: "ob", "11-9": "ob",
};

// The kind of cases a day holds, or null when there are none to log (off, clinic, ICU, electives).
export function caseKind(d) {
  if (!d || d.status !== "work") return null;
  if (d.roles?.some((r) => r.kind === "ob")) return "ob";
  if (d.call && d.call !== "10-7") return "call";
  const fromCode = KIND_OF_CODE[d.code];
  if (d.roles?.some((r) => r.kind === "room")) return fromCode && fromCode !== "pain" ? fromCode : "or";
  if (d.roles?.some((r) => r.kind === "opsc")) return "or";
  if (d.call === "10-7") return "call";
  return fromCode || null;
}

// ---- the day, from the schedule ----
const tidy = (s) => String(s ?? "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
// "Rook/Sable" -> "Rook"; "Dr. O'Neil" -> "ONeil": what goes inside a Case ID.
export function surgeonWord(name) {
  const first = tidy(name).split(/[/,&+]| and /i)[0].replace(/^dr\.?\s+/i, "");
  return first.split(" ").filter(Boolean).at(-1)?.replace(/[^A-Za-z-]/g, "") || "";
}

// A supervisor as the app keeps it: the directory's full name when the sheet's name matches one.
export function supervisorFrom(model, name, site = "harper") {
  const raw = tidy(name).split(/[/,&+]/)[0].trim();
  if (!raw) return null;
  const s = model?.dir?.staff?.(raw, { site });
  return s ? { last: s.last, first: s.first || "", name: `${s.last}, ${s.first || ""}`.replace(/, $/, "") } : { last: raw.split(" ").at(-1), first: "", name: raw };
}

// Everything the schedule says about one resident's cases on one day.
export function dayCases(model, pid, date) {
  const d = model.day(pid, date);
  const kind = caseKind(d);
  const site = SITE_FOR[d.roles?.some((r) => r.kind === "ob") ? "hutzel" : d.site] || (kind ? "harper" : null);
  const rooms = (d.roles || []).filter((r) => r.kind === "room").map((r) => ({
    or: String(r.or), surgeon: tidy(r.room.surgeon), cases: Math.max(0, Math.min(20, parseInt(r.room.cases, 10) || 0)), time: r.room.time || "",
    supervisor: supervisorFrom(model, r.room.mda, "harper"),
  }));
  const ob = d.roles?.find((r) => r.kind === "ob");
  const opsc = d.roles?.find((r) => r.kind === "opsc");
  const supervisor = rooms[0]?.supervisor || (ob?.mda ? supervisorFrom(model, ob.mda, "hutzel") : null) || (opsc?.mdas?.length === 1 ? supervisorFrom(model, opsc.mdas[0], "opsc") : null);
  const expected = rooms.reduce((n, r) => n + r.cases, 0);
  const where = rooms.length ? rooms.map((r) => `OR ${r.or}${r.surgeon ? ` · ${r.surgeon}` : ""}`).join(", ")
    : ob ? "Hutzel OB" : opsc ? "OPSC" : d.call ? d.label : d.label || "";
  return { d, kind, site, rooms, supervisor, expected, where, overnight: (d.shifts || []).some((s) => s.end > 1440) };
}

// When to nudge about a day's cases: 15 minutes after the shift ends, and the next morning at
// 7:30 for a shift that runs overnight. Minutes from midnight of `date` (so >1440 is next day).
export function nudgeAt(d) {
  const end = Math.max(0, ...(d?.shifts || []).map((s) => s.end));
  if (!end) return 1095;
  return end > 1440 ? 1440 + 450 : end + 15;
}

// ---- one case ----
export function caseIdFor(date, word, n) {
  const { y, m, d } = parts(date);
  const head = `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${String(y).slice(-2)}-`;
  const tail = `-${n}`;
  const room = CASE_ID_MAX - head.length - tail.length;
  return `${head}${(word || "Case").slice(0, room)}${tail}`;
}

// `day` is the schedule day it was logged under; `date` is ACGME's case date (the next day for a
// case after midnight on call).
export function blankCase({ id = "", date, day = date, kind = "or", group = "proc", site = "harper", supervisor = null, surgeon = "", or = "", slot = "", seq = 1, word = "", codes = [], age = "d" }) {
  return {
    id, day, date, kind, slot, seq, or, surgeon, word: word || surgeonWord(surgeon) || "", caseId: caseIdFor(date, word || surgeonWord(surgeon), seq),
    site, supervisor, age, asa: "", emergency: false, group, codes: order(codes), ltp: "", airway: "", comments: "",
    customId: false, updatedAt: "", enteredAt: "",
  };
}

// After a change of date or number, a Case ID the resident didn't type follows along (in the
// default style; the screens use the resident's own style, below).
export const withCaseId = (c) => (c.customId ? c : { ...c, caseId: caseIdFor(c.date, c.word || surgeonWord(c.surgeon), c.seq) });

// ---- Case ID styles: everyone names cases their own way ----
// A style is a list of parts joined by a separator. Numbers come three ways: the case's place in
// the day, its place among that day's cases with the same surgeon (or procedure), or a running
// number that keeps counting from wherever the resident says (their ACGME total, say).
export const ID_PARTS = {
  date: "Date",
  word: "Surgeon or procedure",
  room: "Room",
  site: "Hospital",
  initials: "Your initials",
  text: "Your own text",
  day: "Case # of the day",
  daySurgeon: "Case # with that surgeon",
  total: "Running case #",
};
export const DATE_FORMATS = ["MM/DD/YY", "MM-DD-YY", "MMDDYY", "YYMMDD", "YYYY-MM-DD", "MM/DD", "MMDD"];
export const SEPARATORS = [["-", "Dash"], ["_", "Underscore"], [" ", "Space"], ["/", "Slash"], ["", "None"]];
// `start` is where the running number starts; `last` the highest one a case took into ACGME since
// `setAt`, when the resident last said where to start (so they can restart lower if they need to).
export const DEFAULT_NAMING = { parts: ["date", "word", "daySurgeon"], date: "MM/DD/YY", sep: "-", text: "", start: 1, last: 0, setAt: "" };
export const NAMING_STYLES = [
  { key: "habit", label: "Date, surgeon, number", parts: ["date", "word", "daySurgeon"], date: "MM/DD/YY", sep: "-" },
  { key: "total", label: "One running number", parts: ["total"] },
  { key: "date-total", label: "Date, running number", parts: ["date", "total"], date: "MM/DD/YY", sep: "-" },
  { key: "date-day", label: "Date, case of the day", parts: ["date", "day"], date: "MMDDYY", sep: "-" },
  { key: "word", label: "Surgeon, number", parts: ["word", "daySurgeon"], sep: "-" },
  { key: "room", label: "Date, room, case of the day", parts: ["date", "room", "day"], date: "MM/DD/YY", sep: "-" },
  { key: "blank", label: "Leave it blank", parts: [] },
];

export function cleanNaming(raw) {
  const n = raw && typeof raw === "object" ? raw : {};
  const parts = (Array.isArray(n.parts) ? n.parts : DEFAULT_NAMING.parts).filter((p) => ID_PARTS[p]).slice(0, 6);
  const int = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) && x >= 0 && x < 1e6 ? x : d; };
  return {
    parts: Array.isArray(n.parts) ? parts : [...DEFAULT_NAMING.parts],
    date: DATE_FORMATS.includes(n.date) ? n.date : DEFAULT_NAMING.date,
    sep: SEPARATORS.some(([v]) => v === n.sep) ? n.sep : DEFAULT_NAMING.sep,
    text: String(n.text ?? "").replace(/[^\w .#/-]/g, "").slice(0, 12),
    start: Math.max(1, int(n.start, 1)),
    last: int(n.last, 0),
    setAt: typeof n.setAt === "string" && !Number.isNaN(Date.parse(n.setAt)) ? new Date(n.setAt).toISOString() : "",
  };
}
// Which ready-made style a resident's choice is, or "custom".
export function styleOf(naming) {
  const n = cleanNaming(naming);
  const hit = NAMING_STYLES.find((st) => st.parts.join() === n.parts.join() && (!st.parts.includes("date") || st.date === n.date) && (st.parts.length < 2 || (st.sep ?? "-") === n.sep));
  return hit && !n.parts.includes("text") ? hit.key : "custom";
}
export const usesTotal = (naming) => cleanNaming(naming).parts.includes("total");
export const withStyle = (naming, key) => {
  const st = NAMING_STYLES.find((x) => x.key === key);
  const n = cleanNaming(naming);
  return st ? { ...n, parts: [...st.parts], date: st.date || n.date, sep: st.sep ?? n.sep } : n;
};

function fmtCaseDate(date, f) {
  const { y, m, d } = parts(date);
  const MM = String(m).padStart(2, "0"), DD = String(d).padStart(2, "0"), YY = String(y).slice(-2);
  return { "MM/DD/YY": `${MM}/${DD}/${YY}`, "MM-DD-YY": `${MM}-${DD}-${YY}`, MMDDYY: `${MM}${DD}${YY}`, YYMMDD: `${YY}${MM}${DD}`, "YYYY-MM-DD": `${y}-${MM}-${DD}`, "MM/DD": `${MM}/${DD}`, MMDD: `${MM}${DD}` }[f] || `${MM}/${DD}/${YY}`;
}

// One case's ID in a style. `nums` is { day, daySurgeon, total, initials }. ACGME takes 25
// characters, so a long surgeon or procedure name is shortened first.
export function formatCaseId(c, naming, nums = {}) {
  const n = cleanNaming(naming);
  const word = c.word || surgeonWord(c.surgeon) || "Case";
  const piece = (p, w) => ({
    date: fmtCaseDate(c.date, n.date),
    word: w,
    room: c.or ? `OR${String(c.or).replace(/\s+/g, "")}` : "",
    site: ACGME_SITES[c.site]?.code || "",
    initials: nums.initials || "",
    text: n.text,
    day: nums.day ? String(nums.day) : "",
    daySurgeon: String(nums.daySurgeon || c.seq || 1),
    total: nums.total ? String(nums.total) : "",
  }[p] || "");
  const build = (w) => n.parts.map((p) => piece(p, w)).filter(Boolean).join(n.sep);
  let id = build(word);
  if (id.length > CASE_ID_MAX && n.parts.includes("word")) id = build(word.slice(0, Math.max(1, word.length - (id.length - CASE_ID_MAX))));
  return id.slice(0, CASE_ID_MAX);
}

// The highest running number a case has taken into ACGME since the resident said where to start.
export function lastUsed(naming, cases) {
  const n = cleanNaming(naming);
  return Math.max(n.last, ...cases.filter((c) => c.enteredAt && c.num && c.enteredAt > n.setAt).map((c) => c.num));
}

// Every case's ID in the resident's style. `days` is [{ day, cards }], oldest first, each day's
// cards in the order the screen shows them (sheet cases not logged yet included, so the day's
// numbers match what the resident sees). Cases in ACGME keep their IDs but still count for the
// day's numbers. Running numbers go to logged cases in that same order, which is the order the
// Log cases button enters them, so they track ACGME's own count; sheet cases not logged yet get
// the numbers after. Returns key (id, or slot for a sheet case) -> { num, caseId }.
export function planIds(days, naming, { initials = "", last = 0 } = {}) {
  const n = cleanNaming(naming);
  const counting = n.parts.includes("total");
  let next = Math.max(n.start, n.last + 1, last + 1);
  const out = new Map();
  const later = [];
  for (const { cards } of days) {
    const per = {};
    cards.forEach((c, i) => {
      const w = (c.word || surgeonWord(c.surgeon) || "").toLowerCase();
      per[w] = (per[w] || 0) + 1;
      if (c.enteredAt) return;
      const nums = { day: i + 1, daySurgeon: per[w], initials };
      if (counting && !c.id) { later.push([c, nums]); return; }
      const num = counting ? next++ : 0;
      out.set(c.id || c.slot, { num, caseId: c.customId ? c.caseId : formatCaseId(c, n, { ...nums, total: num }) });
    });
  }
  for (const [c, nums] of later) {
    const num = next++;
    out.set(c.slot, { num: 0, caseId: formatCaseId(c, n, { ...nums, total: num }) });
  }
  return out;
}

// Every box is its own: ticking one never unticks or ticks another, so any combination ACGME's
// form allows can be logged. "high-risk" and "trauma" are shortcuts for the boxes they name.
export function toggleCode(c, key) {
  const codes = new Set(c.codes);
  if (key === "high-risk") {
    // The delivery boxes already ticked, swapped for their high-risk versions (and back).
    const swaps = [["cs", "cs-hr"], ["vag", "vag-hr"]];
    const on = swaps.some(([, hr]) => codes.has(hr));
    for (const [plain, hr] of swaps) {
      if (on && codes.has(hr)) { codes.delete(hr); codes.add(plain); }
      if (!on && codes.has(plain)) { codes.delete(plain); codes.add(hr); }
    }
    return { ...c, codes: order([...codes]) };
  }
  if (key === "trauma") return { ...c, ltp: c.ltp === "trauma" ? "" : "trauma" };
  if (codes.has(key)) codes.delete(key); else codes.add(key);
  return { ...c, codes: order([...codes]) };
}
export const extraOn = (c, key) => (key === "high-risk" ? c.codes.some((k) => k === "cs-hr" || k === "vag-hr") : key === "trauma" ? c.ltp === "trauma" : c.codes.includes(key));

// A preset's boxes, in high-risk form when the case is already high-risk.
const presetCodes = (c, p) => (c.codes.some((k) => k === "cs-hr" || k === "vag-hr") ? p.codes.map((k) => (k === "cs" ? "cs-hr" : k === "vag" ? "vag-hr" : k)) : p.codes);

// Presets add their boxes to what's there (two of them make a combination: a labor epidural that
// became a C-section). Tapping one that's on takes its boxes off again, apart from boxes another
// preset that's on still needs. A pain preset moves the case to ACGME's pain group; the other
// group's boxes are kept, only not sent, so switching back loses nothing.
export function applyPreset(c, key) {
  const p = PRESETS[key];
  if (!p) return c;
  const group = p.group || "proc";
  if (presetOn(c, key)) {
    const still = new Set(Object.keys(PRESETS).filter((k) => k !== key && presetOn(c, k)).flatMap((k) => presetCodes(c, PRESETS[k])));
    const drop = new Set(presetCodes(c, p).filter((k) => !still.has(k)));
    return { ...c, codes: order(c.codes.filter((k) => !drop.has(k))) };
  }
  return { ...c, group, codes: order([...c.codes, ...presetCodes(c, p)]) };
}
export const presetOn = (c, key) => {
  const p = PRESETS[key];
  if (!p || (p.group || "proc") !== c.group) return false;
  const have = new Set(c.codes.map((k) => k.replace(/-hr$/, "")));
  return p.codes.every((k) => have.has(k));
};

// The same for a resident's own usual combination.
export function applyCombo(c, combo) {
  const on = combo.group === c.group && combo.codes.every((k) => c.codes.includes(k));
  if (on) return { ...c, codes: c.codes.filter((k) => !combo.codes.includes(k)) };
  return { ...c, group: combo.group, codes: order([...c.codes, ...combo.codes]) };
}
export const comboOn = (c, combo) => combo.group === c.group && combo.codes.every((k) => c.codes.includes(k));

const ORDER = [...ITEMS.keys()];
export const order = (codes) => [...new Set(codes)].filter((k) => ITEMS.has(k)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

// What still stands between this case and ACGME. Empty means ready.
export function missing(c) {
  const out = [];
  if (!c.supervisor?.last) out.push("supervisor");
  if (!ACGME_SITES[c.site]) out.push("site");
  if (!AGES.some((a) => a.key === c.age)) out.push("age");
  if (c.group === "pain") {
    if (!c.codes.some((k) => ITEMS.get(k)?.group === "pain")) out.push("what you did");
  } else if (c.kind === "procedure") {
    if (!c.codes.some((k) => ITEMS.get(k)?.group === "proc")) out.push("what you did");
  } else {
    if (!c.asa) out.push("ASA");
    if (!c.codes.some((k) => ITEMS.get(k)?.section === "type" || ITEMS.get(k)?.section === "category")) out.push("what you did");
  }
  return out;
}
export const isReady = (c) => missing(c).length === 0;

export function summary(c, { asa = true } = {}) {
  const words = order(c.codes).filter((k) => ITEMS.get(k)?.group === c.group).map((k) => ITEMS.get(k).short);
  if (c.ltp === "trauma") words.push("Trauma");
  else if (c.ltp === "nontrauma") words.push("Life-threatening");
  if (c.airway) words.push(`Difficult airway (${c.airway})`);
  if (asa && c.group !== "pain" && c.asa) words.push(`ASA ${c.asa}${c.emergency ? "E" : ""}`);
  return words.join(" · ");
}

// ---- for the bookmark on ACGME's page ----
const usDate = (date) => { const { y, m, d } = parts(date); return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`; };
export function toAcgme(c) {
  const group = c.group === "pain" ? "pain" : "proc";
  const items = order(c.codes).map((k) => ITEMS.get(k)).filter((i) => i.group === group).map((i) => ({ id: i.id, area: i.area, label: i.label }));
  if (group === "proc" && c.asa) {
    const key = `${c.asa}${c.emergency && c.asa !== "6" ? "E" : ""}`;
    items.unshift({ id: ASA_IDS[key], area: "ASA Physical Status", label: key, type: `ASA ${key}` });
  }
  const radios = [CASE_TYPES.ltp[c.ltp], CASE_TYPES.airway[c.airway]].filter(Boolean);
  const site = ACGME_SITES[c.site] || ACGME_SITES.harper;
  return {
    id: c.id, caseId: c.caseId, date: usDate(c.date), siteId: site.id, siteName: site.name,
    supervisor: c.supervisor ? { last: c.supervisor.last, first: c.supervisor.first || "" } : null,
    ageId: AGES.find((a) => a.key === c.age)?.id || 33, group: GROUPS[group], items, radios,
    comments: String(c.comments || "").slice(0, 500), summary: summary(c),
  };
}

// ---- learning: what this resident usually does, kept short so the cases themselves can go ----
const surgeonKey = (s) => fold(surgeonWord(s));
// Only the boxes of the case's own group count (the other group's are kept but not sent).
const sentCodes = (c) => order(c.codes).filter((k) => ITEMS.get(k)?.group === (c.group === "pain" ? "pain" : "proc"));
const comboKey = (c) => `${c.group}:${sentCodes(c).join(",")}`;
// `seen` is the latest case date for each entry.
export function summarize(cases) {
  const out = { surgeons: {}, combos: {}, supervisors: {}, sites: {} };
  for (const c of cases) {
    if (!isReady(c)) continue;
    const kind = c.kind || "or";
    const sk = surgeonKey(c.surgeon);
    if (sk) {
      const was = out.surgeons[sk];
      out.surgeons[sk] = !was || was.seen <= c.date ? { codes: sentCodes(c), group: c.group, n: (was?.n || 0) + 1, seen: c.date } : { ...was, n: was.n + 1 };
    }
    const ck = `${kind}|${comboKey(c)}`;
    const combo = out.combos[ck] || { kind, group: c.group, codes: sentCodes(c), n: 0, seen: "" };
    combo.n++;
    if (c.date > combo.seen) combo.seen = c.date;
    out.combos[ck] = combo;
    if (c.supervisor?.last) {
      const vk = fold(`${c.supervisor.last} ${c.supervisor.first || ""}`).trim();
      const v = out.supervisors[vk] || { last: c.supervisor.last, first: c.supervisor.first || "", n: 0, seen: "" };
      v.n++;
      if (c.date > v.seen) v.seen = c.date;
      out.supervisors[vk] = v;
    }
    if (!out.sites[kind] || out.sites[kind].seen <= c.date) out.sites[kind] = { site: c.site, seen: c.date };
  }
  return out;
}
// Adds two summaries (the cases still kept, and the ones already pruned).
export function mergeSummaries(a, b) {
  const out = { surgeons: { ...(a?.surgeons || {}) }, combos: { ...(a?.combos || {}) }, supervisors: { ...(a?.supervisors || {}) }, sites: { ...(a?.sites || {}) } };
  for (const key of ["surgeons", "combos", "supervisors"]) {
    for (const [k, v] of Object.entries(b?.[key] || {})) {
      const was = out[key][k];
      out[key][k] = !was ? v : v.seen >= was.seen ? { ...v, n: was.n + v.n } : { ...was, n: was.n + v.n };
    }
  }
  for (const [k, v] of Object.entries(b?.sites || {})) if (!out.sites[k] || out.sites[k].seen <= v.seen) out.sites[k] = v;
  // Keep it small: the most used and most recent.
  for (const key of ["combos", "supervisors", "surgeons"]) {
    const list = Object.entries(out[key]).sort((x, y) => y[1].n - x[1].n || (y[1].seen > x[1].seen ? 1 : -1));
    out[key] = Object.fromEntries(list.slice(0, key === "surgeons" ? 150 : 60));
  }
  return out;
}

// The resident's own usual choices for this kind of day, best first (two uses or more).
export function usual(learned, kind, limit = 3) {
  return Object.values(learned?.combos || {})
    .filter((x) => x.kind === kind && x.n >= 2 && x.codes.length)
    .sort((a, b) => b.n - a.n || (b.seen > a.seen ? 1 : -1))
    .slice(0, limit)
    .map((x) => ({ codes: x.codes, group: x.group, label: summary({ codes: x.codes, group: x.group, ltp: "", airway: "" }, { asa: false }) }));
}
export const surgeonHabit = (learned, surgeon) => learned?.surgeons?.[surgeonKey(surgeon)] || null;
export const recentSupervisors = (learned, limit = 8) => Object.values(learned?.supervisors || {}).sort((a, b) => (b.seen > a.seen ? 1 : b.seen < a.seen ? -1 : b.n - a.n)).slice(0, limit);

// The cards a day starts with: one per case on the sheet, each with its Case ID and supervisor,
// and what was done filled in from the last time with that surgeon. Later cases in a room show
// what the case before them got until they're changed (rooms usually run one kind of case).
export function startingCards(ctx, learned, date) {
  const cards = [];
  const site = learned?.sites?.[ctx.kind]?.site || ctx.site || "harper";
  for (const room of ctx.rooms) {
    const habit = surgeonHabit(learned, room.surgeon);
    for (let n = 1; n <= room.cases; n++) {
      cards.push({
        ...blankCase({
          date, kind: ctx.kind, slot: `${date}|${room.or}|${n}`, seq: n, or: room.or, surgeon: room.surgeon, site,
          supervisor: room.supervisor, codes: n === 1 ? habit?.codes || [] : [], group: n === 1 && habit ? habit.group : (kindInfo(ctx.kind).group || "proc"),
          age: ctx.kind === "peds" ? "" : "d",
        }),
        inherit: n > 1,
      });
    }
  }
  return cards;
}

// A Case ID word for a day without a surgeon on the sheet.
export function dayWord(ctx) {
  return { ob: "OB", call: "Call", regional: "Block", pain: "Pain", nora: "NORA", peds: "Peds", cardiac: "Cardiac" }[ctx.kind] || "Case";
}

// Which day an overnight case belongs to, by ACGME's date.
export const caseDateFor = (date, afterMidnight) => (afterMidnight ? addDays(date, 1) : date);
