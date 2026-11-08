import { h, icon, card, avatar, classPill, segmented, emptyState, notice, openSheet, toast } from "../ui.js";
import { startOfWeek, addDays, fmtDate, monthKey, parts } from "../../core/dates.js";
import { hoursReport } from "../../core/hours.js";
import { fmtTime } from "../../core/dates.js";
import { compareLogged, hoursByRotation, mergeEntries, outlook, parseLoggedHours } from "../../core/logged.js";
import { actualFor, clearLogged, loggedFor, saveLogged, uploadLogged, removeUploaded } from "../logged.js";
import { hoursCard } from "./today.js";

// The login page, not View Hours itself: that page shows an error to anyone not signed in yet.
const SIGN_IN = "https://www.new-innov.com/login/login.aspx";

// Why it matters, in the resident's words: shown wherever hours come in.
export const WHY_HOURS = "Your real hours are useful information for the chiefs: they show who has actually been working more than others, so the calls, shifts and rotations ahead can be divided more fairly. Everything in this app is built for fairness and preventing burnout.";

// New Innovations offers no outside connection, so a resident brings their own View Hours page:
// the Export To Excel file, or a copy and paste. Nobody hands over a password.
function openImport(ctx, pid) {
  const quiet = "No password is shared. Pick the file or paste the page.";
  const status = h("p", { class: "small muted", style: { margin: "10px 0" } }, quiet);
  const save = h("button", { class: "btn primary block", disabled: true }, icon("check"), h("span", null, "Save"));
  let parsed = null;
  const read = (text) => {
    parsed = parseLoggedHours(text);
    const n = parsed.entries.length;
    save.disabled = !n;
    if (!String(text).trim()) { status.textContent = quiet; return; }
    if (!n) { status.textContent = "No hours found. Use the View Hours export or copy the whole page, dates included."; return; }
    const away = n - parsed.entries.filter((e) => !/vacation|holiday/i.test(e.type)).length;
    const found = `${n} ${n === 1 ? "entry" : "entries"}, ${fmtDate(parsed.first)} – ${fmtDate(parsed.last)}, ${parsed.summed.toLocaleString()} h`;
    const check = parsed.total === null ? "." : parsed.total === parsed.summed ? ". Matches the page's total." : `. The page's total is ${parsed.total.toLocaleString()} h, so some rows may be missing.`;
    status.textContent = found + check + (away ? ` ${away} vacation or holiday ${away === 1 ? "entry isn't" : "entries aren't"} counted as work.` : "");
  };
  // Naming the types sends iPhones straight to Files instead of offering the photo library.
  const file = h("input", { type: "file", accept: ".xls,.html,.htm,.txt", hidden: true, "aria-label": "Choose the exported file" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (f) read(await f.text());
  });
  const box = h("textarea", { class: "input", style: { fontSize: "16px", minHeight: "84px" }, placeholder: "Paste the View Hours page here", "aria-label": "Paste the View Hours page" });
  box.addEventListener("input", () => read(box.value));
  const close = openSheet("Add my hours", h("div", null,
    h("ol", { class: "steps" },
      // Opened from the Home Screen, links stay in a small browser inside the app.
      h("li", null, `Tap Sign in below and log in to New Innovations.${navigator.standalone ? " Use Safari: tap the compass at the bottom right if it opens inside this app." : ""}`),
      h("li", null, "On the mobile menu, tap Full Site, then Work Hours › View Hours."),
      h("li", null, "Zoom in on the bottom right, tap Export To Excel, then Download."),
      h("li", null, "Come back here, tap Choose file and pick the newest GridExport file.")),
    h("p", { class: "tiny muted", style: { margin: "0 0 10px" } }, "First time: set From to your first day and tap Update to bring in your whole residency. After that, the usual four weeks is enough."),
    h("div", { class: "btnrow", style: { marginBottom: "10px" } },
      h("a", { class: "btn", href: SIGN_IN, target: "_blank", rel: "noopener noreferrer" }, icon("link"), "Sign in"),
      h("button", { class: "btn", onclick: () => file.click() }, icon("upload"), "Choose file")),
    file,
    h("details", { class: "paste" }, h("summary", null, "Or paste the page instead"), box),
    status,
    h("p", { class: "whybox" }, WHY_HOURS, " Other residents never see your hours."),
    save));
  save.addEventListener("click", async () => {
    const entries = mergeEntries(loggedFor(pid)?.entries, parsed.entries);
    if (!saveLogged(pid, entries)) { toast("This browser wouldn't save it. Private browsing can block this."); return; }
    save.disabled = true;
    save.lastChild.textContent = "Saving…";
    // Offline or not, the hours are saved here; the app's copy catches up next time it opens.
    await uploadLogged(pid, entries).catch(() => {});
    toast(`Saved: ${entries.length} entries`);
    close();
    ctx.render();
  });
}

function askForHours(ctx, pid) {
  return card("Your real hours", h("div", null,
    h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Bring in what you logged in New Innovations: your true 4-week average and a prediction based on how your days actually run. Your real hours are also useful information for the chiefs, to divide calls, shifts and rotations more fairly."),
    h("button", { class: "btn primary block", onclick: () => openImport(ctx, pid) }, icon("upload"), "Add my hours"),
    h("p", { class: "tiny muted", style: { margin: "8px 0 0" } }, "No password needed. Other residents never see your hours.")));
}

