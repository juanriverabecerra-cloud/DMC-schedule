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
