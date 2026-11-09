// Rate the shifts: each resident says how heavy every shift feels. Every slider starts at 0, a
// normal day, so nobody is nudged toward the current points. A shift only counts once touched,
// so one you haven't done stays out.
import { h, card, notice, toast, append } from "../ui.js";
import { api, local } from "../api.js";
import { SURVEY_ROWS, SCALE } from "../../core/survey.js";

const label = (n) => (n > 0 ? String(n) : n < 0 ? `−${Math.abs(n)}` : "0");

export function renderRate(ctx) {
  const { model, state } = ctx;
  const root = h("div");
  const me = state.me && model.person(state.me);
  if (!me) {
    root.append(notice("warn", "info", "Pick yourself first, so each resident counts once."),
      h("button", { class: "btn primary block", onclick: () => ctx.go("pick") }, "Pick yourself"));
    return root;
  }
  const saved = local.get("shiftRatings", {});
  const scores = { ...(saved.scores || {}) };
  const order = h("ol", { class: "rate-order" });

  function drawOrder() {
    const rated = SURVEY_ROWS.filter(([key]) => scores[key] != null).map(([key, name]) => [name, Number(scores[key])]);
    const all = [...rated, ["Regular OR day", 0]].sort((a, b) => b[1] - a[1]);
    order.replaceChildren(...all.map(([name, n]) => h("li", null, h("span", null, name), h("b", null, label(n)))));
  }

  const rows = SURVEY_ROWS.map(([key, name]) => {
    const value = h("b", { class: "rate-value" }, scores[key] == null ? "–" : label(Number(scores[key])));
    const row = h("li", { class: `rate-row${scores[key] == null ? " unset" : ""}` });
    const mark = (e) => {
      scores[key] = Number(e.target.value);
      value.textContent = label(scores[key]);
      row.classList.remove("unset");
      drawOrder();
    };
    const slider = h("input", {
      type: "range", min: SCALE.min, max: SCALE.max, step: SCALE.step, value: scores[key] ?? 0,
      "aria-label": `How heavy is: ${name}`,
      oninput: mark, onpointerup: mark, // a tap counts, so a shift can be rated as a normal day
    });
    const clear = h("button", { class: "btn sm ghost", onclick: () => {
      delete scores[key];
      value.textContent = "–";
      slider.value = 0;
      row.classList.add("unset");
      drawOrder();
    } }, "Skip");
    append(row, [h("div", { class: "rate-head" }, h("span", { class: "name small" }, name), value), h("div", { class: "rate-control" }, slider, clear)]);
    return row;
  });
  drawOrder();

  const send = h("button", { class: "btn primary block", onclick: async () => {
    if (!Object.keys(scores).length) { toast("Rate at least one shift"); return; }
    send.disabled = true;
    try {
      await api("/api/survey", { method: "PUT", body: { pid: state.me, scores } });
      local.set("shiftRatings", { scores, sentAt: new Date().toISOString() });
      toast("Thanks. Your ratings are in");
      ctx.go("more");
    } catch (err) { toast(err.message); send.disabled = false; }
  } }, saved.sentAt ? "Update my ratings" : "Send my ratings");

  append(root, [
    h("section", { class: "card card-pad" },
      h("p", { class: "small", style: { marginTop: 0 } }, "How heavy does each shift really feel? Think of the whole cost: the hours, the lost weekend, the recovery."),
      h("dl", { class: "kv", style: { margin: 0 } },
        h("dt", null, "Regular OR day"), h("dd", null, "0"),
        h("dt", null, "Worst shift you can imagine"), h("dd", null, String(SCALE.max))),
      h("p", { class: "tiny muted", style: { marginBottom: 0 } }, "Each bar starts at 0, a normal day. Slide it against those two, or tap it to keep 0. Below 0 means easier than a normal day. Leave blank anything you haven't done. Only combined numbers are shown: nobody sees your answers.")),
    h("section", { class: "card" }, h("ul", { class: "list rate-list" }, rows)),
    card("Your order, heaviest first", order),
    send,
  ]);
  return root;
}
