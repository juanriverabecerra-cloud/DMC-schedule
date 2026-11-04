import { h, icon, avatar, classPill, notice } from "../ui.js";
import { local } from "../api.js";
import { CLASS_ORDER } from "../../core/model.js";

export function renderSetup(ctx) {
  const input = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: "Passcode", "aria-label": "Passcode", required: true });
  const err = h("p", { class: "small", style: { color: "var(--gap)", minHeight: "1.2em" } }, ctx.state.error || "");
  const btn = h("button", { class: "btn primary block", type: "submit" }, "Open schedule");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.textContent = "";
      try {
        const res = await fetch("/api/login", { method: "POST", headers: { "x-passcode": input.value.trim() } }).then((r) => r.json());
        if (!res.viewer) { err.textContent = "That passcode didn't work."; return; }
        local.set("passcode", input.value.trim());
        ctx.state.error = null;
        await ctx.reload();
        ctx.go(ctx.state.me ? "today" : "pick");
      } catch {
        err.textContent = "Couldn't reach the server. Check your connection.";
      } finally {
        btn.disabled = false;
      }
    },
  }, h("label", { class: "field" }, h("span", null, "Passcode"), input), err, btn);

  return h("div", { style: { maxWidth: "420px", margin: "6vh auto 0" } },
    h("div", { class: "center", style: { marginBottom: "20px" } },
      h("img", { src: "/icons/icon-192.png", alt: "", width: "72", height: "72", style: { borderRadius: "18px", margin: "0 auto 12px", display: "block" } }),
      h("h2", { style: { margin: "0 0 4px", fontSize: "24px" } }, "DMC Anesthesia Schedule"),
      h("p", { class: "muted", style: { margin: 0 } }, "Rotations, call and today's OR assignments in one place."),
    ),
    h("section", { class: "card card-pad" }, form),
    h("p", { class: "disclaimer center" }, "Ask a co-resident for the passcode."),
  );
}

export function renderPickMe(ctx) {
  const { model } = ctx;
  const list = h("ul", { class: "list" });
  const search = h("input", { class: "input", type: "search", placeholder: "Search your name", "aria-label": "Search", oninput: () => draw() });
  function draw() {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const cls of CLASS_ORDER) {
      const people = model.people.filter((p) => p.cls === cls && (!q || model.name(p.id).toLowerCase().includes(q)));
      if (!people.length) continue;
      list.append(h("li", { class: "daterow" }, cls));
      for (const p of people) {
        list.append(h("li", {
          class: "row tap",
          onclick: () => { ctx.setMe(p.id); ctx.go("today"); },
        }, avatar(model, p.id), h("div", { class: "main" }, h("div", { class: "name" }, h("span", { class: "n" }, model.name(p.id)), classPill(p.cls))), icon("right")));
      }
    }
  }
  draw();
  return h("div", null,
    notice("", "user", "Pick yourself to see your own day first. This stays on this device only; you can still look at anyone's schedule."),
    h("div", { class: "search", style: { marginBottom: "12px" } }, icon("search"), search),
    h("section", { class: "card" }, list),
    h("button", { class: "btn block", onclick: () => { ctx.setMe(null); ctx.go("board"); } }, "Skip — just browse"),
  );
}
