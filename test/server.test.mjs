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
async function fakeWorkbook(date, rooms, { egressDate = date } = {}) {
  const { zipSync, strToU8 } = await import("fflate");
  const cell = (ref, v) => (typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`);
  const row = (n, cells) => `<row r="${n}">${cells.map(([c, v]) => cell(`${c}${n}`, v)).join("")}</row>`;
  const sheet = (rows) => `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const [y, m, d] = date.split("-");
  const stamp = (x) => { const [yy, mm, dd] = x.split("-"); return `${Number(mm)}/${Number(dd)}/${yy.slice(2)}`; };
  void y; void m; void d;
  const rows = [
    row(1, [["A", stamp(date)]]),
    row(2, [["A", "OR"], ["B", "Surgeon"], ["C", "Time"], ["D", "# of cases"], ["E", "MDA"], ["F", "Resident/CRNA"], ["G", "JA"], ["H", "Breaks"], ["L", "Resident"]]),
    ...rooms.map((r, i) => row(4 + i, [["A", r[0]], ...(r[1] ? [["B", r[1]], ["C", 0.3125], ["D", 2], ["E", r[3] || "Attending"]] : []), ...(r[4] ? [["F", r[4]]] : []), ["L", "Ignored"]])),
    row(30, [["A", "OPSC (3)"], ["B", "OpscMda"], ["G", "PAT"]]),
    row(31, [["B", "Residents"], ["G", "ResC"]]),
    row(32, [["B", "ResE"]]),
    row(34, [["C", "Cath lab (2)"], ["E", "CathMda"], ["G", "OB"], ["I", "Night coverage"]]),
    row(35, [["C", "Some note for the day"], ["G", "ObMda"], ["I", "ResF"]]),
    row(36, [["G", "Residents"]]),
    row(37, [["G", "ResG"]]),
  ];
  return zipSync({
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="OR Schedule Assignments" r:id="rId1"/><sheet name="Egress List" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(sheet(rows)),
    "xl/worksheets/sheet2.xml": strToU8(sheet([row(1, [["A", stamp(egressDate)]])])),
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
  assert.deepEqual(p.procedures, [{ name: "Cath lab", count: "2", mda: "CathMda" }]);
  assert.deepEqual(p.pat, ["ResC"]);
  assert.deepEqual(p.ob, { mda: "ObMda", residents: ["ResG"] });
  assert.deepEqual(p.night, ["ResF"]);
  assert.deepEqual(p.notes, ["Some note for the day"]);
  assert.equal(looksComplete(wb, p), true);
  assert.equal(looksComplete(readXlsx(await fakeWorkbook("2026-03-11", [["1", "Smith", "", "M", "ResA"]], { egressDate: "2026-03-10" })), p), false); // egress not redone yet
  assert.equal(looksComplete(wb, { ...p, rooms: [{ surgeon: "Smith", staff: "" }] }), false); // a room with nobody in it
});

test("the live sheet: updates quietly, alerts once when settled, then only the people it moved", async () => {
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
  assert.equal(pa.received.length, 0);
  await run(30);
  assert.equal(pa.received.length, 0); // still inside the quiet window
  // An edit restarts the wait.
  bytes = await fakeWorkbook("2026-03-11", [...v1.slice(0, 2), ["3", "Lee", "", "Other", "X"]]);
  await run(40);
  await run(80);
  assert.equal(pa.received.length, 0);
  await run(86);
  assert.equal(pa.received.length, 1); // 46 minutes unchanged: one alert
  assert.equal(pb.received.length, 1);
  assert.equal(pa.open(pa.received[0].body).title, "Tomorrow's OR schedule is posted");
  assert.equal((await daily()).draft, false);
  assert.deepEqual((await call("GET", "/api/daily-source", undefined, admin)).body.reach, { phones: 2, sent: 2 }); // how far it got
  await run(120);
  assert.equal(pa.received.length, 1); // never twice
  // A correction after the alert: only the resident it moved hears, and once.
  bytes = await fakeWorkbook("2026-03-11", v2);
  await run(130);
  assert.equal(pb.received.length, 1); // waits for it to settle
  await run(165);
  assert.equal(pa.received.length, 1);
  assert.equal(pb.received.length, 2);
  const moved = pb.open(pb.received[1].body);
  assert.equal(moved.title, "Your assignment changed for tomorrow");
  assert.match(moved.body, /OR 3 with Lee/);
  bytes = await fakeWorkbook("2026-03-11", v1);
  await run(170);
  await run(205);
  assert.equal(pb.received.length, 2); // only once each, however many corrections follow
  assert.equal((await daily()).rooms[1].staff, "ResB"); // the app still has the latest

  // The next morning: the sheet is cleared, or holds tomorrow's cases under today's date.
  const morning = (mins) => new Date(Date.parse("2026-03-11T13:00:00Z") + mins * 60000);
  const runAt = (mins) => sync.syncDaily(st, { now: morning(mins), fetchBytes: async () => bytes });
  bytes = await fakeWorkbook("2026-03-11", [["1"], ["2"], ["3"]]);
  assert.match((await runAt(0)).held, /mostly empty/);
  bytes = await fakeWorkbook("2026-03-11", [["1", "New1", "", "M", ""], ["2", "New2", "", "M", ""], ["3", "New3", "", "M", ""]]);
  assert.match((await runAt(3)).held, /rewritten/);
  assert.equal((await daily()).rooms[0].surgeon, "Smith"); // today's rooms untouched
  // A real fix to today's sheet still goes through.
  bytes = await fakeWorkbook("2026-03-11", [["1", "Smith", "", "M", "ResC"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]]);
  assert.equal((await runAt(6)).held, null);
  assert.equal((await daily()).rooms[0].staff, "ResC");
  // The date moved on but the rooms didn't: not shown as the next day's sheet.
  bytes = await fakeWorkbook("2026-03-12", [["1", "Smith", "", "M", "ResC"], ["2", "Jones", "", "M", "ResB"], ["3", "Lee", "", "M", "X"]]);
  assert.match((await runAt(9)).held, /previous day's rooms/);
  assert.equal((await st.getJSON("dataset")).daily["2026-03-12"], undefined);

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

  // First seen at 9:28p: 45 quiet minutes lands after the 10p cutoff.
  const night = (mins) => new Date(Date.parse("2026-03-11T01:28:00Z") + mins * 60000);
  await run(night(0));
  const first = (await ds()).updatedAt;
  await run(night(30));
  assert.equal(await draft(), true);
  await run(night(47));
  assert.equal(await draft(), false);
  assert.notEqual((await ds()).updatedAt, first); // otherwise phones keep getting "not modified"
  // A late edit brings the label back until the sheet is quiet again.
  bytes = await fakeWorkbook("2026-03-11", [...full.slice(0, 2), ["3", "Lee", "", "Other", "Y"]]);
  await run(night(50));
  assert.equal(await draft(), true);
  await run(night(80));
  assert.equal(await draft(), true);
  await run(night(96));
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
  await withDataset(st, (d) => { setDaily(d, "2026-03-11", { ...photo, source: "photo" }); markAnnounced(state, d, "2026-03-11", new Date("2026-03-10T21:00:00Z")); });
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
  assert.equal(pa.received.length + pb.received.length, 0); // no "your assignment changed" for a spelling fix
  assert.equal((await readState(st)).rooms, 3);
  pa.close(); pb.close();
  await sync.disconnect(st);
});
