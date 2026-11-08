// Requests, together in one place: a sick call, swapping a shift with a classmate, and the
// monthly no-call weekend days. Each ends in an email draft to the schedule's inbox.
import { h, icon, card, notice, emptyState, avatar, openSheet, toast, segmented, callChip, smsHref, copyText, append } from "../ui.js";
import { api, local, deviceKey } from "../api.js";
import { addDays, addMonths, fmtDate, fmtMonth, monthKey, nowMinutesLocal } from "../../core/dates.js";
import {
  SCHEDULE_EMAIL, mailto, upcomingShifts, whenShort, when, swapEmail, swapAsk, jeopardyOn, assignmentText, sickText, sickEmail,
  NO_CALL_REASONS, noCallMonth, weekendsOf, noCallEmail, shiftName, lc,
} from "../../core/requests.js";
import { swapCandidates } from "../../core/swap.js";

const CLASSES = ["CA-1", "CA-2", "CA-3"];
const firstName = (model, pid) => model.person(pid)?.preferred || model.person(pid)?.first || model.name(pid);

// ---------- shared pieces ----------

// Text with the message already written, plus a call button. Numbers are never shown.
// `onAct` runs on any of them (a sick call is logged the moment someone reaches out).
function contactPills(model, pid, message, onAct) {
  const r = model.dir.resident(pid);
  const dial = r?.mobile ? model.dir.dial(r.mobile) : null;
  const call = r?.numbers?.length ? callChip(model.dir, "Call", r.numbers) : null;
  call?.addEventListener("click", () => onAct?.());
  return h("div", { class: "numrow" },
    dial ? h("a", { class: "numbtn", href: smsHref(dial, message), onclick: (e) => { e.stopPropagation(); onAct?.(); } }, icon("message"), "Text") : null,
    call,
    h("button", { class: "numbtn copy", type: "button", onclick: (e) => { e.stopPropagation(); copyText(message, "Message"); onAct?.(); } }, icon("copy"), "Copy message"));
}

// Lets the chiefs see it in Admin › Requests too. Once per sick day or month is enough; the
// server ignores repeats for alerts.
const logged = new Set();
function logRequest(body, key) {
  if (logged.has(key)) return;
  logged.add(key);
  api("/api/requests", { method: "POST", body }).catch(() => logged.delete(key));
}

// The draft email: one tap opens it in the mail app, ready to send. `draft` can be a function,
// so what was typed a moment ago is in it.
function emailBlock(draft, { onOpen, label = "Email the schedule" } = {}) {
  const get = () => (typeof draft === "function" ? draft() : draft);
  const { subject, body } = get();
  return h("div", { class: "emailbox" },
    h("a", { class: "btn primary block", href: mailto(subject, body), onclick: (e) => { const d = get(); e.currentTarget.href = mailto(d.subject, d.body); onOpen?.(); } }, icon("mail"), label),
    h("div", { class: "btnrow", style: { marginTop: "8px" } },
      h("button", { class: "btn sm", onclick: () => { const d = get(); copyText(`To: ${SCHEDULE_EMAIL}\nSubject: ${d.subject}\n\n${d.body}`, "Email"); onOpen?.(); } }, icon("copy"), "Copy email")),
    h("details", { class: "paste", style: { marginTop: "8px" } }, h("summary", null, "See the email"),
      h("div", { class: "draft" }, h("div", { class: "tiny muted" }, `To: ${SCHEDULE_EMAIL}`), h("div", { class: "tiny muted" }, `Subject: ${subject}`), h("pre", null, body))));
}

// ---------- the Requests card on More ----------

