// More › Alerts: turn on a lock-screen alert for when the next day's OR schedule is posted.
import { h, icon, notice, openSheet, toast, append } from "../ui.js";
import { alertStatus, turnOnAlerts, turnOffAlerts, testAlert } from "../push.js";

export const ALERT_SUB = {
  on: "On: you'll hear when the next day's rooms are posted",
  off: "Get a lock-screen alert when the next day's rooms are posted",
  install: "Add the app to your Home Screen to get alerts",
  blocked: "Blocked in your phone's settings",
  unsupported: "This browser can't show alerts",
};

export function openAlerts(ctx) {
  const body = h("div");
  let close = () => {};
  const draw = () => {
    const status = alertStatus();
    const busy = (btn, label) => { btn.disabled = true; btn.lastChild.textContent = label; };
    body.replaceChildren();
    append(body, [
      h("p", { class: "small", style: { marginTop: 0 } }, "When the next day's OR sheet is posted, your phone shows it on the lock screen with where you are, like \"Tomorrow's OR schedule is posted. You're in OR 7.\" Tap it to open that day."),
      status === "install" ? h("div", null,
        h("ol", { class: "steps" },
          h("li", null, "In Safari, tap the Share button (the square with an arrow)."),
          h("li", null, "Tap Add to Home Screen, then Add."),
          h("li", null, "Open DMC Schedule from your Home Screen, sign in, and come back here to turn alerts on.")),
        h("p", { class: "tiny muted" }, "iPhones only allow web alerts from the Home Screen app (iOS 16.4 or later). It also keeps your saved hours from being cleared after a week without a visit.")) : null,
      status === "blocked" ? notice("warn", "alert", "Notifications are turned off for this app. On iPhone: Settings › Notifications › DMC Schedule › Allow Notifications. Then come back and turn alerts on.") : null,
      status === "unsupported" ? notice("", "info", "This browser can't show alerts. On iPhone, add the app to your Home Screen from Safari; on a computer, use Chrome, Edge, Firefox or Safari.") : null,
      status === "off" || status === "blocked" ? (() => {
        const btn = h("button", { class: "btn primary block", onclick: async () => {
          busy(btn, "Turning on…");
          try { await turnOnAlerts(ctx.state.me || null); toast("Alerts are on"); draw(); ctx.render(); } catch (err) { toast(err.message); draw(); }
        } }, icon("bell"), h("span", null, "Turn on alerts"));
        return btn;
      })() : null,
      status === "on" ? h("div", { class: "btnrow" },
        (() => {
          const btn = h("button", { class: "btn", onclick: async () => {
            busy(btn, "Sending…");
            try { await testAlert(); toast("Sent. It should show in a few seconds"); } catch (err) { toast(err.message); }
            draw();
          } }, icon("bell"), h("span", null, "Send me a test"));
          return btn;
        })(),
        h("button", { class: "btn", onclick: async () => { await turnOffAlerts(); toast("Alerts are off"); draw(); ctx.render(); } }, icon("x"), h("span", null, "Turn off"))) : null,
      status === "on" && !ctx.state.me ? h("p", { class: "tiny muted" }, "Pick yourself under More so the alert can say where you are.") : null,
      h("p", { class: "tiny muted", style: { marginBottom: 0 } }, "Only for posted OR schedules. Nothing else is sent."),
    ]);
  };
  draw();
  close = openSheet("Alerts", body);
  return close;
}
