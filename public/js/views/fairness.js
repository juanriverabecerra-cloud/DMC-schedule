// Admin › Fairness, laid out for the chiefs: an overview (grades, burnout watch, next month's
// plan), covering someone who's out, the shift tables, real hours, and the settings behind it
// all. It advises; people make the decisions.
import { h, card, notice, emptyState, segmented, avatar, classPill, openSheet, toast, contactActions, append, icon } from "../ui.js";
import { api, local } from "../api.js";
import { fmtDate, fmtMonth, monthDates } from "../../core/dates.js";
import {
  WEIGHT_ROWS, DEFAULT_WEIGHTS, NO_CALL_GROUPS, academicMonths, academicYears, yearLabel, yearRange, yearsSummary, samePointLastYear, fairnessReport, weightsOf, columnCount,
  coverOptions, suggestMoves, serviceCoverage, serviceList, shortOn, limitsReport, rotationBalance, insights,
} from "../../core/fairness.js";
import { SURVEY_ROWS, SCALE, MIN_RATINGS } from "../../core/survey.js";
import { loggedPerWeek } from "../../core/chief.js";
import { burnoutCard, planCard, sharedHoursCard, rotationHoursCard, loadShared, sharedHours, watchFor } from "./chief.js";

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
      h("b", { class: "small" }, `${it.pts > 0 ? "+" : ""}${num(it.pts)}`)))) : h("p", { class: "muted small" }, "No scored shifts in this period."),
    model.person(r.pid).former ? null : h("button", { class: "btn block sm", style: { marginTop: "10px" }, onclick: () => ctx.go(`p/${r.pid}`) }, "Open their schedule"));
  openSheet(`${model.name(r.pid)} · ${cls}`, body);
}

