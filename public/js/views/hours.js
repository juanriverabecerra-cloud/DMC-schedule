import { h, icon, card, avatar, classPill, segmented, emptyState, notice, openSheet, toast } from "../ui.js";
import { startOfWeek, addDays, fmtDate, fmtMonth, monthKey, parts } from "../../core/dates.js";
import { hoursReport } from "../../core/hours.js";
import { fmtTime } from "../../core/dates.js";
import { compareLogged, hoursByRotation, mergeEntries, mergeRanges, monthlyHistory, outlook, parseLoggedHours, rangesOf } from "../../core/logged.js";
import { csvToTabs, hoursFileText } from "../../core/hoursfile.js";
import { local } from "../api.js";
import { meStatus } from "../me.js";
import { actualFor, clearLogged, loggedFor, saveLogged, uploadLogged, removeUploaded } from "../logged.js";
import { hoursCard } from "./today.js";

// The login page, not View Hours itself: that page shows an error to anyone not signed in yet.
const SIGN_IN = "https://www.new-innov.com/login/login.aspx";

// Why it matters, in the resident's words: shown wherever hours come in.
export const WHY_HOURS = "Your real hours are useful information for the chiefs: they show who has actually been working more than others, so the calls, shifts and rotations ahead can be divided more fairly. Everything in this app is built for fairness and preventing burnout.";

// New Innovations offers no outside connection, so a resident brings their own View Hours page:
// the Export To Excel file, or a copy and paste. Nobody hands over a password.
// The first day of the academic year a date falls in (July 1).
const entriesWord = (n) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;
const yearStart = (date) => `${date.slice(5) >= "07-01" ? date.slice(0, 4) : Number(date.slice(0, 4)) - 1}-07-01`;

function openImport(ctx, pid) {
  const quiet = "No password is shared. Pick the file or paste the page.";
  const status = h("p", { class: "small muted", style: { margin: "10px 0" } }, quiet);
  const hint = h("p", { class: "small hint-line", hidden: true });
  const save = h("button", { class: "btn primary block", disabled: true }, icon("check"), h("span", null, "Save"));
  const before = loggedFor(pid);
  let parsed = null;
  const say = (text, { warn = false } = {}) => { status.textContent = text; status.classList.toggle("muted", !warn); status.style.color = warn ? "var(--warn)" : ""; };
  const read = (text) => {
    parsed = parseLoggedHours(text);
    const n = parsed.entries.length;
    save.disabled = !n;
    hint.hidden = true;
    if (!String(text).trim()) { say(quiet); return; }
    if (!n) { say("No hours found in that. Use the GridExport file from View Hours › Export To Excel, or copy the whole page, dates included.", { warn: true }); return; }
    const away = n - parsed.entries.filter((e) => !/vacation|holiday/i.test(e.type)).length;
    const found = `${n} ${n === 1 ? "entry" : "entries"}, ${fmtDate(parsed.first, "year")} – ${fmtDate(parsed.last, "year")}, ${parsed.summed.toLocaleString()} h`;
    const check = parsed.total === null ? "." : Math.abs(parsed.total - parsed.summed) < 0.02 ? ". Matches the page's total." : `. The page's total is ${parsed.total.toLocaleString()} h, so some rows may be missing.`;
    say(found + check + (away ? ` ${away} vacation or holiday ${away === 1 ? "entry isn't" : "entries aren't"} counted as work.` : ""), { warn: parsed.total !== null && Math.abs(parsed.total - parsed.summed) >= 0.02 });
    // A few weeks on a first import: the whole residency is one setting away.
    const earliest = before?.entries?.[0]?.date;
    if ((!earliest || earliest > parsed.first) && parsed.first > yearStart(ctx.state.today)) {
      hint.hidden = false;
      hint.textContent = `This file starts ${fmtDate(parsed.first, "year")}. For your whole residency: on View Hours, set From to your first day, tap Update, then Export To Excel again. You can save this one now and add the longer file after.`;
    }
  };
  // Naming the types sends iPhones straight to Files instead of offering the photo library.
  const file = h("input", { type: "file", accept: ".xls,.xlsx,.csv,.html,.htm,.txt", hidden: true, "aria-label": "Choose the exported file" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = ""; // the same file can be picked again after a fix
    if (!f) return;
    say(`Reading ${f.name}…`);
    try {
      const got = await hoursFileText(new Uint8Array(await f.arrayBuffer()));
      if (got.error) { parsed = null; save.disabled = true; hint.hidden = true; say(got.error, { warn: true }); return; }
      read(got.text);
    } catch {
      say("That file couldn't be opened. Export it again from View Hours and pick the new GridExport file.", { warn: true });
    }
  });
  const box = h("textarea", { class: "input", style: { fontSize: "16px", minHeight: "84px" }, placeholder: "Paste the View Hours page here", "aria-label": "Paste the View Hours page" });
  box.addEventListener("input", () => read(csvToTabs(box.value)));
  const close = openSheet("Add my hours", h("div", null,
    h("ol", { class: "steps" },
      // Opened from the Home Screen, links stay in a small browser inside the app.
      h("li", null, `Tap Sign in below and log in to New Innovations.${navigator.standalone ? " Use Safari: tap the compass at the bottom right if it opens inside this app." : ""}`),
      h("li", null, "On the mobile menu, tap Full Site, then Work Hours › View Hours."),
      h("li", null, before ? "Check the dates cover what's new, then tap Update." : h("span", null, h("b", null, "Set From to your first day of residency"), ", then tap Update. The page shows only the last few weeks until you do.")),
      h("li", null, "Zoom in on the bottom right, tap Export To Excel, then Download."),
      h("li", null, "Come back here, tap Choose file and pick the newest GridExport file (Files › Downloads).")),
    h("div", { class: "btnrow", style: { marginBottom: "10px" } },
      h("a", { class: "btn", href: SIGN_IN, target: "_blank", rel: "noopener noreferrer" }, icon("link"), "Sign in"),
      h("button", { class: "btn", onclick: () => file.click() }, icon("upload"), "Choose file")),
    file,
    h("details", { class: "paste" }, h("summary", null, "Or paste the page instead"), box),
    status,
    hint,
    h("p", { class: "whybox" }, WHY_HOURS, " Other residents never see your hours."),
    save));
  save.addEventListener("click", async () => {
    const saved = loggedFor(pid);
    const entries = mergeEntries(saved?.entries, parsed.entries);
    const ranges = mergeRanges(rangesOf(saved?.entries, saved?.ranges), [[parsed.first, parsed.last]]);
    if (!saveLogged(pid, entries, ranges)) { toast("This browser wouldn't save it. Private browsing can block this."); return; }
    save.disabled = true;
    save.lastChild.textContent = "Saving…";
    // Saved here first; the app's copy follows. Offline, it catches up next time the app opens.
    let result = null, problem = "";
    try { result = await uploadLogged(pid, entries, ranges); } catch (err) { problem = err.status && err.status < 500 ? err.message : ""; }
    const now = loggedFor(pid);
    const total = now?.entries.length || entries.length;
    toast(result?.history && total > entries.length ? `Saved. Your earlier hours came back too: ${entriesWord(total)}` : problem ? `Saved on this phone. The app's copy didn't update: ${problem}` : `Saved: ${entriesWord(total)}${result ? "" : ". The app's copy updates when you're back online."}`);
    close();
    ctx.render();
  });
}

