// App shell: state, routing, header and tab bar.
import { h, icon, avatar, toast, append } from "./ui.js";
import { api, local, fetchDataset } from "./api.js";
import { createModel } from "../core/model.js";
import { todayLocal, addDays, fmtDate, relDay, parts, MONTH_SHORT, DOW_SHORT, dow, nowMinutesLocal } from "../core/dates.js";
import { dayGaps } from "../core/gaps.js";
import { relevantTo } from "../core/didactics.js";
import { renderToday } from "./views/today.js";
import { renderTonight } from "./views/tonight.js";
import { renderBoard } from "./views/board.js";
import { renderPerson } from "./views/person.js";
import { renderHours } from "./views/hours.js";
import { renderCall } from "./views/call.js";
import { renderGaps } from "./views/gaps.js";
import { renderMore } from "./views/more.js";
import { renderRate } from "./views/rate.js";
import { renderAdmin } from "./views/admin.js";
import { renderDidactics } from "./views/didactics.js";
import { renderSetup, renderPickMe } from "./views/setup.js";

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

const TABS = [
  ["today", "Today", "home"],
  ["tonight", "Tonight", "moon"],
  ["board", "Board", "grid"],
  ["didactics", "Didactics", "book"],
  ["more", "More", "more"],
];

const DATED = new Set(["today", "tonight", "board"]);

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = hash.split("/");
  return { name: name || "today", arg: rest.join("/") };
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

async function reload({ quiet = false } = {}) {
  if (!local.get("passcode") && !local.get("adminKey")) return;
  state.loading = true;
  try {
    const { ds, changed } = await fetchDataset();
    if (changed || !state.model) {
      state.ds = ds;
      rebuild();
      render();
    }
    state.error = null;
  } catch (err) {
    if (err.status === 401) {
      local.del("passcode");
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
}

function topbar(r) {
  const bar = document.getElementById("topbar");
  const inner = h("div", { class: "topbar-inner" });
  const me = state.me && state.model?.person(state.me);
  const meBtn = me ? h("button", { class: "avatarbtn", "aria-label": "My schedule", onclick: () => go(`p/${state.me}`) }, avatar(state.model, state.me, "sm")) : null;
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
          h("span", { class: "sub" }, relDay(state.date, state.today)),
          `${DOW_SHORT[dow(state.date)]}, ${MONTH_SHORT[m - 1]} ${d}`,
          input),
      ),
      h("button", { class: "iconbtn", "aria-label": "Next day", onclick: () => setDate(addDays(state.date, 1)) }, icon("right")),
      state.date !== state.today ? h("button", { class: "todaybtn", onclick: () => setDate(state.today) }, "Today") : null,
      callBtn,
      meBtn,
    ]);
  } else {
    const titles = { call: "Call", hours: "Duty hours", gaps: "Coverage gaps", didactics: "Didactics", more: "More", admin: "Admin", p: "Schedule", setup: "DMC Schedule", pick: "Who are you?" };
    const back = ["p", "call", "gaps", "admin", "hours", "rate"].includes(r.name);
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
  const inner = h("div", { class: "tabbar-inner" }, TABS.map(([id, label, ic]) =>
    h("button", {
      class: "tab", "aria-current": r.name === id || (id === "more" && ["call", "gaps", "admin", "hours", "rate"].includes(r.name)) ? "page" : null,
      onclick: () => go(id),
    }, icon(ic), label,
    id === "more" && gapsSoon ? h("i", { class: "dot", "aria-label": "Coverage gaps soon" }) : null,
    id === "didactics" && didToday ? h("i", { class: `dot${didToday === "live" ? "" : " soon"}`, "aria-label": didToday === "live" ? "Session live now" : "Session today" }) : null)));
  nav.replaceChildren(inner);
}

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
    else if (!state.model) content = h("div", { class: "empty-state" }, h("div", { class: "spinner", style: { margin: "40px auto" } }), "Loading the schedule…");
    else if (r.name === "pick") content = renderPickMe(ctx());
    else if (r.name === "tonight") content = renderTonight(ctx());
    else if (r.name === "board") content = renderBoard(ctx());
    else if (r.name === "hours") content = renderHours(ctx());
    else if (r.name === "call") content = renderCall(ctx());
    else if (r.name === "gaps") content = renderGaps(ctx(), r.arg);
    else if (r.name === "didactics") content = renderDidactics(ctx());
    else if (r.name === "more") content = renderMore(ctx());
    else if (r.name === "rate") content = renderRate(ctx());
    else if (r.name === "admin") content = renderAdmin(ctx());
    else if (r.name === "p" && r.arg) content = renderPerson(ctx(), r.arg);
    else content = renderToday(ctx());
  } catch (err) {
    console.error(err);
    content = h("div", { class: "empty-state" }, h("h3", null, "Something went wrong"), h("p", null, String(err.message || err)));
  }
  view.replaceChildren(content);
}

window.addEventListener("hashchange", () => { render(); window.scrollTo({ top: 0 }); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const t = todayLocal();
    if (t !== state.today) { if (state.date === state.today) state.date = t; state.today = t; render(); }
    reload({ quiet: true });
  }
});
window.addEventListener("online", () => reload({ quiet: true }));

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

rebuild();
render();
reload({ quiet: !!state.ds });

export { state, fmtDate };
