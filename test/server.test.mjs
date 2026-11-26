// Server routes and lock-screen alerts, run against a throwaway local store.
// Synthetic data only: the repository is public, so no real schedules or names here.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DMC_LOCAL_STORE = await fs.mkdtemp(path.join(os.tmpdir(), "dmc-test-"));
process.env.APP_PASSCODE = "pass-test";
process.env.ADMIN_KEY = "admin-test";
const { default: api } = await import("../netlify/functions/api.mjs");
const { openStore } = await import("../lib/store.js");
const push = await import("../lib/push.js");
const { todayLocal, addDays, zonedTime, nowMinutesLocal } = await import("../public/core/dates.js");

// The tests never reach Google: a test that wants the live sheet hands its workbook to `google`.
let google = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => (/^https:\/\/docs\.google\.com\//.test(String(url))
  ? (google ? google(String(url)) : Promise.reject(new Error("No network in the tests.")))
  : realFetch(url, opts));

const call = async (method, url, body, headers = {}) => {
  const res = await api(new Request(`http://localhost${url}`, {
    method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json().catch(() => null) };
};
const viewer = { "x-passcode": "pass-test" };
const admin = { "x-admin-key": "admin-test" };

// A pretend phone: its own keys, and a local server standing in for Apple's push service.
function fakePhone() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { received.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201).end(); });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({
    sub: { endpoint: `http://127.0.0.1:${server.address().port}/push/abc`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    received,
    close: () => server.close(),
    // What the phone shows, read the way an iPhone reads Apple's declarative format.
    open(body) {
      const msg = this.raw(body);
      assert.equal(msg.web_push, 8030);
      const n = msg.notification;
      assert.ok(n.title && /^https?:\/\//.test(n.navigate), "a declarative alert needs a title and a full address");
      const u = new URL(n.navigate);
      return { title: n.title, body: n.body, url: u.pathname + u.search + u.hash, tag: n.tag, origin: u.origin };
    },
    // RFC 8291, the phone's side.
    raw(body) {
      const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), sealed = body.subarray(21 + idlen);
      const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
      const ikm = hmac(hmac(auth, ecdh.computeSecret(asPublic)), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const d = crypto.createDecipheriv("aes-128-gcm", hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12));
      d.setAuthTag(sealed.subarray(-16));
      const plain = Buffer.concat([d.update(sealed.subarray(0, -16)), d.final()]);
      assert.equal(plain[plain.length - 1], 2); // last-record delimiter
      return JSON.parse(plain.subarray(0, -1).toString());
    },
  })));
}

test("push encryption matches the worked example in RFC 8291", () => {
  const out = push.encryptPayload(
    { keys: { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" } },
    "When I grow up, I want to be a watermelon",
    { salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), serverKey: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url") });
  assert.equal(out.toString("base64url"), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("an alert reaches the phone encrypted, signed by the server, and readable", async () => {
  const phone = await fakePhone();
  const keys = push.makeVapidKeys();
  const r = await push.sendPush(phone.sub, { title: "Tomorrow's OR schedule is posted", body: "You're in OR 7." }, { keys, subject: "https://example.org", urgency: "high" });
  phone.close();
  assert.equal(r.ok, true);
  const [got] = phone.received;
  assert.equal(got.headers["content-encoding"], "aes128gcm");
  assert.equal(got.headers.urgency, "high");
  // Apple's declarative format: the phone can show it without waking the app's script.
  assert.deepEqual(phone.raw(got.body), {
    web_push: 8030,
    notification: { title: "Tomorrow's OR schedule is posted", body: "You're in OR 7.", navigate: "https://example.org/", lang: "en-US", dir: "ltr" },
  });
  // A tap opens the app on the site that sent it, never a stray address.
  assert.equal(push.webPushMessage({ title: "x", url: "/#/day/2026-11-20", tag: "daily" }, "https://dmc.example").notification.navigate, "https://dmc.example/#/day/2026-11-20");
  assert.equal(push.webPushMessage({ title: "x" }, "mailto:someone").notification.navigate, "https://dmcschedule.netlify.app/");
  // The VAPID token is signed with the server's key and names the push service.
  const [, token, k] = got.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicKey);
  const [h64, c64, s64] = token.split(".");
  const pub = Buffer.from(keys.publicKey, "base64url");
  const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h64}.${c64}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s64, "base64url")));
  const claims = JSON.parse(Buffer.from(c64, "base64url"));
  assert.equal(claims.aud, new URL(phone.sub.endpoint).origin);
  assert.ok(claims.exp - Date.now() / 1000 <= 24 * 3600);
});

test("only real push services can be subscribed", async () => {
  assert.equal(push.isPushEndpoint("https://web.push.apple.com/abc"), true);
  assert.equal(push.isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(push.isPushEndpoint("https://evil.example.com/push.apple.com"), false);
  assert.equal(push.isPushEndpoint("http://web.push.apple.com/abc"), false);
  const bad = await call("POST", "/api/push/subscribe", { subscription: { endpoint: "http://169.254.169.254/latest", keys: { p256dh: "x", auth: "y" } } }, viewer);
  assert.equal(bad.status, 400);
  assert.equal((await call("GET", "/api/push/key")).status, 401); // passcode needed
  const key = await call("GET", "/api/push/key", undefined, viewer);
  assert.equal(Buffer.from(key.body.publicKey, "base64url").length, 65);
  assert.equal((await call("GET", "/api/push/key", undefined, viewer)).body.publicKey, key.body.publicKey); // made once, then kept
});

test("posting a day's sheet alerts everyone once, with where they are", async () => {
  const st = openStore();
  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const month = tomorrow.slice(0, 7);
  const day = Number(tomorrow.slice(8));
  await st.setJSON("dataset", {
    people: [{ id: "doe-jane", last: "Doe", first: "Jane", preferred: "Jane", cls: "CA-1", canonical: "Doe, Jane", aliases: [] }],
    months: { [month]: { rows: { "doe-jane": { rotation: "Basic Anesthesia", days: { [day]: { t: "BA" } } } }, days: 31 } },
    daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] },
  });
  const phone = await fakePhone();
  // Stored directly: the subscribe route only accepts real push services.
  await st.setJSON("push/subs", { a: { ...phone.sub, pid: "doe-jane" } });
  const sheet = { rooms: [{ or: "7", surgeon: "Smith", staff: "Doe" }], opsc: {}, ob: {}, pat: [], night: [] };
  const first = await call("PUT", `/api/daily/${tomorrow}`, sheet, admin);
  assert.equal(first.status, 200);
  assert.equal(first.body.alerted, 1);
  const msg = phone.open(phone.received[0].body);
  assert.equal(msg.title, "Tomorrow's OR schedule is posted");
  assert.equal(msg.body, "You're in OR 7 with Smith.");
  assert.equal(msg.url, `/#/day/${tomorrow}`);
  // A fix to the same day doesn't alert again, unless the admin asks.
  assert.equal((await call("PUT", `/api/daily/${tomorrow}`, sheet, admin)).body.alerted, 0);
  assert.equal((await call("PUT", `/api/daily/${tomorrow}`, { ...sheet, notify: true }, admin)).body.alerted, 1);
  // A sheet typed in for a past day never alerts.
  assert.equal((await call("PUT", `/api/daily/${addDays(today, -3)}`, sheet, admin)).body.alerted, 0);
  phone.close();
  assert.equal(phone.received.length, 2);
});

test("shared hours: the sharing device owns them, only admins read them, and they add up", async () => {
  const entry = (date, hours = 12) => ({ date, start: 360, endDate: date, end: 360 + hours * 60, hours, type: "Duty Hours", rotation: "TEST ROTATION" });
  const key = "k".repeat(40);
  const put = (body) => call("PUT", "/api/hours/doe-jane", body, viewer);
  assert.equal((await put({ key, entries: [entry("2026-10-01"), entry("2026-10-02")] })).body.entries, 2);
  assert.equal((await put({ key, entries: [entry("2026-10-02", 10), entry("2026-10-03")] })).body.entries, 3); // additive; a day can be corrected
  assert.equal((await put({ key: "o".repeat(40), entries: [entry("2026-10-04")] })).status, 409); // another device
  assert.equal((await call("GET", "/api/hours", undefined, viewer)).status, 403); // residents can't read anyone's
  let all = (await call("GET", "/api/hours", undefined, admin)).body.people;
  assert.deepEqual(all["doe-jane"].entries.map((e) => e.hours), [12, 10, 12]);
  // Taking over from a new device starts from that device's hours, and the chiefs see the move.
  assert.equal((await put({ key: "n".repeat(40), entries: [entry("2026-10-05")], replace: true })).status, 200);
  all = (await call("GET", "/api/hours", undefined, admin)).body.people;
  assert.equal(all["doe-jane"].entries.length, 1);
  assert.equal(all["doe-jane"].moves.length, 1);
  // Bad rows are dropped; someone else can't delete them; a chief can.
  assert.equal((await put({ key: "n".repeat(40), entries: [{ date: "nope", hours: 5 }] })).status, 400);
  assert.equal((await call("DELETE", "/api/hours/doe-jane", { key: "z".repeat(40) }, viewer)).status, 403);
  assert.equal((await call("DELETE", "/api/hours/doe-jane", {}, admin)).status, 200);
  assert.deepEqual((await call("GET", "/api/hours", undefined, admin)).body.people, {});
});

test("swap requests: post, offer within the class, accept only by the asker, then cancel", async () => {
  const st = openStore();
  const today = todayLocal();
  const day = (n) => addDays(today, n);
  const month = (d) => d.slice(0, 7);
  const rows = { a: { rotation: "Basic Anesthesia", days: {} }, b: { rotation: "Basic Anesthesia", days: {} }, c: { rotation: "Basic Anesthesia", days: {} } };
  const months = {};
  const put = (pid, date, t) => { (months[month(date)] ||= { rows: JSON.parse(JSON.stringify(rows)), days: 31 }).rows[pid].days[Number(date.slice(8))] = { t }; };
  put("a", day(3), "H1");
  put("b", day(5), "H2");
  put("a", day(4), "BA");
  for (const m of Object.values(months)) for (const r of Object.values(m.rows)) r.days ||= {};
  const person = (id, cls) => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Test", cls, canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  await st.setJSON("dataset", { people: [person("a", "CA-1"), person("b", "CA-1"), person("c", "CA-2")], months, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  const ka = "a".repeat(40), kb = "b".repeat(40), kc = "c".repeat(40);
  assert.equal((await call("POST", "/api/swaps", { pid: "a", date: day(4), key: ka }, viewer)).status, 400); // a regular day
  const made = await call("POST", "/api/swaps", { pid: "a", date: day(3), key: ka, note: "Family thing" }, viewer);
  assert.equal(made.status, 200);
  assert.equal(made.body.swap.label, "24-hr call (H1)");
  assert.equal((await call("POST", "/api/swaps", { pid: "a", date: day(3), key: ka }, viewer)).status, 409); // asked already
  const id = made.body.swap.id;
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "offer", pid: "c", key: kc }, viewer)).status, 400); // another class
  const offer = await call("POST", `/api/swaps/${id}`, { action: "offer", pid: "b", key: kb, date: day(5) }, viewer);
  assert.equal(offer.body.swap.offers[0].label, "12-hr call (H2)"); // a trade
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "accept", offerPid: "b", key: kb }, viewer)).status, 403);
  const agreed = await call("POST", `/api/swaps/${id}`, { action: "accept", offerPid: "b", key: ka }, viewer);
  assert.equal(agreed.body.swap.status, "agreed");
  assert.equal(agreed.body.swap.agreed.date, day(5));
  // What anyone sees has no device keys; each device sees which ones are its own.
  const seen = await call("GET", "/api/swaps", undefined, { ...viewer, "x-device-key": kb });
  assert.ok(!JSON.stringify(seen.body).includes("keyHash"));
  assert.equal(seen.body.swaps[0].mine, false);
  assert.equal(seen.body.swaps[0].offers[0].mine, true);
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "emailed", key: kb }, viewer)).status, 200); // the taker can send the email too
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "cancel", key: kb }, viewer)).status, 403);
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "cancel", key: ka }, viewer)).body.swap.status, "cancelled");
  assert.deepEqual((await call("GET", "/api/swaps", undefined, viewer)).body.swaps, []);
});

test("devices: one tap and a resident's swap requests, case log and hours work on another of their devices", async () => {
  const st = openStore();
  const today = todayLocal();
  const day = (n) => addDays(today, n);
  const months = {};
  const put = (pid, date, t) => {
    const m = (months[date.slice(0, 7)] ||= { rows: { a: { rotation: "Basic Anesthesia", days: {} }, b: { rotation: "Basic Anesthesia", days: {} } }, days: 31 });
    m.rows[pid].days[Number(date.slice(8))] = { t };
  };
  put("a", day(3), "H1");
  const person = (id) => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Test", cls: "CA-1", canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  await st.setJSON("dataset", { people: [person("a"), person("b")], months, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  for (const k of ["swaps", "devices/a", "cases/a", "hours/a", "calseen/a"]) await st.delete(k);
  const safari = "s".repeat(40), homeApp = "h".repeat(40), classmate = "x".repeat(40);
  const as = (key) => ({ ...viewer, "x-device-key": key });

  // Safari asks for a swap and starts the case log: that device is theirs.
  const id = (await call("POST", "/api/swaps", { pid: "a", date: day(3), key: safari }, viewer)).body.swap.id;
  await call("PUT", "/api/cases/a", { cases: [], days: { [day(-1)]: { none: true } } }, as(safari));
  assert.equal((await call("GET", "/api/me/a", undefined, as(safari))).body.linked, true);

  // The Home Screen app is a stranger: it hears what's kept elsewhere and can't change any of it.
  let me = await call("GET", "/api/me/a", undefined, as(homeApp));
  assert.deepEqual([me.body.linked, me.body.elsewhere.requests, me.body.elsewhere.any], [false, 1, true]);
  assert.equal((await call("GET", "/api/swaps", undefined, { ...as(homeApp), "x-me": "a" })).body.swaps[0].mine, false);
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "cancel", key: homeApp }, viewer)).status, 403);
  assert.equal((await call("GET", "/api/cases/a", undefined, as(homeApp))).body.owned, false);

  // One tap, and all of it works there too.
  me = await call("POST", "/api/me/a/link", { key: homeApp }, viewer);
  assert.deepEqual([me.body.linked, me.body.devices, me.body.elsewhere], [true, 2, null]);
  assert.equal((await call("GET", "/api/swaps", undefined, { ...as(homeApp), "x-me": "a" })).body.swaps[0].mine, true);
  const log = await call("GET", "/api/cases/a", undefined, as(homeApp));
  assert.equal(log.body.owned, true);
  assert.deepEqual(Object.keys(log.body.days), [day(-1)]);
  // Saying you're them isn't enough: a classmate's phone still can't change their request.
  assert.equal((await call("GET", "/api/swaps", undefined, { ...as(classmate), "x-me": "a" })).body.swaps[0].mine, false);
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "cancel", key: classmate }, viewer)).status, 403);

  // Hours from either of their devices add up, with no "replace" question.
  const entry = (date) => ({ date, start: 360, endDate: date, end: 1080, hours: 12, type: "Duty Hours", rotation: "TEST ROTATION" });
  assert.equal((await call("PUT", "/api/hours/a", { key: safari, entries: [entry("2026-10-01")] }, viewer)).status, 200);
  assert.equal((await call("PUT", "/api/hours/a", { key: homeApp, entries: [entry("2026-10-02")] }, viewer)).body.entries, 2);
  assert.equal((await call("PUT", "/api/hours/a", { key: classmate, entries: [entry("2026-10-03")] }, viewer)).status, 409);

  // Once a calendar app reads their feed, the app knows not to offer subscribing again.
  assert.equal((await call("GET", "/api/me/a", undefined, as(homeApp))).body.calendarAt, null);
  const feed = new URL((await call("GET", "/api/caltoken/a", undefined, viewer)).body.url);
  const ics = await api(new Request(`http://localhost${feed.pathname}`));
  assert.equal(ics.status, 200);
  assert.ok((await call("GET", "/api/me/a", undefined, as(homeApp))).body.calendarAt);

  // And the request can be cancelled from the Home Screen app now.
  assert.equal((await call("POST", `/api/swaps/${id}`, { action: "cancel", key: homeApp }, viewer)).body.swap.status, "cancelled");
});

