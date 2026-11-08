// The chief's cards in Admin › Fairness: who needs a lighter stretch, how to deal next month's
// call, and the real hours residents added. They advise; the chiefs decide.
import { h, card, avatar, classPill, segmented, openSheet, toast, icon } from "../ui.js";
import { api, local } from "../api.js";
import { fmtDate, fmtMonth, todayLocal } from "../../core/dates.js";
import { burnoutWatch, planMonth, loggedSummary, rotationHours, WATCH } from "../../core/chief.js";
import { hoursReport } from "../../core/hours.js";

const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
const pill = (text, c) => h("span", { class: "pill", style: { "--c": c } }, text);
const owed = (b) => (Math.abs(b) < 0.5 ? "even" : b > 0 ? `${Math.round(b)} over` : `${Math.round(-b)} under`);

// ---- hours residents added (admins only) ----

let shared = { data: null, at: 0, loading: false, error: null };
export const sharedHours = () => shared.data || {};
// The calculations take each resident's entries; the server sends a record around them.
const sharedEntries = () => Object.fromEntries(Object.entries(sharedHours()).map(([pid, rec]) => [pid, rec.entries || []]));
export function loadShared(ctx, { force = false } = {}) {
  if (shared.loading || (!force && shared.data && Date.now() - shared.at < 60 * 1000)) return;
  shared.loading = true;
  api("/api/hours").then((res) => {
    shared = { data: res.people || {}, at: Date.now(), loading: false, error: null };
  }).catch((err) => {
    shared = { ...shared, loading: false, error: err.message, at: Date.now(), data: shared.data || {} };
  }).finally(() => {
    if (location.hash.startsWith("#/admin")) ctx.render();
  });
}
const sharedStatus = () => (shared.data ? null : shared.error ? `Logged hours couldn't load: ${shared.error}` : "Loading logged hours…");

// ---- burnout watch ----

export function watchFor(ctx) {
  return burnoutWatch(ctx.model, ctx.state.today, { shared: sharedEntries() });
}

export function burnoutCard(ctx, watch, openResident) {
  const { model } = ctx;
  const flagged = watch.filter((w) => w.score >= 2);
  const fine = watch.length - flagged.length;
  const body = h("div", null,
    flagged.length ? h("ul", { class: "list flush" }, flagged.map((w) => h("li", { class: "row tap", onclick: () => openResident(w.pid) },
      avatar(model, w.pid, "sm"),
      h("div", { class: "main" },
        h("div", { class: "name" }, h("span", { class: "n" }, model.name(w.pid)), classPill(w.cls)),
        h("div", { class: "sigs" }, w.signals.map((s) => pill(s.text, s.level === "high" ? "var(--gap)" : "var(--warn)"))),
        w.upcoming.length ? h("div", { class: "tiny muted", style: { marginTop: "4px" } }, `Heavy call ahead: ${w.upcoming.map((d) => fmtDate(d)).join(", ")}`) : null),
      h("div", { class: "side" }, h("b", { style: { color: w.score >= 4 ? "var(--gap)" : "var(--warn)", fontSize: "17px" } }, w.score))))) : h("p", { class: "small", style: { margin: 0 } }, "Nobody stands out right now."),
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `${flagged.length ? `${fine} others: nothing stands out. ` : ""}Looks at the last 4 weeks and the next 2. A signal is a 4-week average of ${WATCH.hoursWarn} h or more (logged when the resident added hours, otherwise estimated), ${WATCH.heavyWarn}+ heavy calls (24s and weekend 12s), ${WATCH.weekendsWarn} of the last 4 weekends worked, ${WATCH.offWarn} or fewer days off, ${WATCH.streakWarn}+ days in a row, ${WATCH.loadWarn}× the class's recent points, or any ACGME limit. Red counts double. Tap someone for every scored shift.`),
    sharedStatus() ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, sharedStatus()) : null);
  return card("Burnout watch", body, { right: flagged.length ? `${flagged.length} to look at` : "all clear" });
}

// ---- next month ----

