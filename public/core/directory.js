// Phone directory: one plain-text format (kept by admins) for residents, attendings, places
// and pagers, plus the rules that turn 5-digit hospital extensions into numbers a cell can dial.
//
//   ## Section title            what the section is decides how entries are used
//   Name | number | number      a number may start with a label: Cisco, Cell, Ext, Pager, Phone
//   Ext 5xxxx = 313-745-xxxx    (in a "Dialing" section) extension rule
//
// 7-digit numbers get area code 313; 4-5 digit numbers are extensions unless labeled Pager.
import { createMatcher, splitName, fold } from "./names.js";

const CLASS_TOKEN = /^(CA|PGY)\s*-?\s*\d$/i;

export function parseNumber(token) {
  const raw = String(token ?? "").trim();
  const m = raw.match(/^([A-Za-z][A-Za-z .]*?)?\s*([+(]?\d[\d\s().\-/]*)$/);
  if (!m) return null;
  const label = (m[1] || "").trim().replace(/\.$/, "");
  let digits = m[2].replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  const kindLabel = label.toLowerCase();
  if (kindLabel === "pager") return { kind: "pager", label: "Pager", value: digits };
  if (digits.length === 10) return { kind: "phone", label: label || "Phone", value: digits };
  if (digits.length === 7) return { kind: "phone", label: label || "Phone", value: `313${digits}` };
  if (digits.length === 4 || digits.length === 5) return { kind: "ext", label: label && kindLabel !== "ext" ? label : "Ext", value: digits };
  return null;
}

function sectionType(title) {
  const t = title.toLowerCase();
  if (/^dialing|^extensions?$/.test(t)) return "dialing";
  if (/^residents?\b/.test(t) && !/lounge|lines?/.test(t)) return "residents";
  if (/anesthesiolog|attending|mda list|physicians?/.test(t)) return "staff";
  return "places";
}

function siteOf(title) {
  const t = title.toLowerCase();
  if (/drh|receiving/.test(t)) return "drh";
  if (/sinai/.test(t)) return "sinai";
  if (/\bva\b/.test(t)) return "va";
  if (/huron|hvsh/.test(t)) return "hvsh";
  if (/chm|children/.test(t)) return "chm";
  return "harper";
}

export function parseDirectoryText(text) {
  const out = { residents: [], staff: [], places: [], dialing: [], warnings: [] };
  let section = { title: "Other", type: "places" };
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith("#") && !s.startsWith("##")) return;
    if (s.startsWith("##")) {
      const title = s.replace(/^#+\s*/, "").trim();
      section = { title, type: sectionType(title), site: siteOf(title) };
      return;
    }
    if (section.type === "dialing") {
      const m = s.match(/(\d)x{3,4}\s*=\s*([\d\s().-]+?)x{3,4}/i);
      if (m) out.dialing.push({ prefix: m[1], base: m[2].replace(/\D/g, "") });
      else out.warnings.push(`Line ${i + 1}: dialing rules look like "Ext 5xxxx = 313-745-xxxx".`);
      return;
    }
    const parts = s.split("|").map((x) => x.trim()).filter(Boolean);
    const name = parts.shift();
    if (!name) return;
    const numbers = [], notes = [];
    let cls = null;
    for (const part of parts) {
      const c = part.match(CLASS_TOKEN);
      if (c) { cls = `${c[1].toUpperCase()}-${part.match(/\d$/)[0]}`; continue; }
      const n = parseNumber(part);
      if (n) numbers.push(n);
      else notes.push(part);
    }
    if (!numbers.length && !notes.length) out.warnings.push(`Line ${i + 1}: no number found for "${name}".`);
    const entry = { name, numbers, notes, group: section.title };
    if (section.type === "residents") out.residents.push({ ...entry, cls });
    else if (section.type === "staff") out.staff.push({ ...entry, site: section.site });
    else out.places.push(entry);
  });
  return out;
}

export const DEFAULT_DIALING = [];