export function requestsCard(ctx) {
  const me = ctx.state.me && ctx.model.person(ctx.state.me);
  const tile = (ic, title, sub, color, onclick) => h("button", { class: "reqtile", style: { "--c": color }, onclick }, h("span", { class: "ic" }, icon(ic)), h("b", null, title), h("span", null, sub));
  return h("section", { class: "card card-pad" },
    h("h3", { class: "card-title" }, "Requests"),
    h("div", { class: "reqtiles" },
      tile("thermo", "Sick call", "Jeopardy and email", "var(--gap)", () => openSickCall(ctx)),
      tile("swap", "Swap", "Trade a shift", "var(--accent)", () => ctx.go("swaps")),
      tile("calendar", "No call", "Weekend days", "var(--late)", () => ctx.go("nocall"))),
    h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, `Each one ends with an email to ${SCHEDULE_EMAIL}, ready to send.`));
}

// ---------- sick call ----------

export function openSickCall(ctx) {
  const { model, state } = ctx;
  const pid = state.me;
  if (!pid || !model.person(pid)) { toast("Pick yourself under More first"); ctx.go("pick"); return; }
  const body = h("div");
  let date = nowMinutesLocal() >= 18 * 60 ? addDays(state.today, 1) : state.today;
  const draw = () => {
    const d = model.day(pid, date);
    const working = d.status === "work";
    const intern = model.person(pid).cls === "PGY-1";
    const jeopardy = intern ? [] : jeopardyOn(model, date).map((x) => x.pid).filter((id) => id !== pid);
    const others = !intern && shiftName(d) ? swapCandidates(model, pid, date).slice(0, 3) : [];
    const email = sickEmail(model, pid, date, { jeopardy });
    const log = () => logRequest({ type: "sick", pid, date }, `sick|${pid}|${date}`);
    body.replaceChildren();
    append(body, [
      segmented([[state.today, `Today, ${fmtDate(state.today, "md")}`], [addDays(state.today, 1), `Tomorrow, ${fmtDate(addDays(state.today, 1), "md")}`]], date, (v) => { date = v; draw(); }),
      h("p", { class: "small", style: { margin: "12px 0" } }, working ? ["You're on ", h("b", null, assignmentText(d)), ` on ${fmtDate(date, "long")}.`] : `The schedule shows you ${d.label ? d.label.toLowerCase() : "not working"} on ${fmtDate(date, "long")}.`),
      h("h4", { class: "steptitle" }, h("span", null, "1"), intern ? "Tell your team" : "Tell the Jeopardy resident"),
      intern ? h("p", { class: "small muted" }, "Let your off-service team know as you normally would, then send the email below.")
        : jeopardy.length ? h("ul", { class: "list flush" }, jeopardy.map((id) => h("li", { class: "row", style: { alignItems: "flex-start" } },
          avatar(model, id, "sm"),
          h("div", { class: "main" }, h("div", { class: "name" }, model.name(id), h("span", { class: "pill", style: { "--c": "var(--ob)" } }, "Jeopardy")),
            contactPills(model, id, sickText(model, pid, date, state.today, id), log)))))
          : h("p", { class: "small muted" }, `No Jeopardy resident is listed for ${fmtDate(date)}.`),
      others.length ? h("details", { class: "paste", style: { margin: "6px 0 0" } }, h("summary", null, `Classmates who look free (${others.length})`),
        h("ul", { class: "list flush" }, others.map((c) => h("li", { class: "row", style: { alignItems: "flex-start" } },
          avatar(model, c.pid, "sm"),
          h("div", { class: "main" }, h("div", { class: "name" }, model.name(c.pid)), h("div", { class: "sub" }, c.status || "Off"),
            contactPills(model, c.pid, sickText(model, pid, date, state.today, c.pid), log)))))) : null,
      h("h4", { class: "steptitle" }, h("span", null, "2"), "Email the schedule"),
      emailBlock(email, { onOpen: log }),
      h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "Texting, calling or emailing also lets the chiefs know in the app. Feel better."),
    ]);
  };
  draw();
  openSheet("Sick call", body);
}

// ---------- swaps ----------

