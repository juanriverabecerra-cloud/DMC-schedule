// What the codes and colors on the DMC call sheet mean.
// Hours confirmed by the residents: H1 = 24 h (6a-6a), H2 = 12 h (6a-6p), NF = 6p-6a,
// "10-7" = 10a-7p, green = late resident (finishes at their site, then helps at Harper until 6p),
// blue on a weekday = 24-hour call (same as H1), magenta week = cardiac call, "X" in an OR = CRNA room.
// The CA-1 obstetrics rotation is officially the "11 to 9" rotation: Monday to Friday, 11a-9p.

export const SITES = {
  harper: { short: "Harper", name: "Harper University Hospital" },
  opsc: { short: "OPSC", name: "OPSC – CVI Outpatient" },
  hutzel: { short: "Hutzel OB", name: "Hutzel Women's Hospital" },
  va: { short: "VA", name: "John D. Dingell VA Medical Center" },
  chm: { short: "CHM", name: "Children's Hospital of Michigan" },
  hvsh: { short: "HVSH", name: "Huron Valley-Sinai Hospital" },
  sinai: { short: "Sinai-Grace", name: "Sinai-Grace Hospital" },
  pain: { short: "Chronic Pain", name: "Chronic Pain service" },
  elective: { short: "Elective", name: "Elective" },
  offservice: { short: "Off-service", name: "Off-service rotation" },
};

// Day codes as typed in the call sheet cells.
export const CODES = {
  "BA": { label: "Basic Anesthesia", site: "harper", group: "Basic Anesthesia" },
  "BA-V": { label: "Basic Anesthesia – Vascular", site: "harper", group: "Basic Anesthesia" },
  "OPSC": { label: "OPSC", site: "opsc", group: "OPSC" },
  "VA": { label: "VA", site: "va", group: "VA" },
  "PACU": { label: "PACU", site: "harper", group: "PACU" },
  "AP": { label: "Acute Pain", site: "harper", group: "Acute Pain" },
  "CP": { label: "Chronic Pain", site: "pain", group: "Chronic Pain" },
  "P": { label: "Chronic Pain", site: "pain", group: "Chronic Pain" },
  "HC": { label: "Cardiac", site: "harper", group: "Cardiac" },
  "HN": { label: "Neuro", site: "harper", group: "Neuro / ACC" },
  "HN/ACC": { label: "Neuro / ACC", site: "harper", group: "Neuro / ACC" },
  "ACC": { label: "Advanced Clinical Cases", site: "harper", group: "Neuro / ACC" },
  "TH": { label: "Thoracic", site: "harper", group: "Thoracic" },
  "VASC": { label: "Vascular", site: "harper", group: "Vascular" },
  "VAS": { label: "Vascular", site: "harper", group: "Vascular" },
  "BD": { label: "Board Runner", site: "harper", group: "Board Runner" },
  "JA": { label: "Junior Attending", site: "harper", group: "Junior Attending" },
  "RES. INT": { label: "Res. int", site: "harper", group: "Junior Attending" },
  "NORA": { label: "NORA", site: "harper", group: "NORA" },
  "PAT": { label: "PAT clinic", site: "harper", group: "PAT" },
  "9-ICU": { label: "9-ICU", site: "harper", group: "9-ICU" },
  "SG-ICU": { label: "Sinai-Grace ICU", site: "sinai", group: "Sinai-Grace ICU" },
  "CHM": { label: "Pediatrics (CHM)", site: "chm", group: "Pediatrics" },
  "HVSH": { label: "Regional @ HVSH", site: "hvsh", group: "Regional" },
  "OB": { label: "Obstetrics", site: "hutzel", group: "Obstetrics" },
  "OB1": { label: "Obstetrics (OB1)", site: "hutzel", group: "Obstetrics" },
  "11-9": { label: "11 to 9", site: "hutzel", group: "Obstetrics", hours: [660, 1260] },
  "TEE": { label: "TEE", site: "harper", group: "Cardiac" },
  "GLAM": { label: "Conference (GLAM)", site: "elective", group: "Other" },
  "ELECT": { label: "Elective", site: "elective", group: "Elective" },
  "ELECT-J": { label: "Elective – Jeopardy", site: "elective", group: "Elective" },
  "NCD": { label: "NCD", site: "harper", group: "Other" },
};

