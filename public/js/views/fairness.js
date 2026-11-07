// Admin › Fairness: everyone's workload by class, a grade for how evenly it's shared, who can
// cover when someone's out, and suggested swaps. It advises; people make the decisions.
import { h, card, notice, emptyState, segmented, avatar, classPill, openSheet, toast, contactActions, append } from "../ui.js";
import { api, local } from "../api.js";
import { fmtDate, fmtMonth, monthDates } from "../../core/dates.js";
import {
  WEIGHT_ROWS, DEFAULT_WEIGHTS, NO_CALL_GROUPS, academicMonths, yearRange, fairnessReport, weightsOf, columnCount,
  coverOptions, suggestMoves, serviceCoverage, rotationBalance, insights,
} from "../../core/fairness.js";

const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const WEIGHT_LABEL = Object.fromEntries(WEIGHT_ROWS.map(([k, label]) => [k, label]));
const GRADE_NOTE = { A: "Very even", B: "Mostly even", C: "Noticeably uneven", D: "Uneven", F: "Very uneven", "—": "Not enough data" };

function gradeBadge(grade, big) {
  return h("span", { class: `grade g${grade === "—" ? "x" : grade}${big ? " big" : ""}` }, grade);
}

// One resident's scored shifts, newest first.
function openResident(ctx, r, cls) {
  const { model } = ctx;
  const body = h("div", null,
    h("dl", { class: "kv" },
      h("dt", null, "Points"), h("dd", null, `${num(r.points)} (fair share ${num(Math.round(r.fairShare * 10) / 10)})`),
      h("dt", null, "Balance"), h("dd", null, `${signed(r.balance)} ${r.balance > 0 ? "over" : "under"} fair share`),
      h("dt", null, "Heaviest 14 days"), h("dd", null, r.peakFrom ? `${num(r.peak)} points from ${fmtDate(r.peakFrom)}` : "—"),
      h("dt", null, "Days available"), h("dd", null, `${r.eligible}${r.noCallDays ? ` (plus ${r.noCallDays} on no-call rotations)` : ""}`),
      h("dt", null, "Vacation days"), h("dd", null, String(r.vacation)),
      r.hoursAvg != null ? [h("dt", null, "Hours per week"), h("dd", null, `about ${Math.round(r.hoursAvg)} (highest ${Math.round(r.hoursMax)})`)] : null),
    r.items.length ? h("ul", { class: "list" }, [...r.items].reverse().map((it) => h("li", { class: "row", style: { minHeight: "40px" } },
      h("div", { class: "timecol" }, fmtDate(it.date)),
      h("div", { class: "main small" }, WEIGHT_LABEL[it.key] || it.key),
      h("b", { class: "small" }, `+${num(it.pts)}`)))) : h("p", { class: "muted small" }, "No scored shifts in this period."),
    h("button", { class: "btn block sm", style: { marginTop: "10px" }, onclick: () => ctx.go(`p/${r.pid}`) }, "Open their schedule"));
  openSheet(`${model.name(r.pid)} · ${cls}`, body);
}

// The class table: what everyone has done, colored against the class.
function classTable(ctx, c) {
  const { model } = ctx;
  const cols = c.columns.filter((x) => x.used);
  const cell = (r, col) => {
    const v = columnCount(r, col.keys);
    const off = (v - col.avg) / Math.max(col.avg, col.unit);
    const heat = r.eligible < 14 ? "" : off >= 0.6 ? " hot2" : off >= 0.3 ? " hot1" : off <= -0.6 ? " cool2" : off <= -0.3 ? " cool1" : "";
    return h("td", { class: `n${heat}` }, v || "·");
  };
  return h("div", { class: "scrollx fairscroll" }, h("table", { class: "fair" },
    h("thead", null, h("tr", null,
      h("th", { class: "who" }, "Resident"),
      h("th", null, "Share"), h("th", null, "+/−"), h("th", null, "Pts"),
      cols.map((x) => h("th", { title: `Range ${x.min}–${x.max}` }, x.label)),
      h("th", null, "Wknd"), h("th", null, "h/wk"), h("th", null, "Vac"))),
    h("tbody", null, c.rows.map((r) => h("tr", { onclick: () => openResident(ctx, r, c.cls) },
      h("td", { class: "who" }, model.person(r.pid).last),
      h("td", { class: "n" }, r.load == null ? "—" : `${Math.round(r.load)}%`),
      h("td", { class: `n bal${r.load == null ? "" : r.balance >= 5 ? " over" : r.balance <= -5 ? " under" : ""}` }, r.load == null ? "—" : signed(r.balance)),
      h("td", { class: "n" }, num(r.points)),
      cols.map((col) => cell(r, col)),
      h("td", { class: "n" }, r.weekendDays || "·"),
      h("td", { class: "n" }, r.hoursAvg == null ? "—" : Math.round(r.hoursAvg)),
      h("td", { class: "n" }, r.vacation || "·")))),
    h("tfoot", null, h("tr", null,
      h("td", { class: "who" }, "Evenness"), h("td"), h("td"), h("td"),
      cols.map((x) => h("td", { class: "n" }, gradeBadge(x.grade))),
      h("td"), h("td"), h("td")))));
}

