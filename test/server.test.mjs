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
const { todayLocal, addDays } = await import("../public/core/dates.js");

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
    // RFC 8291, the phone's side.
    open(body) {
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
  assert.deepEqual(phone.open(got.body), { title: "Tomorrow's OR schedule is posted", body: "You're in OR 7." });
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
