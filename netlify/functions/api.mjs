// All API routes plus the calendar feeds.
import { openStore } from "../../lib/store.js";
import { isAdmin, isViewer, calToken, pidFromToken, configured, env } from "../../lib/auth.js";
import {
  normalizeDataset, mergeCallWorkbook, mergeRotationsWorkbook, setDaily, setDirectory, setSettings,
} from "../../lib/dataset.js";
import { createModel } from "../../public/core/model.js";
import { buildIcs, feedRange } from "../../public/core/ics.js";
import { todayLocal } from "../../public/core/dates.js";

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
      const ics = buildIcs(model, pid, { ...feedRange(model, todayLocal()), appUrl: `${origin(req)}/` });
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

    // ---- admin only below ----
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
      const { daily: saved, changes } = setDaily(ds, date, { ...body, hasPhoto });
      await st.setJSON("dataset", ds);
      return json({ ok: true, daily: saved, changes, updatedAt: ds.updatedAt });
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
