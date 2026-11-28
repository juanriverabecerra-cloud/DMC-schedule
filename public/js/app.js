// App shell: state, routing, header and tab bar.
import { h, icon, avatar, toast, append, closeSheet, splitColumns } from "./ui.js";
import { api, local, fetchDataset } from "./api.js";
import { createModel } from "../core/model.js";
import { todayLocal, addDays, diffDays, relDay, parts, MONTH_SHORT, DOW_SHORT, dow, nowMinutesLocal } from "../core/dates.js";
import { dayGaps } from "../core/gaps.js";
import { relevantTo } from "../core/didactics.js";
import { screenLayout } from "../core/screen.js";
import { renderToday } from "./views/today.js";
import { renderTonight } from "./views/tonight.js";
import { renderBoard } from "./views/board.js";
import { renderPerson } from "./views/person.js";
import { renderHours } from "./views/hours.js";
import { renderCall } from "./views/call.js";
import { renderGaps } from "./views/gaps.js";
import { renderMore } from "./views/more.js";
import { renderLayout, savedTabs } from "./views/layout.js";
import { renderEvents, rsvpsSoon } from "./views/events.js";
import { TAB_PAGES } from "../core/layout.js";
import { renderRate } from "./views/rate.js";
import { renderSwaps, renderNoCall } from "./views/requests.js";
import { renderDaysOff } from "./views/daysoff.js";
import { renderExams } from "./views/exams.js";
import { renderAdmin } from "./views/admin.js";
import { renderDidactics } from "./views/didactics.js";
import { renderCases } from "./views/cases.js";
import { renderSetup, renderPickMe } from "./views/setup.js";
import { remindersFor } from "./views/reminders.js";
import { syncAlerts } from "./push.js";
import { syncWidget, reloadWidgets, onWidgetOpen, onAlertTap, onScreenRegions } from "./native.js";
import { watchInstall } from "./install.js";
import { retryUpload } from "./logged.js";
import { loadInbox, inboxCounts } from "./views/inbox.js";
import { onCaseLogChange, hasUnsent, syncCaseLog, loadCaseLog } from "./cases.js";
import { onMeChange } from "./me.js";
import { checkMilestones, loadingLine } from "./delight.js";
import { loadSwaps } from "./views/requests.js";

const state = {
  ds: local.get("ds"),
  model: null,
  me: local.get("me"),
  date: todayLocal(),
  today: todayLocal(),
  admin: !!local.get("adminKey"),
  loading: false,
  error: null,
};

// The tab bar is each person's own (Arrange, under More): their pages in their order, then More.
const tabList = () => [...savedTabs().map((k) => [k, ...TAB_PAGES[k]]), ["more", "More", "more"]];

const DATED = new Set(["today", "tonight", "board", "cases"]);
// Screens made of cards flow into two columns when the window has room. Forms, long single
// lists and the case log (rows of buttons that want the width) stay in one; wide tables just
// get the extra width.
const TWO_COLUMNS = new Set(["today", "tonight", "board", "more", "call", "didactics", "p", "hours", "off", "exams", "swaps", "nocall", "layout", "events"]);
function layoutFor(r) {
  if (r.name === "admin") return !local.get("adminKey") ? "" : local.get("adminTab", "uploads") === "uploads" ? "cols" : "wide";
  return TWO_COLUMNS.has(r.name) ? "cols" : "";
}
const MORE_PAGES = ["call", "gaps", "admin", "hours", "rate", "swaps", "nocall", "off", "exams", "cases", "layout", "events"];
// A page reached from More, unless it's one of this person's tabs.
const underMore = (name) => MORE_PAGES.includes(name) && !savedTabs().includes(name);

