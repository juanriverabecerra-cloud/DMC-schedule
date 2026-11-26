// The devices a resident uses the app on: the Home Screen app, Safari, a computer. Each browser
// keeps its own random device key (public/js/api.js), and storage isn't shared between them, so
// without this every device was a stranger: the case log, swap requests and real hours each
// belonged to the one device that started them.
//
// Once a device is linked to a resident (Blobs `devices/<pid>`, listed by a hash of its key),
// everything of theirs works there. Linking takes one tap and no password, like the case log's
// "Use it here too" always did: anyone with the passcode could already pick any name, and the
// chiefs see every swap. What this guards against is a classmate's phone changing your things by
// accident, not a determined impostor.
import crypto from "node:crypto";

export const MAX_LINKED = 8;
export const devicesKey = (pid) => `devices/${pid}`;
export const linkHash = (key) => crypto.createHash("sha256").update(`me:${key}`).digest("base64url");
const goodKey = (key) => typeof key === "string" && key.length >= 16 && key.length <= 200;

export const isLinked = (rec, key) => !!(rec && goodKey(key) && (rec.keys || []).includes(linkHash(key)));

// The record with this device added (the oldest falls off past MAX_LINKED), or undefined when it's
// already there, so a store update leaves the record alone.
export function withDevice(rec, key, now = new Date().toISOString()) {
  if (!goodKey(key) || isLinked(rec, key)) return undefined;
  return { keys: [...(rec?.keys || []), linkHash(key)].slice(-MAX_LINKED), updatedAt: now };
}

// What a not-yet-linked device should hear about: the things of theirs kept on other devices.
export function elsewhere({ caseRec, swaps = [], hoursRec, pid }) {
  const cases = caseRec ? Object.keys(caseRec.cases || {}).length : 0;
  const requests = swaps.filter((r) => r.status !== "cancelled" && (r.pid === pid || (r.offers || []).some((o) => o.pid === pid))).length;
  return { cases, requests, hours: !!hoursRec?.entries?.length, any: !!(caseRec || requests || hoursRec) };
}
