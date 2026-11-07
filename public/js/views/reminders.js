// The reminder at the top of Today. Its button goes straight to the task, not to a menu.
import { h, icon } from "../ui.js";
import { local } from "../api.js";
import { nextReminder, pendingReminders, snoozeReminder } from "../../core/reminders.js";
import { loggedFor } from "../logged.js";

const COPY = {
  hours: {
    icon: "clock", title: "Add your real hours", action: "Add my hours", go: "hours/add",
    text: "See your true 4-week average and a better prediction. No password shared, and it stays on this device.",
  },
  rate: {
    icon: "sparkle", title: "Rate the shifts", action: "Rate now", go: "rate",
    text: "One minute. It helps make call fairer, and nobody sees your answers.",
  },
};

export const remindersFor = (model, state) => pendingReminders({
  cls: state.me ? model.person(state.me)?.cls : null,
  hasHours: !!(state.me && loggedFor(state.me)),
  hasRated: !!local.get("shiftRatings")?.sentAt,
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
        h("button", { class: "btn sm primary", onclick: () => ctx.go(c.go) }, c.action),
        h("button", { class: "btn sm ghost", onclick: () => { local.set("reminderSnooze", snoozeReminder(snoozed, key, state.today)); ctx.render(); } }, "Later"))));
}
