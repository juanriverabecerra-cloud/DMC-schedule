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

// "Rivers- 8AM" -> { name: "Rivers", note: "8AM" }; "lakeside" -> "Lakeside"; "Van Wren" stays whole.
// The name ends at a dash or comma beside a space, a parenthesis, or a time or note word after it.
const NOTE_START = /\s*[–,(]|\s-|-\s|-$|\s+(?=\S*\d)|\s+(?=(?:late|early|am|pm|call|post|pre|off|until|till|after|before|only)\b)/i;
export function cleanAttending(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const cut = text.search(NOTE_START);
  const name = (cut >= 0 ? text.slice(0, cut) : text).replace(/-$/, "").trim();
  const note = cut >= 0 ? text.slice(cut).replace(/^\s*[-–,]?\s*/, "").trim() : "";
  return { name: name.charAt(0).toUpperCase() + name.slice(1), note };
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

// ---- who a resident works under on a day ----

// "Rook/Sable" -> ["Rook", "Sable"]: the MDAs a sheet cell names, CRNA marks and blanks left out.
export function mdaNames(raw) {
  const out = [];
  for (const part of String(raw ?? "").replace(/\([^)]*\)/g, " ").split(/\s*\/\s*|\s+&\s+|\s+and\s+/i)) {
    const { name } = cleanAttending(part.replace(/^\s*dr\.?\s+/i, ""));
    if (name && /[A-Za-z]/.test(name) && !/^(x|crna|tbd|mda|none|n\/a|-+)$/i.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}
export const mdaText = (raw) => mdaNames(raw).join(" / ");

// The MDAs someone works with that day, from the daily sheet: their room's, the rooms they give
// breaks in or are junior attending for, their procedure area's, OPSC's or OB's. [{ name, where }]
export function dayMdas(d) {
  const out = [];
  const add = (raw, where) => { for (const name of mdaNames(raw)) if (!out.some((x) => x.name === name)) out.push({ name, where }); };
  for (const r of d?.roles || []) {
    if (r.kind === "room") add(r.room.mda, `OR ${r.or}`);
    else if (r.kind === "breaks" || r.kind === "ja") for (const room of r.rooms) add(room.mda, `OR ${room.or}`);
    else if (r.kind === "proc") add(r.mda, r.name);
    else if (r.kind === "where") add(r.mda, r.where);
    else if (r.kind === "opsc") for (const m of r.mdas || []) add(m, "OPSC");
    else if (r.kind === "ob") add(r.mda, "OB");
  }
  return out;
}

// Rotations the OR sheet doesn't place anyone in by room: the PACU is staffed all day, OPSC hands
// out its rooms there each morning, and the VA makes its own assignments.
export const SPOTS = {
  PACU: { title: "PACU", line: "No room assignment: the PACU rotation is in the PACU all day.", where: "Harper PACU" },
  OPSC: { title: "OPSC", line: "Rooms are handed out at OPSC each morning, so the OR sheet doesn't list yours.", where: "OPSC" },
  VA: { title: "VA", line: "The VA makes its own assignments. It isn't on the DMC sheet.", where: "John D. Dingell VA" },
};
// Which of those someone is in that day, or null. The sheet's own word comes first (a room, a
// procedure area, breaks), and a call that replaces the day (H1, H2, nights) isn't one.
export function spotOf(d) {
  if (!d || d.status !== "work" || (d.call && d.call !== "24")) return null;
  if (d.roles.some((r) => ["room", "breaks", "ja", "proc", "pat", "night", "ob"].includes(r.kind))) return null;
  if (d.roles.some((r) => r.kind === "opsc")) return "OPSC";
  const placed = d.roles.find((r) => r.kind === "where");
  if (placed) return SPOTS[placed.code] ? placed.code : null;
  return SPOTS[d.code] ? d.code : null;
}

// Who's in charge that day, from the Egress tab: the day's board runner (and the resident beside
// them) and the MDA on call tonight. OB residents hear OB's on-call MDA, everyone else the main OR's.
export function inCharge(dl, d = null) {
  if (!dl) return null;
  const call = (label) => (dl.attendings || []).find((a) => a.kind === "call" && a.label === label) || null;
  const ob = !!d && (d.site === "hutzel" || d.code === "11-9" || (d.roles || []).some((r) => r.kind === "ob"));
  const onCall = (ob && call("OB call")) || call("Main OR call");
  const out = { runner: dl.runner?.mda || null, resident: dl.runner?.resident || null, call: onCall, ob: ob && onCall?.label === "OB call" };
  return out.runner || out.resident || out.call ? out : null;
}
