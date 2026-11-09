// More › Days off: your golden weekends, and the days you and your friends are all off.
import { h, icon, card, avatar, classPill, emptyState, notice, openSheet } from "../ui.js";
import { local } from "../api.js";
import { DOW_SHORT, diffDays, dow, fmtDate, fmtMonth, monthDates, monthKey } from "../../core/dates.js";
import { goldenSummary, sharedOff } from "../../core/daysoff.js";
import { windowLabel } from "../../core/exams.js";

const CLASSES = ["CA-3", "CA-2", "CA-1"];
export const inDays = (n) => (n <= 0 ? "this weekend" : n === 1 ? "tomorrow" : `in ${n} days`);

export const weekendLabel = (w) => windowLabel(w.sat, w.sun).replace(/, \d{4}$/, "");

function goldenCard(ctx, s) {
  const { state } = ctx;
  const next = s.next;
  return card("Golden weekends", h("div", null,
    next
      ? h("div", { class: "bignum" }, weekendLabel(next), h("small", null, inDays(diffDays(state.today, next.sat))))
      : h("p", { class: "small", style: { marginTop: 0 } }, `No golden weekend on the call sheets through ${fmtDate(s.through)}.`),
    h("div", { class: "stats" },
      h("div", { class: "stat" }, h("b", null, s.past), h("span", null, "so far this year")),
      h("div", { class: "stat" }, h("b", null, s.ahead), h("span", null, "still ahead"))),
    s.upcoming.length ? h("ul", { class: "list flush", style: { marginTop: "8px" } }, s.upcoming.slice(0, 8).map((w) => h("li", { class: "row tap", style: { minHeight: "48px" }, onclick: () => { ctx.setDate(w.sat); ctx.go("today"); } },
      h("div", { class: "main" },
        h("div", { class: "name small" }, h("span", { class: "n" }, weekendLabel(w))),
        w.why.length ? h("div", { class: "sub" }, w.why.join(" · ")) : null),
      w.golden ? h("span", { class: "chip late" }, w.vacation ? "Vacation" : w.long ? "Long weekend" : "Golden") : null))) : null,
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `Saturday and Sunday both free: no call, not post-call, no night float, no cardiac home call. Through ${fmtMonth(monthKey(s.through))}, the latest call sheet.`)));
}

function friendsOf(ctx) {
  const { model, state } = ctx;
  return (local.get("offFriends", []) || []).filter((id) => id !== state.me && model.people.some((p) => p.id === id && CLASSES.includes(p.cls)));
}

function openPicker(ctx, onChange) {
  const { model, state } = ctx;
  const mine = model.person(state.me).cls;
  const order = [mine, ...CLASSES.filter((c) => c !== mine)]; // your own class first
  const list = h("ul", { class: "list flush pick" });
  const search = h("input", { class: "input", type: "search", placeholder: "Search a name", "aria-label": "Search a name", style: { marginBottom: "8px" } });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const chosen = friendsOf(ctx);
    list.replaceChildren(...order.flatMap((cls) => model.people
      .filter((p) => p.cls === cls && p.id !== state.me && (!q || model.name(p.id).toLowerCase().includes(q)))
      .map((p) => h("li", { class: `row tap${chosen.includes(p.id) ? " on" : ""}`, onclick: () => {
        local.set("offFriends", chosen.includes(p.id) ? chosen.filter((x) => x !== p.id) : [...chosen, p.id]);
        draw();
        onChange();
      } }, h("span", { class: "radio" }), h("div", { class: "main" }, h("div", { class: "name" }, h("span", { class: "n" }, model.name(p.id)), classPill(p.cls)))))));
  };
  search.addEventListener("input", draw);
  draw();
  openSheet("Who's coming?", h("div", null, search, list));
}

function runLabel(r) {
  if (r.from === r.to) return `${DOW_SHORT[dow(r.from)]}, ${windowLabel(r.from, r.to).replace(/, \d{4}$/, "")}`;
  return `${DOW_SHORT[dow(r.from)]}–${DOW_SHORT[dow(r.to)]}, ${windowLabel(r.from, r.to).replace(/, \d{4}$/, "")}`;
}

function sharedCard(ctx, through) {
  const { model, state } = ctx;
  const holder = h("div");
  const draw = () => {
    const friends = friendsOf(ctx);
    const chips = h("div", { class: "numrow", style: { marginTop: 0 } }, friends.map((id) => h("button", { class: "numbtn copy", type: "button", "aria-label": `Remove ${model.name(id)}`, onclick: () => { local.set("offFriends", friends.filter((x) => x !== id)); draw(); } }, avatar(model, id, "sm"), model.person(id).last, icon("x"))),
      h("button", { class: "numbtn", type: "button", onclick: () => openPicker(ctx, draw) }, icon("user"), friends.length ? "Add" : "Pick people"));
    holder.replaceChildren(chips);
    if (!friends.length) {
      holder.append(h("p", { class: "small muted", style: { margin: "10px 0 0" } }, "Pick who you'd like to see, and the app finds the days you're all off."));
      return;
    }
    const { runs, almost } = sharedOff(model, [state.me, ...friends], state.today, through);
    holder.append(runs.length
      ? h("ul", { class: "list flush", style: { marginTop: "8px" } }, runs.slice(0, 12).map((r) => h("li", { class: "row", style: { minHeight: "48px" } },
        h("div", { class: "main" },
          h("div", { class: "name small" }, h("span", { class: "n" }, runLabel(r))),
          r.away.length ? h("div", { class: "sub" }, `${r.away.map((id) => (id === state.me ? "You're" : `${model.person(id).last} is`)).join(", ")} on vacation`) : null),
        r.wholeWeekend ? h("span", { class: "chip late" }, "Whole weekend") : null)))
      : h("p", { class: "small", style: { margin: "10px 0 0" } }, `No day everyone's off through ${fmtDate(through)}.`));
    if (almost.length) {
      holder.append(h("details", { class: "paste", style: { marginTop: "8px" } }, h("summary", null, `Only one person can't make it (${almost.length})`),
        h("ul", { class: "list flush" }, almost.slice(0, 12).map((a) => h("li", { class: "row", style: { minHeight: "44px" } },
          h("div", { class: "main small" }, fmtDate(a.date)),
          h("div", { class: "side" }, `${a.pid === state.me ? "You" : model.person(a.pid).last}: ${a.why}`))))));
    }
  };
  draw();
  return card("Off together", h("div", null, holder,
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "Your picks stay on this phone. Swaps that aren't on the call sheet yet don't show here.")));
}

export function renderDaysOff(ctx) {
  const { model, state } = ctx;
  const me = state.me && model.person(state.me);
  if (!me) return emptyState("calendar", "Pick yourself first", "Days off are worked out from your own schedule.", h("button", { class: "btn primary", onclick: () => ctx.go("pick") }, "Pick yourself"));
  if (!CLASSES.includes(me.cls)) return emptyState("calendar", "For CA-1 to CA-3", "Intern schedules come in weekly blocks, so the call sheet doesn't show their days off.");
  const s = goldenSummary(model, state.me, state.today);
  if (!s.through || monthDates(monthKey(s.through)).pop() < state.today) {
    const root = h("div");
    root.append(notice("warn", "info", "This month's call sheet isn't uploaded yet, so there's nothing to work out."));
    return root;
  }
  const root = h("div");
  root.append(goldenCard(ctx, s), sharedCard(ctx, s.through));
  return root;
}
