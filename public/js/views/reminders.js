// The reminder at the top of Today. Its button goes straight to the task, not to a menu.
import { h, icon, safely } from "../ui.js";
import { local } from "../api.js";
import { nextReminder, pendingReminders, snoozeReminder } from "../../core/reminders.js";
import { loggedFor } from "../logged.js";
import { alertStatus } from "../push.js";
import { installRoute, promptInstall } from "../install.js";
import { openAlerts } from "./alerts.js";

// Opened in a browser: how to put the app on the Home Screen, before any other reminder. It
// stays until the app is opened from there, or "Hide" is tapped.
const glyph = (name) => icon(name, 'class="glyph"');
const INSTALL_STEPS = {
  safari: [
    ["Tap Share ", glyph("share"), ". If you don't see it, tap ··· first."],
    ["Scroll down and tap Add to Home Screen."],
    ["Tap Add, then open DMC Schedule from your Home Screen and sign in there once."],
  ],
  "other-ios": [
    ["Tap Share ", glyph("share"), " in this browser."],
    ["Tap Add to Home Screen. If it isn't there, open this page in Safari and add it from there."],
    ["Open DMC Schedule from your Home Screen and sign in there once."],
  ],
};

export function installCard(ctx) {
  const route = installRoute();
  if (!route || local.get("installHidden")) return null;
  const steps = INSTALL_STEPS[route];
  return h("section", { class: "card card-pad reminder install" },
    h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("add")),
    h("div", { class: "main" },
      h("div", { class: "name" }, route === "prompt" ? "Install DMC Schedule" : "Add DMC Schedule to your Home Screen"),
      h("div", { class: "small muted" }, route === "prompt"
        ? "It opens full screen like an app, with its own icon."
        : "It opens full screen like an app, and it's the only way an iPhone allows alerts."),
      steps ? h("ol", { class: "steps" }, steps.map((s) => h("li", null, s))) : null,
      h("div", { class: "btnrow" },
        route === "prompt" ? h("button", { class: "btn sm primary", onclick: safely(async () => {
          if (await promptInstall()) local.set("installHidden", true);
          ctx.render();
        }) }, "Install") : null,
        h("button", { class: "btn sm ghost", onclick: () => { local.set("installHidden", true); ctx.render(); } }, "Hide"))));
}

const COPY = {
  hours: {
    icon: "clock", title: "Add your real hours", action: "Add my hours", go: "hours/add",
    text: "See your true 4-week average. Your real hours are also useful information for the chiefs, to divide calls, shifts and rotations more fairly. No password needed.",
  },
  rate: {
    icon: "sparkle", title: "Rate the shifts", action: "Rate now", go: "rate",
    text: "One minute. It helps make call fairer, and nobody sees your answers.",
  },
  alerts: {
    icon: "bell", title: "Know when tomorrow's rooms are posted", action: "Turn on alerts", open: openAlerts,
    text: "Get a lock-screen alert the moment the next day's OR schedule is up, with where you are, and before the lectures you're due at.",
  },
};

export const remindersFor = (model, state) => pendingReminders({
  cls: state.me ? model.person(state.me)?.cls : null,
  hasHours: !!(state.me && loggedFor(state.me)),
  hasRated: !!local.get("shiftRatings")?.sentAt,
  alerts: alertStatus(),
});

export function reminderCard(ctx) {
  const { model, state } = ctx;
  const snoozed = local.get("reminderSnooze", {});
  const key = nextReminder(remindersFor(model, state), snoozed, state.today);
  if (!key) return null;
  const c = COPY[key];
  return h("section", { class: "card card-pad reminder" },
    h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon(c.icon)),
    h("div", { class: "main" },
      h("div", { class: "name" }, c.title),
      h("div", { class: "small muted" }, c.text),
      h("div", { class: "btnrow" },
        h("button", { class: "btn sm primary", onclick: () => (c.open ? c.open(ctx) : ctx.go(c.go)) }, c.action),
        h("button", { class: "btn sm ghost", onclick: () => { local.set("reminderSnooze", snoozeReminder(snoozed, key, state.today)); ctx.render(); } }, "Later"))));
}
