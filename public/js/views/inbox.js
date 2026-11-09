// Admin › Requests: what residents asked for, in one place. Sick calls first, then agreed swaps
// to put on the call sheet, then every no-call list for a month gathered by day. "Done" is
// shared by all admins, and items clear themselves once their dates pass, so the red dot only
// means something still needs a look.
import { h, icon, card, emptyState, avatar, classPill, segmented, toast, callChip, append } from "../ui.js";
import { api, local } from "../api.js";
import { addDays, fmtDate, fmtMonth, relDay } from "../../core/dates.js";
import { lc, whenShort } from "../../core/requests.js";
import { alertStatus, setRequestMode, requestModeHere } from "../push.js";
import { openAlerts } from "./alerts.js";

let inbox = { items: null, at: 0, loading: false, key: "" };

export function loadInbox(ctx, { force = false } = {}) {
  if (!local.get("adminKey")) return;
  if (inbox.loading || (!force && inbox.items && Date.now() - inbox.at < 60 * 1000)) return;
  inbox.loading = true;
  api("/api/requests").then((res) => {
    const key = JSON.stringify(res.items);
    const changed = key !== inbox.key;
    inbox = { items: res.items, at: Date.now(), loading: false, key };
    if (changed) ctx.render();
  }).catch(() => { inbox = { ...inbox, loading: false, at: Date.now() }; });
}

// open: anything not done. urgent: a sick call for today or tomorrow.
export function inboxCounts(today) {
  const open = (inbox.items || []).filter((i) => !i.done);
  return { open: open.length, urgent: open.filter((i) => i.type === "sick" && i.date <= addDays(today, 1)).length };
}

async function setDone(ctx, ids, done, msg) {
  try {
    const res = await api("/api/requests/done", { method: "POST", body: { ids, done } });
    inbox = { ...inbox, items: res.items, key: JSON.stringify(res.items), at: Date.now() };
    if (msg) toast(msg);
    ctx.render();
  } catch (err) { toast(err.message); }
}

const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return fmtDate(new Date(iso).toLocaleDateString("en-CA"));
};

// How much this phone hears. The inbox and its dot are there either way.
const MODE_TEXT = {
  smart: "Sick calls right away. Swaps and no-call lists in one summary around 6–7p, only on days something new came in.",
  sick: "Only sick calls, right away. Check here for swaps and no-call lists.",
  off: "No alerts. The red dot on More still shows when something's waiting.",
};
function alertSetting(ctx) {
  const status = alertStatus();
  if (status !== "on") {
    return h("div", { class: "setbox" },
      h("div", { class: "main" }, h("div", { class: "name small" }, "Get sick calls on this phone"), h("div", { class: "tiny muted" }, "Turn on alerts to hear about a sick call the moment it comes in, and once a day about the rest.")),
      status === "unsupported" ? null : h("button", { class: "btn sm primary", onclick: () => openAlerts(ctx) }, icon("bell"), "Turn on"));
  }
  const mode = requestModeHere();
  return h("div", { class: "setbox", style: { display: "block" } },
    h("div", { class: "name small", style: { marginBottom: "8px" } }, "Alerts on this phone"),
    segmented([["smart", "Smart"], ["sick", "Sick calls"], ["off", "Off"]], mode, async (v) => {
      try { await setRequestMode(v); ctx.render(); } catch (err) { toast(err.message); }
    }),
    h("div", { class: "tiny muted", style: { marginTop: "8px" } }, MODE_TEXT[mode]));
}

function doneBtn(ctx, ids, label = "Done") {
  return h("button", { class: "btn sm", onclick: () => setDone(ctx, ids, true) }, icon("check"), label);
}