export function planCard(ctx, report, watch) {
  const { model, state } = ctx;
  const plan = planMonth(model, state.today, report, { shared: sharedEntries(), watch });
  if (!plan.classes.length) return null;
  const prefs = local.get("planPrefs", {});
  const cls = plan.classes.some((c) => c.cls === prefs.cls) ? prefs.cls : plan.classes[0].cls;
  const c = plan.classes.find((x) => x.cls === cls);
  const callable = c.rows.filter((r) => r.callable);
  const out = c.rows.filter((r) => !r.callable);
  const label = fmtMonth(plan.month).replace(/ \d+$/, "");
  const row = (r) => h("li", { class: "row", style: { alignItems: "flex-start" } },
    avatar(model, r.pid, "sm"),
    h("div", { class: "main" },
      h("div", { class: "name" }, h("span", { class: "n" }, model.name(r.pid)), r.easy.length ? pill("Go easy", "var(--warn)") : null),
      h("div", { class: "sub" }, `${r.rotation || "No rotation listed"} · ${plan.newYear ? "new year" : owed(r.balance)}`),
      h("div", { class: "small", style: { marginTop: "2px" } }, r.nudge),
      r.due.length || r.plenty.length ? h("div", { class: "sigs" },
        r.due.map((d) => pill(`Due: ${d.label}${d.n > 1 ? ` ×${d.n}` : ""}`, "var(--late)")),
        r.plenty.map((d) => pill(`Plenty: ${d.label}`, "var(--muted)"))) : null,
      r.easy.length ? h("div", { class: "tiny", style: { color: "var(--warn)", marginTop: "4px" } }, r.easy.join("; ")) : null,
      r.logged?.avg4 != null && !r.logged.stale ? h("div", { class: "tiny muted", style: { marginTop: "2px" } }, `Logged: ${Math.round(r.logged.avg4)} h/wk over 4 weeks`) : null),
    h("div", { class: "side" }, h("b", { style: { color: "var(--text)", fontSize: "17px" } }, Math.round(r.target)), h("div", { class: "tiny muted" }, "pts")));
  return card(`Plan ${label}`, h("div", null,
    h("div", { style: { marginBottom: "10px" } }, segmented(plan.classes.map((x) => [x.cls, x.cls]), cls, (v) => { local.set("planPrefs", { cls: v }); ctx.render(); })),
    h("p", { class: "small muted", style: { margin: "0 0 6px" } }, plan.newYear
      ? `Balances start over in July, so everyone who takes call aims for the class average, about ${Math.round(c.perMonth)} points.`
      : `Most under their fair share first. The number is what each could carry in ${label} (class average about ${Math.round(c.perMonth)} points; a late day is 1, a Saturday 24 is 10), closing ${plan.payback === 1 ? "the whole gap" : `a ${plan.payback === 2 ? "half" : "third"} of the gap`} this month.`),
    callable.length ? h("ul", { class: "list flush" }, callable.map(row)) : h("p", { class: "small" }, `Nobody in ${cls} takes call in ${label}.`),
    out.length ? h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `No call in ${label}: ${out.map((r) => `${model.person(r.pid).last} (${r.group || r.rotation})`).join(", ")}. Their balances carry over.`) : null,
    h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, "Due and Plenty compare each kind of shift with the class, for the days each resident could take call. Rotations come from the annual schedule; vacations in the new month aren't known until its call sheet is uploaded.")));
}

// ---- real hours ----

function openShared(ctx, pid, rec, summary) {
  const { model } = ctx;
  const rot = rotationHours({ [pid]: rec.entries });
  const close = openSheet(`${model.name(pid)} · real hours`, h("div", null,
    h("dl", { class: "kv" },
      h("dt", null, "4-week average"), h("dd", null, summary.avg4 == null ? "—" : `${Math.round(summary.avg4)} h/wk (to ${fmtDate(summary.end)})`),
      h("dt", null, "Highest this year"), h("dd", null, summary.peak == null ? "—" : `${Math.round(summary.peak)} h/wk, ending ${fmtDate(summary.peakEnd)}`),
      h("dt", null, "Logged through"), h("dd", null, fmtDate(summary.through)),
      h("dt", null, "First added"), h("dd", null, fmtDate(todayLocal(new Date(rec.sharedAt)))),
      rec.moves?.length ? [h("dt", null, "Moved devices"), h("dd", null, rec.moves.map((m) => fmtDate(todayLocal(new Date(m)))).join(", "))] : null),
    rot.length ? h("ul", { class: "list flush" }, rot.map((r) => h("li", { class: "row", style: { minHeight: "44px" } },
      h("div", { class: "main small" }, r.name), h("b", { class: "small" }, `${Math.round(r.median)} h/wk`)))) : null,
    h("div", { class: "btnrow", style: { marginTop: "12px" } },
      h("button", { class: "btn", onclick: () => { close(); ctx.go(`p/${pid}`); } }, "Open their schedule"),
      h("button", { class: "btn danger", onclick: async () => {
        if (!confirm(`Delete the hours ${model.name(pid)} added? They can add them again from their phone.`)) return;
        try { await api(`/api/hours/${pid}`, { method: "DELETE", body: {} }); toast("Deleted"); close(); loadShared(ctx, { force: true }); } catch (err) { toast(err.message); }
      } }, "Delete their hours"))));
}