// Someone's out: pick the person and day, get ranked options and the reason for everyone else.
function coverTool(ctx, report) {
  const { model, state } = ctx;
  const residents = model.people.filter((p) => p.cls !== "PGY-1").sort((a, b) => a.cls.localeCompare(b.cls) || a.last.localeCompare(b.last));
  const result = h("div");
  const who = h("select", { class: "input", "aria-label": "Resident who is out", onchange: (e) => { state.coverPid = e.target.value; draw(); } },
    h("option", { value: "" }, "Who's out?"),
    residents.map((p) => h("option", { value: p.id, selected: p.id === state.coverPid }, `${p.last}, ${p.preferred || p.first} (${p.cls})`)));
  const when = h("input", { class: "input", type: "date", "aria-label": "Date", value: state.coverDate || state.today, onchange: (e) => { state.coverDate = e.target.value; draw(); } });
  const others = h("input", { type: "checkbox", checked: !!state.coverAll, onchange: (e) => { state.coverAll = e.target.checked; draw(); } });

  function draw() {
    result.replaceChildren();
    const pid = state.coverPid, date = state.coverDate || state.today;
    if (!pid) return;
    if (!model.hasCall(date)) { result.append(notice("warn", "info", `No call sheet for ${fmtMonth(date.slice(0, 7))} yet.`)); return; }
    const { shift, options, blocked } = coverOptions(model, pid, date, { allClasses: !!state.coverAll, report });
    if (!shift) { result.append(notice("", "info", `${model.name(pid)} isn't scheduled on ${fmtDate(date)} (${model.day(pid, date).label || "off"}).`)); return; }
    append(result, [
      h("p", { class: "small", style: { margin: "10px 0 6px" } }, h("b", null, shift.label), ` · ${fmtDate(date)}${shift.pts ? ` · ${num(shift.pts)} points` : ""}`),
      shift.key === "regular" ? h("p", { class: "tiny muted", style: { marginTop: 0 } }, "A regular day: anyone pulled leaves their own service short, so backups come first.") : null,
      options.length ? h("ul", { class: "list" }, options.slice(0, 8).map((o, i) => h("li", { class: "row contact" },
        h("div", { class: "rank" }, i + 1),
        avatar(model, o.pid, "sm"),
        h("div", { class: "main" },
          h("div", { class: "name" }, model.name(o.pid), o.backup ? h("span", { class: "chip ob" }, "Backup") : null, state.coverAll ? classPill(model.person(o.pid).cls) : null),
          h("div", { class: "sub" }, `${o.load == null ? "No score yet" : `${signed(o.balance)} vs fair share`} · ${o.status || "Off"}${o.projected < 70 ? ` · about ${o.projected} h that week` : ""}`),
          o.cautions.length ? h("div", { class: "tiny", style: { color: "var(--warn)" } }, o.cautions.join("; ")) : null),
        contactActions(model.phone(o.pid))))) : notice("warn", "alert", "Nobody in this class passes the checks. Try other classes below, or check the reasons."),
      blocked.length ? h("details", { class: "about" }, h("summary", null, `Not available (${blocked.length})`),
        h("ul", { class: "list" }, blocked.map((b) => h("li", { class: "row", style: { minHeight: "34px" } },
          h("div", { class: "main small" }, model.person(b.pid).last), h("div", { class: "small muted" }, b.why))))) : null,
    ]);
  }
  draw();
  return card("Someone's out", h("div", null,
    h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Pick who's out and when. Options are ranked: backup first, then fewest warnings, then furthest under fair share for the year."),
    h("div", { class: "grid2" }, who, when),
    h("label", { class: "checkline", style: { margin: "10px 0 0" } }, others, h("span", null, "Include other classes")),
    result));
}