// Some screens keep part of themselves for the phone: a strip down one side, or a clock in one
// corner (see core/screen.js). The stylesheet can read how wide a margin is, but not what it is
// for, so this works that out and names it on <html>; the stylesheet does the rest. In the app
// the phone also says exactly which rectangles are taken.
let reserved = null;
function screenShape() {
  const probe = h("div", { style: { position: "fixed", visibility: "hidden", pointerEvents: "none", paddingTop: "var(--safe-top)", paddingLeft: "var(--safe-left)", paddingRight: "var(--safe-right)" } });
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = { top: parseFloat(style.paddingTop) || 0, left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0 };
  probe.remove();
  // What the phone reported is for one size of screen: after a turn it is stale until it reports again.
  const current = reserved && Math.abs(reserved.width - innerWidth) <= 1 && Math.abs(reserved.height - innerHeight) <= 1;
  const shape = screenLayout({
    width: innerWidth, height: innerHeight, insets, regions: current ? reserved.regions : [],
    screenSize: { width: screen.width, height: screen.height }, phone: /\biPhone\b/.test(navigator.userAgent),
  });
  const root = document.documentElement;
  for (const name of ["strip", "corner", "rail", "cam", "dock"]) if (shape[name]) root.dataset[name] = shape[name]; else delete root.dataset[name];
  for (const [name, value] of [["--strip-top", shape.stripTop], ["--strip-bottom", shape.stripBottom], ["--corner-width", shape.cornerWidth], ["--corner-height", shape.cornerHeight]]) {
    if (value) root.style.setProperty(name, `${value}px`); else root.style.removeProperty(name);
  }
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = hash.split("/");
  return { name: name || savedTabs()[0], arg: rest.join("/") };
}

export function go(path) {
  location.hash = `#/${path}`;
}

function setDate(date) {
  state.date = date;
  render();
  window.scrollTo({ top: 0 });
}

function rebuild() {
  state.model = state.ds ? createModel(state.ds) : null;
}

async function reload({ quiet = false, soft = false } = {}) {
  if (!local.get("passcode") && !local.get("adminKey")) return;
  state.loading = true;
  try {
    const { ds, changed } = await fetchDataset();
    if (changed || !state.model) {
      state.ds = ds;
      rebuild();
      if (changed) reloadWidgets(); // the widgets shouldn't wait for their own timer
      // A background refresh repaints the schedule screens, never a form someone is filling in
      // or a search box someone is typing in.
      const typing = document.activeElement?.matches?.("input, textarea, select");
      if (!soft || (DATED.has(route().name) && !typing)) render();
    }
    state.error = null;
    // Admin devices check the requests inbox whenever the app comes back into view.
    if (state.model) loadInbox(ctx(), { force: true });
    syncAlerts(state.me || null);
  } catch (err) {
    if (err.status === 401) {
      local.del("passcode");
      local.del("adminKey");
      state.admin = false;
      state.error = "The passcode changed or expired. Enter it again.";
      go("setup");
    } else if (!quiet) toast(navigator.onLine ? err.message : "Offline — showing the last saved schedule");
  } finally {
    state.loading = false;
  }
}

function ctx() {
  return { state, model: state.model, go, setDate, reload, render, api, setMe };
}

function setMe(pid) {
  state.me = pid;
  if (pid) local.set("me", pid); else local.del("me");
  syncAlerts(pid || null);
  syncWidget(pid || null);
}

