import { h, icon, card, avatar, classPill, dayChips, emptyState, telHref, smsHref, numberButtons } from "../ui.js";
import { monthKey, monthDates, addMonths, fmtMonth, fmtDate, dow, parts, DOW_LETTER, academicYearOf, MONTH_SHORT } from "../../core/dates.js";
import { headline } from "../../core/model.js";
import { SITES, GROUP_COLORS, groupOfRotation } from "../../core/codes.js";
import { hoursReport } from "../../core/hours.js";
import { openDaySheet, subscribeCard } from "./common.js";
import { didacticsPersonCard } from "./didactics.js";

function cellCode(d) {
  if (d.call === "NF") return "NF";
  if (d.call === "10-7") return "10–7";
  if (d.call === "H1") return "H1";
  if (d.call === "H2") return "H2";
  if (d.status === "vacation") return "Vac";
  if (d.status === "postcall") return "PC";
  if (d.status === "holiday") return "Hol";
  if (d.status === "off") return "";
  const room = d.roles.find((r) => r.kind === "room");
  if (room) return `OR${room.or}`;
  return d.code || d.raw || (d.status === "planned" ? "·" : "");
}

function marks(d) {
  const m = [];
  if (d.late) m.push("var(--late)");
  if (d.call === "H1" || d.call === "24") m.push("var(--call24)");
  if (d.call === "H2") m.push("var(--call12)");
  if (d.call === "NF") m.push("var(--night)");
  if (d.call === "10-7") m.push("var(--senior)");
  if (d.cardiac) m.push("var(--cardiac)");
  return m;
}

export function monthGrid(ctx, pid, month, onPick) {
  const { model, state } = ctx;
  const dates = monthDates(month);
  const lead = dow(dates[0]);
  return h("div", { class: "month" },
    DOW_LETTER.map((l) => h("div", { class: "hd" }, l)),
    Array.from({ length: lead }, () => h("div", { class: "mcell empty" })),
    dates.map((date) => {
      const d = model.day(pid, date);
      const off = ["off", "holiday", "postcall"].includes(d.status);
      return h("button", {
        class: `mcell${date === state.today ? " today" : ""}${date === state.date ? " sel" : ""}${off ? " off" : ""}${d.status === "vacation" ? " vac" : ""}`,
        vars: { "--c": d.status === "work" ? d.color : "transparent" },
        "aria-label": `${date}: ${headline(d)}`,
        onclick: () => onPick(date),
      },
      h("span", { class: "d" }, parts(date).d),
      h("span", { class: "c" }, cellCode(d)),
      h("span", { class: "marks" }, marks(d).map((c) => h("i", { vars: { "--m": c } }))));
    }),
  );
}