function sickRow(ctx, i) {
  const { model, state } = ctx;
  const n = model.dir.resident(i.pid)?.numbers;
  return h("li", { class: "row", style: { alignItems: "flex-start" } },
    avatar(model, i.pid, "sm"),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, model.name(i.pid)), classPill(i.cls)),
      h("div", { class: "sub" }, `${relDay(i.date, state.today)}${i.what ? ` · ${i.what}` : ""}`),
      h("div", { class: "tiny muted" }, `${i.jeopardy.length ? `Jeopardy: ${i.jeopardy.map((id) => model.name(id)).join(", ")} · ` : ""}${ago(i.updatedAt)}`),
      h("div", { class: "numrow" }, n?.length ? callChip(model.dir, "Call", n) : null, doneBtn(ctx, [i.id]))));
}

function swapRow(ctx, i) {
  const { model } = ctx;
  return h("li", { class: "row", style: { alignItems: "flex-start" } },
    avatar(model, i.other, "sm"),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, `${model.person(i.pid)?.last} ↔ ${model.person(i.other)?.last}`), classPill(i.cls),
        i.cancelled ? h("span", { class: "pill", style: { "--c": "var(--gap)" } }, "Cancelled") : null),
      h("div", { class: "sub" }, `${whenShort(i)}: ${model.name(i.other)} takes ${model.person(i.pid)?.last}'s ${lc(i.label)}`),
      i.agreed?.date ? h("div", { class: "sub" }, `${whenShort(i.agreed)}: ${model.name(i.pid)} takes ${model.person(i.other)?.last}'s ${lc(i.agreed.label)}`) : null,
      h("div", { class: "tiny muted" }, i.cancelled ? "They undid it after it was marked done: take it off the call sheet." : `Agreed ${ago(i.updatedAt)}`),
      h("div", { class: "numrow" }, doneBtn(ctx, [i.id], i.cancelled ? "Taken off" : "On the call sheet"))));
}

// Every list for a month, gathered by day: who'd rather not have call, and why.
function noCallCard(ctx, month, items) {
  const { model } = ctx;
  const open = items.filter((i) => !i.done);
  const byDay = {};
  for (const i of items) for (const [date, reason] of Object.entries(i.picks)) (byDay[date] ||= []).push({ pid: i.pid, reason, fresh: !i.done });
  const days = Object.keys(byDay).sort();
  const residents = model.people.filter((p) => ["CA-1", "CA-2", "CA-3"].includes(p.cls)).length;
  const notes = items.filter((i) => i.note);
  const none = items.filter((i) => !Object.keys(i.picks).length);
  return card(`No call · ${fmtMonth(month)}`, h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, `${items.length} of ${residents} residents sent their days${open.length ? `, ${open.length} new` : ""}. New ones are in bold.`),
    days.length ? h("ul", { class: "list flush" }, days.map((date) => h("li", { class: "row", style: { alignItems: "flex-start", minHeight: "44px" } },
      h("div", { class: "timecol", style: { width: "64px" } }, fmtDate(date)),
      h("div", { class: "main small" }, byDay[date].map((x, k) => [k ? ", " : "", h(x.fresh ? "b" : "span", null, model.person(x.pid)?.last), x.reason && x.reason !== "Other" ? h("span", { class: "muted" }, ` (${x.reason.toLowerCase()})`) : null])),
      h("div", { class: "side" }, byDay[date].length)))) : null,
    none.length ? h("p", { class: "tiny muted" }, `No days requested: ${none.map((i) => model.person(i.pid)?.last).join(", ")}.`) : null,
    notes.length ? h("ul", { class: "facts small", style: { marginTop: "8px" } }, notes.map((i) => h("li", { class: "info" }, `${model.person(i.pid)?.last}: "${i.note}"`))) : null,
    open.length ? h("div", { class: "numrow", style: { marginTop: "10px" } }, doneBtn(ctx, open.map((i) => i.id), "Mark as read")) : null));
}

