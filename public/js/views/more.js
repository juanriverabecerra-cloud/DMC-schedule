import { h, icon, card, avatar, classPill, segmented, telHref } from "../ui.js";
import { local } from "../api.js";
import { monthKey, fmtMonth } from "../../core/dates.js";
import { monthGaps } from "../../core/gaps.js";
import { subscribeCard } from "./common.js";
import { remindersFor } from "./reminders.js";
import { openAlerts, ALERT_SUB } from "./alerts.js";
import { alertStatus } from "../push.js";
import { requestsCard } from "./requests.js";
import { inboxCounts } from "./inbox.js";

const LEGEND = [
  ["late", "Late resident", "Green on the call sheet. Finish at your site, then help at Harper until 6p."],
  ["call24", "24-hr call", "Friday (blue) and Saturday (H1) only. 6a to 6a, so it covers that night."],
  ["call12", "12-hr call", "H2. Saturday and Sunday only, 6a to 6p."],
  ["night", "Night float", "NF. 6p to 6a, Sunday to Thursday nights. Friday and Saturday nights belong to the 24."],
  ["senior", "CA-3 10a–7p", "\"10-7\" on the call sheet."],
  ["ob", "11 to 9", "CA-1 OB rotation at Hutzel. Monday to Friday, 11a to 9p (\"11-9\" on the call sheet)."],
  ["cardiac", "Cardiac call", "Magenta week on the call sheet."],
  ["vac", "Vacation", "Vac, or the peach block around it."],
  ["pc", "Post-call", "PC: post-call day off."],
];

function applyTheme(t) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
applyTheme(local.get("theme", "system"));

export function renderMore(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const me = state.me && model.person(state.me);

  root.append(h("section", { class: "card" }, h("ul", { class: "list" },
    h("li", { class: "row tap", onclick: () => ctx.go(me ? `p/${state.me}` : "pick") },
      me ? avatar(model, state.me) : h("div", { class: "avatar" }, icon("user")),
      h("div", { class: "main" }, h("div", { class: "name" }, me ? model.name(state.me) : "Pick yourself", me ? classPill(me.cls) : null), h("div", { class: "sub" }, me ? "Your schedule and calendar link" : "So Today shows your day")),
      icon("right")),
    me ? h("li", { class: "row tap", onclick: () => ctx.go("pick") }, h("div", { class: "main" }, "Not you? Change"), icon("right")) : null,
  )));

  if (me) root.append(requestsCard(ctx));

  const pending = remindersFor(model, state);
  const todo = (key) => (pending.includes(key) ? h("span", { class: "pill todo" }, "To do") : null);
  const month = monthKey(state.today);
  const gaps = model.months.includes(month) ? monthGaps(model, month).filter((g) => g.date >= state.today && g.level === "gap") : [];
  const dirCount = model.dir.all().length;
  root.append(h("section", { class: "card" }, h("ul", { class: "list" },
    h("li", { class: "row tap", onclick: () => ctx.go("call") },
      h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("phone")),
      h("div", { class: "main" }, h("div", { class: "name" }, "Call"), h("div", { class: "sub" }, dirCount ? `${dirCount} people, rooms and units` : "Phone directory")),
      icon("right")),
    (() => {
      const status = alertStatus();
      return h("li", { class: "row tap", onclick: () => openAlerts(ctx) },
        h("div", { class: "avatar", style: { "--c": status === "on" ? "var(--late)" : "var(--accent)" } }, icon("bell")),
        h("div", { class: "main" }, h("div", { class: "name" }, "Alerts", todo("alerts")), h("div", { class: "sub" }, ALERT_SUB[status])),
        icon("right"));
    })(),
    h("li", { class: "row tap", onclick: () => ctx.go("gaps") },
      h("div", { class: "avatar", style: { "--c": gaps.length ? "var(--gap)" : "var(--late)" } }, icon(gaps.length ? "alert" : "check")),
      h("div", { class: "main" }, h("div", { class: "name" }, "Coverage gaps"), h("div", { class: "sub" }, gaps.length ? `${gaps.length} from today to the end of ${fmtMonth(month)}` : "None flagged for the rest of the month")),
      icon("right")),
    h("li", { class: "row tap", onclick: () => ctx.go("hours") },
      h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("clock")),
      h("div", { class: "main" }, h("div", { class: "name" }, "Duty hours", todo("hours")), h("div", { class: "sub" }, "Your real hours, and estimates for everyone")),
      icon("right")),
    h("li", { class: "row tap", onclick: () => ctx.go("rate") },
      h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("sparkle")),
      h("div", { class: "main" }, h("div", { class: "name" }, "Rate the shifts", todo("rate")), h("div", { class: "sub" }, local.get("shiftRatings")?.sentAt ? "Thanks for rating. You can change your answers" : "One minute: how heavy does each shift really feel?")),
      icon("right")),
  )));

  if (me && me.cls !== "PGY-1") root.append(subscribeCard(ctx, state.me));

  root.append(card("What the colors mean", h("ul", { class: "list" }, LEGEND.map(([cls, label, text]) =>
    h("li", { class: "row", style: { minHeight: "48px" } }, h("span", { class: `chip ${cls}`, style: { minWidth: "112px", justifyContent: "center" } }, label), h("div", { class: "main small muted" }, text)))), { pad: false }));

  const m = model.ds.months?.[month];
  root.append(card("Data", h("dl", { class: "kv" },
    h("dt", null, "Call sheets"), h("dd", null, model.months.map((x) => fmtMonth(x)).join(", ") || "None"),
    m?.lastUpdated ? [h("dt", null, "Sheet says"), h("dd", null, `Last updated ${m.lastUpdated}`)] : null,
    h("dt", null, "Synced"), h("dd", null, model.ds.updatedAt ? new Date(model.ds.updatedAt).toLocaleString() : "—"),
    h("dt", null, "Daily sheets"), h("dd", null, String(Object.keys(model.ds.daily || {}).length)),
  )));

  root.append(card("Appearance", segmented([["system", "System"], ["light", "Light"], ["dark", "Dark"]], local.get("theme", "system"), (v) => { local.set("theme", v); applyTheme(v); ctx.render(); })));

  root.append(h("div", { class: "btnrow", style: { marginTop: "12px" } },
    (() => {
      const waiting = state.admin ? inboxCounts(state.today) : { open: 0, urgent: 0 };
      return h("button", { class: "btn", onclick: () => ctx.go(waiting.open ? "admin/requests" : "admin") }, icon("shield"), state.admin ? "Admin" : "Admin sign-in",
        waiting.open ? h("span", { class: "pill", style: { "--c": waiting.urgent ? "var(--gap)" : "var(--accent)" } }, `${waiting.open} ${waiting.open === 1 ? "request" : "requests"}`) : null);
    })(),
    h("button", { class: "btn danger", onclick: () => {
      if (!confirm("Sign out on this device?")) return;
      for (const k of ["passcode", "adminKey", "ds", "etag", "me"]) local.del(k);
      location.hash = "#/setup";
      location.reload();
    } }, "Sign out")));
  return root;
}

export { telHref };
