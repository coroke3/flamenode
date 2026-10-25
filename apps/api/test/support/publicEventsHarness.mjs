import { createSqlite, createD1, insert } from "./personalHarness.mjs";

export function createFakeBucket() {
  const store = new Map();
  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      const textVal = typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data);
      let jsonVal = null;
      try {
        jsonVal = typeof entry.data === "string" ? JSON.parse(entry.data) : entry.data;
      } catch {
        jsonVal = null;
      }
      const bytes = new TextEncoder().encode(textVal);
      return {
        size: entry.size ?? bytes.byteLength,
        etag: entry.etag ?? `"${bytes.byteLength}"`,
        async text() { return textVal; },
        async json() {
          if (jsonVal === null) throw new Error("invalid_json");
          return jsonVal;
        },
        body: { async cancel() {} },
      };
    },
    async put(key, value, options) {
      const textVal = typeof value === "string" ? value : JSON.stringify(value);
      const bytes = new TextEncoder().encode(textVal);
      store.set(key, {
        data: value,
        size: bytes.byteLength,
        etag: options?.httpMetadata?.etag ?? `"${bytes.byteLength}"`,
      });
    },
    setRaw(key, entry) {
      store.set(key, entry);
    },
    clear() {
      store.clear();
    },
  };
}

export function createFakeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    async delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

export { createSqlite, createD1, insert };
