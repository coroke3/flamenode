import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { selectApiArtifacts, publishApiArtifacts } from "./publishApiArtifacts.ts";
import { EVENT_INDEX_KEY, eventDetailKey, eventReleaseKey } from "../src/lib/publicDataLoader.ts";

const sha = (s) => createHash("sha256").update(s).digest("hex");
function fixture(ids = ["evt_a", "evt_b"]) {
  const generation = "test-generation-1";
  const payloads = new Map([[EVENT_INDEX_KEY, { items: ids.map((id) => ({ id })) }]]);
  for (const id of ids) {
    payloads.set(eventDetailKey(id), { id, public: true });
    payloads.set(eventReleaseKey(id), { event_id: id, released: true });
  }
  return {
    manifest: {
      schemaVersion: 1, generation, allowedKeys: [...payloads.keys()].sort(), blockedKeys: [],
    },
    snapshots: [...payloads].map(([key, payload]) => ({
      key,
      sha256: sha(JSON.stringify(payload)),
      json: JSON.stringify({
        schemaVersion: 1, generation, key, visibility: "public",
        sha256: sha(JSON.stringify(payload)), payload,
      }),
    })),
  };
}
function bucket() {
  const rows = new Map(), writes = [];
  return {
    rows, writes,
    async get(key) {
      if (!rows.has(key)) return null;
      return { size: Buffer.byteLength(rows.get(key)), async text() { return rows.get(key); } };
    },
    async put(key, body) {
      writes.push(key);
      rows.set(key, body);
    },
  };
}

test("MIG-0666 T01: initial, identical rerun, and one missing object publish only changed keys", async () => {
  const data = fixture();
  const b = bucket();
  const first = await publishApiArtifacts(data, b);
  assert.deepEqual(first, {
    artifacts: 3, puts: 3, skipped: 0, retries: 0, verified: 3,
    bytes: selectApiArtifacts(data).reduce((n, item) => n + Buffer.byteLength(item.body), 0),
  });
  assert.deepEqual([...b.rows.keys()].sort(), [
    "events/evt_a/release.v1.json", "events/evt_b/release.v1.json", "events/index.json",
  ]);
  assert.equal(JSON.parse(b.rows.get("events/index.json")).items.length, 2,
    "public API artifact must be the CURRENT bare payload, not the SSG envelope");
  const second = await publishApiArtifacts(data, b);
  assert.deepEqual([second.puts, second.skipped], [0, 3]);
  assert.equal(b.writes.length, 3);
  b.rows.delete("events/evt_b/release.v1.json");
  const third = await publishApiArtifacts(data, b);
  assert.deepEqual([third.puts, third.skipped], [1, 2]);
  assert.equal(b.writes.at(-1), "events/evt_b/release.v1.json");
});

test("MIG-0666 T02: missing readback retries at most three times; permanent absence fails closed", async () => {
  const data = fixture([]);
  const ok = bucket();
  let lost = 0;
  const original = ok.put.bind(ok);
  ok.put = async (key, body) => { if (lost++ < 2) { ok.writes.push(key); return; } return original(key, body); };
  const report = await publishApiArtifacts(data, ok);
  assert.equal(report.puts, 3);
  assert.equal(report.retries, 2);
  const absent = bucket();
  absent.put = async (key) => { absent.writes.push(key); };
  await assert.rejects(publishApiArtifacts(data, absent), /readback integrity failed after 3 retries/);
  assert.equal(absent.writes.length, 4, "initial write plus at most 3 retry PUTs");
});

test("MIG-0666 T03: envelope, manifest, generation, checksum, visibility and event coverage fail closed", () => {
  const data = fixture();
  assert.deepEqual(selectApiArtifacts(data).map((x) => x.key), [
    "events/index.json", "events/evt_a/release.v1.json", "events/evt_b/release.v1.json",
  ]);
  const mutate = (fn) => {
    const copy = structuredClone(data);
    fn(copy);
    assert.throws(() => selectApiArtifacts(copy), /api artifact publish:/);
  };
  mutate((x) => { x.manifest.allowedKeys = x.manifest.allowedKeys.filter((k) => k !== eventReleaseKey("evt_a")); });
  mutate((x) => { x.manifest.allowedKeys.push(EVENT_INDEX_KEY); });
  mutate((x) => { x.manifest.blockedKeys.push(EVENT_INDEX_KEY); });
  mutate((x) => { x.snapshots = x.snapshots.filter((s) => s.key !== eventReleaseKey("evt_a")); });
  mutate((x) => { const s = x.snapshots.find((v) => v.key === EVENT_INDEX_KEY); s.sha256 = "0".repeat(64); });
  mutate((x) => { const s = x.snapshots.find((v) => v.key === EVENT_INDEX_KEY); const p = JSON.parse(s.json); p.visibility = "private"; s.json = JSON.stringify(p); });
  mutate((x) => { const s = x.snapshots.find((v) => v.key === EVENT_INDEX_KEY); const p = JSON.parse(s.json); p.generation = "other"; s.json = JSON.stringify(p); });
});

test("MIG-0666: remote oversized object is refused without any write", async () => {
  const b = bucket(), data = fixture([]);
  b.get = async () => ({ size: 2 * 1024 * 1024 + 1, text: async () => "x" });
  await assert.rejects(publishApiArtifacts(data, b), /remote object exceeds comparison budget/);
  assert.equal(b.writes.length, 0);
});