const signed = (n) => (n > 0 ? `${n} h more` : `${-n} h less`);

function loggedCard(ctx, pid) {
  const { model, state } = ctx;
  const saved = loggedFor(pid);
  if (!saved) return askForHours(ctx, pid);
  const actual = actualFor(model, pid);
  const today = state.today;
  const ws = startOfWeek(today);
  const from = addDays(ws, -21), to = addDays(ws, 27);
  const real = hoursReport(model, pid, from, to, { actual });
  const est = hoursReport(model, pid, from, to);
  const view = outlook(real, today, actual);
  const cmp = compareLogged(model, pid, saved.entries);
  const estNow = view.current ? est.weeks.find((w) => w.start === view.current.start)?.avg4 : null;
  const max = Math.max(90, ...real.weeks.map((w) => w.hours));
  const yearStart = `${state.today.slice(5) >= "07-01" ? state.today.slice(0, 4) : Number(state.today.slice(0, 4)) - 1}-07-01`;
  const offDays = cmp.offDays.filter((d) => d >= yearStart);
  const kinds = cmp.rows.filter((r) => r.days >= 2); // one day says little
  const rotations = hoursByRotation(saved.entries);
  const peakPast = hoursReport(model, pid, actual.first, actual.last, { actual }).weeks.reduce((top, w) => (w.avg4 !== null && (!top || w.avg4 > top.avg4) ? w : top), null);

  return card("Your real hours", h("div", null,
    h("div", { class: "stats", style: { marginTop: 0 } },
      h("div", { class: "stat" }, h("b", null, view.current ? Math.round(view.current.avg4) : "—"), h("span", null, view.allLogged ? "4-wk avg, logged" : "4-wk avg so far")),
      h("div", { class: "stat" }, h("b", null, estNow != null ? Math.round(estNow) : "—"), h("span", null, "schedule estimate")),
      h("div", { class: "stat" }, h("b", null, view.peak ? Math.round(view.peak.avg4) : "—"), h("span", null, view.peak ? `peak, wk of ${parts(view.peak.start).m}/${parts(view.peak.start).d}` : "peak ahead"))),
    h("div", { class: "bars", style: { marginTop: "14px" } },
      h("div", { class: "line80", style: { bottom: `${(80 / max) * 0.78 * 120 + 18}px` }, title: "80-hour limit" }),
      real.weeks.map((w) => h("div", { class: `b${w.start > actual.last ? " ahead" : ""}` },
        h("b", null, w.known ? Math.round(w.hours) : "—"),
        h("i", { style: { height: `${w.known ? (w.hours / max) * 78 : 0}%`, background: w.hours > 80 ? "var(--gap)" : w.hours > 70 ? "var(--warn)" : "var(--accent)" } }),
        h("span", null, `${parts(w.start).m}/${parts(w.start).d}`)))),
    h("p", { class: "tiny muted", style: { margin: "6px 0 12px" } }, "Solid bars are logged. Lighter bars are predicted from your own averages once you have three days of that kind."),
    kinds.length ? h("details", { class: "paste", open: true },
      h("summary", null, "Compared with the schedule"),
      h("ul", { class: "list flush" }, kinds.map((r) => h("li", { class: "row", style: { minHeight: "48px" } },
        h("div", { class: "main" },
          h("div", { class: "name" }, h("span", { class: "n" }, r.label)),
          h("div", { class: "sub" }, `${r.days} days${Math.abs(r.diff) >= 0.1 ? `, ${signed(r.diff)} than the schedule` : ", same as the schedule"}`)),
        h("div", { class: "side", style: { fontWeight: 700, color: "var(--text)" } }, `${r.avg} h`))))) : null,
    rotations.length > 1 ? h("details", { class: "paste", style: { marginTop: "10px" } },
      h("summary", null, `Hours by rotation (${rotations.length})`),
      h("ul", { class: "list flush" }, rotations.map((r) => h("li", { class: "row", style: { minHeight: "48px" } },
        h("div", { class: "main" }, h("div", { class: "name" }, h("span", { class: "n" }, r.name)), h("div", { class: "sub" }, `${r.weeks} weeks logged`)),
        h("div", { class: "side", style: { fontWeight: 700, color: "var(--text)" } }, `${r.perWeek} h/wk`))))) : null,
    peakPast ? h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `Highest 4-week average so far: ${Math.round(peakPast.avg4)} h, ending ${fmtDate(peakPast.end)}.`) : null,
    offDays.length ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, `Logged this year on ${offDays.length === 1 ? "a day" : `${offDays.length} days`} the call sheet shows off: ${offDays.slice(-4).map((d) => fmtDate(d)).join(", ")}.`) : null,
    cmp.conference ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, `${cmp.conference} conference day${cmp.conference === 1 ? " counts" : "s count"} toward your hours but not these averages.`) : null,
    h("p", { class: "tiny muted", style: { margin: "6px 0 12px" } }, `Logged through ${fmtDate(actual.last)}. Your official record stays in New Innovations.`),
    h("div", { class: "btnrow" },
      h("button", { class: "btn", onclick: () => openImport(ctx, pid) }, icon("refresh"), "Update"),
      h("button", { class: "btn", onclick: async () => {
        if (!confirm("Remove your logged hours from the app?")) return;
        clearLogged();
        await removeUploaded(pid).catch((err) => toast(err.message));
        ctx.render();
      } }, icon("x"), "Remove"))),
  );
}

