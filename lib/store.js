// Storage: Netlify Blobs in production, a local folder when DMC_LOCAL_STORE is set (npm run dev).
import { getStore } from "@netlify/blobs";
import fs from "node:fs/promises";
import path from "node:path";

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
  };
}

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
  };
}

export function openStore() {
  const local = process.env.DMC_LOCAL_STORE;
  return local ? localStore(local) : blobStore();
}
