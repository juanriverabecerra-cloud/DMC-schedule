// Admin › Fairness: how often each resident's no-call days were honored. Only admins see this.
import { h, card, classPill, openSheet } from "../ui.js";
import { api } from "../api.js";
import { fmtDate } from "../../core/dates.js";
import { noCallScorecard } from "../../core/nocall.js";

const TAG = { honored: ["Honored", "var(--late)"], missed: ["Not honored", "var(--gap)"], excluded: ["Not counted", "var(--muted)"], waiting: ["Waiting", "var(--accent)"] };
const pct = (n) => (n == null ? "—" : `${n}%`);

function openDetail(ctx, r) {
  openSheet(`${ctx.model.name(r.pid)} · no-call days`, h("ul", { class: "list flush" }, r.days.map((d) => h("li", { class: "row", style: { minHeight: "48px" } },
    h("div", { class: "main" },
      h("div", { class: "name small" }, h("span", { class: "n" }, fmtDate(d.date, "long")), d.reason && d.reason !== "Other" ? h("span", { class: "muted" }, ` · ${d.reason}`) : null),
      d.why ? h("div", { class: "sub" }, d.why) : null),
    h("span", { class: "pill", style: { "--c": TAG[d.result][1] } }, TAG[d.result][0])))));
}

export function noCallCard(ctx, ay) {
  const { model } = ctx;
  const body = h("div", null, h("p", { class: "small muted", style: { margin: 0 } }, "Loading…"));
  api("/api/requests/no-call-history").then(({ history }) => {
    const classes = noCallScorecard(model, history, ay);
    if (!classes.length) {
      body.replaceChildren(h("p", { class: "small muted", style: { margin: 0 } }, "Nothing to score yet. This fills in as residents send their no-call days from the app and each month's call sheet comes out."));
      return;
    }
    body.replaceChildren(
      h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
        h("thead", null, h("tr", null, h("th", { class: "who" }, "Resident"), h("th", null, "Asked"), h("th", null, "Honored"), h("th", null, "Rate"), h("th", null, "Waiting"))),
        classes.map((c) => h("tbody", null,
          h("tr", null, h("td", { class: "who" }, classPill(c.cls)), h("td", { class: "n" }, c.honored + c.missed), h("td", { class: "n" }, c.honored), h("td", { class: "n" }, h("b", null, pct(c.rate))), h("td")),
          c.rows.map((r) => h("tr", { onclick: () => openDetail(ctx, r) },
            h("td", { class: "who" }, model.person(r.pid).last),
            h("td", { class: "n" }, r.honored + r.missed),
            h("td", { class: "n" }, r.honored),
            h("td", { class: `n${c.rate != null && r.rate != null && r.rate <= c.rate - 25 ? " hot2" : ""}` }, pct(r.rate)),
            h("td", { class: "n" }, r.waiting || "·"))))))),
      h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "Not honored means a call shift that day, or post-call from a 24. Days on vacation or a rotation with no call aren't counted. Red is 25 points or more below the class. Tap a row for the dates. Lists sent after a month's call sheet is uploaded don't count, since they couldn't have been honored."));
  }).catch(() => body.replaceChildren(h("p", { class: "small muted", style: { margin: 0 } }, "The scorecard couldn't be loaded.")));
  return card("No-call scorecard", body);
}
