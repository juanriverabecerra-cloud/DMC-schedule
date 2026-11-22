// Arrange: each person puts what they look at most first. The tab bar (the first tab opens with
// the app) and the order of Today's cards, some hidden. Kept on this device.
import { h, icon, toast } from "../ui.js";
import { local } from "../api.js";
import { TODAY_SECTIONS, TAB_PAGES, MAX_TABS, tabsFrom, todayLayout, moved } from "../../core/layout.js";

export const savedTabs = () => tabsFrom(local.get("tabs"));

function arrowButtons(label, list, key, save) {
  // Labels say which list, since a page and a Today card can share a name (Tonight).
  const i = list.indexOf(key);
  return h("div", { class: "arrows" },
    h("button", { class: "iconbtn sm", "aria-label": `Move ${label} up`, disabled: i === 0 || null, onclick: (e) => save(moved(list, key, -1), e) }, icon("up")),
    h("button", { class: "iconbtn sm", "aria-label": `Move ${label} down`, disabled: i === list.length - 1 || null, onclick: (e) => save(moved(list, key, 1), e) }, icon("down")));
}

export function renderLayout(ctx) {
  const root = h("div", { class: "arrange" });
  // After a move, keep the finger's button under it (it follows the row it moved).
  const keepFocus = (e) => {
    const label = e?.currentTarget?.getAttribute("aria-label");
    ctx.render();
    if (!label) return;
    requestAnimationFrame(() => {
      const btn = document.querySelector(`.arrange [aria-label="${CSS.escape(label)}"]`);
      // At the top or bottom its own arrow is off: the row's other arrow takes the focus.
      (btn?.disabled ? btn.parentElement.querySelector("button:not(:disabled)") : btn)?.focus({ preventScroll: true });
    });
  };

  // ---- tabs ----
  const tabs = savedTabs();
  const saveTabs = (list, e) => { local.set("tabs", list); keepFocus(e); };
  const spare = Object.keys(TAB_PAGES).filter((k) => !tabs.includes(k));
  root.append(h("section", { class: "card" },
    h("div", { class: "card-pad", style: { paddingBottom: "6px" } },
      h("h3", { class: "card-title" }, "Tabs"),
      h("p", { class: "small muted", style: { margin: 0 } }, "The first one opens when you open the app. More always stays last.")),
    h("ul", { class: "list" }, tabs.map((k, i) => {
      const [label, ic] = TAB_PAGES[k];
      return h("li", { class: "row" },
        h("div", { class: "avatar sm", style: { "--c": "var(--accent)" } }, icon(ic)),
        h("div", { class: "main" }, h("div", { class: "name" }, label), i === 0 ? h("div", { class: "sub" }, "Opens first") : null),
        arrowButtons(`${label} tab`, tabs, k, saveTabs),
        h("button", { class: "iconbtn sm", "aria-label": k === "today" ? "Today stays in the tab bar" : `Remove ${label}`, disabled: k === "today" || tabs.length === 1 || null, onclick: () => saveTabs(tabs.filter((x) => x !== k)) }, icon("x")));
    })),
    spare.length ? h("div", { class: "card-pad", style: { paddingTop: "4px" } },
      h("div", { class: "case-sec-title" }, tabs.length >= MAX_TABS ? `Swap one in (it takes the last tab's place)` : "Add a tab"),
      h("div", { class: "taps" }, spare.map((k) => h("button", { class: "tap", onclick: () => {
        if (tabs.length < MAX_TABS) { saveTabs([...tabs, k]); return; }
        // Full: it takes the place of the last tab that isn't Today.
        const out = [...tabs].reverse().find((x) => x !== "today");
        saveTabs(tabs.map((x) => (x === out ? k : x)));
        toast(`${TAB_PAGES[k][0]} replaced ${TAB_PAGES[out][0]}`);
      } }, icon(tabs.length < MAX_TABS ? "add" : "swap"), TAB_PAGES[k][0])))) : null));

  // ---- Today ----
  const saved = local.get("todayLayout") || {};
  const { order, hidden } = todayLayout(saved);
  const saveToday = (next, e) => { local.set("todayLayout", { order: next.order ?? order, hidden: next.hidden ?? hidden }); keepFocus(e); };
  const byKey = Object.fromEntries(TODAY_SECTIONS.map((s) => [s.key, s]));
  root.append(h("section", { class: "card" },
    h("div", { class: "card-pad", style: { paddingBottom: "6px" } },
      h("h3", { class: "card-title" }, "Today"),
      h("p", { class: "small muted", style: { margin: 0 } }, "Anything waiting on you, like a swap request, always comes first. Cards only show when they have something.")),
    h("ul", { class: "list" }, order.map((k) => {
      const s = byKey[k];
      const off = hidden.includes(k);
      return h("li", { class: `row${off ? " off" : ""}` },
        s.fixed ? h("span", { class: "switch-spacer" }) : h("label", { class: "switch", title: off ? "Hidden" : "Shown" },
          h("input", { type: "checkbox", role: "switch", checked: !off || null, "aria-label": `Show ${s.label}`, onchange: () => saveToday({ hidden: off ? hidden.filter((x) => x !== k) : [...hidden, k] }) }), h("span")),
        h("div", { class: "main" }, h("div", { class: "name" }, s.label), h("div", { class: "sub" }, off ? "Hidden" : s.fixed ? `Always shown · ${s.sub.toLowerCase()}` : s.sub)),
        arrowButtons(`${s.label} card`, order, k, (list, e) => saveToday({ order: list }, e)));
    }))));

  // Only once something has changed; under both columns on a wide screen.
  if (local.get("tabs") || local.get("todayLayout")) {
    root.append(h("div", { class: "arrange-link span-all" },
      h("button", { type: "button", onclick: () => { local.del("tabs"); local.del("todayLayout"); ctx.render(); toast("Back to the original layout"); } }, icon("refresh"), "Reset to the original")));
  }
  return root;
}

