// Call: search everyone and everything with a number, a "Right now" list built from your
// assignment today, one-tap essentials, and OR room tiles.
import { h, icon, avatar, classPill, numberButtons, emptyState, notice, card, copyText } from "../ui.js";
import { fmtDate } from "../../core/dates.js";
import { CLASS_ORDER } from "../../core/model.js";
import { techChip } from "./common.js";

const ESSENTIALS = [
  /^resident board runner/i, /^mda board runner/i, /^crna board runner/i, /^harper or main desk/i, /^pacu harper/i,
  /^pacu resident/i, /^acute pain/i, /^mda ob/i, /^ob vocera/i, /^on-call pain fellow/i,
];

// The clinical groups come first, then the rest of the hospital.
const GROUP_ORDER = [
  "anesthesiologists — harper", "cardiac attendings", "anesthesia lines", "anesthesia techs", "harper desks", "or team", "harper units", "icus",
  "lab", "pharmacy", "radiology", "procedure areas", "departments", "pain", "pagers", "hospital services", "karmanos", "drh units", "rim",
];

function placeItem(dir, re, why) {
  const p = dir.place(re);
  return p ? { key: `place:${p.id}`, title: p.name, sub: why, numbers: p.numbers } : null;
}

// Techs float between rooms, so this opens the whole list instead of calling one number.
function techItem(ctx, why) {
  const count = ctx.model.dir.techs().length;
  return count ? { key: "techs", title: "Anesthesia techs", sub: why || `${count} on the list`, action: () => techChip(ctx, "Choose a tech") } : null;
}

function staffItem(dir, name, why, site) {
  const s = dir.staff(name, { site });
  return s ? { key: `staff:${s.id}`, title: s.name, sub: why, numbers: s.numbers } : null;
}

function residentItem(model, pid, why) {
  const r = model.dir.resident(pid);
  return r ? { key: `res:${pid}`, pid, title: model.name(pid), sub: why, numbers: r.numbers } : null;
}

function roomItem(dir, room, why) {
  const p = dir.room(room.or);
  return p ? { key: `place:${p.id}`, title: `OR ${room.or}`, sub: why || [room.surgeon, room.time].filter(Boolean).join(" · "), numbers: p.numbers } : null;
}