// Codes that are a shift or a status rather than a rotation.
export const CALL_CODES = {
  "H1": { label: "24-hr call", short: "H1 24h", kind: "call24", start: 360, end: 1800 },
  "H2": { label: "12-hr call", short: "H2 12h", kind: "call12", start: 360, end: 1080 },
  "NF": { label: "Night float", short: "NF", kind: "night", start: 1080, end: 1800 },
  "10-7": { label: "CA-3 10a–7p", short: "10–7", kind: "senior", start: 600, end: 1140 },
};
export const FRIDAY_24 = { label: "24-hr call", short: "24h", kind: "call24", start: 360, end: 1800 };

// Monthly rotation names (column C of the call sheet and the annual workbook) -> day code.
const ROTATION_RULES = [
  [/basic anesthesia\s*-\s*vascular|^ba-?v$/i, "BA-V"],
  [/^ba\/pacu$|^pacu\/ba$/i, "BA"],
  [/basic anesthesia|^ba$/i, "BA"],
  [/^opsc/i, "OPSC"],
  [/^va\b/i, "VA"],
  [/pacu/i, "PACU"],
  [/acute pain/i, "AP"],
  [/chronic pain|karmanos/i, "CP"],
  [/^11\s*(?:a\.?m?\.?)?\s*(?:-|–|to)\s*9(?!\d)|^9-nov$/i, "11-9"],
  [/obstetric|^ob\b|hutzel/i, "OB"],
  [/regional|hvsh|huron/i, "HVSH"],
  [/pediatric|chm|children/i, "CHM"],
  [/sg-?icu|sinai/i, "SG-ICU"],
  [/9-?icu/i, "9-ICU"],
  [/thoracic/i, "TH"],
  [/neuro\s*\/\s*acc/i, "HN/ACC"],
  [/^neuro/i, "HN"],
  [/advanced clinical|^acc$/i, "ACC"],
  [/vascular/i, "VASC"],
  [/cardiac/i, "HC"],
  [/board/i, "BD"],
  [/junior attending/i, "JA"],
  [/jeopardy/i, "ELECT-J"],
  [/elective/i, "ELECT"],
  [/^pat\b/i, "PAT"],
  [/nora/i, "NORA"],
];

// Other ways a code gets typed, including what Excel shows when it turns "11-9" into a date.
const CODE_ALIASES = [
  [/^PEDS?$/, "CHM"],
  [/^(BA|BA-V|AP|OPSC|PACU|CP|VA|HC|TH|HN|ACC|BD|JA|NORA|VASC)1$/, null], // the rotation with a Friday 24-hr marker: "BA1"
  [/^11\s*A?M?\s*(?:-|–|TO)\s*9\s*P?M?$|^9-NOV$/, "11-9"],
  [/^10\s*A?M?\s*(?:-|–|TO)\s*7\s*P?M?$|^7-OCT$/, "10-7"],
];

export function normCode(raw) {
  const key = String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  for (const [re, code] of CODE_ALIASES) if (re.test(key)) return code ?? key.slice(0, -1);
  return key;
}

// The CA-1 OB rotation is the "11 to 9" rotation, whatever the sheet calls it.
export const CA1_OB_ROTATION = "11 to 9";
const isOb = (code) => code === "OB" || code === "OB1";
export function classCode(code, cls) {
  return cls === "CA-1" && isOb(code) ? "11-9" : code;
}
export function classRotation(name, cls) {
  return cls === "CA-1" && name && isOb(rotationCode(name)) ? CA1_OB_ROTATION : name;
}

export function rotationCode(name) {
  if (!name) return null;
  const s = String(name).trim();
  for (const [re, code] of ROTATION_RULES) if (re.test(s)) return code;
  return null;
}

export function codeInfo(code) {
  return CODES[normCode(code)] || null;
}

