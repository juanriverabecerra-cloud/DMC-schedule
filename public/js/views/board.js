import { h, icon, personRow, emptyState, segmented, openSheet, notice } from "../ui.js";
import { BOARD_ORDER, headline } from "../../core/model.js";
import { fmtDate } from "../../core/dates.js";
import { local } from "../api.js";
import { roomSummary, roomCallChips, draftNote } from "./common.js";

const HIDE_BY_DEFAULT = new Set(["Off", "Vacation", "Post-call", "No schedule"]);

// Sort key for the Main OR group: people in a room by OR number, JA/breaks just after their first room.
function orNumber(d) {
  const room = d.roles.find((x) => x.kind === "room");
  if (room) return parseInt(room.or, 10) || 99;
  const multi = d.roles.find((x) => x.rooms);
  return multi ? (parseInt(multi.rooms[0].or, 10) || 99) + 0.5 : 100;
}

export function openDailySheet(ctx, date) {
  const dl = ctx.model.daily(date);
  if (!dl) return;
  const { model } = ctx;
  const nm = (s) => (s.id ? model.name(s.id) : s.name);
  const body = h("div");
  if (dl.sheet.hasPhoto) {
    const img = h("img", { class: "photo-thumb", alt: `Daily sheet photo for ${date}` });
    body.append(h("details", { class: "card card-pad", ontoggle: async (e) => {
      if (!e.target.open || img.src) return;
      const res = await fetch(`/api/photo/${date}`, { headers: { "x-passcode": local.get("passcode") || "", "x-admin-key": local.get("adminKey") || "" } });
      if (res.ok) img.src = URL.createObjectURL(await res.blob());
    } }, h("summary", { style: { cursor: "pointer", fontWeight: 650 } }, "Original photo"), h("div", { style: { marginTop: "10px" } }, img)));
  }
  body.append(h("section", { class: "card" }, h("ul", { class: "list" }, dl.rooms.map((room) => h("li", { class: "row" },
    h("div", { class: "avatar", style: { borderRadius: "12px", "--c": "var(--accent)" } }, room.or),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, roomSummary(room) || "—")),
      h("div", { class: "roomline" }, [
        room.mda ? `MDA ${room.mda}` : null,
        room.crna ? "CRNA" : room.staffIds.map(nm).join(" & "),
        room.ja ? `JA ${room.jaIds.map(nm).join(", ")}` : null,
        room.breaks ? `Breaks ${room.breakIds.map(nm).join(", ")}` : null,
      ].filter(Boolean).join(" · ")),
      roomCallChips(ctx, room, { residents: true })))))));
  const s = dl.sheet;
  const lines = [
    s.opsc?.residents?.length || s.opsc?.mdas?.length ? ["OPSC", `${s.opsc.rooms ? `${s.opsc.rooms} rooms · ` : ""}MDAs ${s.opsc.mdas.join(", ")} · ${dl.opsc.map(nm).join(", ")}`] : null,
    s.procedures?.length ? ["Procedures", s.procedures.map((p) => `${p.name} (${p.count})${p.mda ? ` ${p.mda}` : ""}`).join(", ")] : null,
    s.meyers?.mda ? ["Meyers lab", `${s.meyers.rooms ? `${s.meyers.rooms} rooms · ` : ""}${s.meyers.mda}`] : null,
    s.pat?.length ? ["PAT", dl.pat.map(nm).join(", ")] : null,
    s.ob?.mda || s.ob?.residents?.length ? ["OB", `${s.ob.mda ? `MDA ${s.ob.mda} · ` : ""}${dl.ob.map(nm).join(", ")}`] : null,
    s.night?.length ? ["Night", dl.night.map(nm).join(", ")] : null,
    ...(s.notes || []).map((n) => ["Note", n]),
    ...(s.other || []).map((o) => [o.label || "Other", o.value]),
  ].filter(Boolean);
  if (lines.length) body.append(h("section", { class: "card card-pad" }, h("dl", { class: "kv" }, lines.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]))));
  openSheet(`OR sheet · ${fmtDate(date)}`, body);
}

export function renderBoard(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const draft = draftNote(ctx, state.date);
  if (draft) root.append(draft);
  const prefs = local.get("boardPrefs", { cls: "all", showOff: false });
  const search = h("input", { class: "input", type: "search", placeholder: "Search name or place", "aria-label": "Search", value: state.boardQuery || "" });
  const listHolder = h("div");

  function draw() {
    const q = search.value.trim().toLowerCase();
    state.boardQuery = search.value;
    const roster = model.roster(state.date).filter((d) => {
      const p = model.person(d.pid);
      if (prefs.cls !== "all" && p.cls !== prefs.cls) return false;
      if (!q) return true;
      return [model.name(d.pid), d.label, d.rotation, headline(d), model.boardGroup(d)].join(" ").toLowerCase().includes(q);
    });
    const groups = new Map();
    for (const d of roster) {
      const g = model.boardGroup(d);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(d);
    }
    listHolder.replaceChildren();
    if (!roster.length) { listHolder.append(emptyState("search", "No one matches", "")); return; }
    const hidden = [];
    for (const g of [...BOARD_ORDER, ...[...groups.keys()].filter((k) => !BOARD_ORDER.includes(k))]) {
      const list = groups.get(g);
      if (!list) continue;
      if (HIDE_BY_DEFAULT.has(g) && !prefs.showOff && !q) { hidden.push([g, list.length]); continue; }
      if (g === "Harper Main OR") list.sort((a, b) => orNumber(a) - orNumber(b));
      listHolder.append(
        h("div", { class: "section-title" }, g, h("span", { class: "count" }, list.length)),
        h("section", { class: "card" }, h("ul", { class: "list" }, list.map((d) => personRow(ctx, d)))),
      );
    }
    if (hidden.length) {
      listHolder.append(h("button", { class: "btn block", style: { marginTop: "4px" }, onclick: () => { prefs.showOff = true; local.set("boardPrefs", prefs); draw(); } },
        `Show ${hidden.map(([g, n]) => `${g.toLowerCase()} (${n})`).join(", ")}`));
    }
  }

  search.addEventListener("input", draw);
  const seg = () => segmented([["all", "All"], ["CA-3", "CA-3"], ["CA-2", "CA-2"], ["CA-1", "CA-1"], ["PGY-1", "PGY-1"]], prefs.cls, (v) => {
    prefs.cls = v;
    local.set("boardPrefs", prefs);
    segHolder.replaceChildren(seg());
    draw();
  });
  const segHolder = h("div", { style: { marginBottom: "12px" } }, seg());

  if (!model.hasCall(state.date)) root.append(notice("warn", "info", "No call sheet for this month yet; showing planned rotations only."));
  const dl = model.daily(state.date);
  root.append(
    h("div", { class: "toolbar" },
      h("div", { class: "search" }, icon("search"), search),
      dl ? h("button", { class: "btn", onclick: () => openDailySheet(ctx, state.date), "aria-label": "Daily OR sheet" }, icon("image"), "OR sheet") : null),
    segHolder,
    listHolder,
  );
  if (prefs.showOff) {
    root.append(h("button", { class: "btn block sm", style: { marginTop: "8px" }, onclick: () => { prefs.showOff = false; local.set("boardPrefs", prefs); draw(); } }, "Hide off / vacation"));
  }
  draw();
  return root;
}