// Who you're most likely to need to call today, in order.
export function quickContacts(ctx, pid, date) {
  const { model } = ctx;
  const dir = model.dir;
  const d = model.day(pid, date);
  const items = [];
  const add = (x) => { if (x && !items.some((y) => y.key === x.key)) items.push(x); };
  const nm = (s) => (s.id ? model.person(s.id)?.last || model.name(s.id) : s.name);

  for (const r of d.roles) {
    if (r.kind === "room") {
      add(roomItem(dir, r.room, `Your room · ${[r.room.surgeon, r.room.time].filter(Boolean).join(" ")}`));
      add(staffItem(dir, r.room.mda, `Your MDA · OR ${r.or}`));
      add(techItem(ctx, "For anything your room needs"));
      r.room.jaIds.forEach((s) => s.id && add(residentItem(model, s.id, `JA for OR ${r.or}`)));
      r.with.forEach((s) => s.id && add(residentItem(model, s.id, `In OR ${r.or} with you`)));
      r.room.breakIds.forEach((s) => s.id && add(residentItem(model, s.id, `Breaks for OR ${r.or}`)));
    }
    if (r.kind === "breaks" || r.kind === "ja") {
      for (const room of r.rooms) {
        add(roomItem(dir, room, `${r.kind === "ja" ? "JA" : "Breaks"} · ${room.staffIds.map(nm).join(" & ") || (room.crna ? "CRNA" : "")}`));
        room.staffIds.forEach((s) => s.id && add(residentItem(model, s.id, `In OR ${room.or}`)));
        add(staffItem(dir, room.mda, `MDA · OR ${room.or}`));
        add(techItem(ctx, "For anything a room needs"));
        if (r.kind === "breaks") room.jaIds.forEach((s) => s.id && add(residentItem(model, s.id, `JA for OR ${room.or}`)));
      }
    }
    if (r.kind === "opsc") {
      for (const m of r.mdas || []) for (const part of String(m).split("/")) add(staffItem(dir, part, "OPSC MDA"));
      add(placeItem(dir, /^pacu outpatient/i, "OPSC"));
      add(placeItem(dir, /^pre-op outpatient/i, "OPSC"));
    }
    if (r.kind === "ob") {
      add(staffItem(dir, r.mda, "OB MDA today"));
      add(placeItem(dir, /^mda ob$/i, "OB"));
      add(placeItem(dir, /^ob vocera/i, "OB"));
    }
    if (r.kind === "pat") add(placeItem(dir, /^pat clinic/i, "Your post today"));
  }

  if (d.status === "work") {
    if (d.code === "PAT") add(placeItem(dir, /^pat clinic/i, "Your post today"));
    if (d.code === "PACU") { add(placeItem(dir, /^pacu harper/i, "Your post today")); add(placeItem(dir, /^pacu resident/i, "PACU")); }
    if (d.code === "AP") { add(placeItem(dir, /^acute pain/i, "Acute pain")); add(placeItem(dir, /^on-call pain fellow/i, "Pain")); }
    if (d.code === "CP") { add(placeItem(dir, /^pain clinic resident/i, "Chronic pain")); add(placeItem(dir, /^pain clinic karmanos/i, "Chronic pain")); }
    if (d.code === "NORA") { add(placeItem(dir, /^meyers lab/i, "NORA")); add(placeItem(dir, /^mri nursing/i, "NORA")); add(placeItem(dir, /^ct holding/i, "NORA")); }
    if (d.code === "OB" || d.code === "OB1" || d.code === "11-9") { add(placeItem(dir, /^mda ob$/i, "OB")); add(placeItem(dir, /^ob vocera/i, "OB")); }
    if (d.code === "HC") dir.raw.staff.filter((s) => /cardiac/i.test(s.group)).forEach((s) => add({ key: `staff:${s.id}`, title: s.name, sub: "Cardiac attending", numbers: s.numbers }));
    if (d.code === "9-ICU") add(placeItem(dir, /^9 icu$/i, "Your unit"));
    const siteStaff = { va: "va", sinai: "sinai", hvsh: "hvsh" }[d.site];
    if (siteStaff) dir.raw.staff.filter((s) => s.site === siteStaff).forEach((s) => add({ key: `staff:${s.id}`, title: s.name, sub: `${model.site(d.site)?.short} attending`, numbers: s.numbers }));
    if (["harper", "opsc", "hutzel"].includes(d.site) || d.call) {
      add(placeItem(dir, /^resident board runner/i, "Board runner"));
      add(placeItem(dir, /^mda board runner/i, "Board runner"));
    }
  }
  if (d.call || d.late) {
    const t = model.tonight(date);
    for (const x of [...t.night, ...t.senior, ...t.call24]) if (x.pid !== pid) add(residentItem(model, x.pid, x.call === "NF" ? "Night float tonight" : x.call === "10-7" ? "CA-3 10a–7p" : "24-hr call"));
    add(placeItem(dir, /^harper or main desk/i, "OR desk"));
  }
  return items;
}

export function contactRow(ctx, item) {
  const { model } = ctx;
  const p = item.pid ? model.person(item.pid) : null;
  return h("li", { class: "row contact", onclick: item.pid ? () => ctx.go(`p/${item.pid}`) : null },
    item.pid ? avatar(model, item.pid) : h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon(item.icon || "phone")),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, item.title), p ? classPill(p.cls) : null),
      item.sub ? h("div", { class: "sub" }, item.sub) : null,
      (item.notes || []).length ? h("div", { class: "tiny faint" }, item.notes.join(" · ")) : null,
      h("div", { class: "numrow" }, item.action ? item.action() : numberButtons(model.dir, item.numbers))),
  );
}

function roomGrid(ctx, kind) {
  const { model, state } = ctx;
  const dir = model.dir;
  const dl = model.daily(state.today);
  const rooms = dir.raw.places.filter((p) => p.keys?.some((k) => k.startsWith(`${kind}:`)))
    .sort((a, b) => Number(a.keys[0].split(":")[1]) - Number(b.keys[0].split(":")[1]));
  if (!rooms.length) return null;
  return h("div", { class: "roomgrid" }, rooms.map((p) => {
    const n = p.keys[0].split(":")[1];
    const today = kind === "or" && dl ? dl.rooms.find((r) => String(Number(r.or)) === n) : null;
    const who = today ? (today.crna ? "CRNA" : today.staffIds.map((s) => (s.id ? model.person(s.id)?.last : s.name)).join("/")) : "";
    const num = p.numbers[0];
    const dial = num && dir.dial(num);
    const inner = [h("b", null, n), h("span", null, who || today?.surgeon || ""), !dial ? h("i", null, "copy") : null];
    return dial
      ? h("a", { class: "roomtile", href: `tel:+1${dial}`, title: `${p.name} · ${dir.text(num)}` }, inner)
      : h("button", { class: "roomtile ext", type: "button", title: `${p.name} · ${dir.text(num)} (hospital phone)`, onclick: () => copyText(num.value, `${p.name} ${num.value}`) }, inner);
  }));
}

