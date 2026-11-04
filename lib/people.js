// Person registry: merges spelling variants from different files into one record.
import { splitName, sameName, slugify } from "../public/core/names.js";

function partsOf(p) {
  return [p.canonical, ...(p.aliases || [])].map(splitName);
}

export function findPerson(people, raw) {
  const q = splitName(raw);
  return people.find((p) => partsOf(p).some((x) => sameName(q, x))) || null;
}

// Adds or updates a person. `cls` overrides the stored class only when `authoritative`.
export function upsertPerson(people, raw, { cls = null, authoritative = false } = {}) {
  const q = splitName(raw);
  let p = findPerson(people, raw);
  if (!p) {
    let id = slugify(`${q.last}-${q.preferred || q.first}`) || slugify(raw);
    for (let i = 2; people.some((x) => x.id === id); i++) id = `${slugify(`${q.last}-${q.preferred || q.first}`)}-${i}`;
    p = { id, canonical: q.raw, last: q.last, first: q.first, preferred: q.preferred, cls, aliases: [] };
    people.push(p);
    return { person: p, added: true };
  }
  if (q.raw !== p.canonical && !p.aliases.includes(q.raw)) p.aliases.push(q.raw);
  if (/\(/.test(q.raw) && q.preferred) p.preferred = q.preferred; // "(Mariam)" names the preferred first name
  if (cls && (authoritative || !p.cls)) p.cls = cls;
  return { person: p, added: false };
}
