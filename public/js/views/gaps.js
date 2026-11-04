import { h, icon, emptyState, segmented } from "../ui.js";
import { monthKey, addMonths, fmtMonth, fmtDate, relDay } from "../../core/dates.js";
import { monthGaps } from "../../core/gaps.js";

const ICON = { gap: "alert", warn: "alert", info: "info" };

export function renderGaps(ctx, arg) {
  const { model, state } = ctx;
  const month = /^\d{4}-\d{2}$/.test(arg || "") ? arg : monthKey(state.today);
  const filter = state.gapFilter || "upcoming";
  const root = h("div");
  root.append(h("div", { class: "card card-pad", style: { display: "flex", alignItems: "center", padding: "6px" } },
    h("button", { class: "iconbtn", "aria-label": "Previous month", onclick: () => ctx.go(`gaps/${addMonths(month, -1)}`) }, icon("left")),
    h("div", { style: { flex: 1, textAlign: "center", fontWeight: 700 } }, fmtMonth(month)),
    h("button", { class: "iconbtn", "aria-label": "Next month", onclick: () => ctx.go(`gaps/${addMonths(month, 1)}`) }, icon("right"))));
  root.append(h("div", { style: { marginBottom: "12px" } }, segmented([["upcoming", "From today"], ["all", "Whole month"], ["gaps", "Gaps only"]], filter, (v) => { state.gapFilter = v; ctx.render(); })));

  if (!model.months.includes(month)) {
    root.append(emptyState("calendar", "No call sheet for this month", "Gaps are checked once the monthly call sheet is uploaded."));
    return root;
  }
  let items = monthGaps(model, month);
  if (filter === "upcoming") items = items.filter((g) => g.date >= state.today);
  if (filter === "gaps") items = items.filter((g) => g.level === "gap");
  if (!items.length) {
    root.append(emptyState("check", "No gaps found", filter === "upcoming" ? "Nothing flagged from today to the end of the month." : "Nothing flagged this month."));
  } else {
    const byDate = new Map();
    for (const g of items) byDate.set(g.date, [...(byDate.get(g.date) || []), g]);
    root.append(h("section", { class: "card" }, [...byDate].map(([date, list]) => [
      h("div", { class: "daterow", style: { cursor: "pointer" }, onclick: () => { ctx.setDate(date); ctx.go("tonight"); } },
        ["Today", "Tomorrow", "Yesterday"].includes(relDay(date, state.today)) ? `${relDay(date, state.today)} · ${fmtDate(date, "long")}` : fmtDate(date, "long")),
      list.map((g) => h("div", { class: `gapitem ${g.level}` },
        h("span", { class: "ic" }, icon(ICON[g.level])),
        h("div", null, h("div", { style: { fontWeight: 600 } }, g.title)))),
    ])));
  }
  root.append(h("p", { class: "disclaimer" }, "Red: fewer people scheduled than the usual pattern (editable in Admin › Settings) or a gap the call sheet itself lists. Amber: conflicts between the call sheet and the daily OR sheet, or a shift the day after 24-hr call. Tap a date to see who's on."));
  return root;
}
