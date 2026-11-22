import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { selectApiArtifacts, publishApiArtifacts } from "./publishApiArtifacts.ts";
import { EVENT_INDEX_KEY, eventDetailKey, eventReleaseKey } from "../src/lib/publicDataLoader.ts";
import { EVENT_ID_PATTERN as PRODUCER_EVENT_ID_PATTERN } from "./produceSnapshots.ts";

const sha = (s) => createHash("sha256").update(s).digest("hex");
function fixture(ids = ["evt_a", "evt_b"], indexedIds = ids) {
  const generation = "test-generation-1";
  const payloads = new Map([[EVENT_INDEX_KEY, { items: indexedIds.map((id) => ({ id })) }]]);
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
    "events/evt_a/release.v1.json", "events/evt_b/release.v1.json", "events/index.json",
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
  // The index may name an event whose detail and release are both absent from
  // the manifest. Valid digests alone must not turn that into a successful build.
  const changeIndex = (fn) => mutate((x) => {
    const s = x.snapshots.find((v) => v.key === EVENT_INDEX_KEY);
    const envelope = JSON.parse(s.json);
    fn(envelope.payload);
    s.sha256 = sha(JSON.stringify(envelope.payload));
    envelope.sha256 = s.sha256;
    s.json = JSON.stringify(envelope);
  });
  changeIndex((index) => index.items.push({ id: "missing-both" }));
  changeIndex((index) => index.items.push({ id: "evt_a" }));
  changeIndex((index) => { index.items[0].visibility_status = "private"; });
  changeIndex((index) => { index.items = "not-an-array"; });
});

test("SEC-708 P1-A: CURRENT 200-row index is a subset of 201 public release objects", async () => {
  // CURRENT rebuildEventsIndex has LIMIT 200; produceSnapshots creates release
  // data for every public event. A legitimate extra release must not abort.
  const ids = Array.from({ length: 201 }, (_, i) => "evt_" + String(i).padStart(3, "0"));
  const data = fixture(ids, ids.slice(0, 200));
  const items = selectApiArtifacts(data);
  assert.equal(items.length, 202, "201 releases plus the capped index");
  assert.equal(items.at(-1).key, "events/index.json", "promote index last");

  const b = bucket();
  const report = await publishApiArtifacts(data, b);
  assert.equal(report.verified, 202);
  assert.equal(b.writes.at(-1), "events/index.json");
  assert.equal(JSON.parse(b.rows.get("events/index.json")).items.length, 200);
  assert.ok(b.rows.has("events/evt_200/release.v1.json"), "extra public release remains available");

  // An index with 201 entries does NOT match CURRENT's capped contract.
  assert.throws(() => selectApiArtifacts(fixture(ids)), /index items are invalid or over budget/);
});

test("SEC-708 P1-A: a public half-period event may have a release but no index item", async () => {
  // CURRENT filters one-sided event periods from the index, yet the producer
  // selects all public event IDs for release artifacts.
  const data = fixture(["evt_valid", "evt_half_period"], ["evt_valid"]);
  assert.deepEqual(selectApiArtifacts(data).map((x) => x.key), [
    "events/evt_half_period/release.v1.json",
    "events/evt_valid/release.v1.json",
    "events/index.json",
  ]);
  const b = bucket();
  const report = await publishApiArtifacts(data, b);
  assert.equal(report.verified, 3);
  assert.deepEqual(JSON.parse(b.rows.get("events/index.json")).items, [{ id: "evt_valid" }]);
  assert.ok(b.rows.has("events/evt_half_period/release.v1.json"));
});

test("SEC-708 P1-B: release PUT or readback failure does not promote a new index", async () => {
  for (const failure of ["put", "readback"]) {
    const b = bucket();
    await publishApiArtifacts(fixture(["evt_a"]), b);
    const previousIndex = b.rows.get("events/index.json");
    const previousWrites = b.writes.length;
    const newReleaseKey = "events/evt_b/release.v1.json";
    if (failure === "put") {
      const originalPut = b.put.bind(b);
      b.put = async (key, body) => {
        if (key === newReleaseKey) throw new Error("injected release PUT failure");
        return originalPut(key, body);
      };
    } else {
      const originalGet = b.get.bind(b);
      b.get = async (key) => {
        if (key === newReleaseKey && b.writes.slice(previousWrites).includes(newReleaseKey)) {
          return null; // injected permanent readback loss after a real PUT
        }
        return originalGet(key);
      };
    }
    const expectedError = failure === "put"
      ? /injected release PUT failure/
      : /readback integrity failed after 3 retries/;
    await assert.rejects(publishApiArtifacts(fixture(["evt_a", "evt_b"]), b), expectedError);
    assert.equal(b.rows.get("events/index.json"), previousIndex, failure + ": old public index preserved");
    assert.ok(!b.writes.slice(previousWrites).includes("events/index.json"),
      failure + ": no new index PUT before all releases verify");
    if (failure === "readback") {
      assert.equal(b.writes.filter((key) => key === newReleaseKey).length, 4,
        "retry cap must also hold for an unverified new release");
    }
  }
});