// Static fill colors (hex without '#') -> meaning. Admins can add more in Settings.
export const DEFAULT_FILL_TAGS = {
  "00FF00": "late",
  "C9DAF8": "call24",
  "CFE2F3": "call24",
  "A4C2F4": "call24",
  "9FC5E8": "call24",
  "FF00FF": "cardiac",
  "FAE2D5": "off",
  "FCE5CD": "off",
  "FFCFB3": "off",
};

// The chiefs pick a slightly different shade most months, so a color that isn't listed above
// is read by its family: bright green, magenta, pale blue, or peach.
export function fillFamily(hex) {
  const m = String(hex ?? "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d < 0.06) return null;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  if (h >= 100 && h <= 140 && s > 0.7 && l < 0.65) return "late";
  if (h >= 285 && h <= 315 && s > 0.7) return "cardiac";
  if (h >= 190 && h <= 235 && l >= 0.6) return "call24";
  if (h >= 8 && h <= 45 && l >= 0.75 && s >= 0.5) return "off";
  return null;
}

export const FILL_TAG_LABELS = {
  late: "Late resident (until 6p)",
  call24: "24-hour call",
  cardiac: "Cardiac call week",
  off: "Off / vacation block",
};

// Scheduled hours used for duty-hour estimates, in minutes from midnight.
export const DEFAULT_SETTINGS = {
  dayHours: [360, 1020], // regular weekday: 6a-5p (estimate; adjust in Settings)
  codeHours: {
    "11-9": [660, 1260],
    "PAT": [420, 960],
    "CP": [420, 960],
  },
  lateEnd: 1080,
  staffing: [
    { id: "late", label: "Late resident (until 6p)", days: [1, 2, 3, 4, 5], min: 1, match: "late" },
    { id: "nf", label: "Night float (6p–6a)", days: [0, 1, 2, 3, 4], min: 2, match: "NF" },
    { id: "senior", label: "CA-3 10a–7p", days: [0, 1, 2, 3, 4, 5, 6], min: 1, match: "10-7" },
    { id: "fri24", label: "Friday 24-hr call", days: [5], min: 2, match: "call24" },
    { id: "sat24", label: "Saturday 24-hr call (H1)", days: [6], min: 2, match: "call24" },
    { id: "sat12", label: "Saturday 12-hr call (H2)", days: [6], min: 1, match: "H2" },
    { id: "sun12", label: "Sunday 12-hr call (H2)", days: [0], min: 2, match: "H2" },
    { id: "cardiac", label: "Cardiac call", days: [0, 1, 2, 3, 4, 5, 6], min: 1, match: "cardiac" },
  ],
  fillTags: {},
};

export function mergeSettings(saved) {
  const s = saved || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    codeHours: { ...DEFAULT_SETTINGS.codeHours, ...(s.codeHours || {}) },
    fillTags: { ...DEFAULT_FILL_TAGS, ...(s.fillTags || {}) },
    staffing: Array.isArray(s.staffing) && s.staffing.length ? s.staffing : DEFAULT_SETTINGS.staffing,
  };
}

// Colors for rotation groups in the app (light, dark). Sheet colors are kept as a fallback.
export const GROUP_COLORS = {
  "Basic Anesthesia": "#7fb7ff",
  "OPSC": "#63d471",
  "VA": "#9ecf86",
  "PACU": "#f5a3e8",
  "Acute Pain": "#ff6b7a",
  "Chronic Pain": "#6f8ff0",
  "Cardiac": "#5cc8f0",
  "Neuro / ACC": "#ffa94d",
  "Thoracic": "#7de3e8",
  "Vascular": "#a78bfa",
  "Board Runner": "#3b9cff",
  "Junior Attending": "#c084fc",
  "NORA": "#f4e04d",
  "PAT": "#ff8a80",
  "9-ICU": "#4ade80",
  "Sinai-Grace ICU": "#22a06b",
  "Pediatrics": "#ffb3c7",
  "Regional": "#e8e04a",
  "Obstetrics": "#ff85d8",
  "Elective": "#b0b8c4",
  "Off-service": "#b0b8c4",
  "Other": "#b0b8c4",
};

export function groupOfRotation(name) {
  const code = rotationCode(name);
  return code ? CODES[code].group : "Other";
}