function askForHours(ctx, pid) {
  // Added before from another device (Safari, a computer): this one starts empty, but adding the
  // latest file here brings the rest back (logged.js uploadLogged).
  const elsewhere = meStatus(pid)?.elsewhere?.hours || local.get("hoursSync")?.held;
  return card("Your real hours", h("div", null,
    elsewhere ? h("p", { class: "small", style: { margin: "0 0 10px" } }, h("b", null, "Your hours are saved from another device. "), "Add your latest View Hours file here and your whole history comes with it.") : null,
    h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Bring in what you logged in New Innovations: your true 4-week average and a prediction based on how your days actually run. Your real hours are also useful information for the chiefs, to divide calls, shifts and rotations more fairly."),
    h("button", { class: "btn primary block", onclick: () => openImport(ctx, pid) }, icon("upload"), "Add my hours"),
    h("p", { class: "tiny muted", style: { margin: "8px 0 0" } }, "No password needed. Other residents never see your hours.")));
}

const signed = (n) => (n > 0 ? `${n} h more` : `${-n} h less`);

function loggedCard(ctx, pid) {
  const { model, state } = ctx;
  const saved = loggedFor(pid);
  const actual = actualFor(model, pid);
  if (!saved || !actual) return askForHours(ctx, pid); // a file with only vacation days has no hours to show
  const today = state.today;
  const ws = startOfWeek(today);
  const from = addDays(ws, -21), to = addDays(ws, 27);
  const real = hoursReport(model, pid, from, to, { actual });
  const est = hoursReport(model, pid, from, to);
  const view = outlook(real, today, actual);
  const cmp = compareLogged(model, pid, saved.entries);
  const estNow = view.current ? est.weeks.find((w) => w.start === view.current.start)?.avg4 : null;
  const max = Math.max(90, ...real.weeks.map((w) => w.hours));
  const offDays = cmp.offDays.filter((d) => d >= yearStart(state.today));
  const kinds = cmp.rows.filter((r) => r.days >= 2); // one day says little
  const rotations = hoursByRotation(saved.entries);
  const peakPast = hoursReport(model, pid, actual.first, actual.last, { actual }).weeks.reduce((top, w) => (w.avg4 !== null && (!top || w.avg4 > top.avg4) ? w : top), null);
  const history = monthlyHistory(saved.entries, saved.ranges);
  const sync = local.get("hoursSync");
  const days = (month) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();

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
    // Every month on record, not just the weeks around today.
    history.length ? h("details", { class: "paste", style: { marginTop: "10px" } },
      h("summary", null, `Full history (${history.length} month${history.length === 1 ? "" : "s"})`),
      h("ul", { class: "list flush" }, history.map((m) => h("li", { class: "row", style: { minHeight: "48px" } },
        h("div", { class: "main" },
          h("div", { class: "name" }, h("span", { class: "n" }, fmtMonth(m.month))),
          h("div", { class: "sub" }, [
            m.days ? `${m.days} day${m.days === 1 ? "" : "s"} worked` : "Nothing worked",
            m.calls ? `${m.calls} call${m.calls === 1 ? "" : "s"}` : "",
            m.away ? `${m.away} day${m.away === 1 ? "" : "s"} away` : "",
            m.covered < days(m.month) ? `${m.covered} of ${days(m.month)} days in your files` : "",
          ].filter(Boolean).join(" · "))),
        h("div", { class: "side", style: { textAlign: "right", color: "var(--text)" } },
          h("div", { style: { fontWeight: 700 } }, `${m.hours.toLocaleString()} h`),
          m.perWeek != null ? h("div", { class: "tiny muted" }, `${m.perWeek} h/wk`) : null))))) : null,
    peakPast ? h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `Highest 4-week average so far: ${Math.round(peakPast.avg4)} h, ending ${fmtDate(peakPast.end)}.`) : null,
    offDays.length ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, `Logged this year on ${offDays.length === 1 ? "a day" : `${offDays.length} days`} the call sheet shows off: ${offDays.slice(-4).map((d) => fmtDate(d)).join(", ")}.`) : null,
    cmp.conference ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, `${cmp.conference} conference day${cmp.conference === 1 ? " counts" : "s count"} toward your hours but not these averages.`) : null,
    h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, `${entriesWord(saved.entries.length)}, ${fmtDate(actual.first, "year")} – ${fmtDate(actual.last, "year")}${actual.spans.length > 1 ? ` (${actual.spans.length - 1} gap${actual.spans.length === 2 ? "" : "s"} between files, estimated from the schedule)` : ""}. Your official record stays in New Innovations.`),
    // Where the app's copy stands, when it isn't simply up to date.
    sync?.pid === pid && sync.error ? h("p", { class: "tiny", style: { margin: "6px 0 0", color: "var(--warn)" } }, `The app's copy didn't update: ${sync.error}`)
      : sync?.pid === pid && sync.pending ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, "Saved on this phone; the app's copy updates next time you're online.")
        : sync?.pid === pid && sync.held ? h("p", { class: "tiny muted", style: { margin: "6px 0 0" } }, `The app also holds ${entriesWord(sync.held.entries)} added from another device${sync.held.from ? ` (from ${fmtDate(sync.held.from, "year")})` : ""}. Add a file that overlaps a few days you've already added, and they'll show here too.`) : null,
    h("div", { style: { height: "12px" } }),
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
  const weekNav = h("div", { class: "card card-pad", style: { display: "flex", alignItems: "center", padding: "6px" } },
    h("button", { class: "iconbtn", "aria-label": "Previous week", onclick: () => { state.hoursWeek = addDays(ws, -7); ctx.render(); } }, icon("left")),
    h("div", { style: { flex: 1, textAlign: "center", fontWeight: 700 } }, `Week of ${fmtDate(ws)} – ${fmtDate(addDays(ws, 6))}`),
    h("button", { class: "iconbtn", "aria-label": "Next week", onclick: () => { state.hoursWeek = addDays(ws, 7); ctx.render(); } }, icon("right")));
  if (!model.hasCall(ws) && !model.hasCall(addDays(ws, 6))) {
    // The arrows stay, or paging past the last call sheet would be a dead end.
    root.append(weekNav, emptyState("clock", "No call sheet for this week", "Hours are estimated from the monthly call sheet."));
    return root;
  }

  root.append(notice("", "info",
    "The list below is estimated from scheduled shift times, not logged hours. A regular day counts as ",
    h("b", null, `${fmtTime(model.S.dayHours[0])}–${fmtTime(model.S.dayHours[1])}`),
    ", late until 6p, H1 and Friday 24-hr call as 24 h, H2 12 h, NF 6p–6a, 10–7 10p–7a (9 h). Cardiac home call isn't counted. Admins can change these in Settings."));

  if (state.me && model.person(state.me) && model.person(state.me).cls !== "PGY-1") {
    const hc = hoursCard({ ...ctx, state: { ...state, date: ws } }, state.me);
    if (hc) root.append(hc);
    root.append(loggedCard(ctx, state.me));
  }

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
