import { h, icon, card, avatar, classPill, segmented, emptyState, notice } from "../ui.js";
import { startOfWeek, addDays, fmtDate, monthKey } from "../../core/dates.js";
import { hoursReport } from "../../core/hours.js";
import { fmtTime } from "../../core/dates.js";
import { hoursCard } from "./today.js";

export function renderHours(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const ws = startOfWeek(state.hoursWeek || state.date);
  if (!model.hasCall(ws) && !model.hasCall(addDays(ws, 6))) {
    return emptyState("clock", "No call sheet for this week", "Hours are estimated from the monthly call sheet.");
  }

  root.append(notice("", "info",
    "These are estimates from scheduled shift times, not logged hours. A regular day counts as ",
    h("b", null, `${fmtTime(model.S.dayHours[0])}–${fmtTime(model.S.dayHours[1])}`),
    ", late until 6p, H1 and Friday 24-hr call as 24 h, H2 12 h, NF 6p–6a, 10–7 9 h. Cardiac home call isn't counted. Admins can change these in Settings."));

  if (state.me && model.person(state.me) && model.person(state.me).cls !== "PGY-1") {
    const hc = hoursCard({ ...ctx, state: { ...state, date: ws } }, state.me);
    if (hc) root.append(hc);
  }

  const weekNav = h("div", { class: "card card-pad", style: { display: "flex", alignItems: "center", padding: "6px" } },
    h("button", { class: "iconbtn", "aria-label": "Previous week", onclick: () => { state.hoursWeek = addDays(ws, -7); ctx.render(); } }, icon("left")),
    h("div", { style: { flex: 1, textAlign: "center", fontWeight: 700 } }, `Week of ${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`),
    h("button", { class: "iconbtn", "aria-label": "Next week", onclick: () => { state.hoursWeek = addDays(ws, 7); ctx.render(); } }, icon("right")));
  root.append(weekNav);

  const sortBy = state.hoursSort || "hours";
  const rows = model.people.filter((p) => p.cls !== "PGY-1").map((p) => {
    const rep = hoursReport(model, p.id, ws, addDays(ws, 6));
    const w = rep.weeks.find((x) => x.start === ws);
    return { p, w, flags: rep.flags.filter((f) => f.level !== "info") };
  }).filter((r) => r.w && r.w.known);
  rows.sort((a, b) => (sortBy === "name" ? a.p.last.localeCompare(b.p.last) : sortBy === "avg" ? (b.w.avg4 ?? -1) - (a.w.avg4 ?? -1) : b.w.hours - a.w.hours));

  root.append(h("div", { style: { margin: "4px 0 10px" } }, segmented([["hours", "This week"], ["avg", "4-wk avg"], ["name", "Name"]], sortBy, (v) => { state.hoursSort = v; ctx.render(); })));
  root.append(h("section", { class: "card" }, h("ul", { class: "list" }, rows.map(({ p, w, flags }) => {
    const pct = Math.min(100, (w.hours / 90) * 100);
    const color = w.hours > 80 ? "var(--gap)" : w.hours > 70 ? "var(--warn)" : "var(--accent)";
    return h("li", { class: "row tap", onclick: () => ctx.go(`p/${p.id}`) },
      avatar(model, p.id),
      h("div", { class: "main" },
        h("div", { class: "name" }, h("span", { class: "n" }, model.name(p.id)), classPill(p.cls), flags.length ? h("span", { class: "chip gap", style: { height: "20px", padding: "0 6px" } }, icon("alert"), flags.length) : null),
        h("div", { class: "meter", style: { marginTop: "6px" } }, h("i", { style: { width: `${pct}%`, background: color } }), h("span", { class: "limit", style: { left: `${(80 / 90) * 100}%` } })),
        h("div", { class: "tiny muted", style: { marginTop: "4px" } }, `${w.daysOff} day${w.daysOff === 1 ? "" : "s"} off${w.avg4 !== null ? ` · 4-wk avg ${Math.round(w.avg4)} h` : ""}${flags.length ? ` · ${flags[0].text}` : ""}`)),
      h("div", { class: "side", style: { fontWeight: 750, fontSize: "17px", color: "var(--text)" } }, Math.round(w.hours), h("span", { class: "tiny muted" }, " h")));
  }))));
  root.append(h("p", { class: "disclaimer" }, `Weeks run Sunday–Saturday like the call sheet. ${monthKey(ws) !== monthKey(addDays(ws, 6)) ? "This week spans two months; both call sheets are needed for a full count." : ""}`));
  return root;
}

export { card };