// The class table: what everyone has done, colored against the class.
function classTable(ctx, c, period) {
  const { model } = ctx;
  const cols = c.columns.filter((x) => x.used);
  const shared = sharedHours();
  const real = (pid) => (shared[pid] ? loggedPerWeek(shared[pid].entries, period.from, [period.to, ctx.state.today].sort()[0]) : null);
  const anyReal = c.rows.some((r) => real(r.pid) != null);
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
      h("th", null, "Wknd"), h("th", { title: "Estimated from the schedule" }, "h/wk"), anyReal ? h("th", { title: "Logged in New Innovations, for residents who added their hours" }, "Real") : null, h("th", null, "Vac"))),
    h("tbody", null, c.rows.map((r) => h("tr", { onclick: () => openResident(ctx, r, c.cls) },
      h("td", { class: "who" }, model.person(r.pid).last),
      h("td", { class: "n" }, r.load == null ? "—" : `${Math.round(r.load)}%`),
      h("td", { class: `n bal${r.load == null ? "" : r.balance >= 5 ? " over" : r.balance <= -5 ? " under" : ""}` }, r.load == null ? "—" : signed(r.balance)),
      h("td", { class: "n" }, num(r.points)),
      cols.map((col) => cell(r, col)),
      h("td", { class: "n" }, r.weekendDays || "·"),
      h("td", { class: "n" }, r.hoursAvg == null ? "—" : Math.round(r.hoursAvg)),
      anyReal ? h("td", { class: "n" }, real(r.pid) == null ? "·" : h("b", null, Math.round(real(r.pid)))) : null,
      h("td", { class: "n" }, r.vacation || "·")))),
    h("tfoot", null, h("tr", null,
      h("td", { class: "who" }, "Evenness"), h("td"), h("td"), h("td"),
      cols.map((x) => h("td", { class: "n" }, gradeBadge(x.grade))),
      h("td"), h("td"), anyReal ? h("td") : null, h("td")))));
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
    const jeopardy = blocked.find((b) => b.backup);
    if (!shift) { result.append(notice("", "info", `${model.name(pid)} isn't scheduled on ${fmtDate(date)} (${model.day(pid, date).label || "off"}).`)); return; }
    append(result, [
      h("p", { class: "small", style: { margin: "10px 0 6px" } }, h("b", null, shift.label), ` · ${fmtDate(date)}${shift.pts ? ` · ${num(shift.pts)} points` : ""}`),
      shift.key === "regular" ? h("p", { class: "tiny muted", style: { marginTop: 0 } }, "A regular day: anyone pulled leaves their own service short.") : null,
      jeopardy ? notice("warn", "alert", `Jeopardy (${model.person(jeopardy.pid).last}) can't take this: ${jeopardy.why}.`) : null,
      options.length ? h("ul", { class: "list" }, options.slice(0, 8).map((o, i) => h("li", { class: "row contact" },
        h("div", { class: "rank" }, i + 1),
        avatar(model, o.pid, "sm"),
        h("div", { class: "main" },
          h("div", { class: "name" }, model.name(o.pid), o.backup ? h("span", { class: "chip ob" }, "Jeopardy") : null, o.cls !== model.person(pid).cls ? classPill(o.cls) : null),
          h("div", { class: "sub" }, `${o.load == null ? "No score yet" : `${signed(o.balance)} vs fair share`} · ${o.status || "Off"}${o.projected < 70 ? ` · about ${o.projected} h that week` : ""}`),
          o.cautions.length ? h("div", { class: "tiny", style: { color: "var(--warn)" } }, o.cautions.join("; ")) : null),
        contactActions(model.phone(o.pid))))) : notice("warn", "alert", "Nobody in this class passes the checks. The reasons are below."),
      blocked.length ? h("details", { class: "about" }, h("summary", null, `Not available (${blocked.length})`),
        h("ul", { class: "list" }, blocked.map((b) => h("li", { class: "row", style: { minHeight: "34px" } },
          h("div", { class: "main small" }, model.person(b.pid).last), h("div", { class: "small muted" }, b.why))))) : null,
    ]);
  }
  draw();
  return card("Someone's out", h("div", null,
    h("p", { class: "small muted", style: { margin: "0 0 10px" } }, "Pick who's out and when. Jeopardy always comes first. After that, residents of the same class: fewest warnings, then furthest under fair share for the year. Anyone who would break an ACGME limit is left out."),
    h("div", { class: "grid2" }, who, when),
    h("label", { class: "checkline", style: { margin: "10px 0 0" } }, others, h("span", null, "Show other classes too (exception)")),
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
  const anyMin = services.some((s) => s.min != null);
  if (!services.length) return null;
  const range = (dates) => dates.map((d) => d.slice(5).replace("-", "/").replace(/^0/, "")).join(", ");
  return card(`Services · ${fmtMonth(month)}`, h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, `Weekdays a service had fewer residents of a class than ${anyMin ? "its minimum, or than assigned where no minimum is set" : "assigned (vacation or nights)"}, out of ${weekdays}. Red means nobody of that class was there.`),
    short.length ? h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
      h("thead", null, h("tr", null, h("th", { class: "who" }, "Service"), h("th", null, "Class"), h("th", null, "Assigned"), anyMin ? h("th", null, "Min") : null, h("th", null, "Short"), h("th", null, "None"))),
      h("tbody", null, short.map((s) => h("tr", { title: range(s.days) },
        h("td", { class: "who" }, s.group), h("td", { class: "n" }, s.cls), h("td", { class: "n" }, s.assigned), anyMin ? h("td", { class: "n" }, s.min ?? "·") : null, h("td", { class: "n" }, s.days.length),
        h("td", { class: `n${s.zero.length ? " hot2" : ""}` }, s.zero.length || "·")))))) : h("p", { class: "small" }, "Every service kept its assigned residents."),
  ));
}

