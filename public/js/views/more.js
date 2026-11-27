import { h, icon, card, avatar, classPill, segmented, openSheet } from "../ui.js";
import { local } from "../api.js";
import { monthKey, fmtMonth, fmtDate } from "../../core/dates.js";
import { monthGaps } from "../../core/gaps.js";
import { subscribeBody } from "./common.js";
import { calendarSubscribed } from "../me.js";
import { aboutTaps, birthdayPicker } from "../delight.js";
import { remindersFor } from "./reminders.js";
import { openAlerts, ALERT_SUB } from "./alerts.js";
import { alertStatus, turnOffAlerts } from "../push.js";
import { syncWidget } from "../native.js";
import { requestsCard } from "./requests.js";
import { inboxCounts } from "./inbox.js";
import { examsNow, countdownWord } from "./exams.js";
import { caseLogLine } from "./cases.js";

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
  // One row: an icon, a name (with "To do" when it's waiting on them), a line under it.
  const row = (ic, color, name, sub, onclick, todoKey) => h("li", { class: "row tap", onclick },
    h("div", { class: "avatar", style: { "--c": color } }, icon(ic)),
    h("div", { class: "main" }, h("div", { class: "name" }, name, todoKey ? todo(todoKey) : null), h("div", { class: "sub" }, sub)),
    icon("right"));
  const group = (title, rows) => (rows.some(Boolean) ? card(title, h("ul", { class: "list" }, rows), { pad: false }) : null);
  const month = monthKey(state.today);
  const gaps = model.months.includes(month) ? monthGaps(model, month).filter((g) => g.date >= state.today && g.level === "gap") : [];
  const exam = me ? examsNow(ctx).exams[0] : null;
  const next = model.events(state.today, undefined, state.me)[0];

  // Calling isn't here: the phone button at the top of every screen does it.
  root.append(...[
    group("Your work", [
      me ? row("check", "var(--accent)", "Case log", caseLogLine(ctx), () => ctx.go("cases")) : null,
      row("clock", "var(--accent)", "Duty hours", "Your real hours, and estimates for everyone", () => ctx.go("hours"), "hours"),
      me ? row("calendar", "var(--late)", "Days off", "Golden weekends, and days you're off with friends", () => ctx.go("off")) : null,
      me ? row("book", "var(--accent)", "Exams", exam ? `${exam.name}: ${countdownWord(exam)}` : "Your countdowns", () => ctx.go("exams")) : null,
      row("event", "var(--accent)", "Events", next ? `Next: ${next.title}, ${fmtDate(next.date)}` : "Parties, lectures and conferences from the program office", () => ctx.go("events")),
    ]),
    group("Program", [
      row(gaps.length ? "alert" : "check", gaps.length ? "var(--gap)" : "var(--late)", "Coverage gaps", gaps.length ? `${gaps.length} from today to the end of ${fmtMonth(month)}` : "None flagged for the rest of the month", () => ctx.go("gaps")),
      row("sparkle", "var(--accent)", "Rate the shifts", local.get("shiftRatings")?.sentAt ? "Thanks for rating. You can change your answers" : "One minute: how heavy does each shift really feel?", () => ctx.go("rate"), "rate"),
    ]),
    group("Settings", [
      (() => {
        const status = alertStatus();
        return row("bell", status === "on" ? "var(--late)" : "var(--accent)", "Alerts", ALERT_SUB[status], () => openAlerts(ctx), "alerts");
      })(),
      row("arrange", "var(--accent)", "Arrange", "Your tabs, and what Today shows first", () => ctx.go("layout")),
      me && me.cls !== "PGY-1" ? row("calendar", calendarSubscribed(state.me) ? "var(--late)" : "var(--accent)", "Calendar",
        calendarSubscribed(state.me) ? "Subscribed: your shifts are in your phone's calendar" : "Your shifts in your phone's calendar",
        () => openSheet("Calendar", h("div", { class: "card-pad" }, subscribeBody(ctx, state.me)))) : null,
      me ? h("li", { class: "row" },
        h("div", { class: "avatar", style: { "--c": "var(--gold)" } }, icon("sparkle")),
        h("div", { class: "main" }, h("div", { class: "name" }, "Your birthday"), h("div", { class: "sub" }, "Optional. Only this phone knows it: a line on Today that morning."),
          birthdayPicker())) : null,
      h("li", { class: "row" },
        h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("moon")),
        h("div", { class: "main" }, h("div", { class: "name" }, "Appearance"),
          segmented([["system", "System"], ["light", "Light"], ["dark", "Dark"]], local.get("theme", "system"), (v) => { local.set("theme", v); applyTheme(v); ctx.render(); }))),
    ]),
  ].filter(Boolean));

  root.append(h("div", { class: "btnrow", style: { marginTop: "12px" } },
    (() => {
      const waiting = state.admin ? inboxCounts(state.today) : { open: 0, urgent: 0 };
      return h("button", { class: "btn", onclick: () => ctx.go(waiting.open ? "admin/requests" : "admin") }, icon("shield"), state.admin ? "Admin" : "Admin sign-in",
        waiting.open ? h("span", { class: "pill", style: { "--c": waiting.urgent ? "var(--gap)" : "var(--accent)" } }, `${waiting.open} ${waiting.open === 1 ? "request" : "requests"}`) : null);
    })(),
    h("button", { class: "btn danger", onclick: async () => {
      if (!confirm("Sign out on this device?")) return;
      // A signed-out phone shouldn't keep showing the schedule on its lock screen.
      await turnOffAlerts().catch(() => {});
      await syncWidget(null); // and its widgets go blank
      for (const k of ["passcode", "adminKey", "ds", "etag", "me"]) local.del(k);
      location.hash = "#/setup";
      location.reload();
    } }, "Sign out")));
  // How current the schedule on this phone is. The rest of what used to be "Data" is in Admin.
  if (model.ds.updatedAt) root.append(h("p", { class: "disclaimer", onclick: aboutTaps(ctx) }, `Schedule synced ${new Date(model.ds.updatedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}.`));
  return root;
}