test("SEC-708: leading underscore/hyphen legacy event IDs survive producer and publisher", async () => {
  // CURRENT eventForm EVENT_ID_PATTERN accepts these path-safe prefixes.
  // The producer must not silently omit their release while its index includes them.
  const ids = ["_legacy_event", "-legacy-event"];
  for (const id of ids) {
    assert.equal(PRODUCER_EVENT_ID_PATTERN.test(id), true, id + ": producer must enumerate");
  }
  for (const bad of ["", "evt/escape", "../escape", "evt\\escape", "evt.dot"]) {
    assert.equal(PRODUCER_EVENT_ID_PATTERN.test(bad), false, bad + ": deny unsafe key");
  }
  const data = fixture(ids);
  const targets = selectApiArtifacts(data);
  assert.equal(targets.length, 3);
  const b = bucket();
  const report = await publishApiArtifacts(data, b);
  assert.equal(report.verified, 3);
  for (const id of ids) {
    assert.ok(b.rows.has("events/" + id + "/release.v1.json"), id + ": release remains reachable");
  }
  assert.deepEqual(JSON.parse(b.rows.get("events/index.json")).items, ids.map(id => ({ id })));
});

test("MIG-0666: remote oversized object is refused without any write", async () => {
  const b = bucket(), data = fixture([]);
  b.get = async () => ({ size: 2 * 1024 * 1024 + 1, text: async () => "x" });
  await assert.rejects(publishApiArtifacts(data, b), /remote object exceeds comparison budget/);
  assert.equal(b.writes.length, 0);
});


test("MIG-0666 build wiring: publish opt-in requires explicit bucket; default build makes zero R2 writes", async () => {
  const { buildPublicSite } = await import("./buildPublicSite.ts");
  const data = fixture([]);
  const fakeProduce = async (argv) => {
    assert.ok(argv.includes("--out"));
    assert.equal(argv.includes("--publish-api-artifacts"), false,
      "publish flag must not leak to read-only snapshot producer");
    return {
      ...data, rules: null,
      report: {
        generation: "test-generation-1", keys: 1, bytes: 99, d1Statements: 0,
        creators: 0, mirroredRows: 0, skippedCreators: [], blockedKeys: 0,
        trending: "produced", rules: false, elapsedMs: 1,
      },
    };
  };
  const b = bucket();
  const builds = [];
  const run = async (cmd) => { builds.push(cmd); };
  const args = ["--sqlite", "nonproduction-test-fixture", "--generation", "test-generation-1"];
  const ordinary = await buildPublicSite(args, {
    apiArtifactBucket: b, produce: fakeProduce, run,
  });
  assert.equal(ordinary.apiArtifactPublish, undefined);
  assert.equal(b.writes.length, 0);
  assert.equal(builds.length, 2, "default build runs Astro and site budget verification");
  const published = await buildPublicSite([...args, "--publish-api-artifacts"], {
    apiArtifactBucket: b, produce: fakeProduce, run,
  });
  assert.equal(published.apiArtifactPublish.puts, 1);
  assert.equal(b.writes.length, 1);
  const second = await buildPublicSite([...args, "--publish-api-artifacts"], {
    apiArtifactBucket: b, produce: fakeProduce, run,
  });
  assert.equal(second.apiArtifactPublish.puts, 0, "build rerun skips identical public API artifacts");
  assert.equal(second.apiArtifactPublish.skipped, 1);
  await assert.rejects(
    buildPublicSite([...args, "--publish-api-artifacts"], { produce: fakeProduce, run }),
    /requires an explicit injected R2 bucket/,
  );
  await assert.rejects(
    buildPublicSite([...args, "--publish-api-artifacts", "--publish-api-artifacts"], {
      apiArtifactBucket: b, produce: fakeProduce, run,
    }), /duplicate/,
  );
});

test("MIG-0666 build wiring: failed local site verification must never PUT an API artifact", async () => {
  const { buildPublicSite } = await import("./buildPublicSite.ts");
  const b = bucket();
  await assert.rejects(
    buildPublicSite([
      "--sqlite", "nonproduction-test-fixture", "--generation", "test-generation-1",
      "--publish-api-artifacts",
    ], {
      apiArtifactBucket: b,
      produce: async () => ({
        ...fixture([]),
        report: { trending: "produced", generation: "test-generation-1", elapsedMs: 0 },
      }),
      run: async () => { throw new Error("local-build-failed"); },
    }), /local-build-failed/,
  );
  assert.equal(b.writes.length, 0, "R2 PUT occurs only after both local checks pass");
});