export function renderPerson(ctx, pid) {
  const { model, state } = ctx;
  const p = model.person(pid);
  if (!p) return emptyState("user", "Not found", "This person isn't in the schedule.");
  const root = h("div");
  const contact = model.dir.resident(pid);
  const d = model.day(pid, state.date);

  root.append(h("section", { class: "card card-pad", style: { display: "flex", gap: "14px", alignItems: "center" } },
    avatar(model, pid, "lg"),
    h("div", { style: { flex: 1, minWidth: 0 } },
      h("div", { style: { fontSize: "20px", fontWeight: 700 } }, model.name(pid)),
      h("div", { class: "muted small", style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } },
        classPill(p.cls), model.rotationFor(pid, monthKey(state.date)) || ""),
      contact ? h("div", { class: "numrow" }, numberButtons(model.dir, contact.numbers)) : null),
  ));

  root.append(h("section", { class: "card hero", vars: { "--rot": d.color }, onclick: () => openDaySheet(ctx, pid, state.date), style: { cursor: "pointer" } },
    h("div", { class: "eyebrow" }, state.date === state.today ? `Today · ${fmtDate(state.date, "long")}` : fmtDate(state.date, "long")),
    h("h2", { style: { fontSize: "20px" } }, headline(d)),
    h("div", { class: "subtitle" }, [d.rotation || d.label, SITES[d.site]?.short].filter(Boolean).join(" · ")),
    h("div", { class: "chips" }, dayChips(d))));

  let month = state.personMonth?.[pid] || monthKey(state.date);
  const gridHolder = h("div");
  const title = h("span");
  const drawMonth = () => {
    title.textContent = fmtMonth(month);
    gridHolder.replaceChildren(monthGrid(ctx, pid, month, (date) => openDaySheet(ctx, pid, date)));
    state.personMonth = { ...(state.personMonth || {}), [pid]: month };
    drawHours();
  };
  const hoursHolder = h("div");
  const drawHours = () => {
    hoursHolder.replaceChildren();
    if (p.cls === "PGY-1" || !model.months.includes(month)) return;
    const dates = monthDates(month);
    const rep = hoursReport(model, pid, dates[0], dates[dates.length - 1]);
    const max = Math.max(90, ...rep.weeks.map((w) => w.hours));
    hoursHolder.append(card("Weekly hours (estimate)", h("div", null,
      h("div", { class: "bars" },
        h("div", { class: "line80", style: { bottom: `${(80 / max) * 0.78 * 120 + 18}px` }, title: "80-hour limit" }),
        rep.weeks.map((w) => h("div", { class: "b" },
          h("b", null, w.known ? Math.round(w.hours) : "—"),
          h("i", { style: { height: `${(w.hours / max) * 78}%`, background: w.hours > 80 ? "var(--gap)" : w.hours > 70 ? "var(--warn)" : "var(--accent)" } }),
          h("span", null, `${parts(w.start).m}/${parts(w.start).d}`)))),
      rep.flags.length ? h("div", { class: "chips", style: { marginTop: "10px" } }, rep.flags.map((f) => h("span", { class: `chip ${f.level}` }, f.text))) : null,
    )));
  };
  root.append(h("section", { class: "card" },
    h("div", { class: "card-pad", style: { display: "flex", alignItems: "center", paddingBottom: "0" } },
      h("button", { class: "iconbtn", "aria-label": "Previous month", onclick: () => { month = addMonths(month, -1); drawMonth(); } }, icon("left")),
      h("div", { style: { flex: 1, textAlign: "center", fontWeight: 700 } }, title),
      h("button", { class: "iconbtn", "aria-label": "Next month", onclick: () => { month = addMonths(month, 1); drawMonth(); } }, icon("right"))),
    gridHolder,
    h("div", { class: "chips", style: { padding: "0 12px 12px" } },
      h("span", { class: "chip late" }, "Late"), h("span", { class: "chip call24" }, "24h"), h("span", { class: "chip call12" }, "12h"),
      h("span", { class: "chip night" }, "NF"), h("span", { class: "chip senior" }, "10–7"), h("span", { class: "chip cardiac" }, "Cardiac"))));
  root.append(hoursHolder);
  drawMonth();

  const ay = academicYearOf(state.date);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(`${ay}-07`, i));
  const rots = months.map((m) => [m, model.rotationFor(pid, m)]).filter(([, r]) => r);
  if (rots.length) {
    root.append(card(`Rotations ${ay}–${String(ay + 1).slice(2)}`, h("ul", { class: "list" }, rots.map(([m, r]) => {
      const [, mm] = m.split("-").map(Number);
      return h("li", { class: "row tap", style: { minHeight: "44px" }, onclick: () => { month = m; drawMonth(); window.scrollTo({ top: 0, behavior: "smooth" }); } },
        h("span", { style: { width: "36px", fontWeight: 700, color: m === monthKey(state.today) ? "var(--accent)" : "var(--muted)" } }, MONTH_SHORT[mm - 1]),
        h("span", { class: "dotc", vars: { "--c": GROUP_COLORS[groupOfRotation(r)] || "#b0b8c4" } }),
        h("div", { class: "main" }, r));
    })), { pad: false }));
  }

  const did = didacticsPersonCard(ctx, pid);
  if (did) root.append(did);

  if (p.cls !== "PGY-1") root.append(subscribeCard(ctx, pid));
  if (state.me !== pid) {
    root.append(h("button", { class: "btn block sm", onclick: () => { ctx.setMe(pid); ctx.go("today"); } }, icon("user"), "This is me"));
  }
  return root;
}

export { telHref, smsHref };