// Digits a cell phone can dial, or null (pagers, and extensions without a dialing rule).
export function dialDigits(num, dialing = []) {
  if (!num) return null;
  if (num.kind === "phone") return num.value;
  if (num.kind === "ext" && num.value.length === 5) {
    const rule = dialing.find((r) => r.prefix === num.value[0]);
    if (rule) return `${rule.base}${num.value.slice(1)}`.slice(-10).padStart(10, "0");
  }
  return null;
}

export function prettyDigits(d) {
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export function numberText(num, dialing = []) {
  if (num.kind === "pager") return `Pager ${num.value}`;
  const dial = dialDigits(num, dialing);
  if (num.kind === "ext") return dial ? `Ext ${num.value} · ${prettyDigits(dial)}` : `Ext ${num.value}`;
  return prettyDigits(num.value);
}

const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Build the stored directory from parsed text and the roster. `upsert(name, cls)` may add
// people (e.g. a new intern on the card) and returns an id; without it unknown names are listed.
export function buildDirectory(parsed, people, { upsert } = {}) {
  const match = createMatcher(people);
  const out = { people: {}, staff: [], places: [], dialing: parsed.dialing, unmatched: [], added: [] };
  for (const r of parsed.residents) {
    let id = match(r.name);
    if (!id) {
      // The card may use a different first name: fall back to a unique surname.
      const q = splitName(r.name);
      const same = people.filter((p) => splitName(`${p.last},`).lastFull === q.lastFull);
      if (same.length === 1) id = same[0].id;
    }
    if (!id && upsert) {
      id = upsert(r.name, r.cls);
      if (id) out.added.push(r.name);
    }
    if (!id) { out.unmatched.push(r.name); continue; }
    out.people[id] = { numbers: r.numbers, notes: r.notes, listedAs: r.name };
  }
  const seen = new Set();
  const uniq = (base) => { let id = base, i = 2; while (seen.has(id)) id = `${base}-${i++}`; seen.add(id); return id; };
  for (const s of parsed.staff) {
    const q = splitName(s.name.includes(",") || !s.name.includes(" ") ? s.name : s.name.replace(/^(\S+)\s+(.+)$/, "$2, $1"));
    out.staff.push({ id: uniq(`mda-${slug(s.name)}`), name: s.name, last: q.last, first: q.first, preferred: q.preferred, site: s.site, group: s.group, numbers: s.numbers, notes: s.notes });
  }
  for (const p of parsed.places) {
    const keys = [];
    const or = p.name.match(/^(?:rm|room|or)\s*#?\s*(\d{1,2})$/i);
    const opsc = p.name.match(/^opsc\s+(?:or|rm|room)\s*#?\s*(\d{1,2})$/i);
    if (opsc) keys.push(`opsc:${Number(opsc[1])}`);
    else if (or && !/opsc/i.test(p.group)) keys.push(`or:${Number(or[1])}`);
    else if (or && /opsc/i.test(p.group)) keys.push(`opsc:${Number(or[1])}`);
    out.places.push({ id: uniq(`place-${slug(p.name)}`), name: p.name, group: p.group, numbers: p.numbers, notes: p.notes, keys });
  }
  return out;
}

// Older saves stored {people: {id: {phone}}, places: [{name, phone}]}.
function upgrade(dir) {
  const d = dir || {};
  const people = {};
  for (const [id, v] of Object.entries(d.people || {})) {
    people[id] = v.numbers ? v : { numbers: [parseNumber(v.phone)].filter(Boolean), notes: v.note ? [v.note] : [] };
  }
  const places = (d.places || []).map((p, i) => (p.numbers ? p : { id: `place-${i}`, name: p.name, group: "Places", numbers: [parseNumber(p.phone)].filter(Boolean), notes: p.note ? [p.note] : [], keys: [] }));
  return { people, places, staff: d.staff || [], dialing: d.dialing || DEFAULT_DIALING, text: d.text || "" };
}

// Lookups used by the screens and the calendar feed.
export function createDirectory(ds, model) {
  const dir = upgrade(ds.directory);
  const dialing = dir.dialing;
  const staffMatch = createMatcher(dir.staff.map((s) => ({ id: s.id, last: s.last, first: s.first, preferred: s.preferred })));
  const staffById = new Map(dir.staff.map((s) => [s.id, s]));
  const placeByKey = new Map();
  for (const p of dir.places) for (const k of p.keys || []) placeByKey.set(k, p);

  const firstDialable = (numbers) => numbers?.find((n) => dialDigits(n, dialing)) || null;

  function resident(pid) {
    const e = dir.people[pid];
    if (!e) return null;
    return { numbers: e.numbers, notes: e.notes || [], primary: firstDialable(e.numbers), pager: e.numbers.find((n) => n.kind === "pager") || null };
  }

  // An attending named on the daily sheet ("Patel", "Kahai/David"); prefers the site's own list.
  function staff(name, { site = "harper" } = {}) {
    if (!name) return null;
    const prefer = new Set(dir.staff.filter((s) => s.site === site).map((s) => s.id));
    const id = staffMatch(String(name).replace(/\([^)]*\)/g, "").trim(), { prefer });
    return id ? staffById.get(id) : null;
  }

  function place(test) {
    const re = test instanceof RegExp ? test : new RegExp(test, "i");
    return dir.places.find((p) => re.test(p.name)) || null;
  }

  function all() {
    const list = [];
    for (const p of model.people) {
      const r = resident(p.id);
      if (r) list.push({ type: "resident", id: p.id, pid: p.id, name: model.name(p.id), group: p.cls || "Residents", numbers: r.numbers, notes: r.notes });
    }
    for (const s of dir.staff) list.push({ type: "staff", id: s.id, name: s.name, group: s.group, numbers: s.numbers, notes: s.notes });
    for (const p of dir.places) list.push({ type: "place", id: p.id, name: p.name, group: p.group, numbers: p.numbers, notes: p.notes });
    return list;
  }

  function search(q) {
    const s = fold(q).trim();
    if (!s) return [];
    const digits = s.replace(/\D/g, "");
    const words = s.split(/\s+/).filter(Boolean);
    return all().filter((c) => {
      const hay = fold(`${c.name} ${c.group} ${(c.notes || []).join(" ")}`);
      if (words.every((w) => hay.includes(w))) return true;
      return digits.length >= 3 && c.numbers.some((n) => n.value.includes(digits) || (dialDigits(n, dialing) || "").includes(digits));
    });
  }

  return {
    dialing, raw: dir, resident, staff, place, all, search,
    room: (or) => placeByKey.get(`or:${Number(String(or).replace(/\D/g, ""))}`) || null,
    opscRoom: (n) => placeByKey.get(`opsc:${Number(n)}`) || null,
    dial: (num) => dialDigits(num, dialing),
    text: (num) => numberText(num, dialing),
    primary: firstDialable,
    hasData: dir.staff.length + dir.places.length + Object.keys(dir.people).length > 0,
  };
}

// Back to text, so the admin editor always shows what's stored.
export function formatDirectoryText(ds, people) {
  const dir = upgrade(ds.directory);
  if (dir.text) return dir.text;
  const fmt = (n) => (n.kind === "pager" ? `Pager ${n.value}` : n.kind === "ext" ? `${n.label === "Ext" ? "Ext" : n.label} ${n.value}` : `${n.label && n.label !== "Phone" ? `${n.label} ` : ""}${n.value.slice(0, 3)}-${n.value.slice(3, 6)}-${n.value.slice(6)}`);
  const lines = ["## Dialing", ...dir.dialing.map((r) => `Ext ${r.prefix}xxxx = ${r.base}xxxx`), "", "## Residents"];
  for (const p of people) {
    const e = dir.people[p.id];
    if (e) lines.push([`${p.last}, ${p.preferred || p.first}`, ...e.numbers.map(fmt), ...(e.notes || [])].join(" | "));
  }
  let group = null;
  for (const e of [...dir.staff, ...dir.places]) {
    if (e.group !== group) { group = e.group; lines.push("", `## ${group}`); }
    lines.push([e.name, ...e.numbers.map(fmt), ...(e.notes || [])].join(" | "));
  }
  return lines.join("\n");
}