let swaps = { list: null, at: 0, loading: false, key: "" };
export function loadSwaps(ctx, { force = false } = {}) {
  if (swaps.loading || (!force && swaps.list && Date.now() - swaps.at < 30 * 1000)) return;
  swaps.loading = true;
  api("/api/swaps", { headers: { "x-device-key": deviceKey() } }).then((res) => {
    const key = JSON.stringify(res.swaps);
    const changed = key !== swaps.key;
    swaps = { list: res.swaps, at: Date.now(), loading: false, key };
    const here = location.hash.replace(/^#\/?/, "").split("/")[0];
    if (changed && ["", "today", "swaps"].includes(here)) ctx.render();
  }).catch((err) => {
    const first = !swaps.list;
    swaps = { ...swaps, loading: false, at: Date.now(), list: swaps.list || [], error: err.message };
    if (first && location.hash.startsWith("#/swaps")) ctx.render();
  });
}

async function act(ctx, id, body, done) {
  try {
    await api(`/api/swaps/${id}`, { method: "POST", body: { key: deviceKey(), ...body } });
    if (done) toast(done);
    loadSwaps(ctx, { force: true });
  } catch (err) { toast(err.message); }
}

function agreedBlock(ctx, r) {
  const { model, state } = ctx;
  const other = r.pid === state.me ? r.agreed.pid : r.pid;
  return h("div", { class: "agreed" },
    notice("", "check", h("b", null, `Agreed with ${model.name(other)}. `), r.emailedAt ? `Email drafted ${fmtDate(r.emailedAt.slice(0, 10))}. Send it if you haven't.` : "Send the email so the call sheet gets updated. Add them on CC so the schedule sees you both agree."),
    emailBlock(swapEmail(model, r), { onOpen: () => act(ctx, r.id, { action: "emailed" }) }));
}

function offerRow(ctx, r, o) {
  const { model } = ctx;
  return h("li", { class: "row", style: { alignItems: "flex-start" } },
    avatar(model, o.pid, "sm"),
    h("div", { class: "main" },
      h("div", { class: "name" }, model.name(o.pid)),
      h("div", { class: "sub" }, o.date ? `Trade: you'd take their ${lc(o.label)}, ${whenShort(o)}` : "Will take it"),
      o.note ? h("div", { class: "tiny muted" }, `"${o.note}"`) : null),
    r.mine ? h("button", { class: "btn sm primary", onclick: () => { if (confirm(`Swap with ${model.name(o.pid)}?`)) act(ctx, r.id, { action: "accept", offerPid: o.pid }, "Agreed. Now send the email"); } }, "Accept") : null);
}

function myRequestCard(ctx, r) {
  const { model, state } = ctx;
  const cands = r.status === "open" ? swapCandidates(model, r.pid, r.date).filter((c) => !r.offers.some((o) => o.pid === c.pid)).slice(0, 6) : [];
  return card(`${r.label} · ${whenShort(r)}`, h("div", null,
    r.note ? h("p", { class: "small muted", style: { marginTop: 0 } }, `"${r.note}"`) : null,
    r.status === "agreed" ? agreedBlock(ctx, r) : [
      r.offers.length ? h("ul", { class: "list flush" }, r.offers.map((o) => offerRow(ctx, r, o))) : h("p", { class: "small", style: { marginTop: 0 } }, "No offers yet. Classmates see it under Swaps."),
      cands.length ? h("details", { class: "paste", style: { marginTop: "8px" } }, h("summary", null, `Ask classmates who look free (${cands.length})`),
        h("ul", { class: "list flush" }, cands.map((c) => h("li", { class: "row", style: { alignItems: "flex-start" } },
          avatar(model, c.pid, "sm"),
          h("div", { class: "main" }, h("div", { class: "name" }, model.name(c.pid)), h("div", { class: "sub" }, c.status || "Off"), contactPills(model, c.pid, swapAsk(model, r, c.pid))))))) : null,
    ],
    r.mine ? h("div", { class: "btnrow", style: { marginTop: "10px" } },
      r.status === "agreed" ? h("button", { class: "btn sm", onclick: () => { if (confirm("Undo the agreement and reopen the request?")) act(ctx, r.id, { action: "reopen" }, "Reopened"); } }, "Undo agreement") : null,
      h("button", { class: "btn sm danger", onclick: () => { if (confirm("Cancel this swap request?")) act(ctx, r.id, { action: "cancel" }, "Cancelled"); } }, "Cancel request"))
      : h("p", { class: "tiny muted", style: { margin: "10px 0 0" } }, "Posted from another device: accept or cancel it there."),
    h("p", { class: "tiny muted", style: { margin: "8px 0 0" } }, `Asked ${fmtDate(r.createdAt.slice(0, 10))}${state.me === r.pid ? "" : ` by ${model.name(r.pid)}`}.`)));
}

function theirRow(ctx, r) {
  const { model, state } = ctx;
  const me = state.me;
  const mine = r.offers.find((o) => o.pid === me);
  const free = swapCandidates(model, r.pid, r.date).some((c) => c.pid === me);
  const d = model.day(me, r.date);
  const status = free ? h("span", { class: "pill", style: { "--c": "var(--late)" } }, "You look free") : h("span", { class: "tiny muted" }, `You: ${shiftName(d) || d.label || "no schedule"}`);
  return h("li", { class: "row", style: { alignItems: "flex-start" } },
    avatar(model, r.pid, "sm"),
    h("div", { class: "main" },
      h("div", { class: "name" }, model.name(r.pid)),
      h("div", { class: "sub" }, `${r.label} · ${whenShort(r)}`),
      r.note ? h("div", { class: "tiny muted" }, `"${r.note}"`) : null,
      h("div", { style: { marginTop: "4px" } }, status),
      r.status === "agreed" && r.agreed.pid === me ? agreedBlock(ctx, r) : null),
    r.status === "agreed" ? null : mine
      ? h("div", { class: "side" }, h("div", { class: "tiny" }, mine.date ? "You offered a trade" : "You offered"),
        mine.mine ? h("button", { class: "btn sm", style: { marginTop: "4px" }, onclick: () => act(ctx, r.id, { action: "withdraw", pid: me }, "Offer taken back") }, "Take back") : null)
      : h("button", { class: "btn sm primary", onclick: () => openOffer(ctx, r) }, "I can take it"));
}

function openOffer(ctx, r) {
  const { model, state } = ctx;
  const mine = upcomingShifts(model, state.me, state.today);
  let trade = "";
  const note = h("input", { class: "input", placeholder: "Note (optional)", maxlength: "200", "aria-label": "Note" });
  const select = h("select", { class: "input", "aria-label": "Shift to trade", disabled: true, onchange: (e) => { trade = e.target.value; } },
    mine.map((b) => h("option", { value: b.date }, `${b.label} · ${whenShort(b)}`)));
  const radio = (value, label, checked) => h("label", { class: "checkline" }, h("input", { type: "radio", name: "offer", value, checked, onchange: () => { select.disabled = value !== "trade"; trade = value === "trade" ? select.value : ""; } }), h("span", null, label));
  const send = h("button", { class: "btn primary block" }, icon("check"), h("span", null, "Send offer"));
  const close = openSheet(`${firstName(model, r.pid)}'s ${lc(r.label)}`, h("div", null,
    h("p", { class: "small", style: { marginTop: 0 } }, `${when(r)}.`),
    radio("take", "I'll take it", true),
    mine.length ? radio("trade", "Trade: I take theirs if they take one of mine", false) : null,
    mine.length ? select : null,
    h("div", { style: { margin: "10px 0" } }, note),
    send));
  send.addEventListener("click", async () => {
    send.disabled = true;
    try {
      await api(`/api/swaps/${r.id}`, { method: "POST", body: { key: deviceKey(), action: "offer", pid: state.me, date: trade || null, note: note.value } });
      close();
      toast(`Offer sent. ${firstName(model, r.pid)} sees it under Swaps`);
      loadSwaps(ctx, { force: true });
    } catch (err) { toast(err.message); send.disabled = false; }
  });
}

function openAsk(ctx, preset) {
  const { model, state } = ctx;
  const taken = new Set((swaps.list || []).filter((r) => r.pid === state.me).map((r) => r.date));
  const shifts = upcomingShifts(model, state.me, state.today).filter((b) => !taken.has(b.date));
  if (!shifts.length) { toast("No upcoming call shifts on the uploaded call sheets"); return; }
  let pick = shifts.find((b) => b.date === preset)?.date || shifts[0].date;
  const note = h("input", { class: "input", placeholder: "Note for classmates (optional)", maxlength: "200", "aria-label": "Note" });
  const list = h("ul", { class: "list flush pick" });
  const drawList = () => list.replaceChildren(...shifts.map((b) => h("li", { class: `row tap${b.date === pick ? " on" : ""}`, onclick: () => { pick = b.date; drawList(); } },
    h("span", { class: "radio" }), h("div", { class: "main" }, h("div", { class: "name" }, b.label), h("div", { class: "sub" }, when(b))))));
  drawList();
  const post = h("button", { class: "btn primary block" }, icon("swap"), h("span", null, "Post request"));
  const body = h("div", null, h("p", { class: "small muted", style: { marginTop: 0 } }, "Which shift? Classmates in your class see it under Swaps and can offer to take it or trade."), list, h("div", { style: { margin: "10px 0" } }, note), post);
  const close = openSheet("Ask for a swap", body);
  post.addEventListener("click", async () => {
    post.disabled = true;
    try {
      const res = await api("/api/swaps", { method: "POST", body: { key: deviceKey(), pid: state.me, date: pick, note: note.value } });
      const r = res.swap;
      const cands = swapCandidates(model, state.me, r.date).slice(0, 6);
      body.replaceChildren();
      append(body, [
        notice("", "check", h("b", null, "Posted. "), "Your class sees it under Swaps. Want to ask someone directly too?"),
        cands.length ? h("ul", { class: "list flush" }, cands.map((c) => h("li", { class: "row", style: { alignItems: "flex-start" } },
          avatar(model, c.pid, "sm"),
          h("div", { class: "main" }, h("div", { class: "name" }, model.name(c.pid)), h("div", { class: "sub" }, c.status || "Off"), contactPills(model, c.pid, swapAsk(model, r, c.pid)))))) : h("p", { class: "small muted" }, "Nobody in your class looks clearly free that day."),
        h("button", { class: "btn block", style: { marginTop: "10px" }, onclick: close }, "Done"),
      ]);
      loadSwaps(ctx, { force: true });
    } catch (err) { toast(err.message); post.disabled = false; }
  });
}

export function renderSwaps(ctx, arg) {
  const { model, state } = ctx;
  const me = state.me && model.person(state.me);
  if (!me) return emptyState("swap", "Pick yourself first", "Swaps are tied to your name.", h("button", { class: "btn primary", onclick: () => ctx.go("pick") }, "Pick yourself"));
  if (!CLASSES.includes(me.cls)) return emptyState("swap", "Swaps are for CA-1 to CA-3", "Interns swap through their off-service teams.");
  if (arg?.startsWith("new/")) {
    const date = arg.slice(4);
    history.replaceState(null, "", "#/swaps");
    setTimeout(() => openAsk(ctx, date));
  }
  loadSwaps(ctx);
  const root = h("div");
  root.append(h("button", { class: "btn primary block", style: { marginBottom: "12px" }, onclick: () => openAsk(ctx) }, icon("swap"), "Ask for a swap"));
  if (!swaps.list) { root.append(h("div", { class: "spinner", style: { margin: "30px auto" } })); return root; }
  if (swaps.error && !swaps.list.length) root.append(notice("warn", "info", `Couldn't load swap requests: ${swaps.error}`));
  const mine = swaps.list.filter((r) => r.pid === state.me).sort((a, b) => a.date.localeCompare(b.date));
  const theirs = swaps.list.filter((r) => r.pid !== state.me && r.cls === me.cls && (r.status === "open" || r.agreed?.pid === state.me)).sort((a, b) => a.date.localeCompare(b.date));
  if (mine.length) {
    root.append(h("div", { class: "section-title" }, "Your requests"));
    for (const r of mine) root.append(myRequestCard(ctx, r));
  }
  root.append(h("div", { class: "section-title" }, `${me.cls} requests`, h("span", { class: "count" }, theirs.length || "")));
  root.append(theirs.length ? h("section", { class: "card" }, h("ul", { class: "list" }, theirs.map((r) => theirRow(ctx, r))))
    : h("p", { class: "small muted", style: { margin: "0 4px 12px" } }, "No open requests in your class."));
  root.append(h("p", { class: "disclaimer" }, `Swaps stay within the class. Once you both agree, the app writes the email to ${SCHEDULE_EMAIL} and the chiefs see the swap in the app; the call sheet changes only after that email. "Look free" is from the call sheet: free that day, not around nights or 24-hr call, and under about 80 hours that week.`));
  return root;
}

// On Today: offers waiting on you, an email still to send, or a classmate's shift you could take.
export function swapsTodayCard(ctx) {
  const { model, state } = ctx;
  const me = state.me && model.person(state.me);
  if (!me || !CLASSES.includes(me.cls)) return null;
  loadSwaps(ctx);
  if (!swaps.list) return null;
  const lines = [];
  for (const r of swaps.list) {
    if (r.pid === state.me && r.status === "open" && r.offers.length) lines.push(`${r.offers.length === 1 ? `${firstName(model, r.offers[0].pid)} offered` : `${r.offers.length} offers`} for your ${lc(r.label)}, ${whenShort(r)}`);
    if (r.status === "agreed" && !r.emailedAt && (r.pid === state.me || r.agreed.pid === state.me)) lines.push(`Send the swap email for ${whenShort(r)}`);
    if (r.pid !== state.me && r.cls === me.cls && r.status === "open" && !r.offers.some((o) => o.pid === state.me) && swapCandidates(model, r.pid, r.date).some((c) => c.pid === state.me)) {
      lines.push(`${firstName(model, r.pid)} needs someone for ${lc(r.label)}, ${whenShort(r)}. You look free`);
    }
  }
  if (!lines.length) return null;
  return h("section", { class: "card card-pad reminder" },
    h("div", { class: "avatar", style: { "--c": "var(--accent)" } }, icon("swap")),
    h("div", { class: "main" },
      h("div", { class: "name" }, "Swaps"),
      h("ul", { class: "facts small", style: { margin: "4px 0 0" } }, lines.slice(0, 3).map((t) => h("li", { class: "info" }, t))),
      h("div", { class: "btnrow" }, h("button", { class: "btn sm primary", onclick: () => ctx.go("swaps") }, "Open Swaps"))));
}

// ---------- no-call weekend days ----------

export function renderNoCall(ctx) {
  const { model, state } = ctx;
  const me = state.me && model.person(state.me);
  if (!me) return emptyState("calendar", "Pick yourself first", "The email goes out with your name.", h("button", { class: "btn primary", onclick: () => ctx.go("pick") }, "Pick yourself"));
  const saved = local.get("noCall", {});
  const first = noCallMonth(state.today);
  const months = [first, addMonths(first, 1)];
  const month = months.includes(saved.month) ? saved.month : first;
  const entry = { picks: {}, note: "", ...(saved[month] || {}) };
  let lastReason = saved.lastReason || NO_CALL_REASONS[0];
  const store = () => local.set("noCall", { ...local.get("noCall", {}), month, lastReason, [month]: entry });
  const root = h("div");
  const rerender = () => { store(); ctx.render(); };

  const dayNote = (date) => {
    if (!model.hasCall(date)) return null;
    const d = model.day(me.id, date);
    if (shiftName(d)) return `on ${lc(shiftName(d))}: needs a swap`;
    if (d.status === "vacation") return "vacation";
    return null;
  };
  const weekends = weekendsOf(month);
  const picked = Object.keys(entry.picks).filter((d) => monthKey(d) === month).sort();

  append(root, [
    h("div", { style: { marginBottom: "12px" } }, segmented(months.map((m) => [m, fmtMonth(m)]), month, (v) => { local.set("noCall", { ...local.get("noCall", {}), month: v }); ctx.render(); })),
    h("p", { class: "small muted", style: { margin: "0 4px 10px" } }, "Pick the weekend days you'd prefer not to have call, say why, and send the email. These are preferences; the schedule tries to honor them."),
    h("section", { class: "card" }, h("ul", { class: "list" }, weekends.map((w) => h("li", { class: "row", style: { alignItems: "flex-start" } },
      h("div", { class: "main" },
        h("div", { class: "name small" }, `Weekend of ${fmtDate(w.fri, "md")}`),
        h("div", { class: "daychips" }, w.days.map((date) => {
          const on = !!entry.picks[date];
          const note = dayNote(date);
          return h("button", { type: "button", class: `daychip${on ? " on" : ""}`, "aria-pressed": String(on), title: note || "", onclick: () => {
            if (on) delete entry.picks[date]; else entry.picks[date] = lastReason;
            delete entry.sentAt;
            rerender();
          } }, h("b", null, fmtDate(date).split(" ")[0]), h("span", null, fmtDate(date, "md")), note ? h("i", null, "•") : null);
        })),
        w.days.some((d) => dayNote(d)) ? h("div", { class: "tiny muted", style: { marginTop: "4px" } }, w.days.filter((d) => dayNote(d)).map((d) => `${fmtDate(d)}: ${dayNote(d)}`).join(" · ")) : null))))),
    picked.length ? card("Why", h("ul", { class: "list flush" }, picked.map((date) => h("li", { class: "row", style: { minHeight: "48px" } },
      h("div", { class: "main small" }, fmtDate(date, "long")),
      h("select", { class: "input reason", "aria-label": `Reason for ${fmtDate(date, "long")}`, onchange: (e) => { entry.picks[date] = e.target.value; lastReason = e.target.value; delete entry.sentAt; rerender(); } },
        NO_CALL_REASONS.map((r) => h("option", { value: r, selected: entry.picks[date] === r }, r))))))) : null,
    card("Anything to add", h("textarea", { class: "input", style: { minHeight: "64px", fontSize: "16px" }, placeholder: "Optional, e.g. the wedding is out of state", maxlength: "500", "aria-label": "Note", oninput: (e) => { entry.note = e.target.value; store(); } }, entry.note)),
    picked.length ? null : h("p", { class: "small muted", style: { margin: "0 4px 10px" } }, "No days picked: the email says you have no requests this month."),
    entry.sentAt ? notice("", "check", `Email drafted ${fmtDate(entry.sentAt.slice(0, 10))}. Change anything and send it again.`) : null,
    emailBlock(() => noCallEmail(model, me.id, month, entry.picks, entry.note), { onOpen: () => {
      entry.sentAt = new Date().toISOString();
      store();
      // The chiefs see every list for the month in one place; a changed list replaces the old one.
      logged.delete(`nocall|${month}`);
      logRequest({ type: "nocall", pid: me.id, month, picks: entry.picks, note: entry.note }, `nocall|${month}`);
      setTimeout(() => ctx.render(), 800);
    } }),
    h("p", { class: "tiny muted", style: { margin: "10px 4px 0" } }, "Sending it also puts your days in the chiefs' list for the month in the app."),
  ]);
  return root;
}