export function renderInbox(ctx) {
  const { model } = ctx;
  loadInbox(ctx);
  const root = h("div");
  root.append(alertSetting(ctx));
  if (!inbox.items) { root.append(h("div", { class: "spinner", style: { margin: "30px auto" } })); return root; }
  const items = inbox.items;
  const open = items.filter((i) => !i.done);
  const sick = open.filter((i) => i.type === "sick").sort((a, b) => a.date.localeCompare(b.date));
  const swaps = open.filter((i) => i.type === "swap").sort((a, b) => a.date.localeCompare(b.date));
  const months = [...new Set(items.filter((i) => i.type === "nocall").map((i) => i.month))].sort();
  const done = items.filter((i) => i.done && i.type !== "nocall");
  if (!sick.length && !swaps.length && !months.length && !done.length) {
    root.append(emptyState("check", "All caught up", "Sick calls, agreed swaps and no-call lists show up here as residents send them."));
    return root;
  }
  append(root, [
    sick.length ? card("Sick calls", h("ul", { class: "list flush" }, sick.map((i) => sickRow(ctx, i)))) : null,
    swaps.length ? card("Swaps for the call sheet", h("ul", { class: "list flush" }, swaps.map((i) => swapRow(ctx, i)))) : null,
    months.map((m) => noCallCard(ctx, m, items.filter((i) => i.type === "nocall" && i.month === m))),
    !sick.length && !swaps.length && !months.some((m) => items.some((i) => i.month === m && !i.done)) ? h("p", { class: "small muted", style: { margin: "0 4px 12px" } }, "Nothing new. Everything here has been handled.") : null,
    done.length ? h("details", { class: "about" }, h("summary", null, `Done (${done.length})`),
      h("ul", { class: "list" }, done.map((i) => h("li", { class: "row", style: { minHeight: "40px" } },
        h("div", { class: "main small" }, i.type === "sick" ? `Sick call: ${model.name(i.pid)}, ${fmtDate(i.date)}` : `Swap: ${model.person(i.pid)?.last} ↔ ${model.person(i.other)?.last}, ${whenShort(i)}`),
        h("button", { class: "btn sm ghost", onclick: () => setDone(ctx, [i.id], false) }, "Undo"))))) : null,
    h("p", { class: "disclaimer" }, `Done is shared by every admin. Items clear themselves once their dates pass, and no-call lists once the month starts. The emails to the schedule inbox still go out as before.`),
  ]);
  return root;
}

// On an admin's Today: only what can't wait. A sick call today or tomorrow, or a swap in the
// next week that isn't on the call sheet yet. No-call lists stay in the inbox.
export function inboxTodayCard(ctx) {
  const { model, state } = ctx;
  if (!local.get("adminKey")) return null;
  loadInbox(ctx);
  const open = (inbox.items || []).filter((i) => !i.done);
  const sick = open.filter((i) => i.type === "sick" && i.date <= addDays(state.today, 1));
  const swaps = open.filter((i) => i.type === "swap" && i.date <= addDays(state.today, 7));
  if (!sick.length && !swaps.length) return null;
  const lines = [
    ...sick.map((i) => `Sick ${relDay(i.date, state.today).toLowerCase()}: ${model.name(i.pid)}${i.what ? ` · ${i.what}` : ""}`),
    swaps.length ? `${swaps.length} ${swaps.length === 1 ? "swap" : "swaps"} this week to put on the call sheet` : null,
  ].filter(Boolean);
  return h("section", { class: "card card-pad reminder" },
    h("div", { class: "avatar", style: { "--c": sick.length ? "var(--gap)" : "var(--accent)" } }, icon(sick.length ? "thermo" : "swap")),
    h("div", { class: "main" },
      h("div", { class: "name" }, "Requests"),
      h("ul", { class: "facts small", style: { margin: "4px 0 0" } }, lines.slice(0, 4).map((t) => h("li", { class: sick.length && t.startsWith("Sick") ? "gap" : "info" }, t))),
      h("div", { class: "btnrow" }, h("button", { class: "btn sm primary", onclick: () => ctx.go("admin/requests") }, "Open requests"))));
}