export function renderCall(ctx) {
  const { model, state } = ctx;
  const dir = model.dir;
  const root = h("div");
  if (!dir.hasData) {
    root.append(emptyState("phone", "No phone numbers yet", "An admin can load the directory in Admin › Directory."));
    return root;
  }
  const search = h("input", { class: "input", type: "search", placeholder: "Search a name, room, unit or number", "aria-label": "Search contacts", value: state.callQuery || "" });
  const results = h("div");
  const browse = h("div");

  function drawResults() {
    const q = search.value.trim();
    state.callQuery = search.value;
    results.replaceChildren();
    browse.hidden = !!q;
    if (!q) return;
    const found = dir.search(q).slice(0, 40);
    results.append(found.length
      ? h("section", { class: "card" }, h("ul", { class: "list" }, found.map((c) => contactRow(ctx, { key: c.id, pid: c.pid, title: c.name, sub: c.group, notes: c.notes, numbers: c.numbers }))))
      : emptyState("search", "Nothing found", "Try a last name, a room like \"OR 15\", or part of a number."));
  }
  search.addEventListener("input", drawResults);

  const me = state.me && model.person(state.me);
  if (me) {
    const quick = quickContacts(ctx, state.me, state.today);
    if (quick.length) browse.append(card(`Right now · ${fmtDate(state.today)}`, h("ul", { class: "list" }, quick.map((x) => contactRow(ctx, x))), { pad: false }));
  }

  const essentials = ESSENTIALS.map((re) => dir.place(re)).filter(Boolean);
  if (essentials.length) {
    const techs = techItem(ctx);
    browse.append(card("Essentials", h("ul", { class: "list" }, essentials.map((p) => contactRow(ctx, { key: p.id, title: p.name, numbers: p.numbers, notes: p.notes })), techs ? contactRow(ctx, techs) : null), { pad: false }));
  }

  const orGrid = roomGrid(ctx, "or");
  if (orGrid) browse.append(card("Harper OR rooms", h("div", null, orGrid, h("p", { class: "disclaimer" }, "Tap a room to call it. Today's resident is shown under the number. Rooms marked \"copy\" only dial from a hospital phone.")), { right: "today" }));
  const opscGrid = roomGrid(ctx, "opsc");
  if (opscGrid) browse.append(card("OPSC rooms", opscGrid));

  // Everything else, grouped like the cards.
  const groups = new Map();
  for (const c of dir.all()) {
    const g = c.type === "resident" ? `Residents · ${c.group}` : c.group;
    if (/rooms$/i.test(g)) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  const order = (g) => {
    const res = g.match(/^Residents · (.+)$/);
    if (res) return 100 + CLASS_ORDER.indexOf(res[1]);
    const known = GROUP_ORDER.indexOf(g.toLowerCase());
    if (known >= 0) return known;
    return /anesthesiologists/i.test(g) ? 50 : 60;
  };
  for (const g of [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    const list = groups.get(g);
    browse.append(h("details", { class: "card group" },
      h("summary", { class: "card-pad" }, h("span", { class: "card-title", style: { margin: 0 } }, g, h("span", { class: "right muted" }, list.length))),
      h("ul", { class: "list" }, list.map((c) => contactRow(ctx, { key: c.id, pid: c.pid, title: c.name, notes: c.notes, numbers: c.numbers })))));
  }
  const ext = dir.dialing;
  browse.append(h("p", { class: "disclaimer" },
    ext.length ? `Extensions are dialed as ${ext.map((r) => `${r.prefix}xxxx → (${r.base.slice(0, 3)}) ${r.base.slice(3)}-xxxx`).join(", ")}. ` : "",
    "Pagers and other extensions copy to the clipboard. Numbers come from the anesthesia badge cards and the Harper phone list; tell an admin if one is wrong."));

  root.append(h("div", { class: "search", style: { marginBottom: "12px" } }, icon("search"), search), results, browse);
  drawResults();
  return root;
}

export { notice };
