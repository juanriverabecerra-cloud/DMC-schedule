// Storage: Netlify Blobs in production, a local folder when DMC_LOCAL_STORE is set (npm run dev).
import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const TRIES = 8;

// Reads a record, applies `change`, and writes only if nobody saved in between, trying again if
// someone did. `change` can run more than once, so it must only touch the value it's given.
// Returning undefined leaves the record as it is. Resolves to the record as it now stands.
export async function updateRecord({ read, write }, change) {
  for (let i = 0; i < TRIES; i++) {
    const found = await read();
    const next = await change(found ? found.value : null);
    if (next === undefined) return found ? found.value : null;
    if (await write(next, found)) return next;
    await pause(30 * (i + 1) + Math.random() * 60);
  }
  throw new Error("Too many saves at the same moment. Please try again.");
}

// Local writes in one process, one at a time per key.
const localQueues = new Map();

function localStore(dir) {
  const file = (key) => path.join(dir, key.replace(/[^\w.-]+/g, "__"));
  return {
    async getJSON(key) {
      try { return JSON.parse(await fs.readFile(file(key), "utf8")); } catch { return null; }
    },
    async setJSON(key, value) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(key), JSON.stringify(value));
    },
    async getBytes(key) {
      try {
        const data = await fs.readFile(file(key));
        const meta = JSON.parse(await fs.readFile(`${file(key)}.meta`, "utf8").catch(() => "{}"));
        return { data: new Uint8Array(data), contentType: meta.contentType || "application/octet-stream" };
      } catch { return null; }
    },
    async setBytes(key, bytes, contentType) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(key), bytes);
      await fs.writeFile(`${file(key)}.meta`, JSON.stringify({ contentType }));
    },
    async delete(key) {
      await fs.rm(file(key), { force: true });
      await fs.rm(`${file(key)}.meta`, { force: true });
    },
    update(key, change) {
      const id = file(key);
      const run = (localQueues.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
        const current = await this.getJSON(key);
        const next = await change(current);
        if (next === undefined) return current;
        await this.setJSON(key, next);
        return next;
      });
      localQueues.set(id, run);
      return run;
    },
  };
}

// One record on Netlify: the write only lands if the record is still the version that was read,
// or still absent if there wasn't one.
export const blobRecord = (s, key) => ({
  async read() {
    const r = await s.getWithMetadata(key, { type: "json" });
    return r ? { value: r.data, etag: r.etag } : null;
  },
  async write(next, found) {
    return (await s.setJSON(key, next, found ? { onlyIfMatch: found.etag } : { onlyIfNew: true })).modified;
  },
});

function blobStore() {
  const s = getStore({ name: "dmc-schedule", consistency: "strong" });
  return {
    getJSON: (key) => s.get(key, { type: "json" }),
    setJSON: (key, value) => s.setJSON(key, value),
    async getBytes(key) {
      const r = await s.getWithMetadata(key, { type: "arrayBuffer" });
      return r ? { data: new Uint8Array(r.data), contentType: r.metadata?.contentType || "application/octet-stream" } : null;
    },
    setBytes: (key, bytes, contentType) => s.set(key, new Blob([bytes]), { metadata: { contentType } }),
    delete: (key) => s.delete(key),
    update: (key, change) => updateRecord(blobRecord(s, key), change),
  };
}

export function openStore() {
  const local = process.env.DMC_LOCAL_STORE;
  return local ? localStore(local) : blobStore();
}