function rotationsCard(ctx, ay) {
  const list = rotationBalance(ctx.model, ay);
  const any = list.some((c) => c.rows.length);
  return card(`Rotation mix · ${yearLabel(ay)}`, h("div", null,
    any ? h("ul", { class: "list" }, list.flatMap((c) => c.rows.map((r) => h("li", { class: "row", style: { minHeight: "40px" } },
      h("div", { class: "main small" }, `${c.cls}: ${r.group}`), h("div", { class: "small muted" }, `${r.min}–${r.max} months`))))) : null,
    h("p", { class: "small muted", style: { margin: any ? "8px 0 0" : 0 } }, any ? "Only rotations where residents in a class differ by 2 or more months." : "No resident differs from their class by 2 or more months on any rotation.")));
}

async function saveFairness(ctx, body, msg) {
  try {
    await api("/api/fairness", { method: "PUT", body });
    toast(msg);
    await ctx.reload();
    ctx.render();
  } catch (err) { toast(err.message); }
}

function weightsCard(ctx) {
  const { model } = ctx;
  const W = weightsOf(model);
  const draft = { ...W };
  const list = h("ul", { class: "list" }, WEIGHT_ROWS.map(([key, label, , why]) => h("li", { class: "row", style: { minHeight: "52px" } },
    h("div", { class: "main" }, h("div", { class: "name small" }, label), h("div", { class: "tiny muted" }, why)),
    h("input", { class: "input weight", type: "number", step: "0.5", value: W[key], "aria-label": `Points for ${label}`, oninput: (e) => { draft[key] = e.target.value; } }))));
  return card("Points per shift", h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, "1 point = one late day. Regular days score 0. Below 0 takes load off. Change any value and every score updates."),
    list,
    h("div", { class: "btnrow", style: { marginTop: "10px" } },
      h("button", { class: "btn primary", onclick: () => saveFairness(ctx, { weights: draft }, "Points saved") }, "Save points"),
      h("button", { class: "btn", onclick: () => saveFairness(ctx, { weights: DEFAULT_WEIGHTS }, "Back to the starting points") }, "Reset")),
    h("p", { class: "tiny muted" }, `Time on ${NO_CALL_GROUPS.join(", ")} isn't counted as available for call, since those rotations take none.`)));
}

// What the residents say: their combined ratings beside the current points. An admin decides.
function surveyCard(ctx) {
  const { model } = ctx;
  const W = weightsOf(model);
  const body = h("div", null, h("p", { class: "small muted", style: { margin: 0 } }, "Loading…"));
  api("/api/survey/results").then((res) => {
    const rows = SURVEY_ROWS.filter(([key]) => res.shifts[key]);
    const classes = Object.entries(res.byClass).sort().map(([c, n]) => `${c}: ${n}`).join(", ");
    const adopt = () => {
      if (!confirm(`Replace the points with what ${res.count} residents said? You can change them or reset afterward.`)) return;
      const weights = { ...W };
      for (const [key] of rows) weights[key] = res.shifts[key].median;
      saveFairness(ctx, { weights }, "Points updated from the residents' ratings");
    };
    body.replaceChildren();
    append(body, [
      h("p", { class: "small muted", style: { marginTop: 0 } }, res.count
        ? `${res.count} resident${res.count === 1 ? "" : "s"} rated the shifts (${classes}), with a regular day at 0 and the worst shift imaginable at ${SCALE.max}. Middle answer shown; individual answers are never shown.`
        : "No ratings yet. Residents rate the shifts in More › Rate the shifts, and their combined answers show up here."),
      res.count && !rows.length ? h("p", { class: "tiny muted" }, `A shift's numbers appear once ${MIN_RATINGS} residents have rated it, so nobody's own answer is ever shown.`) : null,
      rows.length ? h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
        h("thead", null, h("tr", null, h("th", { class: "who" }, "Shift"), h("th", null, "Now"), h("th", null, "Residents"), h("th", null, "Range"), h("th", null, "Rated by"))),
        h("tbody", null, rows.map(([key, label]) => {
          const x = res.shifts[key];
          const off = Math.abs(x.median - W[key]) >= 2;
          const byClass = Object.entries(x.classes).map(([c, m]) => `${c} ${num(m)}`).join(" · ");
          return h("tr", { title: byClass },
            h("td", { class: "who" }, label), h("td", { class: "n" }, num(W[key])),
            h("td", { class: `n${off ? " hot1" : ""}` }, num(x.median)), h("td", { class: "n" }, `${num(x.low)} to ${num(x.high)}`), h("td", { class: "n" }, x.n));
        })))) : null,
      rows.length ? h("div", { class: "btnrow", style: { marginTop: "10px" } }, h("button", { class: "btn", disabled: res.count < 5, onclick: adopt }, "Use the residents' numbers")) : null,
      rows.length && res.count < 5 ? h("p", { class: "tiny muted" }, "This turns on at 5 residents, so one person's view can't set the points.") : null,
    ]);
  }).catch(() => body.replaceChildren(h("p", { class: "small muted", style: { margin: 0 } }, "Ratings couldn't be loaded.")));
  return card("What residents say", body);
}

