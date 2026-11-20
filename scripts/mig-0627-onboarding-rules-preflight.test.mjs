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

  async function request(t, { objects = {}, mode, token = "tok-carol", breakD1 = false } = {}) {
    const sqlite = createSqlite();
    seed(sqlite);
    t.after(() => sqlite.close());
    const d1 = createD1(sqlite);
    const reads = { get: [], head: [] };
    const bucket = fakeBucket(objects);
    const observedBucket = {
      async get(objectKey) { reads.get.push(objectKey); return bucket.get(objectKey); },
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

  test("MIG-0627 U02c PREP T05: enforce mode refuses rules when visibility manifest is missing", async (t) => {
    const payload = { version_label: "unsafe", body_markdown: "should not render" };
    const a = await request(t, { mode: "enforce", objects: { [key]: payload } });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.rules, null);
    assert.deepEqual(a.reads.head, [visibilityKey]);
    assert.deepEqual(a.reads.get, [], "deny before R2 rules read");
    assert.equal(a.stats.writes, 0);
    const b = await request(t, { mode: "enforce", objects: { [key]: payload, [visibilityKey]: { schema_version: 1 } } });
    assert.deepEqual(b.reads.head, [visibilityKey]);
    assert.deepEqual(b.reads.get, [key]);
    assert.equal(b.body.rules?.versionLabel, "unsafe",
      "current implementation only checks HEAD: manifest body semantic validation remains a release blocker");
  });

  test("MIG-0627 U02c PREP T06: accepted users never read rules or consume R2/D1 fallback", async (t) => {
    const a = await request(t, { token: "tok-alice", mode: "enforce" });
    assert.equal(a.response.status, 200);
    assert.equal(a.body.state.needsTermsAcceptance, false);
    assert.equal(a.body.rules, null);
    assert.deepEqual(a.reads, { get: [], head: [] });
    assert.equal(a.stats.writes, 0);
  });
}
