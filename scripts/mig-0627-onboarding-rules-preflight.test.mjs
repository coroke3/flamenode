// MIG-0627 U02c PREP ONLY: real mounted Hono Personal GET, in-memory D1 and
// fake R2 parity. Does NOT switch a reader, grant Cloudflare authorization,
// or resolve the Worker-accessible published-rules snapshot handoff.
import assert from "node:assert/strict";
import test from "node:test";
import { runUnderRootTsx, createSqlite, createD1, fakeBucket, cookie } from "../apps/api/test/support/personalHarness.mjs";
import { seed } from "../apps/api/test/support/personalSeed.mjs";
import { normalizeStaticRules } from "../src/lib/publicData/staticRulesCore.ts";
import { loadRulesForBuild } from "../apps/site/src/lib/rulesLoader.ts";

if (runUnderRootTsx(import.meta.url)) {
  const { app } = await import("../apps/api/src/app.ts");
  const key = "rules/current.json";
  const visibilityKey = "visibility/blocked-entities.v1.json";

  async function request(t, { objects = {}, mode, token = "tok-carol", breakD1 = false, visibilityGetOverride, seedSqlite } = {}) {
    const sqlite = createSqlite();
    seed(sqlite);
    if (seedSqlite) seedSqlite(sqlite);
    t.after(() => sqlite.close());
    const d1 = createD1(sqlite);
    const reads = { get: [], head: [] };
    const bucket = fakeBucket(objects);
    const observedBucket = {
      async get(objectKey) {
        reads.get.push(objectKey);
        if (objectKey === visibilityKey && visibilityGetOverride !== undefined) {
          return visibilityGetOverride;
        }
        const object = await bucket.get(objectKey);
        if (!object) return null;
        const raw = objects[objectKey];
        return {
          ...object,
          etag: `etag-${objectKey}`,
          async text() {
            return typeof raw === "string" ? raw : JSON.stringify(raw);
          },
        };
      },
      async head(objectKey) { reads.head.push(objectKey); return bucket.head(objectKey); },
    };
    const db = breakD1 ? {
      ...d1,
      prepare(sql) {
        if (/CASE WHEN length\(CAST\(body_markdown AS BLOB\)\)/i.test(sql)) {
          // Inject only at the published-rules fallback, not the onboarding
          // context's separate current-major terms query.
          throw new Error("SYNTHETIC_D1_UNAVAILABLE");
        }
        return d1.prepare(sql);
      },
    } : d1;
    const response = await app.request(
      "/api/personal/onboarding", { method: "GET", headers: cookie(token) },
      { DB: db, BUCKET: observedBucket, PUBLIC_VISIBILITY_GUARD_MODE: mode },
    );
    return { response, body: await response.json(), reads, stats: { ...d1.stats } };
  }

  test("MIG-0627 U02c PREP T01: published R2 rules are CURRENT-normalized, no fallback D1 statement", async (t) => {
    const payload = {
      body_markdown: "# Published rules\n\nPublished text",
      version_label: "published-v3",
      published_at: 1700000000,
    };
    const a = await request(t, { objects: { [key]: payload } });
    const b = await request(t, { objects: {} });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.state.needsTermsAcceptance, true);
    assert.deepEqual(a.body.rules, {
      versionLabel: normalizeStaticRules(payload).versionLabel,
      bodyMarkdown: normalizeStaticRules(payload).bodyMarkdown,
    });
    assert.deepEqual(a.reads.get, [key]);
    assert.equal(a.stats.writes, 0);
    assert.equal(b.body.rules.versionLabel, "v2", "fixture latest published D1 version");
    assert.equal(b.stats.statements, a.stats.statements + 1,
      "only an R2 miss may add one rules fallback D1 statement");
    assert.equal(b.stats.writes, 0);
  });

  test("MIG-0627 U02c PREP T02: build-time published rules project identical version/body to Hono", async (t) => {
    const payload = { version_label: "v2026.11", body_markdown: "# Rules 2026\n\nA", published_at: 1700000000 };
    const build = await loadRulesForBuild({ read: async () => payload });
    const hono = await request(t, { objects: { [key]: payload } });
    assert.equal(hono.response.status, 200);
    assert.deepEqual(hono.body.rules, { versionLabel: build.versionLabel, bodyMarkdown: payload.body_markdown });
    assert.ok(build.blocks.length > 0);
    assert.equal(hono.stats.writes, 0);
  });

  test("MIG-0627 U02c PREP T03: malformed present R2 rules do not silently use an older D1 version", async (t) => {
    const a = await request(t, { objects: { [key]: { version_label: "v-broken" } } });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.rules, null, "present but invalid R2 is NOT an absent-key D1 fallback");
    assert.deepEqual(a.reads.get, [key]);
    assert.equal(a.stats.writes, 0);
    const b = await request(t, { objects: {} });
    assert.equal(b.body.rules.versionLabel, "v2");
    assert.equal(b.stats.statements, a.stats.statements + 1);
  });

  test("MIG-0627 U02c PREP T04: oversized R2 yields a bounded D1 fallback; DB failure returns null", async (t) => {
    const huge = { version_label: "v4", body_markdown: "x".repeat(64 * 1024) };
    const a = await request(t, { objects: { [key]: huge } });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.rules.versionLabel, "v2");
    assert.deepEqual(a.reads.get, [key]);
    assert.equal(a.stats.writes, 0);
    const b = await request(t, { objects: {}, breakD1: true });
    assert.equal(b.response.status, 200);
    assert.equal(b.body.rules, null);
    assert.equal(b.stats.writes, 0);
  });

  test("MIG-0627 U02c T05: enforce mode validates committed manifest body before reading rules", async (t) => {
    const payload = { version_label: "unsafe", body_markdown: "should not render if the fence is invalid" };
    const a = await request(t, { mode: "enforce", objects: { [key]: payload } });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.rules, null);
    assert.deepEqual(a.reads, { head: [], get: [visibilityKey] });
    assert.equal(a.stats.writes, 0);

    const b = await request(t, {
      mode: "enforce", objects: { [key]: payload, [visibilityKey]: { schema_version: 1 } },
    });
    assert.equal(b.body.rules, null, "a committed ETag cannot authenticate malformed manifest JSON");
    assert.deepEqual(b.reads, { head: [], get: [visibilityKey] });
    assert.equal(b.stats.writes, 0);

    const manifest = { schema_version: 1, revision: 1, generated_at: 1700000000, entities: [] };
    const c = await request(t, { mode: "enforce", objects: { [key]: payload, [visibilityKey]: manifest } });
    assert.deepEqual(c.body.rules, { versionLabel: payload.version_label, bodyMarkdown: payload.body_markdown });
    assert.deepEqual(c.reads, { head: [], get: [visibilityKey, key] });
    assert.equal(c.stats.writes, 0);
  });

  test("MIG-0627 U02c PREP T06: accepted users never read rules or consume R2/D1 fallback", async (t) => {
    const a = await request(t, { token: "tok-alice", mode: "enforce" });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.state.needsTermsAcceptance, false);
    assert.equal(a.body.rules, null);
    assert.deepEqual(a.reads, { get: [], head: [] });
    assert.equal(a.stats.writes, 0);
  });

  test("MIG-0627 U02c T07: zero/noninteger visibility manifest size fails closed before rules R2", async (t) => {
    const rules = { version_label: "v3", body_markdown: "# Current terms" };
    const zero = await request(t, {
      mode: "enforce", objects: { [key]: rules, [visibilityKey]: "" },
    });
    assert.equal(zero.response.status, 200);
    assert.equal(zero.body.rules, null);
    assert.deepEqual(zero.reads, { head: [], get: [visibilityKey] });
    assert.equal(zero.stats.writes, 0);
    const fractional = await request(t, {
      mode: "enforce", objects: { [key]: rules },
      visibilityGetOverride: { etag: "etag-nonempty", size: 0.5,
        async text() { throw new Error("oversize body must not be read"); } },
    });
    assert.equal(fractional.body.rules, null, "non-integral object size cannot authorize public rules");
    assert.deepEqual(fractional.reads, { head: [], get: [visibilityKey] });
  });

  test("MIG-0627 U02c T08: shared 1-MiB visibility reader boundary (S2 CPU budget still pending)", async (t) => {
    const rules = { version_label: "v3", body_markdown: "# Current terms" };
    const max = 1024 * 1024;
    const base = JSON.stringify({ schema_version: 1, revision: 1, generated_at: 1700000000, entities: [] });
    const exactJson = base + " ".repeat(max - Buffer.byteLength(base));
    assert.equal(Buffer.byteLength(exactJson), max);
    const exact = await request(t, {
      mode: "enforce", objects: { [key]: rules, [visibilityKey]: exactJson },
    });
    assert.equal(exact.body.rules?.versionLabel, "v3", "well-formed 1-MiB manifest remains accepted per CURRENT shared reader");
    assert.deepEqual(exact.reads, { head: [], get: [visibilityKey, key] });
    const oversized = await request(t, {
      mode: "enforce", objects: { [key]: rules, [visibilityKey]: exactJson + " " },
    });
    assert.equal(oversized.body.rules, null);
    assert.deepEqual(oversized.reads, { head: [], get: [visibilityKey] });
    assert.equal(oversized.stats.writes, 0);
  });

  test("MIG-0627 U02c T09: invalid JSON/entities and uncommitted ETag cannot authorize rules or D1 fallback", async (t) => {
    const rules = { version_label: "v7", body_markdown: "sensitive-current-text" };
    const valid = { schema_version: 1, revision: 1, generated_at: 1700000000, entities: [] };
    const cases = [
      { objects: { [key]: rules, [visibilityKey]: "{bad-json" } },
      { objects: { [key]: rules, [visibilityKey]: { ...valid, entities: [{ entity_type: "video", entity_id: "", fence_token: "t", blocked_at: 1 }] } } },
      { objects: { [key]: rules },
        visibilityGetOverride: {
          etag: "", size: Buffer.byteLength(JSON.stringify(valid)),
          async text() { return JSON.stringify(valid); },
        } },
    ];
    for (const options of cases) {
      const h = await request(t, { mode: "enforce", ...options });
      assert.equal(h.response.status, 200);
      assert.equal(h.body.rules, null, "invalid/uncommitted manifest may not publish R2 or fallback rules");
      assert.deepEqual(h.reads, { head: [], get: [visibilityKey] });
      assert.equal(h.stats.writes, 0);
    }
  });
  test("MIG-0627 U02c PREP T10: published-major update without R2 promotion can show stale rules (BLOCKER characterization)", async (t) => {
    // Current reader parity deliberately returns the present R2 artifact; the
    // visibility fence validates entity revocations, not terms publication
    // generation. Do NOT silently rewrite runtime behavior from this test.
    const publishedMajor = (db) => db.exec(
      "INSERT INTO terms_versions (id, version_label, body_markdown, status, severity, published_at, created_by_user_id, updated_at) " +
      "VALUES ('T4', 'v4', '# Terms v4', 'published', 'major', 4000, 'admin', 4000)"
    );
    const committedFence = {
      schema_version: 1, revision: 1, generated_at: 1700000000, entities: [],
    };
    const previousPublished = {
      version_label: "v2", body_markdown: "# Terms v2\n\n* a", published_at: 2000,
    };
    // Alice accepted the old T2 major in the real migrated-schema fixture.
    const stale = await request(t, {
      token: "tok-alice", mode: "enforce", seedSqlite: publishedMajor,
      objects: { [visibilityKey]: committedFence, [key]: previousPublished },
    });
    const withoutR2 = await request(t, {
      token: "tok-alice", mode: "enforce", seedSqlite: publishedMajor,
      objects: { [visibilityKey]: committedFence },
    });

    assert.equal(stale.response.status, 200);
    assert.equal(stale.body.state.needsTermsAcceptance, true,
      "D1 recognizes the newly published major and demands reacceptance");
    assert.equal(stale.body.rules?.versionLabel, "v2",
      "KNOWN GAP: old valid R2 object is returned despite D1's newer major");
    assert.deepEqual(stale.reads, { head: [], get: [visibilityKey, key] });
    assert.equal(withoutR2.response.status, 200);
    assert.equal(withoutR2.body.state.needsTermsAcceptance, true);
    assert.equal(withoutR2.body.rules?.versionLabel, "v4",
      "D1 fallback selects latest published major only when R2 object is absent");
    assert.deepEqual(withoutR2.reads, { head: [], get: [visibilityKey, key] });
    assert.equal(withoutR2.stats.statements, stale.stats.statements + 1,
      "always querying D1 to hide stale R2 would exceed the existing S2 statement budget");
    assert.equal(stale.stats.writes, 0);
    assert.equal(withoutR2.stats.writes, 0);
  });
}
