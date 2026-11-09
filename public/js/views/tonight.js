import { h, personRow, emptyState, notice, append, numberButtons, callChip } from "../ui.js";
import { fmtDate, addDays, dow } from "../../core/dates.js";
import { headline } from "../../core/model.js";

function group(ctx, title, timeLabel, cls, list, sub) {
  if (!list.length) return null;
  return h("section", { class: "card" },
    h("div", { class: "card-pad", style: { paddingBottom: "4px" } },
      h("h3", { class: "card-title" }, h("span", { class: `chip ${cls}` }, title), h("span", { class: "right muted" }, timeLabel))),
    h("ul", { class: "list" }, list.map((d) => personRow(ctx, d, { sub: sub ? sub(d) : undefined, chips: false }))),
  );
}

export function renderTonight(ctx) {
  const { model, state } = ctx;
  const date = state.date;
  if (!model.hasCall(date)) return emptyState("moon", "No call sheet for this month", "Ask an admin to upload it.");
  const t = model.tonight(date);
  const root = h("div");
  const lines = [[/^resident board runner/i, "Resident BR"], [/^mda board runner/i, "MDA BR"], [/^harper or main desk/i, "OR desk"], [/^pacu harper/i, "PACU"], [/^mda ob$/i, "MDA OB"]]
    .map(([re, label]) => { const p = model.dir.place(re); return p ? callChip(model.dir, label, p.numbers) : null; }).filter(Boolean);
  if (lines.length) root.append(h("div", { class: "callchips", style: { margin: "0 2px 12px" } }, lines));
  const where = (d) => [d.rotation || d.label, d.roles.length ? headline(d) : ""].filter(Boolean).join(" · ");
  const holiday = model.roster(date).some((d) => d.status === "holiday");
  if (holiday) root.append(notice("", "info", "Holiday: coverage is provided by the CRNAs."));

  const tomorrow = addDays(date, 1);
  const wd = dow(date);
  append(root, [
    group(ctx, "Late resident", "until 6p", "late", t.late, (d) => `${where(d)} → Harper until 6p`),
    group(ctx, "CA-3 senior", "10a–7p", "senior", t.senior, where),
    group(ctx, "11 to 9 (OB)", "11a – 9p", "ob", t.elevenNine, (d) => (d.roles.length ? headline(d) : "Hutzel OB")),
    group(ctx, "Night float", `6p – 6a ${fmtDate(tomorrow, "md")}`, "night", t.night),
    // Friday's and Saturday's 24 cover the night; there's no night float those nights.
    group(ctx, "24-hour call", `6a – 6a ${fmtDate(tomorrow, "md")}${t.night.length ? "" : " · has the night"}`, "call24", t.call24, (d) => (d.call === "24" ? `${d.rotation || d.label} + 24-hr call` : "H1")),
    group(ctx, "12-hour call", "6a – 6p", "call12", t.call12, () => "H2"),
    group(ctx, "Cardiac call", "home call this week", "cardiac", t.cardiac, where),
    group(ctx, "Junior attendings", "today", "info", t.ja, (d) => headline(d)),
    group(ctx, "Obstetrics @ Hutzel", t.obMda ? `MDA ${t.obMda}` : "today", "ob", t.ob, (d) => d.label),
  ]);

  const dl = t.daily;
  if (dl) {
    const mdas = new Map();
    const add = (name, where) => {
      for (const part of String(name).split("/")) {
        const key = part.replace(/\([^)]*\)/g, "").trim();
        if (key) mdas.set(key, [...new Set([...(mdas.get(key) || []), where])]);
      }
    };
    for (const room of dl.rooms) if (room.mda) add(room.mda, room.or);
    for (const p of dl.sheet.procedures || []) if (p.mda && p.count !== "0") add(p.mda, p.name);
    if (dl.sheet.meyers?.mda) add(dl.sheet.meyers.mda, "Meyers lab");
    if (dl.sheet.ob?.mda) add(dl.sheet.ob.mda, "OB");
    for (const m of dl.sheet.opsc?.mdas || []) add(m, "OPSC");
    if (mdas.size) {
      root.append(h("section", { class: "card" },
        h("div", { class: "card-pad", style: { paddingBottom: "4px" } }, h("h3", { class: "card-title" }, "Attendings (MDA) today", h("span", { class: "right muted" }, "daily sheet"))),
        h("ul", { class: "list" }, [...mdas].map(([name, where]) => {
          const staff = model.dir.staff(name);
          return h("li", { class: "row contact" },
            h("div", { class: "avatar" }, name.slice(0, 2).toUpperCase()),
            h("div", { class: "main" },
              h("div", { class: "name" }, staff?.name || name),
              h("div", { class: "sub" }, where.map((w) => (/^\d+$/.test(w) ? `OR ${w}` : w)).join(", ")),
              staff ? h("div", { class: "numrow" }, numberButtons(model.dir, staff.numbers)) : null));
        }))));
    }
  } else if (date === addDays(state.today, 1)) {
    root.append(h("p", { class: "disclaimer" }, "Tomorrow's room assignments usually come out this evening; attendings show up here once they're posted."));
  }

  if (wd === 0 || wd === 6) root.append(h("p", { class: "disclaimer" }, "Weekend: anyone not listed is off unless the call sheet says otherwise."));
  if (!root.children.length) root.append(emptyState("moon", "Nobody listed", "The call sheet has no call shifts on this day."));
  return root;
}