// ACGME limits for the whole program, from the scheduled shifts.
function limitsCard(ctx, period) {
  const { model } = ctx;
  const list = limitsReport(model, period);
  const must = list.filter((x) => x.kind === "must").reduce((s, x) => s + x.items.length, 0);
  const dayH = model.S.dayHours;
  return card("ACGME limits", h("div", null,
    h("p", { class: "small", style: { marginTop: 0 } }, must ? h("b", null, `${must} possible ${must === 1 ? "problem" : "problems"} with a "must" limit in this period.`) : "No problems with a \"must\" limit in this period."),
    h("ul", { class: "list" }, list.map((x) => h("li", { class: "limit" },
      x.items.length
        ? h("details", null,
          h("summary", null, h("span", { class: "main small" }, x.label), h("b", { class: `small ${x.kind === "must" ? "limit-bad" : "muted"}` }, x.items.length)),
          h("ul", { class: "facts" }, x.items.slice(0, 40).map((f) => h("li", { class: f.level }, `${model.person(f.pid).last}: ${f.text}`))))
        : h("div", { class: "limit-ok" }, h("span", { class: "main small" }, x.label), icon("check"))))),
    h("p", { class: "tiny muted", style: { marginBottom: 0 } }, `Estimated from the schedule, counting a regular day as ${dayH[0] / 60}a–${dayH[1] / 60 - 12}p, the outer limit, so real hours are usually lower. Logged duty hours are the official record.`)));
}

// Minimums an admin types in; blank means none has been set.
function minimumsCard(ctx) {
  const { model, state } = ctx;
  const saved = model.fairness?.minimums || {};
  const draft = JSON.parse(JSON.stringify(saved));
  const today = shortOn(model, state.today);
  const input = (group, cls) => h("input", {
    class: "input weight", type: "number", min: "0", step: "1", placeholder: "–", value: saved[group]?.[cls] ?? "", "aria-label": `Minimum ${cls} on ${group}`,
    oninput: (e) => { (draft[group] ||= {})[cls] = e.target.value; },
  });
  return card("Service minimums", h("div", null,
    h("p", { class: "small muted", style: { marginTop: 0 } }, "Type in how many residents of each class a service needs. Leave a box blank if there's no minimum. The services table above and the warning here use these."),
    today.length ? notice("gap", "alert", h("b", null, "Short today: "), today.map((t) => `${t.group} ${t.cls} (${t.have} of ${t.min})`).join(", ")) : null,
    h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
      h("thead", null, h("tr", null, h("th", { class: "who" }, "Service"), ["CA-1", "CA-2", "CA-3"].map((c) => h("th", null, c)))),
      h("tbody", null, serviceList(model).map((g) => h("tr", null, h("td", { class: "who" }, g), ["CA-1", "CA-2", "CA-3"].map((c) => h("td", { class: "n" }, input(g, c)))))))),
    h("button", { class: "btn primary", style: { marginTop: "10px" }, onclick: () => saveFairness(ctx, { minimums: draft }, "Minimums saved") }, "Save minimums")));
}