function movesCard(ctx, report) {
  const { model, state } = ctx;
  const moves = suggestMoves(model, state.today, { report });
  if (!moves.length) return card("Suggested swaps", h("p", { class: "small muted", style: { margin: 0 } }, "No upcoming shift can move to someone under their share without a conflict."));
  return card("Suggested swaps", h("ul", { class: "list" }, moves.map((m) => h("li", { class: "row" },
    h("div", { class: "timecol" }, fmtDate(m.date)),
    h("div", { class: "main" },
      h("div", { class: "name" }, m.shift.label),
      h("div", { class: "sub" }, `${model.person(m.from).last} (${signed(m.fromBalance)}) → ${model.person(m.to).last} (${signed(m.toBalance)})`)),
    h("button", { class: "btn sm", onclick: () => { state.coverPid = m.from; state.coverDate = m.date; ctx.render(); window.scrollTo({ top: 0, behavior: "smooth" }); } }, "Check")))), { pad: false });
}

function servicesCard(ctx, month) {
  const { model } = ctx;
  const { services, weekdays } = serviceCoverage(model, month);
  const short = services.filter((s) => s.days.length);
  if (!services.length) return null;
  const range = (dates) => dates.map((d) => d.slice(5).replace("-", "/").replace(/^0/, "")).join(", ");
  return card(`Services · ${fmtMonth(month)}`, h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, `Weekdays a service had fewer residents of a class than assigned (vacation or nights), out of ${weekdays}. Red means nobody of that class was there.`),
    short.length ? h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
      h("thead", null, h("tr", null, h("th", { class: "who" }, "Service"), h("th", null, "Class"), h("th", null, "Assigned"), h("th", null, "Short"), h("th", null, "None"))),
      h("tbody", null, short.map((s) => h("tr", { title: range(s.days) },
        h("td", { class: "who" }, s.group), h("td", { class: "n" }, s.cls), h("td", { class: "n" }, s.assigned), h("td", { class: "n" }, s.days.length),
        h("td", { class: `n${s.zero.length ? " hot2" : ""}` }, s.zero.length || "·")))))) : h("p", { class: "small" }, "Every service kept its assigned residents."),
  ));
}

function rotationsCard(ctx) {
  const list = rotationBalance(ctx.model);
  const any = list.some((c) => c.rows.length);
  return card("Rotation mix · full year", h("div", null,
    any ? h("ul", { class: "list" }, list.flatMap((c) => c.rows.map((r) => h("li", { class: "row", style: { minHeight: "40px" } },
      h("div", { class: "main small" }, `${c.cls}: ${r.group}`), h("div", { class: "small muted" }, `${r.min}–${r.max} months`))))) : null,
    h("p", { class: "small muted", style: { margin: any ? "8px 0 0" : 0 } }, any ? "Only rotations where residents in a class differ by 2 or more months." : "No resident differs from their class by 2 or more months on any rotation.")));
}

function weightsCard(ctx) {
  const { model } = ctx;
  const W = weightsOf(model);
  const draft = { ...W };
  const list = h("ul", { class: "list" }, WEIGHT_ROWS.map(([key, label, , why]) => h("li", { class: "row", style: { minHeight: "52px" } },
    h("div", { class: "main" }, h("div", { class: "name small" }, label), h("div", { class: "tiny muted" }, why)),
    h("input", { class: "input weight", type: "number", min: "0", step: "0.5", value: W[key], "aria-label": `Points for ${label}`, oninput: (e) => { draft[key] = e.target.value; } }))));
  const save = async (weights, msg) => {
    try {
      await api("/api/fairness", { method: "PUT", body: { weights } });
      toast(msg);
      await ctx.reload();
      ctx.render();
    } catch (err) { toast(err.message); }
  };
  return card("Points per shift", h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, "1 point = one late day. Regular days score 0. Change any value and every score updates."),
    list,
    h("div", { class: "btnrow", style: { marginTop: "10px" } },
      h("button", { class: "btn primary", onclick: () => save(draft, "Points saved") }, "Save points"),
      h("button", { class: "btn", onclick: () => save(DEFAULT_WEIGHTS, "Back to the starting points") }, "Reset")),
    h("p", { class: "tiny muted" }, `Time on ${NO_CALL_GROUPS.join(", ")} isn't counted as available for call, since those rotations took none in the months reviewed.`)));
}

