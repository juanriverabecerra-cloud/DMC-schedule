// The day's attendings as the board runner lists them on the Egress tab: one per slot,
// "H1 (MOR call)", "OB 14 (OB call)", "H13 (MOR pre call)", "CV (CHR & CSG)", "H4 (OPSC)"...
// Read into who is on call tonight, who is pre- or post-call, and where the rest are.

// What a slot means. `kind`: call, precall, postcall, runner, site (works somewhere named), slot.
export function slotInfo(raw) {
  const slot = String(raw ?? "").replace(/\s+/g, " ").trim();
  const inner = (slot.match(/\(([^)]*)\)/) || [])[1] || "";
  if (/board\s*runner/i.test(slot)) return { kind: "runner", label: "Board runner", where: "Harper" };
  if (/post\s*-?\s*call/i.test(slot)) return { kind: "postcall", label: /\bob\b/i.test(slot) ? "OB post-call" : "Main OR post-call", where: "" };
  if (/pre\s*-?\s*call/i.test(slot)) return { kind: "precall", label: /\bob\b/i.test(slot) ? "OB pre-call" : "Main OR pre-call", where: "" };
  if (/\bmor\s+call\b/i.test(slot)) return { kind: "call", label: "Main OR call", where: "Harper" };
  if (/\bob\s+call\b/i.test(slot)) return { kind: "call", label: "OB call", where: "Hutzel" };
  if (/^cv\b/i.test(slot)) return { kind: "call", label: "Cardiac call", where: inner || "" };
  if (inner) return { kind: "site", label: slot, where: inner.replace(/^opsc$/i, "OPSC").replace(/^meyers$/i, "Meyers lab") };
  return { kind: "slot", label: slot, where: "" };
}

// "Rivers- 8AM" -> { name: "Rivers", note: "8AM" }; "lakeside" -> "Lakeside".
export function cleanAttending(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const m = text.match(/^([A-Za-z'’.-]+(?:\s*\/\s*[A-Za-z'’.-]+)?)(?:\s*[-–,]\s*|\s+)?(.*)$/);
  const name = (m ? m[1] : text).replace(/-$/, "").trim();
  return { name: name.charAt(0).toUpperCase() + name.slice(1), note: m ? m[2].trim() : "" };
}

// The day's attendings, sorted: on call first, then pre-call, board runner, sites, post-call.
const ORDER = { call: 0, precall: 1, runner: 2, site: 3, slot: 4, postcall: 5 };
export function attendingsOf(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => ({ ...slotInfo(a.slot), slot: a.slot, ...cleanAttending(a.name) }))
    .filter((a) => a.name)
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

// Every attending named on the saved OR sheets (rooms, OPSC, OB, Meyers, procedures, the Egress
// list), by last name as the sheets write them. The case log offers all of them as supervisors,
// since the phone directory doesn't list every attending.
export function sheetAttendingNames(daily) {
  const seen = new Map();
  const add = (raw) => {
    for (const part of String(raw ?? "").replace(/\([^)]*\)/g, " ").split(/[/,&+]| and /i)) {
      const { name } = cleanAttending(part.replace(/^\s*dr\.?\s+/i, ""));
      if (!name || name.length < 2 || /^(x|crna|tbd|mda|none)$/i.test(name)) continue;
      if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
  };
  for (const s of Object.values(daily || {})) {
    for (const r of s.rooms || []) add(r.mda);
    for (const m of s.opsc?.mdas || []) add(m);
    add(s.ob?.mda);
    add(s.meyers?.mda);
    for (const p of s.procedures || []) add(p.mda);
    for (const a of s.egress?.attendings || []) add(a.name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