// Grades year by year, so a change in how call is shared shows up.
function yearsCard(ctx) {
  const rows = yearsSummary(ctx.model, ctx.state.today);
  if (rows.length < 2) return null;
  const atThisPoint = samePointLastYear(ctx.model, ctx.state.today);
  if (atThisPoint) rows.splice(1, 0, atThisPoint);
  return card("Year by year", h("div", { class: "scrollx" }, h("table", { class: "fair plain" },
    h("thead", null, h("tr", null, h("th", { class: "who" }, "Year"), h("th", null, "All"), ["CA-1", "CA-2", "CA-3"].map((c) => h("th", null, c)), h("th", null, "Months"))),
    h("tbody", null, rows.map((y) => h("tr", null,
      h("td", { class: "who" }, y.label), h("td", { class: "n" }, gradeBadge(y.overall)),
      ["CA-1", "CA-2", "CA-3"].map((c) => {
        const x = y.classes.find((k) => k.cls === c);
        return h("td", { class: "n" }, x ? [gradeBadge(x.grade), h("div", { class: "tiny muted" }, x.rate28.toFixed(1))] : "—");
      }),
      h("td", { class: "n" }, y.months)))))), { pad: false });
}

export function renderFairness(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const years = academicYears(model);
  if (!years.length) {
    root.append(emptyState("grid", "No call sheets yet", "Upload the monthly call schedules to see how the work is shared."));
    return root;
  }
  const prefs = { period: "year", cls: "all", ...local.get("fairPrefs", {}) };
  const ay = years.includes(prefs.year) ? prefs.year : years[0];
  const months = academicMonths(model, state.today, ay);
  const loaded = months.filter((m) => m.loaded).map((m) => m.month);
  if (prefs.period !== "year" && !loaded.includes(prefs.period)) prefs.period = "year";
  const missing = months.filter((m) => !m.loaded).map((m) => fmtMonth(m.month).replace(/ \d+$/, ""));
  const setPrefs = (patch) => { local.set("fairPrefs", { ...prefs, year: ay, ...patch }); ctx.render(); };

  const year = yearRange(model, state.today, ay);
  const yearReport = fairnessReport(model, year);
  const monthRange = prefs.period === "year" ? null : (() => { const d = monthDates(prefs.period); return { from: d[0], to: d[d.length - 1] }; })();
  const report = monthRange ? fairnessReport(model, monthRange) : yearReport;
  const live = years[0] === ay ? yearReport : fairnessReport(model, yearRange(model, state.today));
  const dailyDays = Object.keys(model.ds.daily || {}).filter((d) => d >= year.from && d <= year.to).length;
  const pace = years[0] === ay && missing.length === 0 ? samePointLastYear(model, state.today) : null;

  const tabs = [["overview", "Overview"], ["cover", "Cover"], ["shifts", "Shifts"], ["hours", "Hours"], ["setup", "Setup"]];
  const tab = tabs.some(([k]) => k === prefs.tab) ? prefs.tab : "overview";
  loadShared(ctx);
  const byPid = (rep) => new Map(rep.classes.flatMap((c) => c.rows.map((r) => [r.pid, [r, c.cls]])));
  const openByPid = (pid) => {
    const hit = byPid(live).get(pid);
    if (hit) openResident(ctx, hit[0], hit[1]); else ctx.go(`p/${pid}`);
  };

  root.append(h("div", { class: "fairtabs" }, segmented(tabs, tab, (v) => setPrefs({ tab: v }))));
  const periodPicker = () => [
    years.length > 1 ? h("div", { style: { marginBottom: "8px" } }, segmented(years.map((y) => [String(y), yearLabel(y)]), String(ay), (v) => setPrefs({ year: Number(v), period: "year" }))) : null,
    h("select", { class: "input", style: { marginBottom: "8px" }, "aria-label": "Period", onchange: (e) => setPrefs({ period: e.target.value }) },
      h("option", { value: "year", selected: prefs.period === "year" }, `Whole year (${loaded.length} ${loaded.length === 1 ? "month" : "months"})`),
      loaded.map((m) => h("option", { value: m, selected: prefs.period === m }, fmtMonth(m)))),
    missing.length ? notice("warn", "info", `${missing.join(", ")} ${missing.length > 1 ? "aren't" : "isn't"} uploaded, so treat this as provisional.`) : null,
  ];

  const reportCard = () => h("section", { class: "card card-pad reportcard" },
    h("div", { class: "rc-main" }, gradeBadge(report.overall, true),
      h("div", null, h("div", { class: "name" }, prefs.period === "year" ? `Fairness in ${yearLabel(ay)}` : `Fairness in ${fmtMonth(prefs.period)}`), h("div", { class: "small muted" }, GRADE_NOTE[report.overall]))),
    h("div", { class: "rc-classes" }, report.classes.map((c) => h("button", { class: `rc-class${prefs.cls === c.cls ? " on" : ""}`, onclick: () => setPrefs({ cls: prefs.cls === c.cls ? "all" : c.cls, tab: "shifts" }) },
      gradeBadge(c.grade), h("div", null, h("b", null, c.cls), h("div", { class: "tiny muted" }, `${c.rate28.toFixed(1)} pts per 4 wks`))))),
    prefs.period !== "year" ? h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "One month always looks lumpy: a single night-float week is most of someone's month. The year grade is the one that counts.") : null,
    prefs.period === "year" && pace ? h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `Grades climb as a year fills in, because a few weeks of nights look uneven until everyone has had theirs. Last year was at ${pace.overall} at this point and finished at ${pace.final}.`) : null);

  if (tab === "overview") {
    const current = years[0] === ay;
    append(root, [
      periodPicker(),
      reportCard(),
      current ? (() => { const watch = watchFor(ctx); return [burnoutCard(ctx, watch, openByPid), planCard(ctx, live, watch)]; })() : notice("", "info", "Burnout watch and next month's plan are for the current year."),
    ]);
    const facts = insights(model, yearReport, state.today);
    if (facts.length && prefs.period === "year") root.append(card("What stands out", h("ul", { class: "facts" }, facts.map((f) => h("li", { class: f.level }, f.text)))));
    root.append(h("p", { class: "disclaimer" }, "Everything here is a suggestion for the chiefs. The call sheet stays the official schedule."));
  } else if (tab === "cover") {
    root.append(coverTool(ctx, live), movesCard(ctx, live));
  } else if (tab === "shifts") {
    append(root, periodPicker());
    for (const c of report.classes) {
      if (prefs.cls !== "all" && prefs.cls !== c.cls) continue;
      root.append(h("div", { class: "section-title" }, c.cls, h("span", { class: "count" }, GRADE_NOTE[c.grade])), h("section", { class: "card" }, classTable(ctx, c, report)));
    }
    if (prefs.cls !== "all") root.append(h("button", { class: "btn block", style: { marginBottom: "12px" }, onclick: () => setPrefs({ cls: "all" }) }, "Show every class"));
    root.append(h("p", { class: "disclaimer" }, `Share: points compared with a fair share for the days each resident could take call (100% is even). +/−: points over or under that share. Red is above the class, blue below. h/wk is estimated from the schedule; Real is logged, for residents who added their hours. Tap a resident for every scored shift. Balances start over every July. Breaks only count days with a daily sheet: ${dailyDays} this year.`));
    const byYear = yearsCard(ctx);
    if (byYear) root.append(byYear);
    const svc = servicesCard(ctx, prefs.period === "year" ? loaded[loaded.length - 1] : prefs.period);
    if (svc) root.append(svc);
    root.append(rotationsCard(ctx, ay));
  } else if (tab === "hours") {
    append(root, [sharedHoursCard(ctx), rotationHoursCard(ctx), limitsCard(ctx, monthRange || year)]);
  } else {
    root.append(minimumsCard(ctx), surveyCard(ctx), weightsCard(ctx));
  }
  return root;
}
