// Alerts to the iPhone app. A web page can ask a browser for alerts, but an app has to go
// through Apple's own service (APNs): a signed request per phone over HTTP/2. Needs three
// things from the Apple Developer account, set in Netlify: APNS_KEY (the .p8 file's text),
// APNS_KEY_ID and APNS_TEAM_ID. Until they're set, the app can't turn alerts on.
import crypto from "node:crypto";
import http2 from "node:http2";
import { env } from "./auth.js";

const b64u = (v) => Buffer.from(v).toString("base64url");
const TOPIC = "app.netlify.dmcschedule";
const HOSTS = ["https://api.push.apple.com", "https://api.sandbox.push.apple.com"];

export const apnsConfigured = () => !!(env("APNS_KEY") && env("APNS_KEY_ID") && env("APNS_TEAM_ID"));
export const cleanDeviceToken = (t) => (/^[0-9a-f]{64,200}$/i.test(String(t || "")) ? String(t).toLowerCase() : null);

// Apple wants the same signed token reused, not a fresh one per alert: it lasts an hour.
let signed = { jwt: null, at: 0, key: "" };
export function providerToken(now = Date.now()) {
  const id = `${env("APNS_KEY_ID")}|${env("APNS_TEAM_ID")}`;
  if (signed.jwt && signed.key === id && now - signed.at < 40 * 60 * 1000) return signed.jwt;
  const head = b64u(JSON.stringify({ alg: "ES256", kid: env("APNS_KEY_ID") }));
  const body = b64u(JSON.stringify({ iss: env("APNS_TEAM_ID"), iat: Math.floor(now / 1000) }));
  const key = crypto.createPrivateKey(env("APNS_KEY").replace(/\\n/g, "\n"));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  signed = { jwt: `${head}.${body}.${b64u(sig)}`, at: now, key: id };
  return signed.jwt;
}

// The same alert the web app gets, in Apple's shape. `url` is what a tap opens.
export function apnsPayload({ title, body, url, tag }) {
  return { aps: { alert: { title, body }, sound: "default", ...(tag ? { "thread-id": tag } : {}) }, url: url || "/" };
}

function post(host, path, headers, body) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; client.close(); resolve(result); } };
    const client = http2.connect(host);
    client.on("error", () => finish({ status: 0, reason: "No answer" }));
    client.setTimeout(8000, () => finish({ status: 0, reason: "Timed out" }));
    const req = client.request({ ":method": "POST", ":path": path, ...headers });
    let status = 0, text = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      let reason = "";
      try { reason = JSON.parse(text).reason || ""; } catch { /* a success has no body */ }
      finish({ status, reason });
    });
    req.on("error", () => finish({ status: 0, reason: "No answer" }));
    req.end(body);
  });
}

// Sends one alert. A phone that registered from a test build only answers on Apple's test
// service, so a "bad token" from the real one is tried there before the phone is given up on.
export async function sendApns(sub, payload, { urgency = "normal", ttl = 86400 } = {}) {
  if (!apnsConfigured()) return { ok: false, status: 0, gone: false };
  const headers = {
    authorization: `bearer ${providerToken()}`,
    "apns-topic": env("APNS_TOPIC") || TOPIC,
    "apns-push-type": "alert",
    "apns-priority": urgency === "high" ? "10" : "5",
    "apns-expiration": String(Math.floor(Date.now() / 1000) + ttl),
    ...(payload.tag ? { "apns-collapse-id": String(payload.tag).slice(0, 64) } : {}),
  };
  const body = JSON.stringify(apnsPayload(payload));
  const hosts = env("APNS_HOST") ? [env("APNS_HOST")] : HOSTS;
  let last = { status: 0, reason: "" };
  for (const host of hosts) {
    last = await post(host, `/3/device/${sub.apns}`, headers, body);
    if (last.status === 200) return { ok: true, status: 200, gone: false };
    if (!(last.status === 400 && last.reason === "BadDeviceToken")) break;
  }
  if (last.status !== 200) console.warn("apns", last.status, last.reason);
  return { ok: false, status: last.status, gone: last.status === 410 || last.reason === "BadDeviceToken" || last.reason === "Unregistered" };
}