test("the chiefs' inbox: sick calls alert admins once, swaps and no-call lists wait for one evening summary", async () => {
  const st = openStore();
  const { sendDigest } = await import("../lib/reqlog.js");
  const today = todayLocal();
  const tomorrow = addDays(today, 1);
  const months = {};
  const row = (rotation) => ({ rotation, days: {} });
  for (const date of [today, tomorrow, addDays(today, 3), addDays(today, 5)]) {
    months[date.slice(0, 7)] ||= { rows: { a: row("Basic Anesthesia"), b: row("Basic Anesthesia"), e: row("Elective - Jeopardy") }, days: 31 };
  }
  const set = (pid, date, t) => { months[date.slice(0, 7)].rows[pid].days[Number(date.slice(8))] = { t }; };
  set("a", tomorrow, "BA"); set("e", tomorrow, "ELECT-J"); set("a", addDays(today, 3), "H1"); set("b", addDays(today, 5), "H2");
  const person = (id, cls) => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Test", cls, canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  await st.setJSON("dataset", { people: [person("a", "CA-1"), person("b", "CA-1"), person("e", "CA-3")], months, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.setJSON("reqlog", { list: [], digestAt: null });
  const chief = await fakePhone(), quiet = await fakePhone(), sickOnly = await fakePhone(), resident = await fakePhone();
  await st.setJSON("push/subs", {
    c: { ...chief.sub, pid: null, admin: true, mode: "smart" },
    q: { ...quiet.sub, pid: null, admin: true, mode: "off" },
    s: { ...sickOnly.sub, pid: null, admin: true, mode: "sick" },
    r: { ...resident.sub, pid: "b", admin: false },
  });
  // A sick call: admins who want them hear right away; residents and "off" don't.
  const sick = await call("POST", "/api/requests", { type: "sick", pid: "a", date: tomorrow }, viewer);
  assert.equal(sick.body.alerted, 2);
  const msg = chief.open(chief.received[0].body);
  assert.equal(msg.title, "Sick call: Test ResA");
  assert.match(msg.body, /^Tomorrow \(.+\): Basic Anesthesia\. Jeopardy: Test ResE\.$/);
  assert.equal(msg.url, "/#/admin/requests");
  assert.equal(quiet.received.length + resident.received.length, 0);
  assert.equal((await call("POST", "/api/requests", { type: "sick", pid: "a", date: tomorrow }, viewer)).body.alerted, 0); // no second buzz
  // A no-call list, sent twice: the second replaces the first. Weekdays and odd reasons are cleaned.
  const month = addDays(today, 40).slice(0, 7);
  const fri = (await import("../public/core/requests.js")).weekendsOf(month)[1].days[0];
  await call("POST", "/api/requests", { type: "nocall", pid: "b", month, picks: { [fri]: "Wedding" } }, viewer);
  await call("POST", "/api/requests", { type: "nocall", pid: "b", month, picks: { [fri]: "Travel", [addDays(fri, -2)]: "Wedding", [addDays(fri, 1)]: "Because" }, note: "Out of town" }, viewer);
  // An agreed swap goes in too.
  const ka = "a".repeat(40), kb = "b".repeat(40);
  const id = (await call("POST", "/api/swaps", { pid: "a", date: addDays(today, 3), key: ka }, viewer)).body.swap.id;
  await call("POST", `/api/swaps/${id}`, { action: "offer", pid: "b", key: kb }, viewer);
  await call("POST", `/api/swaps/${id}`, { action: "accept", offerPid: "b", key: ka }, viewer);
  assert.equal((await call("GET", "/api/requests", undefined, viewer)).status, 403); // admins only
  let items = (await call("GET", "/api/requests", undefined, admin)).body.items;
  assert.deepEqual(items.map((i) => i.type).sort(), ["nocall", "sick", "swap"]);
  const list = items.find((i) => i.type === "nocall");
  assert.deepEqual(list.picks, { [fri]: "Travel", [addDays(fri, 1)]: "Other" });
  assert.equal(list.note, "Out of town");
  assert.equal(chief.received.length, 1); // still only the sick call: swaps and lists wait
  // The evening summary: once, to "smart" admins only, and not again with nothing new.
  const d1 = await sendDigest(st);
  assert.deepEqual(d1, { items: 2, sent: 1 });
  const digest = chief.open(chief.received[1].body);
  assert.equal(digest.title, "Requests waiting");
  assert.match(digest.body, /^1 swap for the call sheet · 1 no-call list for /);
  assert.equal(sickOnly.received.length, 1);
  assert.deepEqual(await sendDigest(st), { items: 0, sent: 0 });
  // Done is shared; a swap undone before anyone acted simply leaves the inbox.
  const swapItem = items.find((i) => i.type === "swap");
  await call("POST", "/api/requests/done", { ids: [items.find((i) => i.type === "sick").id] }, admin);
  await call("POST", `/api/swaps/${id}`, { action: "reopen", key: ka }, viewer);
  items = (await call("GET", "/api/requests", undefined, admin)).body.items;
  assert.ok(!items.some((i) => i.id === swapItem.id));
  assert.ok(items.find((i) => i.type === "sick").done);
  // Accepted again and marked done, then cancelled: it comes back flagged, so the sheet gets fixed.
  await call("POST", `/api/swaps/${id}`, { action: "accept", offerPid: "b", key: ka }, viewer);
  const again = (await call("GET", "/api/requests", undefined, admin)).body.items.find((i) => i.type === "swap");
  await call("POST", "/api/requests/done", { ids: [again.id] }, admin);
  await call("POST", `/api/swaps/${id}`, { action: "cancel", key: ka }, viewer);
  const flagged = (await call("GET", "/api/requests", undefined, admin)).body.items.find((i) => i.type === "swap");
  assert.equal(flagged.cancelled, true);
  assert.equal(flagged.done, null);
  for (const p of [chief, quiet, sickOnly, resident]) p.close();
});

// A small workbook in the board runner's layout: `rooms` are [or, surgeon, time, mda, staff].
// `list`: the board runner's own [resident, location, late/call] rows (columns L-N); `egress`:
// the Egress tab's rows [slot, attending, code, resident, note]; `procs`: extra procedure rows
// [label, mda, staff, ja] below the table.
async function fakeWorkbook(date, rooms, { egressDate = date, list = null, egress = [], procs = [], top } = {}) {
  const { zipSync, strToU8 } = await import("fflate");
  const cell = (ref, v) => (typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`);
  const row = (n, cells) => `<row r="${n}">${cells.map(([c, v]) => cell(`${c}${n}`, v)).join("")}</row>`;
  const sheet = (rows) => `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const [y, m, d] = date.split("-");
  const stamp = (x) => { const [yy, mm, dd] = x.split("-"); return `${Number(mm)}/${Number(dd)}/${yy.slice(2)}`; };
  void y; void m; void d;
  const listCells = (n) => (list ? (list[n - 3] ? [["L", list[n - 3][0]], ["M", list[n - 3][1] || ""], ["N", list[n - 3][2] || ""]] : []) : [["L", "Ignored"]]);
  const rows = [
    row(1, [["A", top ?? stamp(date)]]), // `top: " "` leaves it blank, as the board runner sometimes does
    row(2, [["A", "OR"], ["B", "Surgeon"], ["C", "Time"], ["D", "# of cases"], ["E", "MDA"], ["F", "Resident/CRNA"], ["G", "JA"], ["H", "Breaks"], ["L", "Resident"], ...(list ? [["M", "Location that day"], ["N", "Late/Call"]] : [])]),
    ...(list ? [row(3, listCells(3))] : []),
    ...rooms.map((r, i) => row(4 + i, [["A", r[0]], ...(r[1] ? [["B", r[1]], ["C", 0.3125], ["D", 2], ["E", r[3] || "Attending"]] : []), ...(r[4] ? [["F", r[4]]] : []), ...listCells(4 + i)])),
    ...(list ? list.slice(rooms.length + 1).map((x, i) => row(4 + rooms.length + i, [["L", x[0]], ["M", x[1] || ""], ["N", x[2] || ""]])) : []),
    row(30, [["A", "OPSC (3)"], ["B", "OpscMda"], ["G", "PAT"]]),
    row(31, [["B", "Residents"], ["G", "ResC"]]),
    row(32, [["B", "ResE"]]),
    row(34, [["C", "Cath lab (2)"], ["E", "CathMda"], ["G", "OB"], ["I", "Night coverage"]]),
    row(35, [["C", "Some note for the day"], ["G", "ObMda"], ["I", "ResF"]]),
    row(36, [["G", "Residents"]]),
    row(37, [["G", "ResG"]]),
    ...procs.map((x, i) => row(45 + i, [["C", x[0]], ["E", x[1]], ...(x[2] ? [["F", x[2]]] : []), ...(x[3] ? [["G", x[3]]] : [])])),
  ];
  const egressRows = [
    row(1, [["A", stamp(egressDate)], ...(egress.length ? [["B", "Anesthesiologist"], ["E", "Resident"]] : [])]),
    ...egress.map((x, i) => row(2 + i, [["A", x[0]], ["B", x[1]], ["D", x[2]], ["E", x[3]], ["F", x[4]]].filter(([, v]) => v))),
  ];
  return zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="OR Schedule Assignments" r:id="rId1"/><sheet name="Egress List" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(sheet(rows)),
    "xl/worksheets/sheet2.xml": strToU8(sheet(egressRows)),
  });
}

test("the workbook reads like the photo, wherever the blocks below the table land", async () => {
  const { readXlsx } = await import("../lib/xlsx.js");
  const { parseDailyWorkbook, looksComplete } = await import("../lib/daily-sheet.js");
  const wb = readXlsx(await fakeWorkbook("2026-03-11", [["1", "Smith", "", "Mda1", "ResA"], ["2"], ["3", "Jones", "", "Mda2", "X"]]));
  const p = parseDailyWorkbook(wb);
  assert.equal(p.date, "2026-03-11");
  assert.deepEqual(p.rooms.map((r) => [r.or, r.surgeon, r.time, r.cases, r.mda, r.staff]), [["1", "Smith", "7:30", "2", "Mda1", "ResA"], ["3", "Jones", "7:30", "2", "Mda2", "X"]]); // the empty OR 2 is dropped
  assert.deepEqual(p.opsc, { rooms: "3", mdas: ["OpscMda"], residents: ["ResE"] });
  assert.deepEqual(p.procedures, [{ name: "Cath lab", count: "2", mda: "CathMda", staff: "", ja: "" }]); // OB's cells in G stay OB's
  assert.deepEqual(p.pat, ["ResC"]);
  assert.deepEqual(p.ob, { mda: "ObMda", residents: ["ResG"] });
  assert.deepEqual(p.night, ["ResF"]);
  assert.deepEqual(p.notes, ["Some note for the day"]);
  assert.equal(looksComplete(wb, p), true);
  assert.equal(looksComplete(readXlsx(await fakeWorkbook("2026-03-11", [["1", "Smith", "", "M", "ResA"]], { egressDate: "2026-03-10" })), p), false); // egress not redone yet
  assert.equal(looksComplete(wb, { ...p, rooms: [{ surgeon: "Smith", staff: "" }] }), false); // a room with nobody in it
});