export function renderHours(ctx, arg) {
  const { model, state } = ctx;
  // The reminder links straight to the import. Clearing the link keeps it from reopening.
  if (arg === "add" && state.me) {
    history.replaceState(null, "", "#/hours");
    setTimeout(() => openImport(ctx, state.me));
  }
  const root = h("div");
  const ws = startOfWeek(state.hoursWeek || state.date);
  if (!model.hasCall(ws) && !model.hasCall(addDays(ws, 6))) {
    return emptyState("clock", "No call sheet for this week", "Hours are estimated from the monthly call sheet.");
  }

  root.append(notice("", "info",
    "The list below is estimated from scheduled shift times, not logged hours. A regular day counts as ",
    h("b", null, `${fmtTime(model.S.dayHours[0])}–${fmtTime(model.S.dayHours[1])}`),
    ", late until 6p, H1 and Friday 24-hr call as 24 h, H2 12 h, NF 6p–6a, 10–7 9 h. Cardiac home call isn't counted. Admins can change these in Settings."));

  if (state.me && model.person(state.me) && model.person(state.me).cls !== "PGY-1") {
    const hc = hoursCard({ ...ctx, state: { ...state, date: ws } }, state.me);
    if (hc) root.append(hc);
    root.append(loggedCard(ctx, state.me));
  }

  const weekNav = h("div", { class: "card card-pad", style: { display: "flex", alignItems: "center", padding: "6px" } },
    h("button", { class: "iconbtn", "aria-label": "Previous week", onclick: () => { state.hoursWeek = addDays(ws, -7); ctx.render(); } }, icon("left")),
    h("div", { style: { flex: 1, textAlign: "center", fontWeight: 700 } }, `Week of ${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`),
    h("button", { class: "iconbtn", "aria-label": "Next week", onclick: () => { state.hoursWeek = addDays(ws, 7); ctx.render(); } }, icon("right")));
  root.append(weekNav);

  const sortBy = state.hoursSort || "hours";
  const rows = model.people.filter((p) => p.cls !== "PGY-1").map((p) => {
    const rep = hoursReport(model, p.id, ws, addDays(ws, 6));
    const w = rep.weeks.find((x) => x.start === ws);
    return { p, w, flags: rep.flags.filter((f) => f.level !== "info") };
  }).filter((r) => r.w && r.w.known);
  rows.sort((a, b) => (sortBy === "name" ? a.p.last.localeCompare(b.p.last) : sortBy === "avg" ? (b.w.avg4 ?? -1) - (a.w.avg4 ?? -1) : b.w.hours - a.w.hours));

  root.append(h("div", { style: { margin: "4px 0 10px" } }, segmented([["hours", "This week"], ["avg", "4-wk avg"], ["name", "Name"]], sortBy, (v) => { state.hoursSort = v; ctx.render(); })));
  root.append(h("section", { class: "card" }, h("ul", { class: "list" }, rows.map(({ p, w, flags }) => {
    const pct = Math.min(100, (w.hours / 90) * 100);
    const color = w.hours > 80 ? "var(--gap)" : w.hours > 70 ? "var(--warn)" : "var(--accent)";
    return h("li", { class: "row tap", onclick: () => ctx.go(`p/${p.id}`) },
      avatar(model, p.id),
      h("div", { class: "main" },
        h("div", { class: "name" }, h("span", { class: "n" }, model.name(p.id)), classPill(p.cls), flags.length ? h("span", { class: "chip gap", style: { height: "20px", padding: "0 6px" } }, icon("alert"), flags.length) : null),
        h("div", { class: "meter", style: { marginTop: "6px" } }, h("i", { style: { width: `${pct}%`, background: color } }), h("span", { class: "limit", style: { left: `${(80 / 90) * 100}%` } })),
        h("div", { class: "tiny muted", style: { marginTop: "4px" } }, `${w.daysOff} day${w.daysOff === 1 ? "" : "s"} off${w.avg4 !== null ? ` · 4-wk avg ${Math.round(w.avg4)} h` : ""}${flags.length ? ` · ${flags[0].text}` : ""}`)),
      h("div", { class: "side", style: { fontWeight: 750, fontSize: "17px", color: "var(--text)" } }, Math.round(w.hours), h("span", { class: "tiny muted" }, " h")));
  }))));
  root.append(h("p", { class: "disclaimer" }, `Weeks run Sunday–Saturday like the call sheet. ${monthKey(ws) !== monthKey(addDays(ws, 6)) ? "This week spans two months; both call sheets are needed for a full count." : ""}`));
  return root;
}

export { card };
