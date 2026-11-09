// All API routes plus the calendar feeds.
import { openStore } from "../../lib/store.js";
import { isAdmin, isViewer, calToken, pidFromToken, surveyKey, configured, env } from "../../lib/auth.js";
import {
  normalizeDataset, mergeCallWorkbook, mergeRotationsWorkbook, setDaily, setDirectory, setSettings, setDidactics, deleteDidactics, removePerson, setFairness,
} from "../../lib/dataset.js";
import { createModel } from "../../public/core/model.js";
import { buildIcs, feedRange } from "../../public/core/ics.js";
import { todayLocal, addDays } from "../../public/core/dates.js";
import { shiftBlock } from "../../public/core/requests.js";
import { sheetIdFrom, fetchSheet, readSource, saveSource, readState, saveState, syncDaily, publicStatus, disconnect, announce, markAnnounced } from "../../lib/daily-sync.js";
import { readXlsx } from "../../lib/xlsx.js";
import { parseDailyWorkbook } from "../../lib/daily-sheet.js";
import { readLog, liveItems, upsert, markDone, sickItem, noCallItem, swapItem, swapUndone, alertSick } from "../../lib/reqlog.js";
import { cleanScores, summarizeSurvey } from "../../public/core/survey.js";
import { cleanEntries, mergeEntries } from "../../public/core/logged.js";
import { dailyAlert, shouldAlert } from "../../public/core/alerts.js";
import { cleanSubscription, subscriptionId, vapidKeys, sendPush, pushSubject, sendToSubs, REQUEST_MODES } from "../../lib/push.js";
import crypto from "node:crypto";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (status, message) => json({ error: message }, status);

async function loadDataset(st) {
  return normalizeDataset(await st.getJSON("dataset"));
}