export function sharedHoursCard(ctx) {
  const { model, state } = ctx;
  const data = sharedHours();
  const residents = model.people.filter((p) => p.cls !== "PGY-1");
  const rows = residents.filter((p) => data[p.id]).map((p) => {
    const s = loggedSummary(data[p.id].entries, state.today);
    const est = hoursReport(model, p.id, state.today, state.today).weeks.filter((w) => w.avg4 !== null).pop()?.avg4 ?? null;
    return { p, s, est, rec: data[p.id] };
  }).sort((a, b) => (b.s?.avg4 ?? -1) - (a.s?.avg4 ?? -1));
  const missing = residents.filter((p) => !data[p.id]);
  const tone = (v) => (v == null ? "" : v >= WATCH.hoursHigh ? " hot2" : v >= WATCH.hoursWarn ? " hot1" : "");
  const body = h("div", null,
    sharedStatus() ? h("p", { class: "small muted", style: { marginTop: 0 } }, sharedStatus()) : null,
    rows.length ? h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
      h("thead", null, h("tr", null, h("th", { class: "who" }, "Resident"), h("th", null, "Logged"), h("th", null, "Est."), h("th", null, "Peak"), h("th", null, "Through"))),
      h("tbody", null, rows.map(({ p, s, est, rec }) => h("tr", { onclick: () => openShared(ctx, p.id, rec, s) },
        h("td", { class: "who" }, p.last, " ", classPill(p.cls), rec.moves?.length ? h("span", { class: "tiny muted", title: "Added again from another device" }, " ↺") : null),
        h("td", { class: `n${tone(s?.avg4)}` }, s?.avg4 == null ? "—" : Math.round(s.avg4)),
        h("td", { class: "n" }, est == null ? "—" : Math.round(est)),
        h("td", { class: `n${tone(s?.peak)}` }, s?.peak == null ? "—" : Math.round(s.peak)),
        h("td", { class: "n", style: s?.stale ? { color: "var(--warn)" } : null }, s ? fmtDate(s.through) : "—")))))) : (shared.data ? h("p", { class: "small", style: { marginTop: 0 } }, "No resident has added their hours yet. They add them under Duty hours › Add my hours.") : null),
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `Hours a week over the last 4 weeks, logged in New Innovations, against the schedule's estimate. Peak is the highest 4-week average since July. Amber from ${WATCH.hoursWarn} h, red from ${WATCH.hoursHigh}. An amber date means nothing logged in 2 weeks. Tap a row for hours by rotation.`),
    missing.length && shared.data ? h("details", { class: "about" }, h("summary", null, `Not added yet (${missing.length})`),
      h("p", { class: "small muted" }, missing.map((p) => p.last).join(", "))) : null,
    h("button", { class: "btn sm", style: { marginTop: "10px" }, disabled: shared.loading, onclick: () => loadShared(ctx, { force: true }) }, icon("refresh"), "Refresh"));
  return card("Real hours", body, { right: shared.data ? `${rows.length} of ${residents.length} added` : null });
}

export function rotationHoursCard(ctx) {
  const list = rotationHours(sharedEntries()).filter((r) => r.residents >= 1);
  if (!list.length) return null;
  return card("Which rotations run longest", h("div", null,
    h("ul", { class: "list flush" }, list.slice(0, 20).map((r) => h("li", { class: "row", style: { minHeight: "46px" } },
      h("div", { class: "main" }, h("div", { class: "name small" }, h("span", { class: "n" }, r.name)), h("div", { class: "tiny muted" }, `${r.residents} resident${r.residents === 1 ? "" : "s"}${r.residents > 1 ? ` · ${Math.round(r.low)}–${Math.round(r.high)} h` : ""}`)),
      h("b", { class: "small" }, `${Math.round(r.median)} h/wk`)))),
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "From the hours residents added, by the rotation New Innovations lists: the middle resident's hours a week on it. Useful when planning who rotates where next, so the heaviest rotations are spread evenly.")));
}

export { icon, signed };