// Above the date itself, how far it is from today (the date already names the weekday).
function howFar(date, today) {
  const n = diffDays(today, date);
  if (Math.abs(n) <= 1) return relDay(date, today);
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

let hintCounted = false;
function topbar(r) {
  const bar = document.getElementById("topbar");
  // The sign-in screen has its own big title: its bar just keeps the space at the top.
  bar.classList.toggle("plain", r.name === "setup");
  const inner = h("div", { class: "topbar-inner" });
  const me = state.me && state.model?.person(state.me);
  const meBtn = me ? h("button", { class: "avatarbtn", "aria-label": "My schedule", onclick: () => { local.set("meHint", true); go(`p/${state.me}`); } }, avatar(state.model, state.me, "sm")) : null;
  // Once, on Today: nothing else says the initials at the top are their own schedule. It goes for
  // good with "Got it" or a tap on the initials, and stops by itself after a few days of opening.
  const hint = meBtn && r.name === "today" && !local.get("meHint") && local.get("meHintShown", 0) < 5 && innerWidth > 350
    ? h("div", { class: "me-hint", role: "note" },
      h("span", null, "Your month, rotations and calendar link: tap your initials."),
      h("button", { class: "btn sm", onclick: () => { local.set("meHint", true); render(); } }, "Got it"))
    : null;
  // Calling is one tap from every screen, without taking a tab.
  const callBtn = state.model && !["setup", "pick", "call"].includes(r.name)
    ? h("a", { class: "numbtn icononly", href: "#/call", "aria-label": "Call", title: "Call" }, icon("phone")) : null;

  if (DATED.has(r.name) && state.model) {
    const { m, d } = parts(state.date);
    const input = h("input", { type: "date", value: state.date, "aria-label": "Pick a date", onchange: (e) => e.target.value && setDate(e.target.value) });
    append(inner, [
      h("button", { class: "iconbtn", "aria-label": "Previous day", onclick: () => setDate(addDays(state.date, -1)) }, icon("left")),
      h("div", { class: "datenav" },
        h("div", { class: "label" },
          h("span", { class: "sub" }, howFar(state.date, state.today)),
          `${DOW_SHORT[dow(state.date)]}, ${MONTH_SHORT[m - 1]} ${d}`,
          input),
      ),
      h("button", { class: "iconbtn", "aria-label": "Next day", onclick: () => setDate(addDays(state.date, 1)) }, icon("right")),
      state.date !== state.today ? h("button", { class: "todaybtn", onclick: () => setDate(state.today) }, "Today") : null,
      callBtn,
      meBtn,
      hint,
    ]);
    if (hint && !hintCounted) { hintCounted = true; local.set("meHintShown", local.get("meHintShown", 0) + 1); }
  } else {
    const titles = { call: "Call", rate: "Rate the shifts", swaps: "Swaps", nocall: "No-call days", off: "Days off", exams: "Exams", hours: "Duty hours", gaps: "Coverage gaps", didactics: "Didactics", more: "More", admin: "Admin", p: "Schedule", setup: "DMC Schedule", pick: "Who are you?", layout: "Arrange", cases: "Case log", events: "Events" };
    const back = underMore(r.name) || r.name === "p";
    append(inner, [
      back ? h("button", { class: "iconbtn", "aria-label": "Back", onclick: () => (history.length > 1 ? history.back() : go("today")) }, icon("left")) : null,
      h("h1", null, titles[r.name] || "DMC Schedule"),
      callBtn,
      r.name !== "setup" ? meBtn : null,
    ]);
  }
  bar.replaceChildren(inner);
}

// "live" while a session you'd attend is running, "today" if one is still to come, else null.
function sessionsToday() {
  const D = state.model?.didactics;
  if (!D?.has) return null;
  const now = nowMinutesLocal();
  const list = D.on(state.today).filter((e) => relevantTo(e, state.me) && (e.end ?? 1440) > now);
  if (!list.length) return null;
  return list.some((e) => e.start != null && e.start <= now) ? "live" : "today";
}

function tabbar(r) {
  const nav = document.getElementById("tabbar");
  if (r.name === "setup" || !state.model) { nav.hidden = true; return; }
  nav.hidden = false;
  const gapsSoon = state.model ? [0, 1, 2].some((i) => dayGaps(state.model, addDays(state.today, i)).some((g) => g.level === "gap")) : false;
  const didToday = sessionsToday();
  const toDo = remindersFor(state.model, state).length > 0 || rsvpsSoon(ctx()).length > 0;
  // Admins: red for a sick call today or tomorrow, blue for anything else waiting in Requests.
  const inbox = state.admin ? inboxCounts(state.today) : { open: 0, urgent: 0 };
  const red = gapsSoon || inbox.urgent > 0;
  const inner = h("div", { class: "tabbar-inner" }, tabList().map(([id, label, ic]) =>
    h("button", {
      class: "tab", "aria-current": r.name === id || (id === "more" && underMore(r.name)) ? "page" : null,
      "aria-label": label, title: label,
      // Shrunk while scrolling: the first tap brings the other tabs back.
      onclick: () => {
        const root = document.documentElement;
        if (root.classList.contains("tabs-min")) { root.classList.remove("tabs-min"); return; }
        go(id);
      },
    }, icon(ic), h("span", { class: "tab-label" }, label),
    id === "more" && red ? h("i", { class: "dot", "aria-label": inbox.urgent ? "Sick call" : "Coverage gaps soon" }) : null,
    id === "more" && (toDo || inbox.open > 0) && !red ? h("i", { class: "dot soon", "aria-label": inbox.open ? "Requests waiting" : "Something to do" }) : null,
    id === "didactics" && didToday ? h("i", { class: `dot${didToday === "live" ? "" : " soon"}`, "aria-label": didToday === "live" ? "Session live now" : "Session today" }) : null)));
  nav.replaceChildren(inner);
}

let lastScreen = ""; // the screen last drawn, so a redraw of the same one keeps its place
export function render() {
  const r = route();
  const view = document.getElementById("view");
  const signedIn = local.get("passcode") || local.get("adminKey");
  if (!signedIn && r.name !== "setup") { go("setup"); return; }
  if (r.name === "day" && /^\d{4}-\d{2}-\d{2}$/.test(r.arg)) { state.date = r.arg; go("today"); return; }

  topbar(r);
  tabbar(r);
  let content;
  try {
    if (r.name === "setup") content = renderSetup(ctx());
    else if (!state.model) {
      // A slow start gets a line from the OR instead.
      const line = h("span", null, "Loading the schedule…");
      setTimeout(() => { if (line.isConnected) line.textContent = loadingLine(); }, 1500);
      content = h("div", { class: "empty-state" }, h("div", { class: "spinner", style: { margin: "40px auto" } }), line);
    }
    else if (r.name === "pick") content = renderPickMe(ctx());
    else if (r.name === "tonight") content = renderTonight(ctx());
    else if (r.name === "board") content = renderBoard(ctx());
    else if (r.name === "hours") content = renderHours(ctx(), r.arg);
    else if (r.name === "call") content = renderCall(ctx());
    else if (r.name === "gaps") content = renderGaps(ctx(), r.arg);
    else if (r.name === "didactics") content = renderDidactics(ctx());
    else if (r.name === "cases") content = renderCases(ctx(), r.arg);
    else if (r.name === "more") content = renderMore(ctx());
    else if (r.name === "layout") content = renderLayout(ctx());
    else if (r.name === "events") content = renderEvents(ctx(), r.arg);
    else if (r.name === "rate") content = renderRate(ctx());
    else if (r.name === "swaps") content = renderSwaps(ctx(), r.arg);
    else if (r.name === "nocall") content = renderNoCall(ctx());
    else if (r.name === "off") content = renderDaysOff(ctx());
    else if (r.name === "exams") content = renderExams(ctx());
    else if (r.name === "admin") content = renderAdmin(ctx(), r.arg);
    else if (r.name === "p" && r.arg) content = renderPerson(ctx(), r.arg);
    else content = renderToday(ctx());
  } catch (err) {
    console.error(err);
    content = h("div", { class: "empty-state" }, h("h3", null, "Something went wrong"), h("p", null, String(err.message || err)));
  }
  // A redraw of the same screen (a tap on a case's box, a save arriving) keeps the page where it
  // was. iPhone Safari can jump to the top when the screen is swapped out under the finger, so the
  // page's height is held while it's redrawn and the position put back if the browser moved it.
  const here = `${r.name}/${r.arg || ""}/${state.date}`;
  const same = here === lastScreen;
  lastScreen = here;
  const keepY = window.scrollY;
  if (same) {
    view.style.minHeight = `${view.offsetHeight}px`;
    if (view.contains(document.activeElement)) document.activeElement.blur();
  }
  view.replaceChildren(content);
  const layout = state.model ? layoutFor(r) : "";
  if (layout) document.body.dataset.layout = layout; else delete document.body.dataset.layout;
  flowColumns();
  if (same) {
    view.style.minHeight = "";
    if (Math.abs(window.scrollY - keepY) > 1) window.scrollTo(0, keepY);
    // Safari can also do it a moment later: put it back if it went to the top by itself.
    requestAnimationFrame(() => { if (keepY > 40 && window.scrollY < 2) window.scrollTo(0, keepY); });
  }
}

// On a wide screen card screens use two columns (splitColumns in ui.js).
function flowColumns() {
  const root = document.getElementById("view").firstElementChild;
  if (root) splitColumns(root);
}

// A phone left open past midnight moves on to the new day.
function rollToNewDay() {
  const t = todayLocal();
  if (t === state.today) return;
  if (state.date === state.today) state.date = t;
  state.today = t;
  render();
}

window.addEventListener("hashchange", () => { closeSheet(); render(); window.scrollTo({ top: 0 }); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  rollToNewDay();
  reload({ quiet: true });
});
window.addEventListener("online", () => {
  reload({ quiet: true });
  if (state.me && hasUnsent(state.me)) syncCaseLog(state.me).catch(() => {});
});
// The case log arrives from the server after a screen is drawn: redraw the screens that show it,
// but never while someone is typing.
onCaseLogChange(() => {
  checkMilestones(state.me); // ACGME's numbers may have just crossed one
  const typing = document.activeElement?.matches?.("input, textarea, select");
  if (!typing && ["cases", "today", "more"].includes(route().name)) render();
});
// This device was just linked to the resident, or the server told something new (their calendar
// subscribed): their case log and swaps come again, and the screen catches up.
onMeChange((was, now) => {
  if (was && !was.linked && now?.linked && state.me && state.model) {
    loadCaseLog(state.me);
    loadSwaps(ctx(), { force: true });
  }
  const typing = document.activeElement?.matches?.("input, textarea, select");
  if (!typing) render();
});
// Scrolled down: the top bar's one-time note steps aside instead of covering cards.
window.addEventListener("scroll", () => document.documentElement.classList.toggle("scrolled", window.scrollY > 40), { passive: true });
// The glass tabs on the folding iPhone shrink to the one you're on while you scroll down, so more of
// the schedule shows, and come back when you scroll up, reach the top, change screens or tap them.
let tabsY = 0;
window.addEventListener("scroll", () => {
  const root = document.documentElement, y = window.scrollY, d = root.dataset;
  if (!(d.strip || d.rail || d.dock) || y < 60) root.classList.remove("tabs-min");
  else if (y > tabsY + 14 && document.querySelector('.tab[aria-current="page"]')) root.classList.add("tabs-min");
  else if (y < tabsY - 14) root.classList.remove("tabs-min");
  if (Math.abs(y - tabsY) > 14 || y < 60) tabsY = y;
}, { passive: true });
window.addEventListener("hashchange", () => document.documentElement.classList.remove("tabs-min"));
// Turning or unfolding the phone changes which part of the screen it keeps.
screenShape();
let resizeTimer = null;
let laidOutAt = window.innerWidth;
window.addEventListener("resize", () => {
  screenShape();
  // Columns come and go with the width (a fold, a turn): lay the screen out again once it
  // settles. Only the width matters: Safari's bars shrinking as you scroll change the height.
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === laidOutAt || document.activeElement?.matches?.("input, textarea, select")) return;
    laidOutAt = window.innerWidth;
    render();
  }, 150);
});
onScreenRegions((screen) => { reserved = screen; screenShape(); });
// The daily sheet can change through the afternoon: keep an open app current.
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  rollToNewDay();
  reload({ quiet: true, soft: true });
}, 2 * 60 * 1000);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  // A tapped alert asks an open window to go to that day.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "open" && typeof e.data.url === "string" && new URL(e.data.url).origin === location.origin) location.href = e.data.url;
  });
}

// Chrome on Android says when it can install the app; Today's card then offers the button.
watchInstall(() => { if (route().name === "today") render(); });

// In the app: a tapped widget or alert opens its day, and the widgets get this resident's feed.
onWidgetOpen((day) => go(`day/${day}`));
onAlertTap((url) => { location.href = url; });
if (local.get("passcode") || local.get("adminKey")) syncWidget(state.me || null);

rebuild();
render();
reload({ quiet: !!state.ds });
if (state.me) retryUpload(state.me);
