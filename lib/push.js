// Web Push (lock-screen alerts) with Node's own crypto, no extra packages: VAPID signing
// (RFC 8292) and aes128gcm payload encryption (RFC 8291). The server's key pair is made on first
// use and kept in the store, or comes from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set.
import crypto from "node:crypto";
import { env } from "./auth.js";
import { sendApns } from "./apns.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

// Push services the app will send to. Anything else is refused, so the server can't be used to
// post to arbitrary addresses.
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function isPushEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

export function cleanSubscription(sub) {
  const endpoint = String(sub?.endpoint || "");
  const p256dh = String(sub?.keys?.p256dh || "");
  const auth = String(sub?.keys?.auth || "");
  if (!isPushEndpoint(endpoint) || endpoint.length > 1000) return null;
  if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export const subscriptionId = (endpoint) => crypto.createHash("sha256").update(endpoint).digest("base64url").slice(0, 22);
// A phone is known by its web address in a browser, or by its device token in the iPhone app.
export const phoneId = ({ endpoint, token } = {}) => subscriptionId(token ? `apns:${String(token).toLowerCase()}` : String(endpoint || ""));

// One alert to one phone, whichever kind it is.
export const sendToPhone = (sub, payload, options) => (sub.apns ? sendApns(sub, payload, options) : sendPush(sub, payload, options));

export function makeVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), privateKey: jwk.d };
}

export async function vapidKeys(st) {
  if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) return { publicKey: env("VAPID_PUBLIC_KEY"), privateKey: env("VAPID_PRIVATE_KEY") };
  return st.update("push/vapid", (saved) => (saved?.publicKey && saved?.privateKey ? undefined : makeVapidKeys()));
}

function vapidHeader(endpoint, keys, subject, now = Date.now()) {
  const pub = unb64u(keys.publicKey);
  const key = crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// RFC 8291: one record, padded with the 0x02 delimiter. `salt` and `serverKey` are only passed
// by the tests, to check the result against the RFC's worked example.
export function encryptPayload(sub, plaintext, { salt = crypto.randomBytes(16), serverKey } = {}) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (serverKey) ecdh.setPrivateKey(serverKey); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, sealed]);
}

// The app's own address, for what a tapped alert opens. Push messages have no page to be relative to.
const HOME = "https://dmcschedule.netlify.app";
export function appOrigin(site) {
  for (const s of [site, env("URL")]) {
    try {
      const u = new URL(s);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch { /* try the next */ }
  }
  return HOME;
}

// Apple's declarative format (iOS 18.4 and later): the phone shows the alert by itself, so it
// arrives even when the app's background script isn't woken in time. Older iPhones and other
// browsers pass the same message to sw.js, which reads it the same way.
export function webPushMessage({ title, body, url, tag }, origin) {
  return {
    web_push: 8030,
    notification: {
      title: title || "DMC Schedule",
      body: body || "",
      navigate: new URL(url || "/", appOrigin(origin)).href,
      lang: "en-US",
      dir: "ltr",
      ...(tag ? { tag } : {}),
    },
  };
}

// Sends one alert. Returns { ok, gone } — gone means the subscription no longer exists.
export async function sendPush(sub, payload, { keys, subject, origin, ttl = 86400, topic, urgency = "normal" }) {
  const body = encryptPayload(sub, JSON.stringify(webPushMessage(payload, origin || subject)));
  const headers = {
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(ttl),
    urgency,
    authorization: vapidHeader(sub.endpoint, keys, subject),
  };
  if (topic) headers.topic = topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  try {
    const res = await fetch(sub.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) console.warn("push", res.status, new URL(sub.endpoint).hostname, (await res.text().catch(() => "")).slice(0, 200));
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    console.warn("push failed", err?.message);
    return { ok: false, status: 0, gone: false };
  }
}

// Apple and the others want a contact for the sender: the site's own address.
export function pushSubject(origin) {
  if (env("VAPID_SUBJECT")) return env("VAPID_SUBJECT");
  return /^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin) ? origin : "https://dmcschedule.netlify.app";
}

// Sends to every stored subscription that `pick` chooses, each with its own payload, and drops
// subscriptions the push service says are gone. Returns how many went through.
export async function sendToSubs(st, pick, payloadFor, { site, urgency = "normal", ttl } = {}) {
  const subs = (await st.getJSON("push/subs")) || {};
  const list = Object.entries(subs).filter(([, sub]) => pick(sub));
  if (!list.length) return 0;
  const keys = await vapidKeys(st);
  const results = await Promise.all(list.map(async ([id, sub]) => {
    const payload = payloadFor(sub);
    return [id, payload ? await sendToPhone(sub, payload, { keys, subject: pushSubject(site || env("URL") || ""), origin: site, urgency, ttl }) : { ok: false }];
  }));
  const gone = results.filter(([, r]) => r.gone).map(([id]) => id);
  if (gone.length) {
    await st.update("push/subs", (fresh) => {
      if (!fresh) return undefined;
      for (const id of gone) delete fresh[id];
      return fresh;
    });
  }
  return results.filter(([, r]) => r.ok).length;
}

// What an admin's phone hears about residents' requests: "smart" is sick calls right away and
// one evening summary of the rest, "sick" is sick calls only, "off" is nothing.
export const REQUEST_MODES = ["smart", "sick", "off"];
export const requestMode = (sub) => (REQUEST_MODES.includes(sub.mode) ? sub.mode : "smart");