export function renderFairness(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const months = academicMonths(model, state.today);
  const loaded = months.filter((m) => m.loaded).map((m) => m.month);
  if (!loaded.length) {
    root.append(emptyState("grid", "No call sheets this year yet", "Upload the monthly call schedules to see how the work is shared."));
    return root;
  }
  const missing = months.filter((m) => !m.loaded).map((m) => fmtMonth(m.month).replace(/ \d+$/, ""));
  const prefs = local.get("fairPrefs", { period: "year", cls: "all" });
  if (prefs.period !== "year" && !loaded.includes(prefs.period)) prefs.period = "year";

  const year = yearRange(model, state.today);
  const yearReport = fairnessReport(model, year);
  const report = prefs.period === "year" ? yearReport : (() => { const d = monthDates(prefs.period); return fairnessReport(model, { from: d[0], to: d[d.length - 1] }); })();
  const setPrefs = (patch) => { local.set("fairPrefs", { ...prefs, ...patch }); ctx.render(); };

  append(root, [
    h("div", { style: { marginBottom: "8px" } }, segmented([["year", "Year"], ...loaded.map((m) => [m, fmtMonth(m).slice(0, 3)])], prefs.period, (v) => setPrefs({ period: v }))),
    missing.length ? notice("warn", "info", `Based on ${loaded.map((m) => fmtMonth(m).replace(/ \d+$/, "")).join(", ")}. ${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} uploaded, so treat these as provisional.`) : null,
  ]);

  // Report card
  root.append(h("section", { class: "card card-pad reportcard" },
    h("div", { class: "rc-main" }, gradeBadge(report.overall, true),
      h("div", null, h("div", { class: "name" }, prefs.period === "year" ? "Fairness so far this year" : `Fairness in ${fmtMonth(prefs.period)}`), h("div", { class: "small muted" }, GRADE_NOTE[report.overall]))),
    h("div", { class: "rc-classes" }, report.classes.map((c) => h("button", { class: `rc-class${prefs.cls === c.cls ? " on" : ""}`, onclick: () => setPrefs({ cls: prefs.cls === c.cls ? "all" : c.cls }) },
      gradeBadge(c.grade), h("div", null, h("b", null, c.cls), h("div", { class: "tiny muted" }, `${c.rate28.toFixed(1)} pts per 4 wks`))))),
    prefs.period !== "year" ? h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "One month always looks lumpy: a single night-float week is most of someone's month. The year grade is the one that counts.") : null));

  const facts = insights(model, yearReport, state.today);
  if (facts.length && prefs.period === "year") {
    root.append(card("What stands out", h("ul", { class: "facts" }, facts.map((f) => h("li", { class: f.level }, f.text)))));
  }

  root.append(coverTool(ctx, yearReport));

  for (const c of report.classes) {
    if (prefs.cls !== "all" && prefs.cls !== c.cls) continue;
    root.append(h("div", { class: "section-title" }, c.cls, h("span", { class: "count" }, GRADE_NOTE[c.grade])), h("section", { class: "card" }, classTable(ctx, c)));
  }
  root.append(h("p", { class: "disclaimer" }, "Share: points compared with a fair share for the days each resident could take call (100% is even). +/−: points over or under that share. Red is above the class, blue below. Tap a resident for every scored shift."));

  root.append(movesCard(ctx, yearReport));
  const svc = servicesCard(ctx, prefs.period === "year" ? loaded[loaded.length - 1] : prefs.period);
  if (svc) root.append(svc);
  root.append(rotationsCard(ctx), weightsCard(ctx));
  return root;
}
