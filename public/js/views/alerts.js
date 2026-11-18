// More › Alerts: lock-screen alerts for the next day's OR schedule and for didactics, each worked
// out from the person's own day. The general lecture heads-ups can be turned off on their own.
import { h, icon, notice, openSheet, toast, append, safely } from "../ui.js";
import { local } from "../api.js";
import { alertStatus, turnOnAlerts, turnOffAlerts, testAlert, lecturesHere, setLectureReminders, caseNudgesHere, setCaseNudges } from "../push.js";
import { isNativeApp } from "../native.js";

export const ALERT_SUB = {
  on: "On: the next day's rooms, and your lectures",
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
      h("p", { class: "small", style: { marginTop: 0 } }, "Once the next day's OR sheet is final, your phone shows it on the lock screen with where you are, like \"Tomorrow's OR schedule is posted. You're in OR 7.\" One alert, not one for every edit. If your own room changes after that, you'll hear once more. Not when the sheet doesn't involve you: off, vacation, post-call, nights or another hospital."),
      h("p", { class: "small" }, "Lectures follow your own day. A heads-up 10 minutes before one in person, or 5 before one on Zoom, with the link if you're at another hospital. Nothing when you're off, post-call, resting before night float or working through it on call or a late shift. Coming off nights at 6a, you still hear about the 6a conference."),
      h("p", { class: "small" }, "Presenting? The evening before you get the time, place and moderator, then a reminder early enough to load your slides before the session starts. Mock orals: the evening before, and 15 minutes before your slot."),
      status === "install" ? h("div", null,
        h("ol", { class: "steps" },
          h("li", null, "In Safari, tap Share (the square with an arrow). If you don't see it, tap ··· first."),
          h("li", null, "Scroll down and tap Add to Home Screen, then Add."),
          h("li", null, "Open DMC Schedule from your Home Screen, sign in, and come back here to turn alerts on.")),
        h("p", { class: "tiny muted" }, "iPhones only allow web alerts from the Home Screen app (iOS 16.4 or later). It also keeps your saved hours from being cleared after a week without a visit.")) : null,
      status === "blocked" ? notice("warn", "alert", "Notifications are turned off for this app. On iPhone: Settings › Notifications › DMC Schedule › Allow Notifications. Then come back and turn alerts on.") : null,
      status === "unsupported" ? notice("", "info", isNativeApp() ? "Alerts aren't available in this version of the app yet." : "This browser can't show alerts. On iPhone, add the app to your Home Screen from Safari; on a computer, use Chrome, Edge, Firefox or Safari.") : null,
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
        h("button", { class: "btn", onclick: safely(async () => { await turnOffAlerts(); toast("Alerts are off"); draw(); ctx.render(); }) }, icon("x"), h("span", null, "Turn off"))) : null,
      status === "on" ? (() => {
        const box = h("input", { type: "checkbox", checked: lecturesHere(), onchange: async () => {
          box.disabled = true;
          try { await setLectureReminders(box.checked); toast(box.checked ? "Zoom reminders on" : "Zoom reminders off"); } catch (err) { box.checked = !box.checked; toast(err.message); }
          box.disabled = false;
        } });
        return h("div", null,
          h("label", { class: "checkline", style: { margin: "12px 0 0" } }, box, h("span", null, "Lecture heads-ups")),
          h("p", { class: "tiny muted", style: { margin: "4px 0 0" } }, "Your own presentations and mock orals always alert you."));
      })() : null,
      status === "on" ? (() => {
        const box = h("input", { type: "checkbox", checked: caseNudgesHere(), onchange: async () => {
          box.disabled = true;
          try { await setCaseNudges(box.checked); toast(box.checked ? "Case log nudges on" : "Case log nudges off"); } catch (err) { box.checked = !box.checked; toast(err.message); }
          box.disabled = false;
        } });
        return h("div", null,
          h("label", { class: "checkline", style: { margin: "12px 0 0" } }, box, h("span", null, "Case log nudges")),
          h("p", { class: "tiny muted", style: { margin: "4px 0 0" } }, "Once you've started a case log: after a case day with nothing logged, and Sunday evening when cases are waiting for ACGME."));
      })() : null,
      status === "on" && !ctx.state.me ? h("p", { class: "tiny muted" }, "Pick yourself under More so the alert can say where you are. Lecture alerts need it too.") : null,
      h("p", { class: "tiny muted", style: { marginBottom: 0 } }, local.get("adminKey")
        ? "On an admin's phone this also covers residents' requests: sick calls right away and one evening summary of swaps and no-call lists. Change it in Admin › Requests."
        : "Only posted OR schedules, didactics and your case log. Nothing else is sent."),
    ]);
  };
  draw();
  close = openSheet("Alerts", body);
  return close;
}