test("the live sheet: updates quietly, alerts once it's ready, then only the people it moved", async () => {
  const st = openStore();
  const sync = await import("../lib/daily-sync.js");
  // 3p in Detroit on Mar 10, 2026; the sheet is for Mar 11.
  const at = (mins) => new Date(Date.parse("2026-03-10T19:00:00Z") + mins * 60000);
  const secretId = "1SecretSheetIdForTheTestOnly_abc123";
  const person = (id) => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Test", cls: "CA-1", canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  const rows = { a: { rotation: "Basic Anesthesia", days: {} }, b: { rotation: "Basic Anesthesia", days: {} }, c: { rotation: "Basic Anesthesia", days: {} } };
  await st.setJSON("dataset", { people: ["a", "b", "c"].map(person), months: { "2026-03": { rows, days: 31 } }, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("daily-sync");
  await sync.saveSource(st, secretId);
  const pa = await fakePhone(), pb = await fakePhone();
  await st.setJSON("push/subs", { a: { ...pa.sub, pid: "a" }, b: { ...pb.sub, pid: "b" } });
  const v1 = [["1", "Smith", "", "M", "ResA"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]];
  const v2 = [["1", "Smith", "", "M", "ResA"], ["2", "Jones", "", "M", "ResC"], ["3", "Lee", "", "M", "ResB"]];
  let bytes = await fakeWorkbook("2026-03-11", v1);
  const run = (mins) => sync.syncDaily(st, { now: at(mins), fetchBytes: async () => bytes });
  const daily = async () => (await st.getJSON("dataset")).daily["2026-03-11"];

  await run(0);
  assert.equal((await daily()).draft, true); // shows right away, marked as not final
  assert.equal((await daily()).source, "sheet");
  assert.equal((await daily()).postedAt, "");
  assert.equal(pa.received.length, 0);
  await run(6);
  assert.equal(pa.received.length, 0); // complete, but still being worked on a moment ago
  // An edit restarts the wait.
  bytes = await fakeWorkbook("2026-03-11", [...v1.slice(0, 2), ["3", "Lee", "", "Other", "X"]]);
  await run(9);
  await run(15);
  assert.equal(pa.received.length, 0);
  await run(21);
  assert.equal(pa.received.length, 1); // ready and 12 minutes unchanged: one alert
  assert.equal(pb.received.length, 1);
  assert.equal(pa.open(pa.received[0].body).title, "Tomorrow's OR schedule is posted");
  assert.equal((await daily()).draft, false);
  assert.equal((await daily()).postedAt, at(21).toISOString()); // the app can say when it went out
  assert.ok(Date.parse((await daily()).editedAt) < Date.parse((await daily()).postedAt), "no changes since it was posted");
  assert.deepEqual((await call("GET", "/api/daily-source", undefined, admin)).body.reach, { phones: 2, skipped: 0, sent: 2 }); // how far it got
  await run(40);
  assert.equal(pa.received.length, 1); // never twice
  // A correction after the alert: only the resident it moved hears, once the edits stop.
  bytes = await fakeWorkbook("2026-03-11", v2);
  await run(50);
  assert.equal((await daily()).editedAt, at(50).toISOString()); // "updated 4:50p" in the app
  await run(55);
  assert.equal(pb.received.length, 1); // still being edited
  await run(61);
  assert.equal(pa.received.length, 1);
  assert.equal(pb.received.length, 2);
  const moved = pb.open(pb.received[1].body);
  assert.equal(moved.title, "Your assignment changed for tomorrow");
  assert.match(moved.body, /OR 3 with Lee/);
  // Moved again later: told again, each time, up to three corrections.
  for (const [i, v] of [v1, v2, v1].entries()) {
    bytes = await fakeWorkbook("2026-03-11", v);
    await run(70 + i * 20);
    await run(81 + i * 20);
  }
  assert.equal(pa.received.length, 1); // OR 1 with Smith all along
  assert.equal(pb.received.length, 4); // the first alert and three corrections, not a fourth
  assert.equal((await daily()).rooms[1].staff, "ResB"); // the app still has the latest

  // The next morning: the sheet is cleared, or holds tomorrow's cases under today's date.
  const morning = (mins) => new Date(Date.parse("2026-03-11T13:00:00Z") + mins * 60000);
  const runAt = (mins) => sync.syncDaily(st, { now: morning(mins), fetchBytes: async () => bytes });
  bytes = await fakeWorkbook("2026-03-11", [["1"], ["2"], ["3"]]);
  assert.match((await runAt(0)).held, /mostly empty/);
  // New rooms under today's date: the next day's sheet, started before its date was changed.
  bytes = await fakeWorkbook("2026-03-11", [["1", "New1", "", "M", ""], ["2", "New2", "", "M", ""], ["3", "New3", "", "M", ""]]);
  const early = await runAt(3);
  assert.equal(early.held, null);
  assert.equal(early.date, "2026-03-12");
  assert.match(early.dateNote, /still says .*next OR day/);
  assert.equal((await daily()).rooms[0].surgeon, "Smith"); // today's rooms untouched
  assert.equal((await st.getJSON("dataset")).daily["2026-03-12"].rooms[0].surgeon, "New1");
  assert.equal((await st.getJSON("dataset")).daily["2026-03-12"].draft, true);
  // A real fix to today's sheet still goes through.
  bytes = await fakeWorkbook("2026-03-11", [["1", "Smith", "", "M", "ResC"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]]);
  assert.equal((await runAt(6)).held, null);
  assert.equal((await daily()).rooms[0].staff, "ResC");
  // The date moved on but the rooms didn't: not shown as the next day's sheet.
  bytes = await fakeWorkbook("2026-03-12", [["1", "Smith", "", "M", "ResC"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]]);
  assert.match((await runAt(9)).held, /previous day's rooms/);
  assert.equal((await st.getJSON("dataset")).daily["2026-03-12"].rooms[0].surgeon, "New1"); // not replaced by today's

  // If Google stops answering, the last good version stays and an admin can see why.
  const before = await daily();
  const failed = await sync.syncDaily(st, { now: morning(12), fetchBytes: async () => { throw new Error("Google asked for a sign-in."); } });
  assert.match(failed.error, /sign-in/);
  assert.deepEqual((await daily()).rooms, before.rooms);

  // The link never leaves the server's own record.
  const status = await call("GET", "/api/daily-source", undefined, admin);
  assert.equal(status.body.connected, true);
  assert.ok(!JSON.stringify(status.body).includes(secretId));
  assert.ok(!JSON.stringify((await call("GET", "/api/data", undefined, viewer)).body).includes(secretId));
  assert.equal((await call("GET", "/api/daily-source", undefined, viewer)).status, 403);
  assert.equal(sync.sheetIdFrom("https://docs.google.com/spreadsheets/d/1-AbcdefGhijklmnopqrstuvwxyz/edit?usp=sharing"), "1-AbcdefGhijklmnopqrstuvwxyz");
  assert.equal(sync.sheetIdFrom("https://example.com/nope"), null);
  pa.close(); pb.close();
  await sync.disconnect(st);
});

test("opening the app reads the live sheet if nobody has in the last minute, and never alerts", async () => {
  const st = openStore();
  const sync = await import("../lib/daily-sync.js");
  const person = { id: "a", last: "ResA", first: "Test", preferred: "Test", cls: "CA-1", canonical: "ResA, Test", aliases: [] };
  const months = { "2026-03": { rows: { a: { rotation: "Basic Anesthesia", days: {} } }, days: 31 } };
  await st.setJSON("dataset", { people: [person], months, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("daily-sync");
  await sync.saveSource(st, "1SecretSheetIdForTheTestOnly_abc123");
  const phone = await fakePhone();
  await st.setJSON("push/subs", { a: { ...phone.sub, pid: "a" } });
  try {
    const full = [["1", "Smith", "", "M", "ResA"], ["2", "Jones", "", "M", "X"], ["3", "Lee", "", "M", "Y"]];
    const bytes = await fakeWorkbook("2026-03-11", full);
    let reads = 0;
    const fetchBytes = async () => { reads++; return bytes; };
    const at = (secs) => new Date(Date.parse("2026-03-10T19:00:00Z") + secs * 1000); // 3p, the sheet is for tomorrow
    const daily = async () => (await st.getJSON("dataset")).daily["2026-03-11"];

    await sync.peekDaily(st, { now: at(0), fetchBytes });
    assert.equal(reads, 1); // the first person to open the app gets the sheet as it is right now
    assert.equal((await daily()).draft, true);
    assert.equal(await sync.peekDaily(st, { now: at(40), fetchBytes }), null);
    assert.equal(reads, 1); // the next ones that minute don't wait on Google again
    await sync.syncDaily(st, { now: at(120), fetchBytes });
    assert.equal(await sync.peekDaily(st, { now: at(150), fetchBytes }), null);
    assert.equal(reads, 2); // a scheduled check counts as a read too
    // Ready and quiet for 15 minutes: opening the app still doesn't send the alert; the scheduled check does.
    await sync.peekDaily(st, { now: at(15 * 60), fetchBytes });
    assert.equal(reads, 3);
    assert.equal(phone.received.length, 0);
    await sync.syncDaily(st, { now: at(16 * 60), fetchBytes });
    assert.equal(phone.received.length, 1);
    assert.equal(reads, 4);
    // Google slow for someone opening the app: admins aren't shown an error, and the next opener
    // in that minute doesn't wait for it too.
    const slow = async () => { reads++; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
    assert.equal((await sync.peekDaily(st, { now: at(20 * 60), fetchBytes: slow })).error, null);
    assert.equal(await sync.peekDaily(st, { now: at(20 * 60 + 30), fetchBytes: slow }), null);
    assert.equal(reads, 5);
    // Overnight (3a), nobody's editing: no reads.
    assert.equal(await sync.peekDaily(st, { now: new Date("2026-03-11T07:00:00Z"), fetchBytes }), null);
    assert.equal(reads, 5);

    // Through the app's own request: the schedule it gets back already has the latest sheet.
    const tomorrow = addDays(todayLocal(), 1);
    const sheet = await fakeWorkbook(tomorrow, [["4", "Park", "", "M", "ResA"], ...full.slice(1)]);
    let googled = 0;
    google = async () => { googled++; return new Response(sheet, { headers: { "content-type": "application/octet-stream" } }); };
    const res = await call("GET", "/api/data", undefined, viewer);
    google = null;
    const awake = nowMinutesLocal() >= 5 * 60;
    assert.equal(googled, awake ? 1 : 0);
    if (awake) assert.equal(res.body.daily[tomorrow].rooms[0].surgeon, "Park");
    assert.equal(phone.received.length, 1); // still just the one alert
  } finally {
    phone.close();
    await sync.disconnect(st);
  }
});

test("the still-being-finalized label clears by itself, and phones find out", async () => {
  const st = openStore();
  const sync = await import("../lib/daily-sync.js");
  const person = { id: "a", last: "ResA", first: "Test", preferred: "Test", cls: "CA-1", canonical: "ResA, Test", aliases: [] };
  const months = { "2026-03": { rows: { a: { rotation: "Basic Anesthesia", days: {} } }, days: 31 } };
  const reset = async () => {
    await st.setJSON("dataset", { people: [person], months, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
    await st.delete("daily-sync");
  };
  await reset();
  await sync.saveSource(st, "1SecretSheetIdForTheTestOnly_abc123");
  const phone = await fakePhone();
  await st.setJSON("push/subs", { a: { ...phone.sub, pid: "a" } });
  const full = [["1", "Smith", "", "M", "ResA"], ["2", "Jones", "", "M", "X"], ["3", "Lee", "", "M", "Y"]];
  let bytes = await fakeWorkbook("2026-03-11", full);
  const run = async (now) => { await new Promise((r) => setTimeout(r, 2)); return sync.syncDaily(st, { now, fetchBytes: async () => bytes }); };
  const ds = () => st.getJSON("dataset");
  const draft = async () => (await ds()).daily["2026-03-11"].draft;

  // First seen at 9:55p: 10 quiet minutes lands after the 10p cutoff.
  const night = (mins) => new Date(Date.parse("2026-03-11T01:55:00Z") + mins * 60000);
  await run(night(0));
  const first = (await ds()).updatedAt;
  await run(night(6));
  assert.equal(await draft(), true);
  await run(night(11));
  assert.equal(await draft(), false);
  assert.notEqual((await ds()).updatedAt, first); // otherwise phones keep getting "not modified"
  assert.equal((await ds()).daily["2026-03-11"].postedAt, ""); // final, but nobody was told
  // A late edit brings the label back until the sheet is quiet again.
  bytes = await fakeWorkbook("2026-03-11", [...full.slice(0, 2), ["3", "Lee", "", "Other", "Y"]]);
  await run(night(14));
  assert.equal(await draft(), true);
  await run(night(20));
  assert.equal(await draft(), true);
  await run(night(25));
  assert.equal(await draft(), false);
  assert.equal(phone.received.length, 0); // none of this buzzes anyone

  // Too many empty rooms: not settled, however quiet it is.
  await reset();
  bytes = await fakeWorkbook("2026-03-11", [full[0], ["2", "Jones", "", "M", ""], ["3", "Lee", "", "M", ""]]);
  await run(night(0));
  await run(night(60));
  assert.equal(await draft(), true);

  // Quiet in the morning isn't final. The 2p alert is what ends the draft, and phones hear of it.
  await reset();
  bytes = await fakeWorkbook("2026-03-11", full);
  const day = (h) => new Date(Date.parse("2026-03-10T00:00:00Z") + (h + 4) * 3600000);
  await run(day(9));
  await run(day(11));
  assert.equal(await draft(), true);
  const before = (await ds()).updatedAt;
  await run(day(14));
  assert.equal(phone.received.length, 1);
  assert.equal(await draft(), false);
  assert.notEqual((await ds()).updatedAt, before);
  phone.close();
  await sync.disconnect(st);
});

test("saves at the same moment don't overwrite each other", async () => {
  const st = openStore();
  await st.delete("race");
  await Promise.all(Array.from({ length: 25 }, (_, i) => st.update("race", (v) => ({ ...(v || {}), [i]: true }))));
  assert.equal(Object.keys(await st.getJSON("race")).length, 25);
  await st.delete("race");

  const { withDataset, NO_CHANGE } = await import("../lib/dataset.js");
  const before = await st.getJSON("dataset");
  await st.delete("dataset");
  await Promise.all(Array.from({ length: 10 }, (_, i) => withDataset(st, (d) => { d.fairness[`k${i}`] = i; })));
  assert.equal(Object.keys((await st.getJSON("dataset")).fairness).length, 10);
  const stamp = (await st.getJSON("dataset")).updatedAt;
  await withDataset(st, () => NO_CHANGE);
  assert.equal((await st.getJSON("dataset")).updatedAt, stamp);
  if (before) await st.setJSON("dataset", before);
});

test("the Netlify save retries when someone else got there first, and gives up cleanly", async () => {
  const { updateRecord } = await import("../lib/store.js");
  let stored = { n: 1 }, tries = 0;
  const flaky = {
    read: async () => ({ value: structuredClone(stored) }),
    write: async (next) => { tries++; if (tries < 3) { stored = { n: stored.n + 10 }; return false; } stored = next; return true; },
  };
  const saved = await updateRecord(flaky, (v) => ({ n: v.n + 1 }));
  assert.equal(saved.n, 22); // built on the newest value, not the first one read
  await assert.rejects(updateRecord({ read: async () => null, write: async () => false }, () => ({})), /Too many saves/);
  assert.deepEqual(await updateRecord({ read: async () => ({ value: { a: 1 } }), write: async () => { throw new Error("must not write"); } }, () => undefined), { a: 1 });
});

test("a Netlify save only lands on the exact version it read", async () => {
  const { blobRecord, updateRecord } = await import("../lib/store.js");
  let version = 1, value = { n: 1 };
  const sent = [];
  const blobs = {
    getWithMetadata: async () => ({ data: structuredClone(value), etag: `v${version}` }),
    setJSON: async (key, next, options) => {
      sent.push(options);
      if (options.onlyIfMatch !== `v${version}`) return { modified: false };
      value = next; version++;
      return { modified: true };
    },
  };
  let first = true;
  await updateRecord(blobRecord(blobs, "k"), (v) => {
    if (first) { first = false; value = { n: 100 }; version++; } // someone else saves right after our read
    return { n: v.n + 1 };
  });
  assert.deepEqual(sent, [{ onlyIfMatch: "v1" }, { onlyIfMatch: "v2" }]);
  assert.equal(value.n, 101);
  const empty = { getWithMetadata: async () => null, setJSON: async (key, next, options) => ({ modified: !!options.onlyIfNew }) };
  assert.deepEqual(await updateRecord(blobRecord(empty, "k"), () => ({ made: true })), { made: true });
});

test("only one run works on the live sheet at a time", async () => {
  const st = openStore();
  const { withSyncLock } = await import("../lib/daily-sync.js");
  await st.delete("daily-sync-lock");
  let release;
  const first = withSyncLock(st, () => new Promise((r) => { release = r; }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(await withSyncLock(st, () => "second"), null);
  release("first");
  assert.equal(await first, "first");
  assert.equal(await withSyncLock(st, () => "third"), "third"); // released, even for the next one
  await assert.rejects(withSyncLock(st, () => { throw new Error("boom"); }), /boom/);
  assert.equal(await withSyncLock(st, () => "after a crash"), "after a crash");
});

test("a sheet's time reads properly however the cell is formatted", async () => {
  const { parseDailyWorkbook } = await import("../lib/daily-sheet.js");
  const cells = { "1,1": { text: "3/11/26", value: "3/11/26" }, "2,1": { text: "OR" }, "2,2": { text: "Surgeon" }, "2,3": { text: "Time" }, "2,6": { text: "Resident/CRNA" },
    "3,1": { text: "1" }, "3,2": { text: "Smith" }, "3,3": { text: ":01", value: new Date(Date.UTC(1899, 11, 30, 7, 30)) }, "3,6": { text: "Doe" } };
  const sheet = { name: "OR Schedule", maxRow: 3, maxCol: 6, get: (r, c) => cells[`${r},${c}`] || null, text: (r, c) => cells[`${r},${c}`]?.text ?? "" };
  assert.equal(parseDailyWorkbook({ sheets: [sheet] }).rooms[0].time, "7:30");
});

test("swaps: an agreed swap can't be accepted again, and nobody can replace someone's offer", async () => {
  const st = openStore();
  const person = (id, last) => ({ id, last, first: "T", preferred: "T", cls: "CA-1", canonical: `${last}, T`, aliases: [] });
  const date = addDays(todayLocal(), 3);
  const [y, m, d] = date.split("-");
  const row = (t) => ({ rotation: "Basic Anesthesia", days: { [Number(d)]: { t } } });
  await st.setJSON("dataset", { people: [person("a", "Ana"), person("b", "Bea"), person("c", "Cal")], months: { [`${y}-${m}`]: { rows: { a: row("H2"), b: row(""), c: row("") }, days: 31 } }, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("swaps");
  const keyA = "a".repeat(20), keyB = "b".repeat(20), keyOther = "z".repeat(20);
  const asked = await call("POST", "/api/swaps", { pid: "a", key: keyA, date }, viewer);
  assert.equal(asked.status, 200);
  const url = `/api/swaps/${asked.body.swap.id}`;
  assert.equal((await call("POST", url, { action: "offer", pid: "b", key: keyB }, viewer)).status, 200);
  assert.equal((await call("POST", url, { action: "offer", pid: "b", key: keyOther }, viewer)).status, 403);
  assert.equal((await call("POST", url, { action: "offer", pid: "c", key: keyOther }, viewer)).status, 200);
  assert.equal((await call("POST", url, { action: "accept", offerPid: "b", key: keyA }, viewer)).status, 200);
  assert.equal((await call("POST", url, { action: "accept", offerPid: "c", key: keyA }, viewer)).status, 409);
});

test("bad input gets a clear answer, and deleting a sheet removes its photo", async () => {
  const st = openStore();
  const res = await api(new Request("http://localhost/api/survey", { method: "PUT", headers: { "content-type": "application/json", ...viewer }, body: "{not json" }));
  assert.equal(res.status, 400);
  assert.equal((await call("POST", "/api/import", { people: [{ id: "x" }], months: {} }, admin)).status, 400);
  await st.setJSON("dataset", { people: [], months: {}, daily: { "2026-03-20": { date: "2026-03-20", rooms: [] } }, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.setBytes("photo/2026-03-20", new Uint8Array([1, 2, 3]), "image/jpeg");
  assert.equal((await call("DELETE", "/api/daily/2026-03-20", undefined, admin)).status, 200);
  assert.equal(await st.getBytes("photo/2026-03-20"), null);
});

test("saves stay safe on the real Netlify storage client, not just the local folder", async () => {
  const { BlobsServer } = await import("@netlify/blobs/server");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dmc-blobs-"));
  const token = "test-token", siteID = "test-site";
  const server = new BlobsServer({ directory: dir, token, port: 0 });
  const { port } = await server.start();
  const url = `http://localhost:${port}`;
  const local = process.env.DMC_LOCAL_STORE;
  delete process.env.DMC_LOCAL_STORE;
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: url, uncachedEdgeURL: url, siteID, token })).toString("base64");
  try {
    const st = openStore();
    // Someone else creates the record between our read and our write. Our save must be turned
    // away and redone on top of theirs, never lost. (Netlify's local stand-in gives no version
    // tag on reads, so overwriting an existing record is checked just below, with a fake one.)
    const rivalSaves = (key, rival) => {
      let first = true;
      return async (value) => {
        if (first) {
          first = false;
          await new Promise((r) => setTimeout(r, 15));
          await st.setJSON(key, rival);
          await new Promise((r) => setTimeout(r, 15));
        }
        return { list: [...(value?.list || []), "mine"] };
      };
    };
    assert.equal(await st.getJSON("swaps"), null);
    await st.update("swaps", rivalSaves("swaps", { list: ["theirs"] }));
    assert.deepEqual((await st.getJSON("swaps")).list, ["theirs", "mine"]);
    assert.deepEqual(await st.update("swaps", () => undefined), await st.getJSON("swaps"));
    const { withSyncLock } = await import("../lib/daily-sync.js");
    assert.equal(await withSyncLock(st, () => "ran"), "ran");
    assert.equal(await st.getJSON("daily-sync-lock"), null);
  } finally {
    process.env.DMC_LOCAL_STORE = local;
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    await server.stop();
  }
});

test("no-call lists stay for the scorecard, and a list sent after the call sheet doesn't count", async () => {
  const st = openStore();
  const person = (id) => ({ id, last: id.toUpperCase(), first: "T", preferred: "T", cls: "CA-1", canonical: `${id}, T`, aliases: [] });
  const month = addDays(todayLocal(), 45).slice(0, 7);
  const sat = (() => { for (let d = `${month}-01`; ; d = addDays(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() === 6) return d; })();
  await st.setJSON("dataset", { people: [person("a"), person("b")], months: {}, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("nocall-history");
  await st.delete("reqlog");
  const send = (pid, picks) => call("POST", "/api/requests", { type: "nocall", pid, month, picks }, viewer);
  assert.equal((await send("a", { [sat]: "Wedding" })).status, 200);
  assert.equal((await call("GET", "/api/requests/no-call-history", undefined, viewer)).status, 403);
  let res = await call("GET", "/api/requests/no-call-history", undefined, admin);
  assert.deepEqual(res.body.history[month].a.picks, { [sat]: "Wedding" });
  const ds = await st.getJSON("dataset");
  ds.months[month] = { days: 30, rows: {}, uploadedAt: new Date().toISOString() };
  await st.setJSON("dataset", ds);
  await new Promise((r) => setTimeout(r, 5));
  await send("a", { [sat]: "Travel" });
  await send("b", { [sat]: "Travel" });
  res = await call("GET", "/api/requests/no-call-history", undefined, admin);
  assert.equal(res.body.history[month].a.picks[sat], "Wedding"); // changing it afterward doesn't rewrite what was asked
  assert.equal(res.body.history[month].b, undefined);
  assert.equal((await call("DELETE", "/api/people/a", undefined, admin)).status, 200);
  assert.equal((await call("GET", "/api/requests/no-call-history", undefined, admin)).body.history[month].a, undefined);
});

test("a role word in a room, like PAT giving breaks, doesn't end the room table", async () => {
  const { parseDailyWorkbook } = await import("../lib/daily-sheet.js");
  const cells = {};
  const put = (r, c, text) => { cells[`${r},${c}`] = { text, value: text }; };
  put(1, 1, "3/11/26");
  ["OR", "Surgeon", "Time", "# of cases", "MDA", "Resident/CRNA", "JA", "Breaks"].forEach((t, i) => put(2, i + 1, t));
  [["1", "Smith", "ResA", "PAT"], ["2", "Jones", "ResB", ""], ["3", "Lee", "OB", ""], ["4", "Park", "X", "ResC"]].forEach(([or, surgeon, staff, breaks], i) => {
    put(4 + i, 1, or); put(4 + i, 2, surgeon); put(4 + i, 6, staff);
    if (breaks) put(4 + i, 8, breaks);
  });
  put(10, 5, "MDA"); put(10, 7, "PAT");
  put(11, 1, "OPSC (6)"); put(11, 7, "ResD");
  const sheet = { name: "OR Schedule Assignments", maxRow: 11, maxCol: 8, get: (r, c) => cells[`${r},${c}`] || null, text: (r, c) => cells[`${r},${c}`]?.text ?? "" };
  const p = parseDailyWorkbook({ sheets: [sheet] });
  assert.deepEqual(p.rooms.map((r) => r.or), ["1", "2", "3", "4"]);
  assert.equal(p.rooms[0].breaks, "PAT");
  assert.equal(p.rooms[2].staff, "OB");
  assert.deepEqual(p.pat, ["ResD"]);
  assert.equal(p.opsc.rooms, "6");
});

test("a day first saved from the photo switches to the live sheet without alerting anyone", async () => {
  const st = openStore();
  const sync = await import("../lib/daily-sync.js");
  const person = (id) => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Test", cls: "CA-1", canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  const rows = { a: { rotation: "Basic Anesthesia", days: {} }, b: { rotation: "Basic Anesthesia", days: {} } };
  await st.setJSON("dataset", { people: ["a", "b"].map(person), months: { "2026-03": { rows, days: 31 } }, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("daily-sync");
  const pa = await fakePhone(), pb = await fakePhone();
  await st.setJSON("push/subs", { a: { ...pa.sub, pid: "a" }, b: { ...pb.sub, pid: "b" } });
  // 5p on Mar 10: the photo is saved for Mar 11, and everyone hears once.
  const photo = { rooms: [{ or: "1", surgeon: "Smyth", staff: "ResA" }, { or: "2", surgeon: "Jones", staff: "ResB" }, { or: "3", surgeon: "Lee", staff: "X" }] };
  const { markAnnounced, readState, saveState } = sync;
  const { withDataset, setDaily } = await import("../lib/dataset.js");
  const state = await readState(st);
  await withDataset(st, (d) => { setDaily(d, "2026-03-11", { ...photo, source: "photo", editedAt: "2026-03-10T21:00:00.000Z" }); markAnnounced(state, d, "2026-03-11", new Date("2026-03-10T21:00:00Z")); });
  await saveState(st, state);
  // The workbook now reads properly: same rooms, the surgeon spelled right.
  await sync.saveSource(st, "1SecretSheetIdForTheTestOnly_abc123");
  const bytes = await fakeWorkbook("2026-03-11", [["1", "Smith", "", "M", "ResA"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]]);
  const at = (mins) => new Date(Date.parse("2026-03-10T21:30:00Z") + mins * 60000);
  for (const m of [0, 40, 80]) await sync.syncDaily(st, { now: at(m), fetchBytes: async () => bytes });
  const saved = (await st.getJSON("dataset")).daily["2026-03-11"];
  assert.equal(saved.source, "sheet");
  assert.equal(saved.rooms[0].surgeon, "Smith");
  assert.equal(saved.draft, false);
  assert.equal(saved.postedAt, "2026-03-10T21:00:00.000Z"); // still posted when the photo was saved
  assert.ok(Date.parse(saved.editedAt) - Date.parse(saved.postedAt) < 60000, "a spelling fix isn't shown as an update");
  assert.equal(pa.received.length + pb.received.length, 0); // no "your assignment changed" for a spelling fix
  assert.equal((await readState(st)).rooms, 3);
  pa.close(); pb.close();
  await sync.disconnect(st);
});

test("widget feed: one resident's week, who's on, what's ahead, and when to show tomorrow", async () => {
  const st = openStore();
  const { widgetFeed, switchMinute, planFromQuery } = await import("../lib/widget-feed.js");
  const { createModel } = await import("../public/core/model.js");
  const { zonedTime } = await import("../public/core/dates.js");
  const person = (id, cls = "CA-1") => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Tess", cls, canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  // March 2026: the 10th is a Tuesday.
  const rows = {
    a: { rotation: "Basic Anesthesia", days: { 10: { t: "BA" }, 11: { t: "BA" }, 12: { t: "BA", f: "00FF00" }, 13: { t: "BA", f: "C9DAF8" }, 14: {} } },
    b: { rotation: "Basic Anesthesia", days: { 10: { t: "NF" }, 11: { t: "NF" } } },
  };
  const ds = { people: [person("a"), person("b")], months: { "2026-03": { rows, days: 31 } }, settings: {}, rotations: {}, directory: { people: { a: { numbers: [{ kind: "phone", label: "Mobile", value: "3135550100" }] } }, places: [] },
    daily: { "2026-03-11": { date: "2026-03-11", rooms: [{ or: "7", surgeon: "Smith", time: "7:30", cases: "2", mda: "Jones", staff: "ResA", ja: "", breaks: "ResB" }], opsc: {}, pat: [], ob: {}, night: [] } } };
  const model = createModel(ds);
  const at = (h, m = 0) => zonedTime("2026-03-10", h * 60 + m);
  assert.equal(at(15).toISOString(), "2026-03-10T19:00:00.000Z"); // Detroit is UTC-4 in March
  assert.equal(zonedTime("2026-01-10", 15 * 60).toISOString(), "2026-01-10T20:00:00.000Z"); // and UTC-5 in January

  const feed = widgetFeed(model, "a", { now: at(10) });
  assert.equal(feed.name, "Tess");
  assert.equal(feed.days.length, 9);
  const [tue, wed, thu, fri] = feed.days;
  assert.equal(tue.title, "Basic Anesthesia");
  assert.equal(wed.title, "OR 7 · Smith");
  assert.equal(wed.code, "OR 7");
  assert.deepEqual(wed.lines, ["Starts 7:30 · 2 cases", "MDA Jones", "Breaks ResB"]);
  assert.deepEqual(thu.chips, ["Late till 6p"]);
  assert.equal(fri.title, "24-hr call"); // the call is the news, not the rotation
  assert.deepEqual(fri.chips, []);
  assert.equal(fri.sub, "Basic Anesthesia · Harper");
  assert.deepEqual(tue.on, [{ k: "Night float", v: "ResB" }]);
  assert.deepEqual(feed.ahead[0], { k: "Next late day", v: "Thu 3/12" });
  assert.equal(tue.sub, "Harper"); // the rotation isn't repeated under itself
  assert.equal(wed.sub, "Basic Anesthesia · Harper");
  assert.ok(!JSON.stringify(feed).includes("3135550100")); // names only, never numbers

  // Tomorrow's sheet is final, so a one-day widget moves on at 2p; a draft waits for the shift to end.
  assert.equal(switchMinute(model, "a", "2026-03-10"), 14 * 60);
  assert.deepEqual(feed.screens.slice(0, 2).map((s) => s.date), ["2026-03-10", "2026-03-11"]);
  assert.equal(feed.screens[1].at, at(14).toISOString());
  assert.equal(widgetFeed(model, "a", { now: at(16) }).screens[0].date, "2026-03-11");
  ds.daily["2026-03-11"].draft = true;
  assert.equal(switchMinute(createModel(ds), "a", "2026-03-10"), 18 * 60);
  assert.equal(switchMinute(model, "b", "2026-03-10"), 1440); // on nights, today stays till midnight
  assert.equal(switchMinute(model, "a", "2026-03-13"), 1440); // and through a 24

  assert.deepEqual(planFromQuery("a", "basic.2027-summer.2027-06-05"), { pid: "a", track: "basic", kind: "basic", session: "2027-summer", day: "2027-06-05" });
  assert.equal(planFromQuery("a", "nonsense"), null);

  // Over the wire: a private address per resident, no passcode, and nothing for a wrong one.
  await st.setJSON("dataset", ds);
  const token = await call("GET", "/api/widgettoken/a", undefined, viewer);
  assert.equal(token.status, 200);
  assert.equal((await call("GET", "/api/widgettoken/a")).status, 401);
  const path = new URL(token.body.url).pathname;
  const res = await call("GET", path);
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "Tess");
  assert.equal((await call("GET", "/api/widget/not-a-real-token")).status, 404);
  const cal = await call("GET", "/api/caltoken/a", undefined, viewer);
  assert.equal((await call("GET", `/api/widget/${new URL(cal.body.url).pathname.match(/cal\/(.+)\.ics/)[1]}`)).status, 404); // a calendar link isn't a widget link
});

test("alerts reach the iPhone app through Apple's service, signed and shaped as Apple expects", async () => {
  const st = openStore();
  const http2 = await import("node:http2");
  const apns = await import("../lib/apns.js");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // A stand-in for Apple: records what it was sent, and says one phone no longer exists.
  const seen = [];
  const gone = "b".repeat(64), alive = "a".repeat(64);
  const server = http2.createServer();
  server.on("stream", (stream, headers) => {
    let body = "";
    stream.on("data", (c) => { body += c; });
    stream.on("end", () => {
      seen.push({ headers, body: JSON.parse(body) });
      const dead = headers[":path"].endsWith(gone);
      stream.respond({ ":status": dead ? 410 : 200 });
      stream.end(dead ? JSON.stringify({ reason: "Unregistered" }) : "");
    });
  });
  await new Promise((r) => server.listen(0, r));
  const person = { id: "a", last: "Ana", first: "T", preferred: "T", cls: "CA-1", canonical: "Ana, T", aliases: [] };
  await st.setJSON("dataset", { people: [person], months: {}, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("push/subs");
  const native = (token) => call("POST", "/api/push/subscribe", { native: { platform: "ios", token }, pid: "a" }, viewer);

  // Without Apple's keys on the server the app is told so, instead of signing up for nothing.
  assert.equal((await native(alive)).status, 503);
  assert.equal((await call("GET", "/api/status")).body.configured.appAlerts, false);
  Object.assign(process.env, { APNS_KEY: privateKey.export({ type: "pkcs8", format: "pem" }), APNS_KEY_ID: "KEYID12345", APNS_TEAM_ID: "TEAMID1234", APNS_HOST: `http://localhost:${server.address().port}` });
  try {
    assert.equal((await call("GET", "/api/status")).body.configured.appAlerts, true);
    assert.equal((await native("not-a-token")).status, 400);
    assert.equal((await native(alive)).status, 200);
    assert.equal((await native(gone)).status, 200);
    assert.equal(Object.keys(await st.getJSON("push/subs")).length, 2);

    assert.equal((await call("POST", "/api/push/test", { token: alive }, viewer)).status, 200);
    const sent = seen[0];
    assert.equal(sent.headers[":path"], `/3/device/${alive}`);
    assert.equal(sent.headers["apns-topic"], "app.netlify.dmcschedule");
    assert.equal(sent.headers["apns-push-type"], "alert");
    assert.equal(sent.headers["apns-priority"], "10");
    assert.deepEqual(sent.body, { aps: { alert: { title: "Alerts are on", body: "You'll hear here when the next day's OR schedule is posted." }, sound: "default", "thread-id": "test" }, url: "/#/today" });
    // The signature is Apple's kind: ES256 over "header.claims", by the key the server holds.
    const [head, claims, sig] = sent.headers.authorization.replace(/^bearer /, "").split(".");
    assert.deepEqual(JSON.parse(Buffer.from(head, "base64url")), { alg: "ES256", kid: "KEYID12345" });
    assert.equal(JSON.parse(Buffer.from(claims, "base64url")).iss, "TEAMID1234");
    assert.ok(crypto.verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
    assert.equal(apns.providerToken(), apns.providerToken()); // reused, as Apple asks

    // A real alert goes to both; the phone Apple says is gone is dropped from the list.
    const delivered = await push.sendToSubs(st, () => true, () => ({ title: "Tomorrow's OR schedule is posted", body: "You're in OR 7.", url: "/#/day/2026-03-11", tag: "daily-2026-03-11" }), { urgency: "high" });
    assert.equal(delivered, 1);
    assert.deepEqual(Object.values(await st.getJSON("push/subs")).map((x) => x.apns), [alive]);
    assert.equal((await call("POST", "/api/push/unsubscribe", { token: alive }, viewer)).status, 200);
    assert.deepEqual(await st.getJSON("push/subs"), {});
  } finally {
    for (const k of ["APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_HOST"]) delete process.env[k];
    server.close();
  }
});

test("the demo passcode shows an invented program and can't touch the real one", async () => {
  const st = openStore();
  const real = { id: "real", last: "Realperson", first: "T", preferred: "T", cls: "CA-1", canonical: "Realperson, T", aliases: [] };
  const date = addDays(todayLocal(), 2);
  await st.setJSON("dataset", { people: [real], months: {}, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("swaps");
  process.env.DEMO_PASSCODE = "demo-test";
  const demo = { "x-passcode": "demo-test" };
  try {
    assert.deepEqual((await call("POST", "/api/login", undefined, demo)).body, { viewer: true, admin: false, demo: true });
    assert.equal((await call("POST", "/api/login", undefined, viewer)).body.demo, false);
    const data = (await call("GET", "/api/data", undefined, demo)).body;
    assert.ok(data.people.length >= 12);
    assert.ok(!JSON.stringify(data).includes("Realperson"));
    assert.ok(data.months[todayLocal().slice(0, 7)]);
    assert.ok(!JSON.stringify((await call("GET", "/api/data", undefined, viewer)).body).includes("demo-stone"));
    assert.equal((await call("GET", "/api/hours", undefined, demo)).status, 403); // not an admin
    assert.equal((await call("PUT", "/api/settings", {}, demo)).status, 403);

    // Something a demo visitor saves stays in the demo.
    const { createModel } = await import("../public/core/model.js");
    const { upcomingShifts } = await import("../public/core/requests.js");
    const model = createModel(data);
    const who = model.people.find((p) => p.cls !== "PGY-1" && upcomingShifts(model, p.id, todayLocal(), 40).length);
    const shift = upcomingShifts(model, who.id, todayLocal(), 40)[0];
    assert.equal((await call("POST", "/api/swaps", { pid: who.id, key: "k".repeat(20), date: shift.date }, demo)).status, 200);
    assert.equal((await call("GET", "/api/swaps", undefined, demo)).body.swaps.length, 1);
    assert.equal((await call("GET", "/api/swaps", undefined, viewer)).body.swaps.length, 0);
    assert.equal((await st.getJSON("dataset")).people[0].id, "real");

    // Its calendar and widget addresses work, marked as demo, and real ones are unaffected.
    const w = await call("GET", `/api/widgettoken/${who.id}`, undefined, demo);
    assert.match(w.body.url, /\/api\/widget\/demo-/);
    const feed = await call("GET", new URL(w.body.url).pathname);
    assert.equal(feed.status, 200);
    assert.equal(feed.body.days.length, 9);
    const c = await call("GET", `/api/caltoken/${who.id}`, undefined, demo);
    const ics = await api(new Request(c.body.url));
    assert.equal(ics.status, 200);
    assert.match(await ics.text(), /BEGIN:VCALENDAR/);
    assert.equal((await call("GET", `/api/widgettoken/${who.id}`, undefined, viewer)).status, 404); // no such real resident
    void date;
  } finally {
    delete process.env.DEMO_PASSCODE;
  }
  assert.equal((await call("POST", "/api/login", undefined, { "x-passcode": "demo-test" })).body.viewer, false); // off unless set
});

test("didactics alerts: each one goes out once, to the right phones, and the switch only quiets the general ones", async () => {
  const { sendDidacticAlerts } = await import("../lib/didactic-alerts.js");
  const { setDidactics } = await import("../lib/dataset.js");
  const st = openStore();
  const date = "2026-11-02"; // a Monday
  const person = (id, last, first, cls) => ({ id, last, first, preferred: first, cls, canonical: `${last}, ${first}`, aliases: [] });
  const ds = {
    people: [person("doe-jane", "Doe", "Jane", "CA-1"), person("roe-max", "Roe", "Max", "CA-2"), person("poe-kim", "Poe", "Kim", "CA-3")],
    months: { "2026-11": { rows: {
      "doe-jane": { rotation: "Basic Anesthesia", days: { 2: { t: "BA" } } },
      "roe-max": { rotation: "Cardiac", days: { 2: { t: "Vac" } } },
      "poe-kim": { rotation: "Basic Anesthesia", days: { 2: { t: "BA" } } },
    }, days: 30 } },
    daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] },
  };
  setDidactics(ds, "2026-11", {
    zoom: [{ key: "monday", label: "Monday Zoom", url: "https://example.zoom.us/j/1" }],
    events: [{ date, start: "17:00", end: "18:00", series: "monday", kind: "board-review", title: "Board review", virtual: true, zoom: "monday",
      people: [{ name: "Poe", role: "presenter", topic: "Acid-base" }, { name: "Dr. Smith", role: "moderator" }] }],
  });
  await st.setJSON("dataset", ds);
  const [jane, max, poe, quietPoe] = await Promise.all([fakePhone(), fakePhone(), fakePhone(), fakePhone()]);
  const id = (sub) => push.phoneId(sub);
  await st.setJSON("push/subs", {
    [id(jane.sub)]: { ...jane.sub, pid: "doe-jane" },
    [id(max.sub)]: { ...max.sub, pid: "roe-max" }, // on vacation
    [id(poe.sub)]: { ...poe.sub, pid: "poe-kim" },
    [id(quietPoe.sub)]: { ...quietPoe.sub, pid: "poe-kim", lectures: false }, // still hears about presenting
  });
  const site = "https://dmc.example";
  const run = (day, min) => sendDidacticAlerts(st, { now: zonedTime(day, min), site });
  const last = (phone) => phone.open(phone.received.at(-1).body);

  assert.deepEqual(await run("2026-11-01", 1140), { due: 1, sent: 2 }); // Sunday 7p: the presenter's two phones
  assert.equal(last(poe).title, "Tomorrow you present at 5p");
  assert.equal(last(poe).body, "Acid-base. On Zoom. Moderator: Dr. Smith. Have your slides ready to share.");
  assert.deepEqual(await run("2026-11-01", 1145), { due: 1, sent: 0 }); // already sent
  assert.deepEqual(await run(date, 1000), { due: 1, sent: 2 }); // 4:40p: set up, not "starts in 5 minutes"
  assert.equal(last(quietPoe).title, "You present at 5p");
  assert.equal(last(quietPoe).body, "Join by 4:55p to test sharing your screen. Tap to join.");
  assert.deepEqual(await run(date, 1010), { due: 0, sent: 0 });
  assert.deepEqual(await run(date, 1015), { due: 1, sent: 1 }); // 4:55p: everyone else it's for
  assert.deepEqual(await run(date, 1016), { due: 1, sent: 0 });
  jane.close(); max.close(); poe.close(); quietPoe.close();
  assert.deepEqual([jane.received.length, max.received.length, poe.received.length, quietPoe.received.length], [1, 0, 2, 2]);
  const got = jane.received[0];
  assert.equal(got.headers.urgency, "high");
  assert.equal(got.headers.ttl, "600"); // no use once the session is well under way
  const msg = jane.open(got.body);
  assert.equal(msg.title, "Monday board review starts in 5 minutes");
  assert.equal(msg.body, "5p Board review · Dr. Smith. On Zoom: tap to join.");
  assert.equal(msg.url, "/#/didactics");
  assert.equal(msg.origin, site);

  // The switch in More > Alerts, and it survives the phone signing up again.
  const endpoint = "https://web.push.apple.com/lectures-test";
  const subscribe = (extra = {}) => call("POST", "/api/push/subscribe", { subscription: { endpoint, keys: jane.sub.keys }, pid: "doe-jane", ...extra }, viewer);
  const saved = async () => (await st.getJSON("push/subs"))[push.phoneId({ endpoint })];
  assert.equal((await subscribe()).status, 200);
  assert.equal((await saved()).lectures, true);
  assert.equal((await call("POST", "/api/push/lectures", { endpoint, on: false }, viewer)).status, 200);
  assert.equal((await subscribe()).status, 200);
  assert.equal((await saved()).lectures, false);
  assert.equal((await call("POST", "/api/push/lectures", { endpoint, on: "yes" }, viewer)).status, 400);
  assert.equal((await call("POST", "/api/push/lectures", { endpoint: "https://web.push.apple.com/nobody", on: true }, viewer)).status, 404);
  assert.equal((await call("POST", "/api/push/lectures", { endpoint, on: true })).status, 401); // passcode needed
});

test("case log: only its own devices read it, ACGME's page gets ready cases, and entering sticks", async () => {
  const { setDaily } = await import("../lib/dataset.js");
  const st = openStore();
  const person = (id, last, first, cls) => ({ id, last, first, preferred: first, cls, canonical: `${last}, ${first}`, aliases: [] });
  const ds = {
    people: [person("doe-jane", "Doe", "Jane", "CA-1"), person("roe-max", "Roe", "Max", "CA-2")],
    months: { "2026-11": { rows: { "doe-jane": { rotation: "Basic Anesthesia", days: { 16: { t: "BA" } } } }, days: 30 } },
    daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] },
  };
  setDaily(ds, "2026-11-16", { rooms: [{ or: "7", surgeon: "Rook", cases: "2", mda: "Smith", staff: "Doe" }] });
  await st.setJSON("dataset", ds);
  const phone = { ...viewer, "x-device-key": "phone-key-0123456789" };
  const other = { ...viewer, "x-device-key": "other-key-0123456789" };
  const kase = (id, extra = {}) => ({ id, day: "2026-11-16", date: "2026-11-16", kind: "or", slot: `2026-11-16|7|${id.slice(-1)}`, seq: Number(id.slice(-1)), or: "7", surgeon: "Rook", word: "Rook", caseId: `11/16/26-Rook-${id.slice(-1)}`, site: "harper", supervisor: { last: "Smith", first: "Alex" }, age: "d", asa: "2", group: "proc", codes: ["general", "sga"], updatedAt: "2026-11-16T22:00:00.000Z", ...extra });

  // Nothing yet: the first device to save owns it, and gets its ACGME button.
  let r = await call("GET", "/api/cases/doe-jane", undefined, phone);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cases, []);
  assert.match(r.body.helper, /\/acgme\.js\?k=[\w-]+$/);
  r = await call("PUT", "/api/cases/doe-jane", { cases: [kase("case00001"), kase("case00002", { asa: "" }), { id: "bad", date: "x" }], days: { "2026-11-15": { none: true } } }, phone);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.cases.map((c) => c.caseId), ["11/16/26-Rook-1", "11/16/26-Rook-2"]);
  assert.equal(r.body.waiting, 1, "the one without an ASA isn't ready");
  assert.deepEqual(r.body.days, { "2026-11-15": { none: true, hidden: [] } });

  // Another device sees only that it exists, until it joins.
  r = await call("GET", "/api/cases/doe-jane", undefined, other);
  assert.deepEqual(r.body, { owned: false, count: 2, devices: 1 });
  r = await call("PUT", "/api/cases/doe-jane", { cases: [kase("case00003")] }, other);
  assert.equal(r.status, 409);
  r = await call("PUT", "/api/cases/doe-jane", { cases: [], join: true }, other);
  assert.equal(r.status, 200);
  assert.equal(r.body.devices, 2);

  // ACGME's page: the private link, with CORS for ACGME only, the ready case in ACGME's terms.
  const helper = new URL(r.body.helper).searchParams.get("k");
  const res = await api(new Request(`http://localhost/api/acgme/${helper}`, { headers: { origin: "https://apps.acgme.org" } }));
  assert.equal(res.headers.get("access-control-allow-origin"), "https://apps.acgme.org");
  const got = await res.json();
  assert.equal(got.first, "Jane");
  assert.equal(got.notReady, 1);
  assert.deepEqual(got.cases.map((c) => [c.caseId, c.date, c.siteId, c.supervisor.last, c.ageId, c.group]), [["11/16/26-Rook-1", "11/16/2026", 12634, "Smith", 33, 681]]);
  assert.deepEqual(got.cases[0].items.map((i) => i.id), [156632, 1256330, 1256333]);
  const pre = await api(new Request(`http://localhost/api/acgme/${helper}`, { method: "OPTIONS" }));
  assert.equal(pre.status, 204);
  assert.equal((await call("GET", "/api/acgme/not-a-real-token")).status, 404);

  // The page saw it in ACGME's list: marked entered (plain-text body, as the page sends it).
  const posted = await api(new Request(`http://localhost/api/acgme/${helper}`, { method: "POST", body: JSON.stringify({ entered: ["case00001"] }) }));
  assert.deepEqual(await posted.json(), { ok: true, changed: 1 });
  r = await call("GET", "/api/cases/doe-jane", undefined, phone);
  assert.ok(r.body.cases.find((c) => c.id === "case00001").enteredAt);
  assert.ok(r.body.helperSeenAt, "the app can tell the button works");
  // A device with an older copy can't undo it by accident; saying so on purpose can.
  r = await call("PUT", "/api/cases/doe-jane", { cases: [kase("case00001", { updatedAt: new Date().toISOString(), enteredAt: "" })] }, phone);
  assert.ok(r.body.cases.find((c) => c.id === "case00001").enteredAt);
  r = await call("POST", "/api/cases/doe-jane/entered", { ids: ["case00001"], on: false }, phone);
  assert.equal(r.body.cases.find((c) => c.id === "case00001").enteredAt, "");
  // Someone else's device can't mark anything, and other residents' logs stay apart.
  assert.equal((await call("POST", "/api/cases/doe-jane/entered", { ids: ["case00001"] }, { ...viewer, "x-device-key": "stranger-key-0123456" })).status, 403);
  assert.deepEqual((await call("GET", "/api/cases/roe-max", undefined, phone)).body.cases, []);
  assert.equal((await call("GET", "/api/cases/doe-jane", undefined, viewer)).status, 400, "a device key is needed");

  // The button also sends ACGME's Supervisor list: every resident's case log can then offer every
  // attending ACGME has, not just the phone directory's. Junk and the "-- Select --" line are dropped.
  await st.delete("acgme-supervisors");
  const names = ["Aaa, Pat", "bbb, quinn", "Ccc, Rory", "Ccc, Rory", "-- Select --", "<script>", "Ddd, Sam"];
  const sent = await api(new Request(`http://localhost/api/acgme/${helper}`, { method: "POST", body: JSON.stringify({ acgmeCount: 12, supervisors: names }) }));
  assert.equal(sent.status, 200);
  r = await call("GET", "/api/cases/roe-max", undefined, other);
  assert.deepEqual(r.body.supervisors.map((s) => `${s.last}, ${s.first}`), ["Aaa, Pat", "bbb, quinn", "Ccc, Rory", "Ddd, Sam"]);
  // One stray name isn't a list, and doesn't replace the one kept.
  await api(new Request(`http://localhost/api/acgme/${helper}`, { method: "POST", body: JSON.stringify({ supervisors: ["Eee, Lee"] }) }));
  assert.equal((await call("GET", "/api/cases/doe-jane", undefined, phone)).body.supervisors.length, 4);

  // ACGME's own count toward the minimums: the button sends ACGME's report file, the app keeps the
  // numbers (not the file or the name in it), the resident's devices see them, and the button
  // knows when it last did.
  await st.delete("acgme-minimums/doe-jane");
  assert.equal((await (await api(new Request(`http://localhost/api/acgme/${helper}`))).json()).minimumsAt, null);
  const file = Buffer.from(minimumsReport()).toString("base64");
  const report = await api(new Request(`http://localhost/api/acgme/${helper}`, { method: "POST", body: JSON.stringify({ minimums: file }) }));
  assert.equal((await report.json()).minimums, true);
  r = await call("GET", "/api/cases/doe-jane", undefined, phone);
  assert.equal(r.body.minimums.asOf, "2026-11-20");
  assert.deepEqual(r.body.minimums.lines.map((l) => [l.name, l.total, l.minimum]), [["Cardiac with CPB", 3, 10], ["Cardiac", 4, 20], ["a. < 3 months", 0, 5]]);
  assert.deepEqual(r.body.minimums.lines[1].parts.map((p) => p.total), [3, 1]);
  assert.ok(!JSON.stringify(await st.getJSON("acgme-minimums/doe-jane")).includes("Resident:"), "only the numbers are kept");
  assert.ok((await (await api(new Request(`http://localhost/api/acgme/${helper}`))).json()).minimumsAt);
  // Anything else sent as the report is ignored.
  const junk = await api(new Request(`http://localhost/api/acgme/${helper}`, { method: "POST", body: JSON.stringify({ minimums: "bm90IGFuIHhscw==" }) }));
  assert.equal((await junk.json()).minimums, false);
  assert.equal((await call("GET", "/api/cases/doe-jane", undefined, phone)).body.minimums.lines.length, 3);
});

// A made-up "Anesthesiology Minimum" report as ACGME's site hands it out: an old-style .xls (BIFF8
// in an OLE2 compound file). Its shared strings run on into a CONTINUE record in the middle of a
// string, as long reports do. Synthetic: no real resident or numbers.
function minimumsReport() {
  const le = (n, size) => { const b = Buffer.alloc(size); if (size === 2) b.writeUInt16LE(n); else b.writeUInt32LE(n >>> 0); return b; };
  const rec = (type, data) => Buffer.concat([le(type, 2), le(data.length, 2), data]);
  const strings = ["Anesthesiology Minimum", "Resident: Test Person", "As of 11/20/2026", "Category", "Minimum", "Total", "Cardiac",
    "    Cardiac with CPB", "    Cardiac without CPB", "Total Cardiac", "Patients less than 12 yrs. old", "    a. < 3 months"];
  const sst = Buffer.concat([le(strings.length, 4), le(strings.length, 4), ...strings.map((s) => Buffer.concat([le(s.length, 2), Buffer.from([0]), Buffer.from(s, "latin1")]))]);
  const cut = sst.indexOf("without") + 3; // mid-string: the rest comes in a CONTINUE with its own flags byte
  const label = (r, c, i) => rec(0x00fd, Buffer.concat([le(r, 2), le(c, 2), le(0, 2), le(i, 4)]));
  const number = (r, c, v) => { const d = Buffer.alloc(14); d.writeUInt16LE(r); d.writeUInt16LE(c, 2); d.writeDoubleLE(v, 6); return rec(0x0203, d); };
  const rk = (r, c, v) => rec(0x027e, Buffer.concat([le(r, 2), le(c, 2), le(0, 2), le((v << 2) | 2, 4)]));
  const bof = (kind) => rec(0x0809, Buffer.concat([le(0x0600, 2), le(kind, 2), Buffer.alloc(12)]));
  const book = Buffer.concat([
    bof(0x0005), rec(0x00fc, sst.subarray(0, cut)), rec(0x003c, Buffer.concat([Buffer.from([0]), sst.subarray(cut)])), rec(0x000a, Buffer.alloc(0)),
    bof(0x0010),
    label(2, 2, 0), label(3, 2, 1), label(4, 2, 2), label(5, 0, 3), label(5, 3, 4), label(5, 4, 5),
    label(6, 0, 6), label(7, 0, 7), rk(7, 3, 10), number(7, 4, 3), label(8, 0, 8), rk(8, 4, 1),
    label(9, 0, 9), number(9, 3, 20), rk(9, 4, 4), label(10, 1, 10), label(11, 1, 11), rk(11, 3, 5), number(11, 4, 0),
    rec(0x000a, Buffer.alloc(0)),
  ]);
  const stream = Buffer.concat([book, Buffer.alloc(Math.max(4096, Math.ceil(book.length / 512) * 512) - book.length)]);
  const n = stream.length / 512;
  const header = Buffer.alloc(512, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x3e, 0x18); header.writeUInt16LE(3, 0x1a); header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e); header.writeUInt16LE(6, 0x20); header.writeUInt32LE(1, 0x2c); header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38); header.writeUInt32LE(0xfffffffe, 0x3c); header.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i === 0 ? 0 : 0xffffffff, 0x4c + i * 4);
  const fat = Buffer.alloc(512, 0xff); // sector 0 the FAT, 1 the directory, 2… the workbook
  fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 0; i < n; i++) fat.writeUInt32LE(i === n - 1 ? 0xfffffffe : 3 + i, (2 + i) * 4);
  const dir = Buffer.alloc(512, 0);
  const entry = (at, name, type, start, size) => {
    Buffer.from(name, "utf16le").copy(dir, at); dir.writeUInt16LE((name.length + 1) * 2, at + 0x40);
    dir[at + 0x42] = type; dir.writeUInt32LE(start, at + 0x74); dir.writeUInt32LE(size, at + 0x78);
  };
  entry(0, "Root Entry", 5, 0xfffffffe, 0);
  entry(128, "Workbook", 2, 2, stream.length);
  return Buffer.concat([header, fat, dir, stream]);
}

test("case log nudges: after a case day with nothing logged, never twice, and weekly when cases wait", async () => {
  const { sendCaseNudges, nudgesFor } = await import("../lib/caselog-nudges.js");
  const { setDaily } = await import("../lib/dataset.js");
  const { createModel } = await import("../public/core/model.js");
  const st = openStore();
  const person = (id, last, first, cls) => ({ id, last, first, preferred: first, cls, canonical: `${last}, ${first}`, aliases: [] });
  const ds = {
    people: [person("doe-jane", "Doe", "Jane", "CA-1"), person("roe-max", "Roe", "Max", "CA-2"), person("poe-kim", "Poe", "Kim", "CA-3")],
    months: { "2026-11": { rows: {
      "doe-jane": { rotation: "Basic Anesthesia", days: { 16: { t: "BA" }, 17: { t: "BA" } } },
      "roe-max": { rotation: "Basic Anesthesia", days: { 16: { t: "NF" } } },
      "poe-kim": { rotation: "PAT", days: { 16: { t: "PAT" } } },
    }, days: 30 } },
    daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] },
  };
  setDaily(ds, "2026-11-16", { rooms: [{ or: "7", surgeon: "Rook", cases: "3", mda: "Smith", staff: "Doe" }] });
  await st.setJSON("dataset", ds);
  const m = createModel(ds);
  const started = { keys: ["x"], cases: {}, days: {}, createdAt: "2026-11-01T00:00:00Z" };
  // A regular day ends 6p here: the nudge is at 6:15p and holds for an hour.
  assert.deepEqual(nudgesFor(m, "doe-jane", started, "2026-11-16", 1094), []);
  const [log] = nudgesFor(m, "doe-jane", started, "2026-11-16", 1095);
  assert.deepEqual(log.payload, { title: "Log today's cases", body: "OR 7 · Rook · 3 cases, already laid out. Tap to log.", url: "/#/cases/2026-11-16", tag: "cases-2026-11-16" });
  assert.deepEqual(nudgesFor(m, "doe-jane", started, "2026-11-16", 1155), []);
  assert.deepEqual(nudgesFor(m, "doe-jane", null, "2026-11-16", 1095), [], "not until they've started a case log");
  assert.deepEqual(nudgesFor(m, "doe-jane", { ...started, days: { "2026-11-16": { none: true, hidden: [] } } }, "2026-11-16", 1095), []);
  assert.deepEqual(nudgesFor(m, "poe-kim", started, "2026-11-16", 1095), [], "no cases in PAT clinic");
  // Interns log a line now and then: no daily nudge even in an OR, only the weekly one for what waits.
  const intern = createModel({ ...ds, people: ds.people.map((p) => (p.id === "doe-jane" ? { ...p, cls: "PGY-1" } : p)) });
  assert.deepEqual(nudgesFor(intern, "doe-jane", started, "2026-11-16", 1095), []);
  const internLine = { ...started, cases: { a: { id: "line000001", day: "2026-11-16", date: "2026-11-16", kind: "procedure", site: "harper", supervisor: { last: "Smith" }, age: "d", asa: "", group: "proc", codes: ["art"] } } };
  assert.equal(nudgesFor(intern, "doe-jane", internLine, "2026-11-22", 1140)[0].payload.title, "1 case waiting for ACGME");
  // Night float: the next morning at 7:30, about last night.
  assert.equal(nudgesFor(m, "roe-max", started, "2026-11-17", 450)[0].payload.title, "Log last night's cases");
  // Partly logged: finish; all logged: nothing.
  const one = { id: "case00001", day: "2026-11-16", date: "2026-11-16", site: "harper", supervisor: { last: "Smith" }, age: "d", asa: "2", group: "proc", codes: ["general"] };
  assert.equal(nudgesFor(m, "doe-jane", { ...started, cases: { a: one } }, "2026-11-16", 1100)[0].payload.title, "1 of 3 cases logged");
  const all = Object.fromEntries([1, 2, 3].map((n) => [`c${n}`, { ...one, id: `case0000${n}` }]));
  assert.deepEqual(nudgesFor(m, "doe-jane", { ...started, cases: all }, "2026-11-16", 1100), []);
  // Sunday 7p: ready cases waiting five days or more.
  const waiting = { ...started, cases: { a: { ...one, date: "2026-11-16", day: "2026-11-16" } } };
  assert.equal(nudgesFor(m, "doe-jane", waiting, "2026-11-22", 1140).find((n) => n.key.includes("acgme")).payload.title, "1 case waiting for ACGME");
  assert.equal(nudgesFor(m, "doe-jane", waiting, "2026-11-22", 1140 - 15).length, 0);

  // Sent once, only to phones that left the switch on.
  const [jane, quiet] = await Promise.all([fakePhone(), fakePhone()]);
  await st.setJSON("push/subs", {
    [push.phoneId(jane.sub)]: { ...jane.sub, pid: "doe-jane" },
    [push.phoneId(quiet.sub)]: { ...quiet.sub, pid: "doe-jane", cases: false },
  });
  await st.setJSON("cases/doe-jane", started);
  const site = "https://dmc.example";
  assert.deepEqual(await sendCaseNudges(st, { now: zonedTime("2026-11-16", 1100), site }), { due: 1, sent: 1 });
  assert.deepEqual(await sendCaseNudges(st, { now: zonedTime("2026-11-16", 1110), site }), { due: 1, sent: 0 });
  assert.equal(jane.received.length, 1);
  assert.equal(quiet.received.length, 0);
  assert.equal(jane.open(jane.received[0].body).url, "/#/cases/2026-11-16");
  jane.close(); quiet.close();
});

test("the board runner's list, the Egress tab and a resident sent to a procedure are all read", async () => {
  const { readXlsx } = await import("../lib/xlsx.js");
  const { parseDailyWorkbook } = await import("../lib/daily-sheet.js");
  const wb = readXlsx(await fakeWorkbook("2026-03-11", [["1", "Smith", "", "Mda1", "ResA"], ["2", "Jones", "", "Mda2", "ResB"], ["3", "Lee", "", "Mda3", "X"]], {
    list: [["ResA", "BA", ""], ["ResB", "BA", "Late"], ["ResH", "Cath lab", ""], ["ResJ", "EP lab", "H1"]],
    egress: [["Board Runner", "Runner", "", "", ""], ["H1 (MOR call)", "Callmda- 8AM", "H1", "ResJ", ""], ["OB 14 (OB call)", "Obcall", "OB", "ResG", "until 7a"], ["H15 (MOR post call)", "Postmda", "", "", ""]],
    procs: [["EP lab (1)", "EpMda", "ResJ", "ResK"], ["MRI", "MriMda", "", ""], ["CT - 3", "CtMda", "", ""]],
  }));
  const p = parseDailyWorkbook(wb);
  assert.deepEqual(p.people, [
    { name: "ResA", where: "BA", call: "" }, { name: "ResB", where: "BA", call: "Late" },
    { name: "ResH", where: "Cath lab", call: "" }, { name: "ResJ", where: "EP lab", call: "H1" },
  ]);
  assert.equal(p.egressDate, "2026-03-11");
  assert.deepEqual(p.egress.attendings, [
    { slot: "Board Runner", name: "Runner" }, { slot: "H1 (MOR call)", name: "Callmda- 8AM" },
    { slot: "OB 14 (OB call)", name: "Obcall" }, { slot: "H15 (MOR post call)", name: "Postmda" },
  ]);
  assert.deepEqual(p.egress.residents, [{ name: "ResJ", where: "H1", note: "" }, { name: "ResG", where: "OB", note: "until 7a" }]);
  assert.deepEqual(p.procedures, [
    { name: "Cath lab", count: "2", mda: "CathMda", staff: "", ja: "" },
    { name: "EP lab", count: "1", mda: "EpMda", staff: "ResJ", ja: "ResK" },
    { name: "MRI", count: "", mda: "MriMda", staff: "", ja: "" }, // no count written
    { name: "CT", count: "3", mda: "CtMda", staff: "", ja: "" },
  ]);
  assert.deepEqual(p.notes, ["Some note for the day"]); // none of them became a note
  assert.deepEqual(p.ob, { mda: "ObMda", residents: ["ResG"] }); // the procedure rows don't take OB's cells
  assert.deepEqual(p.rooms.map((r) => r.staff), ["ResA", "ResB", "X"]); // the list beside the table isn't a room

  // It's all kept when saved, and nothing else sneaks in.
  const { cleanDaily } = await import("../lib/dataset.js");
  const saved = cleanDaily({ ...p, dateNote: "The sheet still says Mar 10." }, "2026-03-11");
  assert.deepEqual(saved.people, p.people);
  assert.deepEqual(saved.egress, p.egress);
  assert.equal(saved.procedures[1].ja, "ResK");
  assert.equal(saved.dateNote, "The sheet still says Mar 10.");
});

test("which day a sheet is for: a stale date never skips a day or files one twice", async () => {
  const { sheetDay, nextOrDay, isOrDay } = await import("../lib/daily-sync.js");
  const rooms = (tag) => ({ rooms: [1, 2, 3].map((n) => ({ or: String(n), surgeon: `${tag}${n}` })) });
  const fri = "2026-03-13", mon = "2026-03-16";
  const fri3p = new Date("2026-03-13T19:00:00Z"), fri9a = new Date("2026-03-13T13:00:00Z");
  const ds = { daily: { [fri]: rooms("Fri") } };
  // New rooms, still dated Friday, on Friday afternoon: Monday's sheet being built.
  const built = sheetDay({ date: fri, ...rooms("New") }, ds, fri3p);
  assert.equal(built.date, mon);
  assert.match(built.note, /still says .*Mon.*next OR day/);
  // Friday's own rooms, touched up: still Friday's.
  assert.deepEqual(sheetDay({ date: fri, ...rooms("Fri") }, ds, fri3p), { date: fri, note: "" });
  // A date ahead at the top is used as it is.
  assert.deepEqual(sheetDay({ date: mon, ...rooms("New") }, ds, fri3p), { date: mon, note: "" });
  // The top still says Thursday, but the Egress tab (done late in the board runner's steps) moved on.
  const eg = sheetDay({ date: "2026-03-12", egressDate: mon, ...rooms("New") }, ds, fri3p);
  assert.equal(eg.date, mon);
  assert.match(eg.note, /egress list says/);
  // Rooms that are mostly Monday's saved sheet stay Monday's, whatever the top says.
  const withMon = { daily: { ...ds.daily, [mon]: rooms("Mon") } };
  assert.equal(sheetDay({ date: "2026-03-12", rooms: [...rooms("Mon").rooms, { or: "4", surgeon: "Added" }] }, withMon, fri3p).date, mon);
  // A morning with no sheet for today yet: new rooms are today's; by afternoon they're the next OR day's.
  const empty = { daily: {} };
  assert.equal(sheetDay({ date: "2026-03-12", ...rooms("New") }, empty, fri9a).date, fri);
  assert.match(sheetDay({ date: "2026-03-12", ...rooms("New") }, empty, fri9a).note, /morning/);
  assert.equal(sheetDay({ date: "2026-03-12", ...rooms("New") }, empty, fri3p).date, mon);
  // Holidays and weekends aren't OR days.
  assert.equal(isOrDay("2026-03-14"), false);
  assert.equal(nextOrDay("2026-11-25"), "2026-11-27"); // Thanksgiving
  assert.equal(nextOrDay("2026-12-24"), "2026-12-28"); // Christmas on a Friday, then the weekend
});

test("a sheet with no date at the top still comes in, filed by its Egress tab or its rooms", async () => {
  const { readXlsx } = await import("../lib/xlsx.js");
  const { parseDailyWorkbook, isoDate } = await import("../lib/daily-sheet.js");
  const sync = await import("../lib/daily-sync.js");
  const rooms = [["1", "Smith", "", "M", "ResA"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]];
  // Blank top cell: read, not rejected, with the day left to the sync.
  const p = parseDailyWorkbook(readXlsx(await fakeWorkbook("2026-03-11", rooms, { top: " ", egressDate: "2026-03-12", procs: [["RIM (0)", "", "", ""]] })));
  assert.equal(p.date, "");
  assert.equal(p.egressDate, "2026-03-12");
  assert.equal(p.rooms.length, 3);
  assert.ok(p.procedures.some((x) => x.name === "RIM" && x.count === "0")); // a procedure line, not a note
  // Dates written out are read too; a word that only starts like a month isn't one.
  const now = new Date("2026-11-24T20:00:00Z");
  assert.equal(isoDate({ text: "Wednesday, November 25, 2026" }, now), "2026-11-25");
  assert.equal(isoDate({ text: "Wed Nov 25" }, now), "2026-11-25");
  assert.equal(isoDate({ text: "Fri Jan 8" }, now), "2027-01-08"); // no year: the nearest one
  assert.equal(isoDate({ text: "11-25-26" }, now), "2026-11-25");
  assert.equal(isoDate({ text: "Marquez 5" }, now), null);
  assert.equal(isoDate({ text: "10-7" }, now), null); // a shift, not a date

  // The whole pass: 3p on Tue Mar 10 with the top blank and the Egress tab on Wed Mar 11.
  const st = openStore();
  const person = (id) => ({ id, last: `Res${id.toUpperCase()}`, first: "Test", preferred: "Test", cls: "CA-1", canonical: `Res${id.toUpperCase()}, Test`, aliases: [] });
  const rows = { a: { rotation: "Basic Anesthesia", days: {} }, b: { rotation: "Basic Anesthesia", days: {} } };
  await st.setJSON("dataset", { people: ["a", "b"].map(person), months: { "2026-03": { rows, days: 31 } }, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });
  await st.delete("daily-sync");
  await st.delete("push/subs");
  await sync.saveSource(st, "1SecretSheetIdForTheTestOnly_abc123");
  const bytes = await fakeWorkbook("2026-03-10", rooms, { top: " ", egressDate: "2026-03-11" });
  const state = await sync.syncDaily(st, { now: new Date("2026-03-10T19:00:00Z"), fetchBytes: async () => bytes });
  assert.equal(state.error, null);
  assert.equal(state.date, "2026-03-11");
  assert.match(state.dateNote, /no date at the top.*egress list says/);
  assert.ok(state.okAt);
  const saved = (await st.getJSON("dataset")).daily["2026-03-11"];
  assert.equal(saved.rooms.length, 3);
  assert.equal(sync.publicStatus({ id: "x" }, state).okAt, state.okAt);
  // Without an Egress date either: new rooms in the afternoon are the next OR day's.
  const p2 = parseDailyWorkbook(readXlsx(await fakeWorkbook("2026-03-10", [["1", "New1", "", "M", "ResA"], ["2", "New2", "", "M", "ResB"], ["3", "New3", "", "M", "X"]], { top: " ", egressDate: "2026-03-10" })));
  const day = sync.sheetDay(p2, { daily: { "2026-03-10": { rooms: [{ or: "1", surgeon: "Old" }] } } }, new Date("2026-03-10T19:00:00Z"));
  assert.equal(day.date, "2026-03-11");
  assert.match(day.note, /^There's no date at the top of the sheet\. The rooms are new/);
});

test("the sheet is read every 3 minutes while it's made, every 15 otherwise; admins hear when it can't be read", async (t) => {
  const sync = await import("../lib/daily-sync.js");
  // Detroit in March (EDT): 9:00a and 9:03a, 1:03p, 11:15p and 11:18p.
  const at = (iso) => new Date(iso);
  assert.equal(sync.scheduledReadDue(at("2026-03-10T13:00:00Z")), true);
  assert.equal(sync.scheduledReadDue(at("2026-03-10T13:03:00Z")), false);
  assert.equal(sync.scheduledReadDue(at("2026-03-10T17:03:00Z")), true);
  assert.equal(sync.scheduledReadDue(at("2026-03-11T03:15:00Z")), true);
  assert.equal(sync.scheduledReadDue(at("2026-03-11T03:18:00Z")), false);

  const st = openStore();
  await st.delete("daily-sync");
  await sync.saveSource(st, "1SecretSheetIdForTheTestOnly_abc123");
  const admin = await fakePhone(), resident = await fakePhone();
  t.after(() => { admin.close(); resident.close(); });
  await st.setJSON("push/subs", { c: { ...admin.sub, pid: null, admin: true, mode: "smart" }, r: { ...resident.sub, pid: "a" } });
  const broken = async () => { throw new Error("The room table's columns have changed."); };
  const run = (iso) => sync.syncDaily(st, { now: at(iso), fetchBytes: broken });
  await run("2026-03-10T18:00:00Z"); // 2:00p: the first failure
  await run("2026-03-10T18:21:00Z");
  assert.equal(admin.received.length, 0); // could be a moment's hiccup
  const s = await run("2026-03-10T18:30:00Z"); // half an hour of it
  assert.equal(admin.received.length, 1);
  assert.equal(resident.received.length, 0); // residents aren't told
  const shown = admin.open(admin.received[0].body);
  assert.equal(shown.title, "The OR sheet isn't coming in");
  assert.match(shown.body, /columns have changed.*since 2p\. Upload the photo/);
  assert.equal(shown.url, "/#/admin");
  assert.equal(s.errorSince, "2026-03-10T18:00:00.000Z");
  await run("2026-03-10T19:30:00Z");
  assert.equal(admin.received.length, 1); // once, not every 3 minutes
  // Late at night nothing buzzes, however long it's been.
  await st.delete("daily-sync");
  await run("2026-03-11T02:30:00Z");
  await run("2026-03-11T03:30:00Z");
  assert.equal(admin.received.length, 1);
});

// The monthly call schedule as the coordinator sends it: one sheet for the month.
async function fakeCallWorkbook(sheetName, rows) {
  const { zipSync, strToU8 } = await import("fflate");
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const col = (n) => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  const row = (r, cells) => `<row r="${r}">${cells.map((v, i) => (v === "" || v == null ? "" : `<c r="${col(i)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join("")}</row>`;
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const body = [
    row(1, ["Last updated", "11/20/26"]),
    row(3, ["Name", "Number", "Rotation", ...days]),
    row(4, ["CA-1"]),
    ...rows.map((r, i) => row(5 + i, [r.name, "", r.rotation, ...days.map((d) => r.days?.[d] || "")])),
  ];
  return zipSync({
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="${sheetName}" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${body.join("")}</sheetData></worksheet>`),
  });
}

test("program emails: who counts, what's a call schedule, a conference schedule or an invite", async () => {
  process.env.MAIL_SENDERS = "coordinator@example.edu";
  const mi = await import("../lib/mail-intake.js");
  const b64 = (text) => Buffer.from(text).toString("base64");
  // What the script sends, checked.
  assert.equal(mi.cleanMail({ id: "x", date: "2026-11-20T10:00:00Z" }), null); // id too short
  assert.equal(mi.cleanMail({ id: "abcdef123", date: "not a date" }), null);
  const mail = mi.cleanMail({
    id: "abcdef123", from: "Coordinator <Coordinator@Example.edu>", subject: "Holiday Party", date: "2026-11-20T10:00:00Z", recipients: "40",
    text: "Join us", attachments: [{ name: "a.ics", type: "text/calendar", data: b64("BEGIN:VCALENDAR") }, { name: "", data: b64("x") }, { name: "empty.pdf", data: "" }],
  });
  assert.equal(mail.recipients, 40);
  assert.deepEqual(mail.attachments.map((a) => a.name), ["a.ics"]);
  assert.equal(Buffer.from(mail.attachments[0].bytes).toString(), "BEGIN:VCALENDAR");

  // The office's emails to the program count; one to a resident or two is personal.
  assert.equal(mi.isProgramMail(mail), true);
  assert.equal(mi.isProgramMail({ ...mail, recipients: 4 }), false);
  assert.equal(mi.isProgramMail({ ...mail, from: "someone@example.edu" }), false);
  const rules = mi.senderRules();
  assert.ok(rules.hashes.includes(mi.senderHash("coordinator@example.edu")));
  assert.ok(rules.domains.includes("example.edu"));
  assert.ok(!JSON.stringify(rules).includes("coordinator"), "addresses go out hashed");

  // Call schedules, and the spreadsheets that aren't.
  const isCall = (subject, name) => mi.isCallSchedule({ subject }, { name });
  assert.equal(isCall("1st DRAFT of DECEMBER Call & PAT Schedule", "DECEMBER 2026 Call Schedule (1st draft).xlsm"), true);
  assert.equal(isCall("November Anesthesia Resident Call & PAT Schedule", "NOVEMBER 2026.xlsx"), true);
  assert.equal(isCall("ASA Presentation Schedule", "ASA 2026 Presentation schedule.xlsx"), false);
  assert.equal(isCall("Reimbursement Info for your Upcoming Trip", "Expense grid.xlsx"), false);
  assert.equal(isCall("December Call Schedule", "Travel voucher call.xlsx"), false);
  // The conference schedule PDF, and the PDFs that aren't.
  const isConf = (subject, name) => mi.isDidacticsPdf({ subject }, { name });
  assert.equal(isConf("November Didactic Schedules", "November 2026 Conference Schedule.pdf"), true);
  assert.equal(isConf("November Anesthesia Resident Call & PAT Schedule", "November 2026 Call Schedule.pdf"), false);
  assert.equal(isConf("PBLD's for NOVEMBER 2026 Attached", "PBLD conference case 1.pdf"), false);
  assert.equal(mi.readingFor({ ...mail, attachments: [{ name: "November 2026 Conference Schedule.pdf" }], subject: "November Didactic Schedules" }, {}).kind, "didactics");
  assert.equal(mi.readingFor({ ...mail, text: "short" }, {}), null);
  assert.equal(mi.readingFor({ ...mail, text: "x".repeat(50) }, { ics: true }), null); // the invite said it all
  assert.equal(mi.readingFor({ ...mail, text: "x".repeat(50) }, {}).kind, "events");

  // Calendar invites: a time zone with colons in its name, UTC, all day, a Zoom link, a cancellation.
  const ics = [
    "BEGIN:VCALENDAR", "METHOD:REQUEST",
    "BEGIN:VEVENT", "SUMMARY:Grand Rounds", "DTSTART;TZID=\"(UTC-05:00) Eastern Time (US & Canada)\":20261202T070000",
    "DTEND;TZID=\"(UTC-05:00) Eastern Time (US & Canada)\":20261202T080000", "LOCATION:https://example.zoom.us/j/1", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Town\\, Hall", "DTSTART:20261210T220000Z", "DTEND:20261210T230000Z", "LOCATION:Main Auditorium", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Wellness Day", "DTSTART;VALUE=DATE:20261215", "STATUS:CANCELLED", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  assert.deepEqual(mi.parseIcs(ics), [
    { title: "Grand Rounds", date: "2026-12-02", start: "07:00", end: "08:00", place: "Zoom", link: "https://example.zoom.us/j/1", cancelled: false },
    { title: "Town, Hall", date: "2026-12-10", start: "17:00", end: "18:00", place: "Main Auditorium", link: "", cancelled: false },
    { title: "Wellness Day", date: "2026-12-15", start: "", end: "", place: "", link: "", cancelled: true },
  ]);
  assert.equal(mi.parseIcs(ics.replace("METHOD:REQUEST", "METHOD:CANCEL")).every((e) => e.cancelled), true);
});

test("program events: one event however it's named, moves, cancellations and short reminders", async () => {
  const mi = await import("../lib/mail-intake.js");
  const today = "2026-11-20";
  const from = (id, date) => ({ id, from: "Coordinator <coordinator@example.edu>", subject: "s", date });
  const invite = mi.cleanEvent({ title: "Holiday Party", date: "2026-12-12", start: "19:00", end: "23:00", place: "Downtown Hall", link: "http://not-https.example", rsvpBy: "2026-12-01", rsvpLink: "https://rsvp.example/x", kind: "social", note: "", who: "All residents", movedFrom: "2026-12-12" }, from("m1", "2026-11-10T10:00:00Z"));
  assert.equal(invite.link, ""); // https only
  assert.equal(invite.who, ""); // everyone isn't a group
  assert.equal(invite.movedFrom, ""); // not moved onto its own day
  assert.equal(invite.from, "Coordinator");
  const ds = { events: [{ title: "Old thing", date: "2026-10-01", start: "" }], updatedAt: null, log: [] };
  assert.equal(mi.upsertEvents(ds, [invite], today), 1);
  assert.deepEqual(ds.events.map((e) => e.title), ["Holiday Party"]); // a month-old event drops off
  assert.ok(ds.updatedAt, "phones see the change");

  // A reminder names it differently and says less: the same event, and what the invite said stays.
  const reminder = mi.cleanEvent({ title: "Anesthesia Holiday Party", date: "2026-12-12", start: "", kind: "social", note: "Dress code: festive" }, from("m2", "2026-12-05T10:00:00Z"));
  mi.upsertEvents(ds, [reminder], today);
  assert.equal(ds.events.length, 1);
  assert.equal(ds.events[0].place, "Downtown Hall");
  assert.equal(ds.events[0].start, "19:00");
  assert.equal(ds.events[0].note, "Dress code: festive");
  assert.equal(ds.events[0].id, invite.id); // the same event for calendars

  // Different classes' sessions on one day are different events.
  const sim1 = mi.cleanEvent({ title: "CA-1 Simulation", date: "2026-12-05", start: "08:00" }, from("m3", "2026-11-11T10:00:00Z"));
  const sim2 = mi.cleanEvent({ title: "CA-2 Simulation", date: "2026-12-05", start: "08:00" }, from("m3", "2026-11-11T10:00:00Z"));
  mi.upsertEvents(ds, [sim1, sim2], today);
  assert.equal(ds.events.filter((e) => /Simulation/.test(e.title)).length, 2);
  assert.equal(mi.sameEvent({ title: "Board Review", date: "2026-12-07" }, { title: "Board Review: Cardiac", date: "2026-12-07" }), true);
  assert.equal(mi.sameEvent({ title: "Board Review", date: "2026-12-07" }, { title: "Wellness Lunch", date: "2026-12-07" }), false);
  assert.equal(mi.sameEvent({ title: "Board Review", date: "2026-12-07" }, { title: "Board Review", date: "2026-12-08" }), false);
  // A new time for the same session updates it.
  mi.upsertEvents(ds, [mi.cleanEvent({ title: "CA-1 Simulation", date: "2026-12-05", start: "09:00" }, from("m3b", "2026-11-12T10:00:00Z"))], today);
  assert.deepEqual(ds.events.filter((e) => e.title === "CA-1 Simulation").map((e) => e.start), ["09:00"]);

  // An older email doesn't undo a newer one.
  mi.upsertEvents(ds, [mi.cleanEvent({ title: "Holiday Party", date: "2026-12-12", place: "Somewhere else" }, from("m0", "2026-11-01T10:00:00Z"))], today);
  assert.equal(ds.events.find((e) => /Party/.test(e.title)).place, "Downtown Hall");

  // Moved to another day: gone from the old one.
  const moved = mi.cleanEvent({ title: "Holiday Party", date: "2026-12-19", start: "19:00", movedFrom: "2026-12-12", place: "Downtown Hall" }, from("m4", "2026-12-06T10:00:00Z"));
  mi.upsertEvents(ds, [moved], today);
  assert.deepEqual(ds.events.filter((e) => /Party/.test(e.title)).map((e) => e.date), ["2026-12-19"]);
  // Cancelled: kept, marked, and the app leaves it out.
  mi.upsertEvents(ds, [mi.cleanEvent({ title: "Holiday Party", date: "2026-12-19", cancelled: true }, from("m5", "2026-12-07T10:00:00Z"))], today);
  assert.equal(ds.events.find((e) => /Party/.test(e.title)).cancelled, true);
  const { createModel } = await import("../public/core/model.js");
  const model = createModel({ people: [], months: {}, daily: {}, settings: {}, directory: { people: {}, places: [] }, events: ds.events });
  assert.deepEqual(model.events(today).map((e) => e.title), ["CA-2 Simulation", "CA-1 Simulation"]); // by time: 8a, then 9a
});

test("program emails arrive at a private address and land where they belong", async () => {
  process.env.MAIL_SENDERS = "coordinator@example.edu";
  const st = openStore();
  await st.delete("mail-log");
  const thisMonth = todayLocal().slice(0, 7);
  const [y, m] = thisMonth.split("-").map(Number);
  const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const [ny, nm] = nextMonth.split("-").map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const [ly, lm] = lastMonth.split("-").map(Number);
  await st.setJSON("dataset", { people: [], months: {}, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] } });

  const info = await call("GET", "/api/mail-intake", undefined, admin);
  assert.equal(info.status, 200);
  const address = new URL(info.body.address).pathname;
  assert.match(address, /^\/api\/mail\/[\w-]{20,}$/);
  assert.ok(info.body.senders.hashes.length >= 2 && info.body.senders.salt);
  assert.equal((await call("GET", "/api/mail-intake", undefined, viewer)).status, 403); // admins only
  // A wrong address is nothing at all, and so is the demo program.
  assert.equal((await call("POST", "/api/mail/not-the-token-at-all-123", { id: "abcdef123" })).status, 404);

  const rows = [{ name: "Resa, Test", rotation: "Basic Anesthesia", days: { 1: "BA", 2: "H1" } }, { name: "Resb, Test", rotation: "Obstetrics", days: { 1: "OB" } }];
  const xlsm = async (sheet) => Buffer.from(await fakeCallWorkbook(sheet, rows)).toString("base64");
  const send = (body) => call("POST", address, { from: "Coordinator <coordinator@example.edu>", recipients: 60, text: "Attached.", ...body });
  const sentAt = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

  // The first draft of next month's schedule: saved, and marked as a draft.
  let r = await send({ id: "draft1aaa", subject: `1st DRAFT of ${MONTHS[nm - 1]} Call & PAT Schedule`, date: sentAt(300), attachments: [{ name: `${MONTHS[nm - 1]} ${ny} Call Schedule (1st draft).xlsm`, data: await xlsm(`${MONTHS[nm - 1]}, ${ny}`) }] });
  assert.equal(r.status, 200);
  assert.match(r.body.actions[0], new RegExp(`Call schedule \\(draft\\) saved for ${nextMonth}`));
  let ds = await st.getJSON("dataset");
  assert.equal(ds.months[nextMonth].draft, true);
  assert.equal(ds.people.length, 2);
  // Sent again (the script retried): nothing happens twice.
  assert.equal((await send({ id: "draft1aaa", subject: "again", date: sentAt(300) })).body.already, true);
  // The final: replaces the draft.
  r = await send({ id: "final1aaa", subject: `${MONTHS[nm - 1]} Anesthesia Resident Call & PAT Schedule`, date: sentAt(200), attachments: [{ name: `${MONTHS[nm - 1]} ${ny}.xlsx`, data: await xlsm(`${MONTHS[nm - 1]}, ${ny}`) }] });
  assert.match(r.body.actions[0], /saved for/);
  assert.equal((await st.getJSON("dataset")).months[nextMonth].draft, false);
  // A draft after the final, an older copy, and a past month are all turned away.
  r = await send({ id: "draft2aaa", subject: `2nd DRAFT of ${MONTHS[nm - 1]} Call Schedule`, date: sentAt(100), attachments: [{ name: "Call Schedule (2nd draft).xlsx", data: await xlsm(`${MONTHS[nm - 1]}, ${ny}`) }] });
  assert.match(r.body.actions[0], /not used: .*the final is already in/);
  r = await send({ id: "older1aaa", subject: `${MONTHS[nm - 1]} Call Schedule`, date: sentAt(250), attachments: [{ name: "Call Schedule.xlsx", data: await xlsm(`${MONTHS[nm - 1]}, ${ny}`) }] });
  assert.match(r.body.actions[0], /not used: .*a newer copy is already in/);
  r = await send({ id: "past1aaaa", subject: `${MONTHS[lm - 1]} Call Schedule`, date: sentAt(50), attachments: [{ name: `${MONTHS[lm - 1]} ${ly} Call Schedule.xlsx`, data: await xlsm(`${MONTHS[lm - 1]}, ${ly}`) }] });
  assert.match(r.body.actions[0], /not used: .*past month/);
  // A spreadsheet that only looks like one is reported, not a crash.
  r = await send({ id: "broken1aa", subject: "Call Schedule", date: sentAt(40), attachments: [{ name: "Call Schedule.xlsx", data: Buffer.from("not a zip").toString("base64") }] });
  assert.equal(r.status, 200);
  assert.match(r.body.actions[0], /Couldn't read Call Schedule\.xlsx/);

  // An invite: its events go in straight away (Claude isn't needed for it).
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Town Hall", `DTSTART;TZID=Eastern Standard Time:${nextMonth.replace("-", "")}10T170000`, `DTEND;TZID=Eastern Standard Time:${nextMonth.replace("-", "")}10T180000`, "LOCATION:Main Auditorium", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  r = await send({ id: "invite1aa", subject: "Resident Town Hall", date: sentAt(30), attachments: [{ name: "invite.ics", type: "text/calendar", data: Buffer.from(ics).toString("base64") }] });
  assert.match(r.body.actions[0], /1 event from the invite: Town Hall/);
  ds = await st.getJSON("dataset");
  assert.deepEqual(ds.events.map((e) => [e.title, e.date, e.start, e.place]), [["Town Hall", `${nextMonth}-10`, "17:00", "Main Auditorium"]]);
  // Any other email waits for Claude, which isn't set up in the tests: nothing is left behind.
  r = await send({ id: "party1aaa", subject: "Holiday Party", date: sentAt(20), text: "Please join us for the holiday party on Saturday, December 12 at 7pm." });
  assert.match(r.body.actions[0], /Not read: Claude isn't set up/);
  assert.equal(await st.getJSON("mailq/party1aaa"), null);

  // A personal email: skipped, and not even its subject is kept.
  r = await send({ id: "personal1", subject: "Your receipts", recipients: 2, date: sentAt(10), text: "Hi, about your receipts: please send them again." });
  assert.match(r.body.actions[0], /personal/);
  const log = (await call("GET", "/api/mail-intake", undefined, admin)).body;
  const entry = log.list.find((x) => x.id === "personal1");
  assert.equal(entry.subject, "");
  assert.equal(entry.personal, true);
  assert.ok(!JSON.stringify(log).includes("receipts"));
  assert.equal(log.list[0].id, "personal1"); // newest first
  assert.ok(log.lastAt);
});

test("the background reader saves a conference schedule and events, and never over an admin's month", async () => {
  process.env.MAIL_SENDERS = "coordinator@example.edu";
  const st = openStore();
  const { readQueuedMail } = await import("../netlify/functions/read-mail-background.mjs");
  const month = addDays(todayLocal(), 40).slice(0, 7);
  await st.setJSON("dataset", { people: [], months: {}, daily: {}, settings: {}, rotations: {}, directory: { people: {}, places: [] }, didactics: {} });
  await st.delete("mail-didactics");
  await st.update("mail-log", () => ({ list: [{ id: "conf1aaaa", actions: ["Conference schedule sent to be read"] }, { id: "evts1aaaa", actions: [] }, { id: "conf2aaaa", actions: [] }], lastAt: new Date().toISOString() }));
  const base = { from: "Coordinator <coordinator@example.edu>", date: new Date().toISOString(), recipients: 60, attachments: [] };
  const readPdf = async () => ({ didactics: { month, events: [{ date: `${month}-07`, start: "17:00", end: "18:00", title: "Airway", kind: "lecture" }] } });

  await st.setJSON("mailq/conf1aaaa", { ...base, id: "conf1aaaa", subject: "Didactic Schedules", text: "", reading: { kind: "didactics", attachment: "x.pdf" } });
  await st.setBytes("mailq/conf1aaaa.pdf", new Uint8Array([37, 80, 68, 70]), "application/pdf");
  assert.match(await readQueuedMail(st, "conf1aaaa", { readPdf }), new RegExp(`saved for ${month} \\(1 sessions\\)`));
  let ds = await st.getJSON("dataset");
  assert.equal(ds.didactics[month].events[0].title, "Airway");
  assert.equal(ds.didactics[month].hasPdf, true);
  assert.ok(await st.getBytes(`didactics-pdf/${month}`));
  assert.equal(await st.getJSON("mailq/conf1aaaa"), null); // done with
  assert.equal(await st.getBytes("mailq/conf1aaaa.pdf"), null);

  // An admin edits that month by hand: a later email's copy doesn't replace theirs.
  await st.delete("mail-didactics");
  await st.setJSON("mailq/conf2aaaa", { ...base, id: "conf2aaaa", subject: "Didactic Schedules (updated)", text: "", reading: { kind: "didactics", attachment: "x.pdf" } });
  await st.setBytes("mailq/conf2aaaa.pdf", new Uint8Array([37, 80, 68, 70]), "application/pdf");
  assert.match(await readQueuedMail(st, "conf2aaaa", { readPdf: async () => ({ didactics: { month, events: [{ date: `${month}-08`, title: "Other" }] } }) }), /not used: an admin already saved that month/);
  assert.equal((await st.getJSON("dataset")).didactics[month].events[0].title, "Airway");

  // Events: cleaned, merged, and the email's log says what was found.
  await st.setJSON("mailq/evts1aaaa", { ...base, id: "evts1aaaa", subject: "Holiday Party", text: "Party!", reading: { kind: "events" } });
  const readEvents = async (m) => {
    assert.equal(m.subject, "Holiday Party"); // the reader gets the email
    return [{ title: "Holiday Party", date: `${month}-12`, start: "19:00", end: "", place: "Hall", link: "", rsvpBy: "", rsvpLink: "", kind: "social", note: "", who: "", cancelled: false, movedFrom: "" }, { title: "No date", date: "soon" }];
  };
  assert.match(await readQueuedMail(st, "evts1aaaa", { readEvents }), new RegExp(`Events: Holiday Party \\(${month}-12\\)`));
  ds = await st.getJSON("dataset");
  assert.deepEqual(ds.events.map((e) => e.title), ["Holiday Party"]);
  const log = await st.getJSON("mail-log");
  assert.match(log.list.find((x) => x.id === "evts1aaaa").actions.at(-1), /Events: Holiday Party/);
  // A reader that fails says so in the log instead of losing the email silently.
  await st.setJSON("mailq/evts2aaaa", { ...base, id: "evts2aaaa", subject: "x", text: "y", reading: { kind: "events" } });
  assert.match(await readQueuedMail(st, "evts2aaaa", { readEvents: async () => { throw new Error("overloaded"); } }), /Couldn't read it: overloaded/);
  // Only the app itself can start a reading.
  const { default: bg } = await import("../netlify/functions/read-mail-background.mjs");
  assert.equal((await bg(new Request("http://localhost/bg/read-mail", { method: "POST", body: JSON.stringify({ id: "evts1aaaa" }) }))).status, 403);
});

test("the Gmail script sends only the office's emails to the program, oldest first, once each", async () => {
  process.env.MAIL_SENDERS = "coordinator@example.edu";
  const vm = await import("node:vm");
  const { mailScript } = await import("../public/core/mail-script.js");
  const info = (await call("GET", "/api/mail-intake", undefined, admin)).body;
  const code = mailScript(info.address, info.senders);
  assert.ok(!code.includes("coordinator@"), "no address is written in the script");
  // Apps Script's Run menu starts on the first function, and hides ones ending in "_".
  const functions = [...code.matchAll(/^function (\w+)/gm)].map((m) => m[1]);
  assert.equal(functions[0], "setup");
  assert.deepEqual(functions.filter((f) => !f.endsWith("_")), ["setup", "sendProgramEmails"]);

  // A pretend Gmail and Apps Script, as Google provides them.
  const msg = (id, from, to, subject, mins, attachments = []) => ({
    getId: () => `18c0ffee${id}`, getFrom: () => from, getTo: () => to, getCc: () => "", getSubject: () => subject,
    getDate: () => new Date(Date.parse("2026-11-20T15:00:00Z") + mins * 60000), getPlainBody: () => `About: ${subject}`,
    getAttachments: () => attachments,
  });
  const att = (name, type, size) => ({ getName: () => name, getContentType: () => type, getSize: () => size, getBytes: () => [80, 75, -3, 4] });
  const many = Array.from({ length: 12 }, (_, i) => `"Res${i}, Test" <res${i}@example.org>`).join(", ");
  const office = "Coordinator <Coordinator@example.edu>";
  let threads = [
    [msg("m2", office, many, "Second", 20, [att("Call Schedule.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12", 1000), att("photo.jpg", "image/jpeg", 1000), att("huge.pdf", "application/pdf", 5 * 1024 * 1024), att("invite", "text/calendar", 300)]),
      msg("m1", office, many, "First", 10)],
    [msg("p1", office, "Me <me@example.org>, me2@example.org", "Personal", 30), msg("o1", "Someone <other@example.edu>", many, "Not the office", 40)],
  ];
  const props = {};
  const sent = [];
  const ids = () => sent.map((x) => x.body.id.slice(8));
  const seen = () => JSON.parse(props.seen).map((x) => x.slice(8));
  let query = "", answer = 200;
  const sandbox = {
    PropertiesService: { getUserProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    GmailApp: { search: (q) => { query = q; return threads.map((ms) => ({ getMessages: () => ms })); } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" }, Charset: { UTF_8: "UTF_8" },
      // Java bytes are signed.
      computeDigest: (alg, text) => [...crypto.createHash("sha256").update(text, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 255)).toString("base64"),
    },
    UrlFetchApp: { fetch: (url, opts) => { sent.push({ url, body: JSON.parse(opts.payload) }); return { getResponseCode: () => answer }; } },
  };
  // Each run starts fresh, as on Google's side; only the script's saved properties carry over.
  const run = (line) => vm.runInNewContext(`${code}\n${line}`, { ...sandbox });
  run("sendProgramEmails();");
  assert.equal(query, "from:(wayne.edu OR example.edu) newer_than:45d"); // the first run looks back further
  assert.deepEqual(ids(), ["m1", "m2"]); // oldest first; personal and other senders stay in Gmail
  assert.equal(sent[0].url, info.address);
  const m2 = sent[1].body;
  assert.equal(m2.recipients, 12);
  assert.deepEqual(m2.attachments.map((a) => a.name), ["Call Schedule.xlsm", "invite"]); // no photos, nothing too big
  assert.equal(Buffer.from(m2.attachments[0].data, "base64").toString("latin1"), "PKý\u0004");
  assert.deepEqual(seen().sort(), ["m1", "m2", "p1"]);

  // What it sends is what the app takes.
  for (const { url, body } of sent) assert.equal((await call("POST", new URL(url).pathname, body)).status, 200);

  // Next time: only the last few days, and nothing twice.
  sent.length = 0;
  run("sendProgramEmails();");
  assert.match(query, /newer_than:3d$/);
  assert.equal(sent.length, 0);

  // The app is busy: that email waits for the next run. Its address changed: the script says so.
  threads = [[msg("m3", office, many, "Third", 50), msg("m4", office, many, "Fourth", 60)]];
  answer = 503;
  run("sendProgramEmails();");
  assert.deepEqual(ids(), ["m3"]);
  assert.ok(!seen().includes("m3"));
  answer = 404;
  assert.throws(() => run("sendProgramEmails();"), /address changed/);
  answer = 200;
  sent.length = 0;
  run("sendProgramEmails();");
  assert.deepEqual(ids(), ["m3", "m4"]);

  // setup() starts the 30-minute check.
  const triggers = [];
  sandbox.ScriptApp = {
    getProjectTriggers: () => [{ id: "old" }], deleteTrigger: (t) => triggers.push(["deleted", t.id]),
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => triggers.push(["created", fn, n]) }) }) }),
  };
  run("setup();");
  assert.deepEqual(triggers, [["deleted", "old"], ["created", "sendProgramEmails", 30]]);
});