function origin(req) {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

async function bytesOf(req) {
  return new Uint8Array(await req.arrayBuffer());
}

// Lock-screen alerts: everyone who turned them on hears when a day's OR sheet is posted, with
// where they are that day. Subscriptions that no longer exist are dropped.
async function alertDaily(st, ds, date, site) {
  const model = createModel(ds);
  const today = todayLocal();
  return sendToSubs(st, () => true, (sub) => dailyAlert(model, date, sub.pid, today), { site, urgency: "high" });
}

// Logged hours belong to the device that first sends them, so nobody else with the passcode
// can overwrite them. An admin can delete them.
const keyHash = (key) => crypto.createHash("sha256").update(String(key)).digest("base64url");
const goodKey = (key) => typeof key === "string" && key.length >= 16 && key.length <= 200;
const cleanText = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

// Swap requests between residents. Each request and offer remembers the device that made it,
// so only that device can change it; what goes out never includes those keys.
function publicSwap(r, mine) {
  const { keyHash: k, offers, ...rest } = r;
  return { ...rest, mine: !!mine && k === mine, offers: offers.map(({ keyHash: ok, ...o }) => ({ ...o, mine: !!mine && ok === mine })) };
}
const pruneSwaps = (list, today) => list.filter((r) => r.end >= addDays(today, -7) && !(r.status === "cancelled" && r.end < today));
const SWAP_CLASSES = ["CA-1", "CA-2", "CA-3"];

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;
  const st = openStore();

  try {
    // ---- calendar feed (token in the URL, no passcode) ----
    const cal = path.match(/^\/cal\/([\w-]+)\.ics$/);
    if (cal && method === "GET") {
      const ds = await loadDataset(st);
      const pid = pidFromToken(cal[1], ds.people);
      if (!pid) return new Response("Not found", { status: 404 });
      const model = createModel(ds);
      const ics = buildIcs(model, pid, { ...feedRange(model, todayLocal()), appUrl: `${origin(req)}/`, didactics: url.searchParams.get("d") !== "0" });
      return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "public, max-age=900", "content-disposition": "inline; filename=dmc-schedule.ics" } });
    }

    if (path === "/api/status") {
      const ds = await loadDataset(st);
      return json({ configured: configured(), updatedAt: ds.updatedAt, months: Object.keys(ds.months).sort(), people: ds.people.length });
    }

    if (path === "/api/login" && method === "POST") {
      return json({ viewer: isViewer(req), admin: isAdmin(req) });
    }

    if (!isViewer(req)) return fail(401, "Passcode required");

    if (path === "/api/data" && method === "GET") {
      const ds = await loadDataset(st);
      const etag = `"${ds.updatedAt || "empty"}"`;
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
      return json(ds, 200, { etag });
    }

    const tok = path.match(/^\/api\/caltoken\/([\w-]+)$/);
    if (tok && method === "GET") {
      if (!env("CAL_SECRET") && !env("ADMIN_KEY")) return fail(503, "Calendar feeds need ADMIN_KEY or CAL_SECRET on the server.");
      const url2 = `${origin(req)}/cal/${calToken(tok[1])}.ics`;
      return json({ url: url2, webcal: url2.replace(/^https?:/, "webcal:") });
    }

    const photo = path.match(/^\/api\/photo\/(\d{4}-\d{2}-\d{2})$/);
    if (photo && method === "GET") {
      const img = await st.getBytes(`photo/${photo[1]}`);
      if (!img) return fail(404, "No photo for that day");
      return new Response(img.data, { headers: { "content-type": img.contentType, "cache-control": "private, max-age=3600" } });
    }

    // Shift ratings are kept apart from the dataset: everyone can read the dataset, and these
    // are only ever shown combined, to admins.
    if (path === "/api/survey" && method === "PUT") {
      const body = await req.json();
      const ds = await loadDataset(st);
      const person = ds.people.find((p) => p.id === body.pid);
      if (!person) return fail(400, "Pick yourself first");
      const scores = cleanScores(body.scores);
      if (!Object.keys(scores).length) return fail(400, "Rate at least one shift");
      const survey = (await st.getJSON("survey")) || { responses: {} };
      survey.responses[surveyKey(person.id)] = { cls: person.cls, scores };
      await st.setJSON("survey", survey);
      return json({ ok: true });
    }

    // ---- lock-screen alerts ----
    if (path === "/api/push/key" && method === "GET") {
      return json({ publicKey: (await vapidKeys(st)).publicKey });
    }
    if (path === "/api/push/subscribe" && method === "POST") {
      const body = await req.json();
      const sub = cleanSubscription(body.subscription);
      if (!sub) return fail(400, "That isn't a push subscription this app can use.");
      const ds = await loadDataset(st);
      const pid = ds.people.some((p) => p.id === body.pid) ? body.pid : null;
      const subs = (await st.getJSON("push/subs")) || {};
      const id = subscriptionId(sub.endpoint);
      // Admin devices also hear about residents' requests, as often as the admin chose.
      const mode = REQUEST_MODES.includes(body.mode) ? body.mode : subs[id]?.mode || "smart";
      subs[id] = { ...sub, pid, admin: isAdmin(req), mode, createdAt: subs[id]?.createdAt || new Date().toISOString() };
      await st.setJSON("push/subs", subs);
      return json({ ok: true });
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const body = await req.json();
      const subs = (await st.getJSON("push/subs")) || {};
      delete subs[subscriptionId(String(body.endpoint || ""))];
      await st.setJSON("push/subs", subs);
      return json({ ok: true });
    }
    if (path === "/api/push/test" && method === "POST") {
      const body = await req.json();
      const sub = ((await st.getJSON("push/subs")) || {})[subscriptionId(String(body.endpoint || ""))];
      if (!sub) return fail(404, "Alerts aren't on for this device. Turn them on again.");
      const r = await sendPush(sub, { title: "Alerts are on", body: "You'll hear here when the next day's OR schedule is posted.", url: "/#/today", tag: "test" },
        { keys: await vapidKeys(st), subject: pushSubject(origin(req)), ttl: 600, urgency: "high" });
      return r.ok ? json({ ok: true }) : fail(502, `The phone's push service said no (${r.status || "no answer"}). Turn alerts off and on again.`);
    }

    // ---- swap requests ----
    if (path === "/api/swaps" && method === "GET") {
      const today = todayLocal();
      const mine = req.headers.get("x-device-key") ? keyHash(req.headers.get("x-device-key")) : null;
      const list = ((await st.getJSON("swaps"))?.list || []).filter((r) => r.end >= addDays(today, -1) && r.status !== "cancelled");
      return json({ swaps: list.map((r) => publicSwap(r, mine)) });
    }
    if (path === "/api/swaps" && method === "POST") {
      const body = await req.json();
      const today = todayLocal();
      const model = createModel(await loadDataset(st));
      const p = model.person(body.pid);
      if (!p || !SWAP_CLASSES.includes(p.cls)) return fail(400, "Pick yourself first (CA-1 to CA-3).");
      if (!goodKey(body.key)) return fail(400, "Missing device key");
      if (!DATE.test(body.date || "") || body.date < today) return fail(400, "Pick an upcoming shift.");
      const block = shiftBlock(model, p.id, body.date);
      if (!block) return fail(400, "The call sheet shows no call shift for you that day.");
      const data = (await st.getJSON("swaps")) || { list: [] };
      data.list = pruneSwaps(data.list, today);
      if (data.list.some((r) => r.pid === p.id && r.date === block.date && r.status !== "cancelled")) return fail(409, "You already asked for a swap for that shift.");
      const r = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 12), pid: p.id, cls: p.cls, ...block, note: cleanText(body.note, 200), keyHash: keyHash(body.key), status: "open", offers: [], createdAt: new Date().toISOString() };
      data.list.push(r);
      await st.setJSON("swaps", data);
      return json({ ok: true, swap: publicSwap(r, r.keyHash) });
    }
    const swap = path.match(/^\/api\/swaps\/([a-z0-9]{6,40})$/);
    if (swap && method === "POST") {
      const body = await req.json();
      const today = todayLocal();
      const data = (await st.getJSON("swaps")) || { list: [] };
      const r = data.list.find((x) => x.id === swap[1]);
      if (!r || r.status === "cancelled") return fail(404, "That request is gone.");
      const key = goodKey(body.key) ? keyHash(body.key) : null;
      const owner = key && key === r.keyHash;
      const now = new Date().toISOString();
      if (body.action === "offer") {
        if (r.status !== "open") return fail(409, "That shift already has a taker.");
        if (!key) return fail(400, "Missing device key");
        const model = createModel(await loadDataset(st));
        const p = model.person(body.pid);
        if (!p || p.id === r.pid) return fail(400, "Pick yourself first.");
        if (p.cls !== r.cls) return fail(400, `Swaps stay within the class (${r.cls}).`);
        let trade = null;
        if (body.date) {
          trade = DATE.test(body.date) && body.date >= today ? shiftBlock(model, p.id, body.date) : null;
          if (!trade) return fail(400, "Pick one of your upcoming shifts to trade.");
        }
        r.offers = r.offers.filter((o) => o.pid !== p.id);
        r.offers.push({ pid: p.id, keyHash: key, ...(trade ? { date: trade.date, end: trade.end, label: trade.label } : {}), note: cleanText(body.note, 200), at: now });
      } else if (body.action === "withdraw") {
        const o = r.offers.find((x) => x.pid === body.pid);
        if (!o || o.keyHash !== key) return fail(403, "Only the device that made this offer can take it back.");
        if (r.agreed?.pid === o.pid) { r.status = "open"; r.agreed = null; await swapUndone(st, r.id); }
        r.offers = r.offers.filter((x) => x !== o);
      } else if (body.action === "accept") {
        if (!owner) return fail(403, "Only the device that asked can accept an offer.");
        const o = r.offers.find((x) => x.pid === body.offerPid);
        if (!o) return fail(404, "That offer was taken back.");
        r.status = "agreed";
        r.agreed = { pid: o.pid, date: o.date || null, end: o.end || null, label: o.label || null, at: now };
        await upsert(st, swapItem(r), (i) => i.type === "swap" && i.swapId === r.id);
      } else if (body.action === "reopen") {
        if (!owner) return fail(403, "Only the device that asked can change this.");
        r.status = "open";
        r.agreed = null;
        await swapUndone(st, r.id);
      } else if (body.action === "cancel") {
        if (!owner && !isAdmin(req)) return fail(403, "Only the device that asked can cancel this.");
        if (r.status === "agreed") await swapUndone(st, r.id);
        r.status = "cancelled";
      } else if (body.action === "emailed") {
        const taker = r.offers.find((x) => x.pid === r.agreed?.pid);
        if (!owner && !(taker && taker.keyHash === key)) return fail(403, "Not your swap.");
        r.emailedAt = now;
      } else return fail(400, "Unknown action");
      await st.setJSON("swaps", data);
      return json({ ok: true, swap: publicSwap(r, key) });
    }

    // ---- a sick call or a no-call list, logged for the admins' inbox ----
    if (path === "/api/requests" && method === "POST") {
      const body = await req.json();
      const today = todayLocal();
      const ds = await loadDataset(st);
      const model = createModel(ds);
      if (body.type === "sick") {
        if (!DATE.test(body.date || "") || body.date < addDays(today, -1) || body.date > addDays(today, 7)) return fail(400, "Pick today or tomorrow.");
        const item = sickItem(model, body.pid, body.date);
        if (!item) return fail(400, "Pick yourself first.");
        const { isNew } = await upsert(st, item, (i) => i.type === "sick" && i.pid === item.pid && i.date === item.date);
        // Only the first time: opening the email twice shouldn't buzz anyone twice.
        const alerted = isNew ? await alertSick(st, model, item, origin(req)) : 0;
        return json({ ok: true, alerted });
      }
      if (body.type === "nocall") {
        const item = noCallItem(model, body.pid, body.month, body.picks, body.note);
        if (!item || body.month < today.slice(0, 7)) return fail(400, "Pick yourself and a month.");
        await upsert(st, item, (i) => i.type === "nocall" && i.pid === item.pid && i.month === item.month);
        return json({ ok: true });
      }
      return fail(400, "Unknown request");
    }

    // ---- real hours residents add (only admins can read them) ----
    const hours = path.match(/^\/api\/hours\/([\w-]+)$/);
    if (hours && (method === "PUT" || method === "DELETE")) {
      const pid = hours[1];
      const body = await req.json().catch(() => ({}));
      const ds = await loadDataset(st);
      if (!ds.people.some((p) => p.id === pid)) return fail(404, "No such resident");
      const saved = await st.getJSON(`hours/${pid}`);
      const mine = saved && body.key && saved.keyHash === keyHash(body.key);
      if (method === "DELETE") {
        if (saved && !mine && !isAdmin(req)) return fail(403, "Only the device that added these hours, or an admin, can remove them.");
        await st.delete(`hours/${pid}`);
        return json({ ok: true });
      }
      if (typeof body.key !== "string" || body.key.length < 16) return fail(400, "Missing device key");
      const takeover = saved && !mine;
      if (takeover && body.replace !== true) return fail(409, "These hours were first added from another device. Update them there, or replace them from this one.");
      const incoming = cleanEntries(body.entries);
      if (!incoming.length) return fail(400, "No hours found");
      // Taking over starts from this device's hours alone; otherwise new days add to the record.
      const entries = takeover ? incoming : mergeEntries(saved?.entries, incoming);
      const now = new Date().toISOString();
      const moves = [...(saved?.moves || []), ...(takeover ? [now] : [])].slice(-5);
      await st.setJSON(`hours/${pid}`, { keyHash: keyHash(body.key), entries, sharedAt: saved?.sharedAt || now, updatedAt: now, moves });
      return json({ ok: true, entries: entries.length, updatedAt: now });
    }

    // ---- admin only below ----
    const didPdf = path.match(/^\/api\/didactics\/(\d{4}-\d{2})\/pdf$/);
    if (didPdf && method === "GET") {
      const pdf = await st.getBytes(`didactics-pdf/${didPdf[1]}`);
      if (!pdf) return fail(404, "No PDF for that month");
      return new Response(pdf.data, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename=conference-schedule-${didPdf[1]}.pdf`, "cache-control": "private, max-age=3600" } });
    }

    if (!isAdmin(req)) return fail(403, "Admin key required");

    if (path === "/api/upload/call" && method === "POST") {
      const ds = await loadDataset(st);
      const summary = mergeCallWorkbook(ds, await bytesOf(req), url.searchParams.get("name") || "");
      await st.setJSON("dataset", ds);
      return json({ ok: true, summary, updatedAt: ds.updatedAt });
    }

    if (path === "/api/upload/rotations" && method === "POST") {
      const ds = await loadDataset(st);
      const summary = mergeRotationsWorkbook(ds, await bytesOf(req), url.searchParams.get("name") || "", url.searchParams.get("ay"));
      await st.setJSON("dataset", ds);
      return json({ ok: true, summary, updatedAt: ds.updatedAt });
    }

    const daily = path.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (daily && method === "PUT") {
      const date = daily[1];
      const ds = await loadDataset(st);
      const body = await req.json();
      // A photo read from the inbox is filed under the date it was saved for.
      if (/^[\w-]{6,64}$/.test(body.photo || "")) {
        const img = await st.getBytes(`inbox/${body.photo}`);
        if (img) {
          await st.setBytes(`photo/${date}`, img.data, img.contentType);
          await st.delete(`inbox/${body.photo}`);
          await st.delete(`job/${body.photo}`);
        }
      }
      const hasPhoto = !!(await st.getBytes(`photo/${date}`));
      const sync = await readState(st);
      // A sheet that only came from the live workbook hasn't been announced yet: saving it here counts.
      const isNew = !ds.daily[date] || (ds.daily[date].source === "sheet" && !sync.days[date]?.alertedAt);
      const { daily: saved, changes } = setDaily(ds, date, { ...body, hasPhoto });
      // The first save of a day's sheet tells everyone; a later fix only when the admin asks.
      const send = (isNew || body.notify === true) && shouldAlert(date, todayLocal());
      if (send) markAnnounced(sync, ds, date);
      await st.setJSON("dataset", ds);
      if (send) await saveState(st, sync);
      const alerted = send ? await alertDaily(st, ds, date, origin(req)) : 0;
      return json({ ok: true, daily: saved, changes, updatedAt: ds.updatedAt, alerted });
    }
    if (daily && method === "DELETE") {
      const ds = await loadDataset(st);
      delete ds.daily[daily[1]];
      ds.updatedAt = new Date().toISOString();
      await st.setJSON("dataset", ds);
      return json({ ok: true, updatedAt: ds.updatedAt });
    }

    // Daily-sheet photo: no date needed up front; the reader finds the date printed on the sheet.
    if (path === "/api/photo" && method === "POST") {
      const type = req.headers.get("content-type") || "image/jpeg";
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return fail(415, "Upload a JPEG, PNG, WebP or GIF image");
      const id = `${todayLocal()}-${crypto.randomUUID().slice(0, 8)}`;
      await st.setBytes(`inbox/${id}`, await bytesOf(req), type);
      if (!configured().ai) return json({ ok: true, id, queued: false });
      await st.setJSON(`job/${id}`, { status: "queued", queuedAt: new Date().toISOString() });
      const r = await fetch(`${origin(req)}/bg/parse-photo`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": req.headers.get("x-admin-key") },
        body: JSON.stringify({ id }),
      });
      if (!r.ok && r.status !== 202) return json({ ok: true, id, queued: false });
      return json({ ok: true, id, queued: true });
    }

    // Monthly conference schedule (PDF): read in the background, reviewed, then saved by month.
    if (path === "/api/didactics/pdf" && method === "POST") {
      const type = (req.headers.get("content-type") || "").split(";")[0];
      if (type !== "application/pdf") return fail(415, "Upload the conference schedule as a PDF");
      const id = `did-${todayLocal()}-${crypto.randomUUID().slice(0, 8)}`;
      await st.setBytes(`inbox/${id}`, await bytesOf(req), type);
      if (!configured().ai) return json({ ok: true, id, queued: false });
      await st.setJSON(`job/${id}`, { status: "queued", queuedAt: new Date().toISOString() });
      const r = await fetch(`${origin(req)}/bg/parse-didactics`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": req.headers.get("x-admin-key") },
        body: JSON.stringify({ id }),
      });
      if (!r.ok && r.status !== 202) return json({ ok: true, id, queued: false });
      return json({ ok: true, id, queued: true });
    }

    const did = path.match(/^\/api\/didactics\/(\d{4}-\d{2})$/);
    if (did && method === "PUT") {
      const month = did[1];
      const body = await req.json();
      if (/^[\w-]{6,64}$/.test(body.pdf || "")) {
        const pdf = await st.getBytes(`inbox/${body.pdf}`);
        if (pdf) {
          await st.setBytes(`didactics-pdf/${month}`, pdf.data, "application/pdf");
          await st.delete(`inbox/${body.pdf}`);
          await st.delete(`job/${body.pdf}`);
        }
      }
      const ds = await loadDataset(st);
      const hasPdf = !!(await st.getBytes(`didactics-pdf/${month}`));
      const { didactics, changes } = setDidactics(ds, month, body.data || body, { hasPdf });
      await st.setJSON("dataset", ds);
      return json({ ok: true, didactics, changes, updatedAt: ds.updatedAt });
    }
    if (did && method === "DELETE") {
      const ds = await loadDataset(st);
      deleteDidactics(ds, did[1]);
      await st.delete(`didactics-pdf/${did[1]}`);
      await st.setJSON("dataset", ds);
      return json({ ok: true, updatedAt: ds.updatedAt });
    }

    const job = path.match(/^\/api\/job\/([\w-]{6,64})$/);
    if (job && method === "GET") {
      return json((await st.getJSON(`job/${job[1]}`)) || { status: "none" });
    }

    if (path === "/api/directory" && method === "PUT") {
      const ds = await loadDataset(st);
      const summary = setDirectory(ds, await req.json());
      await st.setJSON("dataset", ds);
      return json({ ok: true, summary, updatedAt: ds.updatedAt });
    }

    // ---- the live daily sheet (the link stays on the server) ----
    if (path === "/api/daily-source" && method === "GET") {
      return json(publicStatus(await readSource(st), await readState(st)));
    }
    if (path === "/api/daily-source" && method === "PUT") {
      const body = await req.json();
      const id = sheetIdFrom(body.url);
      if (!id) return fail(400, "That doesn't look like a Google Sheets link.");
      try {
        parseDailyWorkbook(readXlsx(await fetchSheet(id)));
      } catch (err) {
        return fail(400, `The app couldn't read that sheet: ${err?.message || "unknown problem"}`);
      }
      await saveSource(st, id);
      const state = await syncDaily(st, { site: origin(req) });
      return json(publicStatus(await readSource(st), state));
    }
    if (path === "/api/daily-source" && method === "DELETE") {
      await disconnect(st);
      return json(publicStatus(null, null));
    }
    if (path === "/api/daily-source/check" && method === "POST") {
      const state = await syncDaily(st, { site: origin(req) });
      return json({ ...publicStatus(await readSource(st), state), updatedAt: (await loadDataset(st)).updatedAt });
    }
    if (path === "/api/daily-source/alert" && method === "POST") {
      const state = await readState(st);
      const ds = await loadDataset(st);
      if (!state.date || !ds.daily[state.date] || !shouldAlert(state.date, todayLocal())) return fail(400, "There's no upcoming sheet to announce.");
      const sent = await announce(st, ds, state, state.date, { site: origin(req) });
      await saveState(st, state);
      return json({ ...publicStatus(await readSource(st), state), alerted: sent });
    }

    if (path === "/api/requests" && method === "GET") {
      const log = await readLog(st);
      return json({ items: liveItems(log.list, todayLocal()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), digestAt: log.digestAt });
    }
    if (path === "/api/requests/done" && method === "POST") {
      const body = await req.json();
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
      const log = await markDone(st, ids, body.done !== false);
      return json({ ok: true, items: liveItems(log.list, todayLocal()) });
    }
    if (path === "/api/push/mode" && method === "POST") {
      const body = await req.json();
      if (!REQUEST_MODES.includes(body.mode)) return fail(400, "Unknown setting");
      const subs = (await st.getJSON("push/subs")) || {};
      const sub = subs[subscriptionId(String(body.endpoint || ""))];
      if (!sub) return fail(404, "Alerts aren't on for this device.");
      Object.assign(sub, { admin: true, mode: body.mode });
      await st.setJSON("push/subs", subs);
      return json({ ok: true });
    }

    if (path === "/api/hours" && method === "GET") {
      const ds = await loadDataset(st);
      const out = {};
      await Promise.all(ds.people.map(async (p) => {
        const rec = await st.getJSON(`hours/${p.id}`);
        if (rec?.entries?.length) out[p.id] = { entries: rec.entries, sharedAt: rec.sharedAt, updatedAt: rec.updatedAt, moves: rec.moves || [] };
      }));
      return json({ people: out });
    }

    if (path === "/api/survey/results" && method === "GET") {
      const survey = (await st.getJSON("survey")) || { responses: {} };
      return json(summarizeSurvey(Object.values(survey.responses)));
    }

    if (path === "/api/fairness" && method === "PUT") {
      const ds = await loadDataset(st);
      const fairness = setFairness(ds, await req.json());
      await st.setJSON("dataset", ds);
      return json({ ok: true, fairness, updatedAt: ds.updatedAt });
    }

    if (path === "/api/settings" && method === "PUT") {
      const ds = await loadDataset(st);
      setSettings(ds, await req.json());
      await st.setJSON("dataset", ds);
      return json({ ok: true, updatedAt: ds.updatedAt });
    }

    const person = path.match(/^\/api\/people\/([\w-]+)$/);
    if (person && method === "PATCH") {
      const ds = await loadDataset(st);
      const p = ds.people.find((x) => x.id === person[1]);
      if (!p) return fail(404, "No such person");
      const body = await req.json();
      for (const k of ["cls", "preferred", "hidden"]) if (k in body) p[k] = body[k];
      ds.updatedAt = new Date().toISOString();
      await st.setJSON("dataset", ds);
      return json({ ok: true, person: p, updatedAt: ds.updatedAt });
    }
    if (person && method === "DELETE") {
      const ds = await loadDataset(st);
      const p = removePerson(ds, person[1]);
      if (!p) return fail(404, "No such person");
      await st.setJSON("dataset", ds);
      return json({ ok: true, removed: p.id, updatedAt: ds.updatedAt });
    }

    if (path === "/api/export" && method === "GET") {
      const ds = await loadDataset(st);
      return new Response(JSON.stringify(ds, null, 1), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename=dmc-schedule-backup-${todayLocal()}.json` } });
    }

    if (path === "/api/import" && method === "POST") {
      const body = await req.json();
      if (!body || !Array.isArray(body.people) || typeof body.months !== "object") return fail(400, "That file doesn't look like a backup from this app.");
      const ds = normalizeDataset(body);
      ds.updatedAt = new Date().toISOString();
      await st.setJSON("dataset", ds);
      return json({ ok: true, updatedAt: ds.updatedAt });
    }

    return fail(404, "Unknown route");
  } catch (err) {
    console.error(err);
    return fail(500, err?.message || "Server error");
  }
}

export const config = { path: ["/api/*", "/cal/*"] };
