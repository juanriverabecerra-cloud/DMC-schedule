// More › Exams: each resident's own countdowns. Which ABA exam someone is taking stays on their
// phone: a CA-2 sitting BASIC again shouldn't be visible to the rest of the program.
import { h, card, emptyState, segmented, append } from "../ui.js";
import { local } from "../api.js";
import { diffDays, fmtDate, range } from "../../core/dates.js";
import { EXAMS, TRACKS, examsFor, expectedSession, openSessions } from "../../core/exams.js";
import { goldenSummary } from "../../core/daysoff.js";
import { inDays, weekendLabel } from "./daysoff.js";

const KEY = "examPlan";
export const examsNow = (ctx) => examsFor(ctx.model, ctx.state.me, local.get(KEY), ctx.state.today);
export const countdownWord = (e) => (e.days <= 0 ? (e.day ? "today" : "this week") : `${e.days} ${e.days === 1 ? "day" : "days"}`);
const whenLine = (e) => (e.day ? `${fmtDate(e.day, "year")}${e.source === "sheet" ? ", from the call sheet" : ""}` : e.window);

function examCard(e) {
  return h("section", { class: "card card-pad" },
    h("h3", { class: "card-title" }, e.long, e.kind === "ite" ? null : h("span", { class: "right muted" }, e.session.label)),
    h("div", { class: "bignum" }, e.days <= 0 ? (e.day ? "Today" : "This week") : e.days, e.days > 0 ? h("small", null, e.days === 1 ? "day" : "days") : null),
    h("div", { class: "small", style: { marginTop: "4px" } }, whenLine(e)),
    e.kind === "ite" && !e.day ? h("div", { class: "tiny muted" }, "The program picks the day in this window. It shows here once it's on the call sheet.") : null,
    e.kind !== "ite" && !e.day ? h("div", { class: "tiny muted" }, "The ABA assigns one of these days after you register.") : null,
    e.registration ? h("div", { class: "small", style: { marginTop: "6px", fontWeight: 600 } }, e.registration) : null,
    e.notes.length ? h("ul", { class: "facts small", style: { marginTop: "8px" } }, e.notes.map((n) => h("li", { class: n.level }, n.text))) : null);
}

function planCard(ctx, track, current) {
  const { state } = ctx;
  const save = (patch) => { local.set(KEY, { ...(local.get(KEY)?.pid === state.me ? local.get(KEY) : {}), pid: state.me, track, ...patch }); ctx.render(); };
  const sessions = track === "none" ? [] : openSessions(track, state.today);
  const session = current?.session || (track === "none" ? null : expectedSession(track, state.today));
  const days = session ? range(session.from, session.to) : [];
  return card("Your ABA exam", h("div", null,
    segmented(TRACKS, track, (v) => save({ track: v, kind: v, session: null, day: null })),
    sessions.length ? h("select", { class: "input", style: { marginTop: "10px" }, "aria-label": "Exam session", onchange: (e) => save({ kind: track, session: e.target.value, day: null }) },
      sessions.map((s) => h("option", { value: s.id, selected: s.id === session?.id }, s.label))) : null,
    days.length ? h("div", { style: { marginTop: "10px" } }, segmented([["", "Not assigned"], ...days.map((d) => [d, fmtDate(d)])], current?.source === "you" ? current.day : "", (v) => save({ kind: track, session: session.id, day: v || null }))) : null,
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "This stays on your phone. Nobody else sees which exam you're taking.")));
}

export function renderExams(ctx) {
  const { model, state } = ctx;
  const me = state.me && model.person(state.me);
  if (!me) return emptyState("book", "Pick yourself first", "Countdowns are specific to you.", h("button", { class: "btn primary", onclick: () => ctx.go("pick") }, "Pick yourself"));
  const { track, exams } = examsNow(ctx);
  const root = h("div");
  append(root, [
    exams.map(examCard),
    me.cls === "PGY-1" ? null : planCard(ctx, track, exams.find((e) => e.kind === track)),
    h("p", { class: "disclaimer" }, `Dates are from the American Board of Anesthesiology. Sessions listed through ${Math.max(...Object.values(EXAMS).flatMap((x) => x.sessions.map((s) => Number(s.to.slice(0, 4)))))}.`),
  ]);
  return root;
}

// On Today: the next exam and the next golden weekend, one line each.
export function aheadCard(ctx, pid) {
  const { model, state } = ctx;
  const exam = examsNow(ctx).exams[0];
  const eligible = ["CA-1", "CA-2", "CA-3"].includes(model.person(pid)?.cls);
  const golden = eligible ? goldenSummary(model, pid, state.today).next : null;
  if (!exam && !golden) return null;
  const line = (text, value, to) => h("li", { class: "row tap", style: { minHeight: "44px" }, onclick: () => ctx.go(to) },
    h("div", { class: "main small" }, text), h("b", { class: "small" }, value));
  return card("Looking ahead", h("ul", { class: "list flush" },
    exam ? line(exam.long, countdownWord(exam), "exams") : null,
    golden ? line(`Golden weekend, ${weekendLabel(golden)}`, inDays(diffDays(state.today, golden.sat)), "off") : null));
}
