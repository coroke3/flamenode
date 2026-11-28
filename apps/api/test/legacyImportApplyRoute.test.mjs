// MIG-0645: intentionally test-only mounted apply HTTP adapter.
// The real D1 adapter covers staged import through new-video creation/skip; production has no mount.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { normalizeLegacyFiles } from "@flamenode/server-core/legacyImport/normalize";
import { createLegacyImportPreview } from "@flamenode/server-core/legacyImport/previewStore";
import {
  legacyImportReceiptMatchesProgress,
  legacyImportSkipSnapshotFingerprint,
} from "@flamenode/server-core/legacyImport/progress";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import {
  createLegacyImportApplyRoutes,
  createLegacyImportEventEffects,
  precommitLegacyImportVisibilityFence,
  planLegacyImportVideoCacheInvalidation,
} from "../src/routes/admin/legacyImportApplyRoute.ts";
import { preCommitEventVisibilityTransition } from "@flamenode/server-core/visibility/eventTransition";
import {
  emptyPublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
} from "@flamenode/server-core/visibility/manifestCore";
import { publicJsonCacheUrl } from "@flamenode/server-core/publicCache/delete";
import {
  EVENT_EXPORT_REFRESH_MINUTES,
  eventExportPayloadCacheKey,
} from "@flamenode/server-core/publicCache/eventExportKeys";
import {
  eventComposedObjectKey,
  eventBaseObjectKey,
  eventSlotsObjectKey,
  eventReleaseObjectKey,
} from "@flamenode/server-core/publicData/eventDetailCore";
import { legacyImportD1ApplyStep } from "../src/routes/admin/legacyImportD1ApplyAdapter.ts";
import {
  projectLegacyVideoCreate,
  readLegacyVideoReplacementSnapshot,
  buildLegacyVideoReplacementAssertion,
  prepareLegacyVideoReplacementAnswers,
  buildLegacyAnswerReplacementAssertion,
  readLegacyImportFenceSnapshot,
  buildLegacyImportFenceAssertion,
  inspectLegacyImportFenceRecovery,
} from "@flamenode/server-core/legacyImport/d1Apply";
import { createAdminD1, seedBase, seedEvent } from "./helpers/sqliteD1.mjs";

// The guards return lazy db.run() SQL wrappers, not prepared D1 queries.
// Production mutateWithAudit normalizes these wrappers before db.batch().
// For the isolated assertion-only tests, compile and bind the same SQL
// directly to the underlying fixture D1 client, without inventing audit rows.
// Never await the lazy wrapper separately: all statements share one batch.
async function runBoundTestBatch(serverDb, statements) {
  const client = serverDb.$client;
  const bound = statements.map((statement) => {
    assert.equal(typeof statement.getSQL, "function");
    const query = serverDb.dialect.sqlToQuery(statement.getSQL());
    return client.prepare(query.sql).bind(...query.params);
  });
  return client.batch(bound);
}

const SITE = "https://app.flamenode.example";
// CURRENT RH-002 durable run identity; the bearer preview token itself is never persisted.
const previewFingerprint = (token) => createHash("sha256").update(token).digest("hex");
const runDigest = (token) => previewFingerprint(token).slice(0, 24);

function extendLegacyImportUserSchema(sqlite) {
  sqlite.exec('ALTER TABLE "user" ADD COLUMN "emailVerified" INTEGER; ALTER TABLE "user" ADD COLUMN can_create_events INTEGER; ALTER TABLE "user" ADD COLUMN is_notification_enabled INTEGER; ALTER TABLE "user" ADD COLUMN terms_reaccept_required INTEGER DEFAULT 0; ALTER TABLE "user" ADD COLUMN onboarding_completed_at INTEGER; ALTER TABLE "user" ADD COLUMN last_guild_check INTEGER; ALTER TABLE "user" ADD COLUMN created_at INTEGER; ALTER TABLE x_users ADD COLUMN profile_text TEXT; ALTER TABLE x_users ADD COLUMN portfolio_contact TEXT; ALTER TABLE x_users ADD COLUMN youtube_channel_url TEXT; ALTER TABLE x_users ADD COLUMN other_social_links TEXT; ALTER TABLE x_users ADD COLUMN creative_start_date INTEGER;');
}

function extendLegacyImportSoftwareSchema(sqlite) {
  sqlite.exec('CREATE TABLE software_catalog (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL, category TEXT, usage_count INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, is_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); CREATE UNIQUE INDEX software_catalog_norm_uniq ON software_catalog(normalized_name);');
}

function extendLegacyImportEventSchema(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS event_staff (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      x_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      permission_preset TEXT NOT NULL,
      custom_permission_keys_json TEXT,
      is_public INTEGER NOT NULL,
      public_role_label TEXT,
      approved_by_auth_user_id TEXT,
      approved_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
}

function legacySoftwareId(normalizedName) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalizedName.length; index += 1) {
    hash ^= normalizedName.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return "sw_imp_" + (hash >>> 0).toString(16).padStart(8, "0");
}
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null,
  role: "admin", is_banned: 0, active_x_user_id: null };

function setup({ user = ADMIN, role = "admin", settings = "normal", bucket, applyStep, bindings = {}, beforeBatch } = {}) {
  const { db, sqlite, stats } = createAdminD1();
  if (beforeBatch) {
    const originalBatch = db.batch.bind(db);
    db.batch = async (statements) => {
      beforeBatch(sqlite);
      return originalBatch(statements);
    };
  }
  seedBase(sqlite, { role, settings });
  let d1ApplyCalls = 0;
  const app = new Hono();
  const admin = createAdminRoutes({
    session: async (c, next) => {
      c.set("user", user);
      c.set("sessionState", user ? "user" : "none");
      await next();
    },
  });
  admin.route("/import/legacy/apply", createLegacyImportApplyRoutes(async (input) => {
    d1ApplyCalls += 1;
    if (applyStep) return applyStep(input);
    throw new Error("D1 apply must never be reached on denied request");
  }));
  app.route("/api/admin", admin);
  const request = (data, origin = SITE) =>
    app.request("/api/admin/import/legacy/apply", {
      method: "POST", headers: { Origin: origin }, body: data,
    }, { DB: db, BUCKET: bucket, NEXT_PUBLIC_SITE_URL: SITE, ...bindings });
  return { request, sqlite, stats, getD1ApplyCalls: () => d1ApplyCalls };
}

test("MIG-0645 U02 apply Hono: cross-origin rejects before D1, multipart or R2", async () => {
  const { request, stats, getD1ApplyCalls } = setup();
  const res = await request(new FormData(), "https://untrusted.example");
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "invalid_origin");
  assert.equal(stats.reads, 0);
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 apply Hono: non-admin cannot claim R2", async () => {
  const { request, getD1ApplyCalls } = setup({
    user: { ...ADMIN, role: "user" }, role: "user",
  });
  const data = new FormData();
  data.set("preview_token", "deadbeef");
  data.set("plan_hash", "hash");
  const res = await request(data);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).reason, "forbidden");
  assert.equal(getD1ApplyCalls(), 0);
});

test("MIG-0645 U02 apply Hono: maintenance refuses all writes", async () => {
  const { request, getD1ApplyCalls } = setup({ settings: "maintenance" });
  const res = await request(new FormData());
  assert.equal(res.status, 503);
  assert.equal((await res.json()).reason, "maintenance_mode");
  assert.equal(getD1ApplyCalls(), 0);
});

test("MIG-0645 U02 apply Hono: missing credentials reject before R2 claim", async () => {
  const { request, stats, getD1ApplyCalls } = setup();
  const res = await request(new FormData());
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.requires_repreview, true);
  assert.equal(stats.batches, 0);
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 apply Hono: missing R2 fails closed without D1 apply", async () => {
  const { request, getD1ApplyCalls, stats } = setup();
  const data = new FormData();
  data.set("preview_token", "a".repeat(32));
  data.set("plan_hash", "b".repeat(64));
  const res = await request(data);
  assert.equal(res.status, 503, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.preview_error_code, "bucket_unavailable");
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(stats.batches, 0);
});

test("MIG-0645 U02 apply Hono: non-multipart input rejects before claim and D1", async () => {
  const { request, getD1ApplyCalls, stats } = setup();
  const res = await request("invalid multipart body");
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
  assert.equal(getD1ApplyCalls(), 0);
  assert.equal(stats.batches, 0);
});


// Test the real shared preview-store CAS with an explicitly simulated D1 step.
// This does not establish the atomic D1 mutation/step-marker/audit contract.
function previewBucket({ failAdvanceOnce = false, failAdvanceStage = "x_users", failCompleteOnce = false } = {}) {
  const objects = new Map();
  let version = 0;
  return {
    bucket: {
      async get(key) {
        const entry = objects.get(key);
        return entry ? {
          etag: entry.etag, size: Buffer.byteLength(entry.data),
          text: async () => entry.data,
        } : null;
      },
      async put(key, value, options = {}) {
        const previous = objects.get(key);
        const expected = options.onlyIf?.etagMatches;
        if (expected && expected !== previous?.etag) return null;
        const data = String(value);
        const next = JSON.parse(data);
        if (failCompleteOnce && expected && next.status === "completed") {
          failCompleteOnce = false;
          return null;
        }
        if (failAdvanceOnce && expected && next.status === "ready" &&
            next.progress.stage === failAdvanceStage) {
          failAdvanceOnce = false;
          return null;
        }
        const etag = String(++version);
        objects.set(key, { etag, data });
        return { etag };
      },
      async delete(key) { objects.delete(key); },
    },
    record: () => JSON.parse([...objects.values()][0].data),
    writes: () => version,
    failNextCompletion: () => { failCompleteOnce = true; },
    // Model a previous HTTP request that committed the last D1 step while its
    // R2 receipt is still in the "ready / complete" position. No D1 write here.
    markProgressComplete: () => {
      const [key, entry] = [...objects.entries()][0];
      assert.ok(key, "create preview before marking completion");
      const record = JSON.parse(entry.data);
      assert.equal(record.status, "ready");
      record.progress = { ...record.progress, stage: "complete", index: 0 };
      objects.set(key, { ...entry, data: JSON.stringify(record) });
    },
  };
}

async function createApplyCredential(bucket, authUserId = ADMIN.id, planOverride = null, strategy = "create_only", snapshots = {}) {
  const plan = planOverride ?? normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  assert.deepEqual(plan.errors, []);
  const credential = await createLegacyImportPreview(bucket, {
    authUserId, strategy, plan, ...snapshots,
  });
  const form = () => {
    const data = new FormData();
    data.set("mode", "apply");
    data.set("preview_token", credential.previewToken);
    data.set("plan_hash", credential.planHash);
    return data;
  };
  return { credential, form };
}

// Separate R2 object double for the manifest's conditional PUT contract.
function manifestBucket(concurrentEntry = null, initialEntries = []) {
  let version = 0;
  let current = null;
  if (initialEntries.length > 0) {
    const manifest = emptyPublicVisibilityBlockedEntitiesManifest(1);
    manifest.revision = 1;
    manifest.entities.push(...initialEntries);
    current = { etag: String(++version), body: JSON.stringify(manifest) };
  }
  const attempts = [];
  let reads = 0;
  return {
    attempts,
    reads: () => reads,
    bucket: {
      async get(key) {
        assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
        reads++;
        return current ? {
          etag: current.etag, size: Buffer.byteLength(current.body),
          text: async () => current.body,
        } : null;
      },
      async put(key, value, options = {}) {
        assert.equal(key, PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
        const create = options.onlyIf instanceof Headers &&
          options.onlyIf.get("If-None-Match") === "*";
        const expected = options.onlyIf?.etagMatches;
        attempts.push({ create, expected, cacheControl: options.httpMetadata?.cacheControl });
        assert.ok(create || expected, "precommit must use a conditional PUT");
        if (create && !current && concurrentEntry) {
          const manifest = emptyPublicVisibilityBlockedEntitiesManifest(1);
          manifest.revision = 1;
          manifest.entities.push(concurrentEntry);
          current = { etag: String(++version), body: JSON.stringify(manifest) };
        }
        if ((create && current) || (expected && expected !== current?.etag)) return null;
        current = { etag: String(++version), body: String(value) };
        return { etag: current.etag };
      },
    },
    manifest: () => current ? JSON.parse(current.body) : null,
  };
}

test("MIG-0645 U02ag event fence host: first-writer CAS conflict preserves another entity", async () => {
  const concurrent = {
    entity_type: "event", entity_id: "other-event", fence_token: "other-token",
    blocked_at: 1, reason: "other",
  };
  const fixture = manifestBucket(concurrent);
  const effects = createLegacyImportEventEffects(fixture.bucket);
  assert.equal(fixture.reads(), 0);
  assert.equal(fixture.attempts.length, 0);
  await preCommitEventVisibilityTransition({
    eventId: "import-event", fenceToken: "import-token", reason: "legacy_import_visibility",
  }, effects.fenceHost);
  assert.deepEqual(fixture.attempts, [
    { create: true, expected: undefined, cacheControl: "no-store" },
    { create: false, expected: "1", cacheControl: "no-store" },
  ]);
  assert.equal(fixture.reads(), 3, "initial read, conflict reread, confirmation");
  const entries = fixture.manifest().entities;
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.find((row) => row.entity_id === "other-event"), concurrent);
  const imported = entries.find((row) => row.entity_id === "import-event");
  assert.equal(imported.fence_token, "import-token");
  assert.equal(imported.reason, "legacy_import_visibility");
});

test("MIG-0645 U02ag event fence host: absent bucket and competing same-event token fail closed", async () => {
  const input = {
    eventId: "import-event", fenceToken: "import-token", reason: "legacy_import_visibility",
  };
  await assert.rejects(
    preCommitEventVisibilityTransition(input, createLegacyImportEventEffects(undefined).fenceHost),
    /public_visibility_manifest_bucket_missing/,
  );
  const concurrent = {
    entity_type: "event", entity_id: "import-event", fence_token: "competing-token",
    blocked_at: 1, reason: "other",
  };
  const fixture = manifestBucket(concurrent);
  await assert.rejects(
    preCommitEventVisibilityTransition(input, createLegacyImportEventEffects(fixture.bucket).fenceHost),
    /public_visibility_fence_token_mismatch/,
  );
  assert.deepEqual(fixture.manifest().entities, [concurrent]);
  assert.ok(fixture.attempts.length <= 3);
});

test("MIG-0645 U02ar D1 fence ownership snapshot and same-batch CAS", async () => {
  const { db, sqlite, stats } = createAdminD1();
  const serverDb = drizzle(db);
  try {
    // Exact canonical columns and compound identity; no production DB access.
    sqlite.exec(`
      CREATE TABLE public_visibility_fences (
        entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL,
        state TEXT NOT NULL, reason TEXT, requirements_json TEXT, blocked_at INTEGER,
        release_requested_at INTEGER, requested_by_auth_user_id TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
      );
      CREATE TABLE legacy_fence_guard_test (value INTEGER NOT NULL);
      INSERT INTO legacy_fence_guard_test(value) VALUES (0);
    `);
    const insert = sqlite.prepare(`
      INSERT INTO public_visibility_fences (
        entity_type, entity_id, fence_token, state, reason, requirements_json,
        blocked_at, release_requested_at, requested_by_auth_user_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const put = (entityType, entityId, token, state) =>
      insert.run(entityType, entityId, token, state, "legacy_import_visibility", null,
        state === "blocked" ? 1 : null, state === "release_pending" ? 1 : null, ADMIN.id, 1);
    for (const entityType of ["event", "video"]) {
      const identity = { entityType, entityId: "same-id", fenceToken: "new-token" };
      const otherType = entityType === "event" ? "video" : "event";
      const readBefore = stats.reads;
      const batchBefore = stats.batches;
      const absent = await readLegacyImportFenceSnapshot(serverDb, identity);
      assert.equal(absent.raw, null);
      assert.equal(absent.previousState, null);
      assert.equal(stats.reads - readBefore, 1);
      assert.equal(stats.batches, batchBefore, "snapshot never writes");

      const check = (snapshot) => runBoundTestBatch(serverDb, [buildLegacyImportFenceAssertion(serverDb, snapshot)]);
      const checkThenWrite = (snapshot) => runBoundTestBatch(serverDb, [
        buildLegacyImportFenceAssertion(serverDb, snapshot),
        serverDb.run(sql`UPDATE legacy_fence_guard_test SET value = value + 1`),
      ]);
      put(otherType, identity.entityId, "unrelated-token", "blocked");
      await check(absent); // same ID with a different type must not collide.
      put(entityType, identity.entityId, "foreign-token", "blocked");
      await assert.rejects(checkThenWrite(absent), /malformed JSON/i, "fence inserted after read must abort");
      assert.equal(sqlite.prepare("SELECT value FROM legacy_fence_guard_test").get().value, 0);
      await assert.rejects(readLegacyImportFenceSnapshot(serverDb, identity), "active foreign token is not import-owned");

      const foreign = { ...identity, fenceToken: "foreign-token" };
      const captured = await readLegacyImportFenceSnapshot(serverDb, foreign);
      assert.equal(captured.previousState, "blocked");
      await check(captured);
      const change = (field, value) => sqlite.prepare("UPDATE public_visibility_fences SET " + field +
        " = ? WHERE entity_type = ? AND entity_id = ?").run(value, entityType, identity.entityId);
      const drifts = [
        ["requirements_json", '{"rebuild":true}', null],
        ["reason", "another reason", "legacy_import_visibility"],
        ["updated_at", 2, 1],
        ["requested_by_auth_user_id", "other-actor", ADMIN.id],
        ["blocked_at", 3, 1],
        ["release_requested_at", 4, null],
        ["state", "release_pending", "blocked"],
        ["fence_token", "competing-token", "foreign-token"],
      ];
      for (const [field, changed, original] of drifts) {
        change(field, changed);
        await assert.rejects(checkThenWrite(captured), /malformed JSON/i, "full-row CAS detects " + field);
        assert.equal(sqlite.prepare("SELECT value FROM legacy_fence_guard_test").get().value, 0);
        change(field, original);
      }
      change("state", "release_pending");
      const pending = await readLegacyImportFenceSnapshot(serverDb, foreign);
      assert.equal(pending.previousState, "release_pending");
      await check(pending);
      change("state", "released");
      await assert.rejects(readLegacyImportFenceSnapshot(serverDb, foreign), "released token cannot be reused");
      const released = await readLegacyImportFenceSnapshot(serverDb, identity);
      assert.equal(released.previousState, "released");
      await check(released);
      change("requirements_json", "x".repeat(128 * 1024));
      await assert.rejects(readLegacyImportFenceSnapshot(serverDb, identity), "oversized row fails closed");
      change("requirements_json", null);
      sqlite.prepare("DELETE FROM public_visibility_fences WHERE entity_type = ? AND entity_id = ?")
        .run(entityType, identity.entityId);
      await assert.rejects(checkThenWrite(released), /malformed JSON/i, "released row deleted after read must abort");
      await check(absent);
      sqlite.prepare("DELETE FROM public_visibility_fences WHERE entity_type = ? AND entity_id = ?")
        .run(otherType, identity.entityId);
    }
    assert.equal(sqlite.prepare("SELECT value FROM legacy_fence_guard_test").get().value, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02aq import fence precommit: never take an existing event or video token", async () => {
  for (const entityType of ["event", "video"]) {
    const input = { entityType, entityId: "same-id", fenceToken: "import-token", reason: "legacy_import_visibility" };
    const competing = {
      entity_type: entityType, entity_id: "same-id", fence_token: "other-token",
      blocked_at: 1, reason: "other",
    };
    const occupied = manifestBucket(null, [competing]);
    const host = createLegacyImportEventEffects(occupied.bucket).fenceHost;
    await assert.rejects(precommitLegacyImportVisibilityFence(input, host), /public_visibility_fence_token_mismatch/);
    assert.equal(occupied.attempts.length, 0, "initial conflict must not attempt PUT");
    assert.deepEqual(occupied.manifest().entities, [competing]);

    const firstWriter = manifestBucket(competing);
    await assert.rejects(precommitLegacyImportVisibilityFence(input,
      createLegacyImportEventEffects(firstWriter.bucket).fenceHost), /public_visibility_fence_token_mismatch/);
    assert.deepEqual(firstWriter.manifest().entities, [competing]);
    assert.ok(firstWriter.attempts.length <= 3, "retry budget remains bounded");

    const sameToken = { ...competing, fence_token: input.fenceToken };
    const resumed = manifestBucket(null, [sameToken]);
    await precommitLegacyImportVisibilityFence(input, createLegacyImportEventEffects(resumed.bucket).fenceHost);
    assert.equal(resumed.attempts.length, 0, "same-token retry is read-only");
    assert.deepEqual(resumed.manifest().entities, [sameToken], "preserve initial reason and blocked_at");

    const otherType = { ...competing, entity_type: entityType === "video" ? "event" : "video" };
    const independent = manifestBucket(otherType);
    await precommitLegacyImportVisibilityFence(input, createLegacyImportEventEffects(independent.bucket).fenceHost);
    assert.equal(independent.attempts.length, 2);
    assert.equal(independent.reads(), 3);
    assert.equal(independent.manifest().entities.length, 2);
    assert.deepEqual(independent.manifest().entities.find((row) => row.entity_type === otherType.entity_type), otherType);
    assert.equal(independent.manifest().entities.find((row) => row.entity_type === entityType).fence_token, input.fenceToken);

    const duplicate = manifestBucket(null, [sameToken, { ...sameToken }]);
    await assert.rejects(precommitLegacyImportVisibilityFence(input,
      createLegacyImportEventEffects(duplicate.bucket).fenceHost), /public_visibility_fence_token_mismatch/);
    assert.equal(duplicate.attempts.length, 0, "ambiguous ownership never writes");
  }
});

test("MIG-0645 U02aq import fence precommit: missing bucket and lost confirmation fail closed", async () => {
  const input = { entityType: "video", entityId: "video-id", fenceToken: "import-token" };
  await assert.rejects(precommitLegacyImportVisibilityFence(input,
    createLegacyImportEventEffects(undefined).fenceHost), /public_visibility_manifest_bucket_missing/);
  let writes = 0;
  let reads = 0;
  const manifest = emptyPublicVisibilityBlockedEntitiesManifest(1);
  const host = { manifest: {
    read: async () => {
      reads++;
      return { manifest, etag: reads === 1 ? null : "other-etag" };
    },
    write: async (_candidate, options) => {
      writes++;
      assert.equal(options.ifMatchEtag, null);
      assert.equal(typeof options.mutateOnConflict, "function");
      // The R2 PUT returned, but the confirmation read no longer owns a block.
    },
  } };
  await assert.rejects(precommitLegacyImportVisibilityFence(input, host), /public_visibility_fence_token_mismatch/);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});

test("MIG-0645 U02ag event cache host: four snapshot and eight export keys, best effort", async () => {
  const deleted = [];
  const fixture = manifestBucket();
  const effects = createLegacyImportEventEffects(fixture.bucket, () => ({
    async delete(url) {
      deleted.push(url);
      if (deleted.length === 1) throw new Error("test-only cache failure");
      return true;
    },
  }));
  const eventId = "legacy-event-1";
  await effects.invalidateEventCaches(eventId);
  const keys = [
    eventComposedObjectKey(eventId), eventBaseObjectKey(eventId),
    eventSlotsObjectKey(eventId), eventReleaseObjectKey(eventId),
    ...["v5", "legacy"].flatMap((format) =>
      EVENT_EXPORT_REFRESH_MINUTES.map((refresh) => eventExportPayloadCacheKey(eventId, format, refresh))),
  ];
  assert.equal(keys.length, 12);
  assert.equal(new Set(keys).size, 12);
  assert.deepEqual(deleted, keys.map(publicJsonCacheUrl));
  assert.equal(fixture.reads(), 0);
  assert.equal(fixture.attempts.length, 0);
});

test("MIG-0645 U02at video cache plan: old/new aliases and removed/added events; local best effort", async () => {
  const deleted = [];
  const fixture = manifestBucket();
  const effects = createLegacyImportEventEffects(fixture.bucket, () => ({
    async delete(url) {
      deleted.push(url);
      if (deleted.length === 1) throw new Error("test-only cache failure");
      return true;
    },
  }));
  const input = {
    videoId: "video-1", beforeYoutubeId: "old-youtube", afterYoutubeId: "new-youtube",
    beforeEventIds: ["removed", "shared", "shared"], afterEventIds: ["shared", "added"],
    remainingCacheCalls: 15,
  };
  const keys = [
    "videos/video-1.json", "videos/old-youtube.json", "videos/new-youtube.json",
    ...["removed", "shared", "added"].flatMap((id) => [
      eventComposedObjectKey(id), eventBaseObjectKey(id), eventSlotsObjectKey(id), eventReleaseObjectKey(id),
    ]),
  ];
  const plan = planLegacyImportVideoCacheInvalidation(input);
  assert.deepEqual(plan.keys, keys);
  assert.equal(plan.requiredDeletes, 15);
  assert.equal(plan.fitsBudget, true);
  const prepared = effects.prepareVideoCacheInvalidation(input);
  assert.equal(prepared.status, "ready");
  assert.equal(prepared.requiredDeletes, 15);
  assert.equal(deleted.length, 0, "planning performs no Cache API calls");
  input.beforeEventIds.push("late-change");
  await prepared.invalidateAfterCommit();
  assert.deepEqual(deleted, keys.map(publicJsonCacheUrl), "failure must not omit later keys");
  assert.equal(fixture.reads(), 0);
  assert.equal(fixture.attempts.length, 0, "no R2 operations");
});

test("MIG-0645 U02at video cache budget: exact 50, one above, existing call consumption, no truncation", async () => {
  let deletes = 0;
  const effects = createLegacyImportEventEffects(undefined, () => ({
    async delete() {
      deletes++;
      if (deletes > 50) throw new Error("fixture cache quota exceeded");
      return true;
    },
  }));
  const events = Array.from({ length: 12 }, (_, i) => "event-" + i);
  const exact = {
    videoId: "video-1", beforeYoutubeId: "same-youtube", afterYoutubeId: "same-youtube",
    beforeEventIds: events.slice(0, 6), afterEventIds: events.slice(6),
    remainingCacheCalls: 50,
  };
  const exactPlan = planLegacyImportVideoCacheInvalidation(exact);
  assert.equal(exactPlan.requiredDeletes, 50);
  assert.equal(exactPlan.fitsBudget, true);
  const over = { ...exact, afterYoutubeId: "new-youtube" };
  const overPlan = planLegacyImportVideoCacheInvalidation(over);
  assert.equal(overPlan.requiredDeletes, 51);
  assert.equal(overPlan.keys.length, 51, "never truncate a privacy-sensitive key set");
  assert.equal(overPlan.fitsBudget, false);
  assert.deepEqual(effects.prepareVideoCacheInvalidation(over), { status: "blocked", requiredDeletes: 51 });
  assert.deepEqual(effects.prepareVideoCacheInvalidation({ ...exact, remainingCacheCalls: 49 }),
    { status: "blocked", requiredDeletes: 50 });
  assert.equal(deletes, 0, "an over-budget candidate is not executable");
  const prepared = effects.prepareVideoCacheInvalidation(exact);
  assert.equal(prepared.status, "ready");
  await prepared.invalidateAfterCommit();
  assert.equal(deletes, 50);

  const minimal = { ...exact, beforeYoutubeId: null, afterYoutubeId: null, beforeEventIds: [], afterEventIds: [] };
  assert.deepEqual(planLegacyImportVideoCacheInvalidation(minimal).keys, ["videos/video-1.json"]);
  assert.equal(effects.prepareVideoCacheInvalidation({ ...minimal, remainingCacheCalls: 0 }).status, "blocked");
  for (const invalid of [
    { ...minimal, remainingCacheCalls: 51 }, { ...minimal, remainingCacheCalls: -1 },
    { ...minimal, remainingCacheCalls: NaN }, { ...minimal, videoId: "" },
    { ...minimal, beforeEventIds: Array(18).fill("same") },
    { ...minimal, afterEventIds: [""] }, { ...minimal, videoId: "x".repeat(128 * 1024) },
  ]) {
    assert.throws(() => effects.prepareVideoCacheInvalidation(invalid), /legacy_import_video_cache_plan_invalid/);
  }
  assert.equal(deletes, 50, "rejected or unexecuted plans never delete");
});

test("MIG-0645 U02 apply Hono: authenticated request DB and owner reach exactly one step, then R2 advances", async () => {
  const { bucket, record } = previewBucket();
  const { credential, form } = await createApplyCredential(bucket);
  const { request, stats, sqlite, getD1ApplyCalls } = setup({
    bucket,
    applyStep: async (input) => {
      assert.equal(typeof input.db.select, "function", "request-scoped Drizzle DB required");
      assert.equal(typeof input.eventEffects.invalidateEventCaches, "function");
      assert.equal(typeof input.eventEffects.prepareVideoCacheInvalidation, "function");
      const manifest = await input.eventEffects.fenceHost.manifest.read();
      assert.equal(manifest.etag, null);
      assert.deepEqual(manifest.manifest.entities, []);
      assert.equal(input.actorAuthUserId, ADMIN.id);
      assert.equal(input.previewToken, credential.previewToken);
      assert.equal(input.planHash, credential.planHash);
      assert.equal(input.progress.stage, "system_user");
      assert.equal(record().status, "claimed");
      return { progress: { ...input.progress, stage: "x_users", index: 0 }, complete: false };
    },
  });
  const res = await request(form());
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const body = await res.json();
  assert.equal(body.continuation_required, true);
  assert.equal(body.progress.stage, "x_users");
  assert.equal(body.attempt, 1);
  assert.equal(body.result.complete, false);
  assert.equal(getD1ApplyCalls(), 1);
  assert.equal(record().status, "ready");
  assert.equal(record().progress.stage, "x_users");
  assert.equal(stats.batches, 0, "injected step is deliberately not a D1 writer");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("MIG-0645 U02 apply Hono: advance CAS failure reports committed pending and releases claim for recovery", async () => {
  const { bucket, record } = previewBucket({ failAdvanceOnce: true });
  const { credential, form } = await createApplyCredential(bucket);
  let simulatedMarker = null;
  let simulatedCommits = 0;
  const { request, stats, getD1ApplyCalls } = setup({
    bucket,
    applyStep: async (input) => {
      assert.equal(typeof input.db.select, "function");
      assert.equal(input.actorAuthUserId, ADMIN.id);
      assert.equal(input.planHash, credential.planHash);
      assert.equal(input.progress.stage, "system_user");
      // Simulate the future D1 adapter's marker replay; no actual D1 write.
      if (!simulatedMarker) {
        simulatedCommits++;
        simulatedMarker = { ...input.progress, stage: "x_users", index: 0 };
      }
      return { progress: simulatedMarker, complete: false };
    },
  });
  const failed = await request(form());
  assert.equal(failed.status, 503, JSON.stringify(await failed.clone().json()));
  const body = await failed.json();
  assert.equal(body.kind, "committed_progress_pending");
  assert.equal(body.committed, true);
  assert.equal(body.retryable, true);
  assert.equal(body.requires_repreview, false);
  assert.equal(body.progress.stage, "x_users");
  assert.equal(failed.headers.get("cache-control"), "private, no-store");
  assert.equal(getD1ApplyCalls(), 1, "one step per HTTP request, never retry within the handler");
  assert.equal(record().status, "ready");
  assert.equal(record().progress.stage, "system_user", "failed CAS did not advance R2");
  const recovered = await request(form());
  assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
  const retry = await recovered.json();
  assert.equal(retry.attempt, 2);
  assert.equal(retry.progress.stage, "x_users");
  assert.equal(getD1ApplyCalls(), 2);
  assert.equal(simulatedCommits, 1, "simulated marker replay does not simulate a second commit");
  assert.equal(record().progress.stage, "x_users");
  assert.equal(stats.batches, 0, "real audit-atomic D1 step is still not wired");
});

test("MIG-0645 U02 apply Hono: finalization CAS failure keeps committed receipt and retries without D1 replay", async () => {
  const { bucket, record, markProgressComplete, writes } = previewBucket({ failCompleteOnce: true });
  const { form } = await createApplyCredential(bucket);
  markProgressComplete();
  const { request, stats, getD1ApplyCalls } = setup({ bucket });
  const failed = await request(form());
  assert.equal(failed.status, 503, JSON.stringify(await failed.clone().json()));
  const body = await failed.json();
  assert.equal(body.kind, "committed_progress_pending");
  assert.equal(body.committed, true);
  assert.equal(body.retryable, true);
  assert.equal(body.requires_repreview, false);
  assert.equal(body.result.complete, true);
  assert.equal(body.progress.stage, "complete");
  assert.equal(body.attempt, 1);
  assert.equal(record().status, "ready", "failed finalization releases claim");
  assert.equal(record().progress.stage, "complete", "previous D1 progress is retained");
  assert.equal(getD1ApplyCalls(), 0, "completion does not replay a committed D1 step");
  assert.equal(stats.batches, 0);
  assert.equal(failed.headers.get("cache-control"), "private, no-store");

  const recovered = await request(form());
  assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
  const next = await recovered.json();
  assert.equal(next.ok, true);
  assert.equal(next.continuation_required, false);
  assert.equal(next.result.complete, true);
  assert.equal(next.attempt, 2);
  assert.equal(record().status, "completed");
  assert.equal(getD1ApplyCalls(), 0, "R2-only recovery must never replay D1");
  assert.equal(stats.batches, 0);

  const completedWrites = writes();
  const repeated = await request(form());
  assert.equal(repeated.status, 200, JSON.stringify(await repeated.clone().json()));
  const idempotent = await repeated.json();
  assert.equal(idempotent.continuation_required, false);
  assert.equal(idempotent.result.complete, true);
  assert.equal(idempotent.attempt, 2, "repeated completed token is not reclaimed");
  assert.equal(writes(), completedWrites, "repeated completed token does not rewrite R2");
  assert.equal(record().status, "completed");
  assert.equal(getD1ApplyCalls(), 0, "completed replay must never execute D1");
  assert.equal(stats.batches, 0);
});


test("MIG-0645 U02u Hono: real system_user D1 receipt survives R2 CAS failure and validates CURRENT replay contract", async () => {
  const { bucket, record } = previewBucket({ failAdvanceOnce: true });
  const { credential, form } = await createApplyCredential(bucket);
  const { request, sqlite, stats, getD1ApplyCalls } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  try {
    const first = await request(form());
    assert.equal(first.status, 503, JSON.stringify(await first.clone().json()));
    const failed = await first.json();
    assert.equal(failed.kind, "committed_progress_pending");
    assert.equal(failed.committed, true);
    assert.equal(failed.requires_repreview, false);
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "system_user");
    assert.equal(stats.reads, 3, "two parent guard reads plus one combined receipt/principal read");
    assert.equal(stats.batches, 1, "principal and durable marker commit in one audited D1 batch");

    const auditRow = sqlite.prepare("SELECT id, target_id, after_json, actor_user_id FROM audit_logs WHERE table_name = 'legacy_import_steps'").get();
    assert.ok(auditRow);
    const originalReceipt = auditRow.after_json;
    assert.equal(auditRow.actor_user_id, ADMIN.id);
    assert.equal(auditRow.target_id, runDigest(credential.previewToken) + ":" + credential.planHash.slice(0, 24) + ":system_user:0");
    assert.ok(!auditRow.target_id.includes(credential.previewToken));
    assert.ok(!originalReceipt.includes(credential.previewToken));
    const expected = JSON.parse(originalReceipt);
    assert.equal(expected.run_digest, runDigest(credential.previewToken));
    assert.equal(expected.plan_hash, credential.planHash);
    assert.equal(expected.stage, "system_user");
    assert.equal(expected.index, 0);
    assert.deepEqual(expected.outcome, { kind: "system_user" });
    assert.equal(expected.next_stage, "x_users");
    assert.equal(expected.next_index, 0);
    assert.deepEqual(expected.next_counts, {
      createdEvents: 0, replacedEvents: 0, skippedEvents: 0,
      createdVideos: 0, replacedVideos: 0, skippedVideos: 0,
      createdXUsers: 0, createdAuthUsers: 0, createdSoftwares: 0,
      createdCustomQuestions: 0, reusedCustomQuestions: 0,
    });
    assert.equal(expected.skip_event_snapshot_fingerprint, legacyImportSkipSnapshotFingerprint([]));
    assert.equal(expected.skip_video_snapshot_fingerprint, legacyImportSkipSnapshotFingerprint([]));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "user" WHERE id = ?').get("system_legacy_import").n, 1);

    const unsafeMarkers = [
      ["run digest mismatch", JSON.stringify({ ...expected, run_digest: "0".repeat(24) })],
      ["plan hash mismatch", JSON.stringify({ ...expected, plan_hash: "0".repeat(64) })],
      ["stage mismatch", JSON.stringify({ ...expected, stage: "videos" })],
      ["index mismatch", JSON.stringify({ ...expected, index: 1 })],
      ["outcome mismatch", JSON.stringify({ ...expected, outcome: { kind: "video" } })],
      ["next stage mismatch", JSON.stringify({ ...expected, next_stage: "complete" })],
      ["next index mismatch", JSON.stringify({ ...expected, next_index: 1 })],
      ["next counts mismatch", JSON.stringify({ ...expected, next_counts: { forged: true } })],
      ["event skip fingerprint mismatch", JSON.stringify({ ...expected, skip_event_snapshot_fingerprint: "0:0000000000000000" })],
      ["video skip fingerprint mismatch", JSON.stringify({ ...expected, skip_video_snapshot_fingerprint: "0:0000000000000000" })],
      ["malformed JSON", '{"incomplete":'],
    ];
    for (const [reason, brokenJson] of unsafeMarkers) {
      sqlite.prepare("UPDATE audit_logs SET after_json = ? WHERE id = ?").run(brokenJson, auditRow.id);
      const blocked = await request(form());
      assert.equal(blocked.status, 409, reason + " " + JSON.stringify(await blocked.clone().json()));
      const body = await blocked.json();
      assert.equal(body.ok, false, reason);
      assert.equal(body.requires_repreview, true, reason);
      assert.equal(record().status, "ready", reason);
      assert.equal(record().progress.stage, "system_user", reason);
      assert.equal(stats.batches, 1, reason);
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "user" WHERE id = ?').get("system_legacy_import").n, 1);
    }

    sqlite.prepare("INSERT INTO audit_logs (id, table_name, target_id, operation, before_json, after_json, changed_keys_json, inverse_patch_json, actor_user_id, actor_x_user_id, actor_snapshot_json, reason, context, retention_class, restore_strategy, restore_status, payload_size_bytes, expires_at, created_at, restore_unavailable_reason_code, restore_unavailable_message) SELECT ?, table_name, target_id, operation, before_json, after_json, changed_keys_json, inverse_patch_json, actor_user_id, actor_x_user_id, actor_snapshot_json, reason, context, retention_class, restore_strategy, restore_status, payload_size_bytes, expires_at, created_at, restore_unavailable_reason_code, restore_unavailable_message FROM audit_logs WHERE id = ?").run("duplicate-step-marker", auditRow.id);
    const duplicate = await request(form());
    assert.equal(duplicate.status, 409, "duplicate marker rows fail closed");
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "system_user");
    assert.equal(stats.batches, 1);
    sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("duplicate-step-marker");

    sqlite.prepare("UPDATE audit_logs SET after_json = ? WHERE id = ?").run(originalReceipt, auditRow.id);
    const second = await request(form());
    assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
    const recovered = await second.json();
    assert.equal(recovered.progress.stage, "x_users");
    assert.equal(recovered.attempt, unsafeMarkers.length + 3);
    assert.equal(record().progress.stage, "x_users");
    assert.equal(getD1ApplyCalls(), unsafeMarkers.length + 3);
    assert.equal(stats.batches, 1);
    assert.equal(stats.reads, 3 * (unsafeMarkers.length + 3), "every request stays within three pre-reads");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'user'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02u Hono: valid pre-existing technical principal receives marker-only atomic audit", async () => {
  const { bucket, record } = previewBucket();
  const { form } = await createApplyCredential(bucket);
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  sqlite.prepare("INSERT INTO \"user\" (id, name, email, \"emailVerified\", image, discord_id, role, can_create_events, is_notification_enabled, is_tos_accepted, accepted_terms_version_id, terms_reaccept_required, is_banned, active_x_user_id, onboarding_completed_at, last_guild_check, created_at) VALUES (?, ?, NULL, NULL, NULL, NULL, 'user', 0, 0, 0, NULL, 0, 0, NULL, NULL, NULL, 1)").run("system_legacy_import", "Legacy import system");
  try {
    const response = await request(form());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).progress.stage, "x_users");
    assert.equal(record().progress.stage, "x_users");
    assert.equal(stats.reads, 3);
    assert.equal(stats.batches, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "user" WHERE id = ?').get("system_legacy_import").n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 1);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02u Hono: reserved principal collision fails closed before any D1 batch", async () => {
  const { bucket, record } = previewBucket();
  const { form } = await createApplyCredential(bucket);
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  sqlite.prepare("INSERT INTO \"user\" (id, name, email, \"emailVerified\", image, discord_id, role, can_create_events, is_notification_enabled, is_tos_accepted, accepted_terms_version_id, terms_reaccept_required, is_banned, active_x_user_id, onboarding_completed_at, last_guild_check, created_at) VALUES (?, 'Legacy import system', NULL, NULL, NULL, NULL, 'admin', 0, 0, 0, NULL, 0, 0, NULL, NULL, NULL, 1)").run("system_legacy_import");
  try {
    const response = await request(form());
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.retryable, false);
    assert.equal(body.requires_repreview, true);
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "system_user");
    assert.equal(stats.reads, 3);
    assert.equal(stats.batches, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  } finally {
    sqlite.close();
  }
});


test("MIG-0645 U02x Hono: x_users mutation, rebuild queue and receipt commit atomically and replay after R2 CAS failure", async () => {
  const { bucket, record } = previewBucket({
    failAdvanceOnce: true,
    failAdvanceStage: "softwares",
  });
  const plan = normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  plan.xUsers.push(
    {
      id: "legacy_x_existing",
      x_name: "Existing creator",
      icon_url: null,
      youtube_channel_url: null,
      other_social_links: null,
    },
    {
      id: "legacy_x_new",
      x_name: "New creator",
      icon_url: "https://example.com/new.png",
      youtube_channel_url: "https://youtube.com/@new",
      other_social_links: null,
    },
  );
  const { credential, form } = await createApplyCredential(bucket, ADMIN.id, plan);
  const { request, sqlite, stats, getD1ApplyCalls } = setup({
    bucket,
    applyStep: legacyImportD1ApplyStep,
  });
  extendLegacyImportUserSchema(sqlite);
  sqlite.prepare(
    "INSERT INTO x_users (id, x_name, icon_url, approval_status, profile_text, portfolio_contact, youtube_channel_url, other_social_links, creative_start_date) VALUES (?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL)",
  ).run("legacy_x_existing", "Existing creator", "approved");

  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200, JSON.stringify(await systemUser.clone().json()));
    assert.equal((await systemUser.json()).progress.stage, "x_users");
    assert.equal(record().progress.stage, "x_users");
    assert.equal(stats.reads, 3);
    assert.equal(stats.batches, 1);

    const failedAdvance = await request(form());
    assert.equal(failedAdvance.status, 503, JSON.stringify(await failedAdvance.clone().json()));
    const pending = await failedAdvance.json();
    assert.equal(pending.kind, "committed_progress_pending");
    assert.equal(pending.committed, true);
    assert.equal(pending.requires_repreview, false);
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "x_users");
    assert.equal(stats.reads, 6);
    assert.equal(stats.batches, 2, "X users, rebuild queue and audit receipt commit in one batch");

    const existing = sqlite.prepare(
      "SELECT x_name, approval_status FROM x_users WHERE id = ?",
    ).get("legacy_x_existing");
    assert.deepEqual({ ...existing }, { x_name: "Existing creator", approval_status: "approved" });
    const created = sqlite.prepare(
      "SELECT x_name, icon_url, youtube_channel_url, approval_status FROM x_users WHERE id = ?",
    ).get("legacy_x_new");
    assert.deepEqual({ ...created }, {
      x_name: "New creator",
      icon_url: "https://example.com/new.png",
      youtube_channel_url: "https://youtube.com/@new",
      approval_status: "imported",
    });

    const queue = sqlite.prepare(
      "SELECT id, target_type, target_id, reason, priority, requested_by_user_id FROM static_rebuild_queue",
    ).get();
    assert.deepEqual({ ...queue }, {
      id: "legacy_import_" + runDigest(credential.previewToken) + "_" +
        credential.planHash.slice(0, 24) + "_x_users_0_0",
      target_type: "users_index",
      target_id: "global",
      reason: "legacy_import_x_users",
      priority: "low",
      requested_by_user_id: ADMIN.id,
    });
    const batchAudit = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'x_users_import_batch'",
    ).get();
    assert.deepEqual(JSON.parse(batchAudit.after_json).ids, ["legacy_x_new"]);
    const stepAudit = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_steps' AND target_id LIKE '%:x_users:0'",
    ).get();
    const stepReceipt = JSON.parse(stepAudit.after_json);
    assert.deepEqual(stepReceipt.outcome, {
      kind: "x_users", created: 1, createdAuthUsers: 0,
    });
    assert.equal(stepReceipt.next_stage, "softwares");
    assert.equal(stepReceipt.next_index, 0);

    const replay = await request(form());
    assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
    const recovered = await replay.json();
    assert.equal(recovered.progress.stage, "softwares");
    assert.equal(recovered.result.created.xUsers, 1);
    assert.equal(record().progress.stage, "softwares");
    assert.equal(stats.reads, 9, "each stage/replay request uses three pre-reads");
    assert.equal(stats.batches, 2, "replaying the durable receipt never duplicates the D1 batch");
    assert.equal(getD1ApplyCalls(), 3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 4);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 2);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02x Hono: empty x_users stage writes only its durable marker", async () => {
  const { bucket, record } = previewBucket();
  const { form } = await createApplyCredential(bucket);
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200);
    assert.equal((await systemUser.json()).progress.stage, "x_users");
    const emptyStage = await request(form());
    assert.equal(emptyStage.status, 200, JSON.stringify(await emptyStage.clone().json()));
    assert.equal((await emptyStage.json()).progress.stage, "softwares");
    assert.equal(record().progress.stage, "softwares");
    assert.equal(stats.reads, 6);
    assert.equal(stats.batches, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'x_users_import_batch'").get().n, 0);
  } finally {
    sqlite.close();
  }
});


test("MIG-0645 U02ac Hono: software catalog mutation, audit receipt and R2 CAS replay are atomic", async () => {
  const { bucket, record } = previewBucket({ failAdvanceOnce: true, failAdvanceStage: "events" });
  const plan = normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  plan.videoSoftwares.push(
    { video_id: "legacy-video-1", label: "OBS Studio" },
    { video_id: "legacy-video-2", label: "OBS   Studio" },
    { video_id: "legacy-video-3", label: "  DaVinci   Resolve " },
  );
  const { credential, form } = await createApplyCredential(bucket, ADMIN.id, plan);
  const { request, sqlite, stats, getD1ApplyCalls } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  sqlite.prepare(
    "INSERT INTO software_catalog (id, name, normalized_name, category, usage_count, is_active, is_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(legacySoftwareId("obs studio"), "OBS canonical", "obs studio", "streaming", 7, 0, 1, 10, 11);

  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200, JSON.stringify(await systemUser.clone().json()));
    assert.equal((await systemUser.json()).progress.stage, "x_users");

    const emptyXUsers = await request(form());
    assert.equal(emptyXUsers.status, 200, JSON.stringify(await emptyXUsers.clone().json()));
    assert.equal((await emptyXUsers.json()).progress.stage, "softwares");

    const failedAdvance = await request(form());
    assert.equal(failedAdvance.status, 503, JSON.stringify(await failedAdvance.clone().json()));
    const pending = await failedAdvance.json();
    assert.equal(pending.kind, "committed_progress_pending");
    assert.equal(pending.committed, true);
    assert.equal(pending.requires_repreview, false);
    assert.equal(pending.progress.stage, "events");
    assert.equal(pending.result.created.softwares, 1);
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "softwares");
    assert.equal(stats.reads, 9, "three pre-reads per request, including the combined software snapshot");
    assert.equal(stats.batches, 3, "system user, empty X stage and software data+audit+receipt batches");

    const existing = sqlite.prepare(
      "SELECT id, name, category, usage_count, is_active, is_verified FROM software_catalog WHERE normalized_name = ?",
    ).get("obs studio");
    assert.deepEqual({ ...existing }, {
      id: legacySoftwareId("obs studio"), name: "OBS canonical", category: "streaming",
      usage_count: 7, is_active: 0, is_verified: 1,
    });
    const created = sqlite.prepare(
      "SELECT id, name, normalized_name, category, usage_count, is_active, is_verified FROM software_catalog WHERE normalized_name = ?",
    ).get("davinci resolve");
    assert.deepEqual({ ...created }, {
      id: legacySoftwareId("davinci resolve"), name: "DaVinci   Resolve",
      normalized_name: "davinci resolve", category: null, usage_count: 0, is_active: 1, is_verified: 0,
    });
    const batchAudit = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'software_catalog_import_batch'",
    ).get();
    assert.deepEqual(JSON.parse(batchAudit.after_json).rows.map((row) => row.normalized_name), ["davinci resolve"]);
    const stepAudit = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_steps' AND target_id LIKE '%:softwares:0'",
    ).get();
    const receipt = JSON.parse(stepAudit.after_json);
    assert.deepEqual(receipt.outcome, { kind: "softwares", created: 1 });
    assert.equal(receipt.next_stage, "events");
    assert.equal(receipt.next_index, 0);

    const replay = await request(form());
    assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
    const recovered = await replay.json();
    assert.equal(recovered.progress.stage, "events");
    assert.equal(recovered.result.created.softwares, 1);
    assert.equal(record().progress.stage, "events");
    assert.equal(stats.reads, 12, "receipt replay adds one combined read and no per-software reads");
    assert.equal(stats.batches, 3, "durable receipt replay never duplicates the software insert or audit");
    assert.equal(getD1ApplyCalls(), 4);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM software_catalog").get().n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 5);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'software_catalog_import_batch'").get().n, 1);
    assert.ok(!JSON.stringify(receipt).includes(credential.previewToken));
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02ac Hono: empty software stage writes only its durable marker", async () => {
  const { bucket, record } = previewBucket();
  const { form } = await createApplyCredential(bucket);
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200);
    assert.equal((await systemUser.json()).progress.stage, "x_users");
    const emptyXUsers = await request(form());
    assert.equal(emptyXUsers.status, 200);
    assert.equal((await emptyXUsers.json()).progress.stage, "softwares");
    const emptySoftwares = await request(form());
    assert.equal(emptySoftwares.status, 200, JSON.stringify(await emptySoftwares.clone().json()));
    assert.equal((await emptySoftwares.json()).progress.stage, "events");
    assert.equal(record().progress.stage, "events");
    assert.equal(stats.reads, 9);
    assert.equal(stats.batches, 3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM software_catalog").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'software_catalog_import_batch'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 3);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02ac Hono: all-existing software group writes marker only and preserves catalog row", async () => {
  const { bucket, record } = previewBucket();
  const plan = normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  plan.videoSoftwares.push({ video_id: "legacy-video-1", label: "OBS Studio" });
  const { form } = await createApplyCredential(bucket, ADMIN.id, plan);
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  sqlite.prepare(
    "INSERT INTO software_catalog (id, name, normalized_name, category, usage_count, is_active, is_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(legacySoftwareId("obs studio"), "OBS canonical", "obs studio", "streaming", 7, 0, 1, 10, 11);
  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200);
    const emptyXUsers = await request(form());
    assert.equal(emptyXUsers.status, 200);
    const allExisting = await request(form());
    assert.equal(allExisting.status, 200, JSON.stringify(await allExisting.clone().json()));
    assert.equal((await allExisting.json()).progress.stage, "events");
    assert.equal(record().progress.stage, "events");
    assert.equal(stats.reads, 9);
    assert.equal(stats.batches, 3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM software_catalog").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'software_catalog_import_batch'").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 3);
    const preserved = sqlite.prepare(
      "SELECT name, category, usage_count, is_active, is_verified FROM software_catalog WHERE normalized_name = ?",
    ).get("obs studio");
    assert.deepEqual({ ...preserved }, {
      name: "OBS canonical", category: "streaming", usage_count: 7, is_active: 0, is_verified: 1,
    });
  } finally {
    sqlite.close();
  }
});


test("MIG-0645 U02ad Hono: event, owner staff, rebuild targets and audit receipt commit atomically and replay after R2 CAS failure", async () => {
  const { bucket, record } = previewBucket({ failAdvanceOnce: true, failAdvanceStage: "custom_questions" });
  const plan = normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  plan.xUsers.push({
    id: "legacy_event_owner",
    x_name: "Event owner",
    icon_url: null,
    youtube_channel_url: null,
    other_social_links: null,
  });
  const event = {
    id: "legacy-event-1",
    title: "Imported event",
    event_type: "event",
    explanation: null,
    icon_url: null,
    img_url: null,
    visibility_status: "private",
    start_time: 1700000000,
    end_time: 1700003600,
  };
  plan.events.push(event);
  plan.eventStaff.push({
    id: "legacy-event-owner-staff",
    event_id: event.id,
    x_user_id: "legacy_event_owner",
    display_name: "Event owner",
    permission_preset: "owner",
    is_public: 0,
    public_role_label: null,
  });
  const { credential, form } = await createApplyCredential(bucket, ADMIN.id, plan);
  const wakeMessages = [];
  const { request, sqlite, stats, getD1ApplyCalls } = setup({
    bucket,
    applyStep: legacyImportD1ApplyStep,
    bindings: {
      QUEUE_DISPATCH_ENABLED: "1",
      STATIC_REBUILD_WAKE_QUEUE: {
        send: async (message) => { wakeMessages.push(message); },
      },
    },
  });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  extendLegacyImportEventSchema(sqlite);

  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200, JSON.stringify(await systemUser.clone().json()));
    assert.equal((await systemUser.json()).progress.stage, "x_users");

    const xUsers = await request(form());
    assert.equal(xUsers.status, 200, JSON.stringify(await xUsers.clone().json()));
    assert.equal((await xUsers.json()).progress.stage, "softwares");
    assert.equal(wakeMessages.length, 1, "X-user D1 commit sends one static rebuild wake");
    assert.deepEqual(
      { kind: wakeMessages[0].kind, source: wakeMessages[0].source },
      { kind: "static_rebuild_available", source: "import" },
    );

    const emptySoftwares = await request(form());
    assert.equal(emptySoftwares.status, 200, JSON.stringify(await emptySoftwares.clone().json()));
    assert.equal((await emptySoftwares.json()).progress.stage, "events");

    const failedAdvance = await request(form());
    assert.equal(failedAdvance.status, 503, JSON.stringify(await failedAdvance.clone().json()));
    const pending = await failedAdvance.json();
    assert.equal(pending.kind, "committed_progress_pending");
    assert.equal(pending.committed, true);
    assert.equal(pending.requires_repreview, false);
    assert.equal(pending.progress.stage, "custom_questions");
    assert.equal(pending.result.created.events, 1);
    assert.equal(wakeMessages.length, 2, "event D1 commit sends one additional wake before the R2 progress CAS");
    assert.deepEqual(wakeMessages.map(({ kind, source }) => ({ kind, source })), [
      { kind: "static_rebuild_available", source: "import" },
      { kind: "static_rebuild_available", source: "import" },
    ]);
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "events");
    assert.equal(stats.reads, 12, "four requests use three pre-reads each, including the combined event snapshot");
    assert.equal(stats.batches, 4, "system user, X users, empty software marker and event/staff/queue/audit batches");

    const savedEvent = sqlite.prepare(
      "SELECT id, title, event_type, visibility_status, start_time, end_time FROM events WHERE id = ?",
    ).get(event.id);
    assert.deepEqual({ ...savedEvent }, {
      id: event.id,
      title: event.title,
      event_type: "event",
      visibility_status: "private",
      start_time: 1700000000,
      end_time: 1700003600,
    });
    const savedStaff = sqlite.prepare(
      "SELECT id, event_id, x_user_id, permission_preset, approved_by_auth_user_id FROM event_staff WHERE event_id = ?",
    ).get(event.id);
    assert.deepEqual({ ...savedStaff }, {
      id: "legacy-event-owner-staff",
      event_id: event.id,
      x_user_id: "legacy_event_owner",
      permission_preset: "owner",
      approved_by_auth_user_id: ADMIN.id,
    });
    const queueTargets = sqlite.prepare(
      "SELECT target_type, target_id, reason, priority FROM static_rebuild_queue ORDER BY target_type, target_id",
    ).all().map((row) => ({ ...row }));
    assert.deepEqual(queueTargets, [
      { target_type: "event_base", target_id: event.id, reason: "legacy_import", priority: "high" },
      { target_type: "event_release", target_id: event.id, reason: "legacy_import", priority: "high" },
      { target_type: "event_slots", target_id: event.id, reason: "legacy_import", priority: "high" },
      { target_type: "events_index", target_id: "global", reason: "legacy_import", priority: "low" },
      { target_type: "search_index", target_id: "global", reason: "legacy_import", priority: "low" },
      { target_type: "users_index", target_id: "global", reason: "legacy_import_x_users", priority: "low" },
    ]);
    const eventAudit = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'events' AND target_id = ?",
    ).get(event.id);
    assert.deepEqual(JSON.parse(eventAudit.after_json).staff.map((row) => row.id), ["legacy-event-owner-staff"]);
    const entitySnapshot = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_entity_snapshots' AND target_id = ?",
    ).get("event:legacy-event-1");
    assert.ok(entitySnapshot);
    const stepAudit = sqlite.prepare(
      "SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_steps' AND target_id LIKE '%:events:0'",
    ).get();
    const receipt = JSON.parse(stepAudit.after_json);
    assert.deepEqual(receipt.outcome, { kind: "event", action: "created" });
    assert.equal(receipt.next_stage, "custom_questions");
    assert.equal(receipt.next_index, 0);

    const replay = await request(form());
    assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
    const recovered = await replay.json();
    assert.equal(recovered.progress.stage, "custom_questions");
    assert.equal(recovered.result.created.events, 1);
    assert.equal(record().progress.stage, "custom_questions");
    assert.equal(wakeMessages.length, 2, "durable receipt replay does not send a duplicate wake");
    assert.equal(stats.reads, 15, "durable receipt replay adds one combined event snapshot read");
    assert.equal(stats.batches, 4, "receipt replay never duplicates event, staff, queue or audit writes");
    assert.equal(getD1ApplyCalls(), 5);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 6);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'events'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_entity_snapshots'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 4);
    assert.ok(!JSON.stringify(receipt).includes(credential.previewToken));
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02ah Hono: proven same-visibility replacement preserves unmanaged fields and rejects stale or competing state", async () => {
  const { bucket } = previewBucket();
  let race = false;
  const { request, sqlite, stats } = setup({
    bucket, applyStep: legacyImportD1ApplyStep,
    beforeBatch: (db) => {
      if (!race) return;
      race = false;
      // Change an unmanaged event field after the combined snapshot, but
      // before the audited D1 batch. Full-row CAS must refuse the mutation.
      db.prepare("UPDATE events SET accent_color = ? WHERE id = ?").run("#334455", "replace-event");
    },
  });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  extendLegacyImportEventSchema(sqlite);
  const makePlan = (title, visibility = "private") => {
    const plan = normalizeLegacyFiles([], {
      eventVisibility: visibility, videoVisibility: "private", now: 1700000000,
    });
    plan.xUsers.push({
      id: "replace-owner", x_name: "Owner", icon_url: null,
      youtube_channel_url: null, other_social_links: null,
    });
    plan.events.push({
      id: "replace-event", title, event_type: "event", explanation: null,
      icon_url: null, img_url: null, visibility_status: visibility,
      start_time: 1700000000, end_time: 1700003600,
    });
    plan.eventStaff.push({
      id: "replace-staff", event_id: "replace-event", x_user_id: "replace-owner",
      display_name: "Owner", permission_preset: "owner", is_public: 0,
      public_role_label: null,
    });
    return plan;
  };
  async function reachEvents(plan, strategy) {
    const { form } = await createApplyCredential(bucket, ADMIN.id, plan, strategy);
    for (const expected of ["x_users", "softwares", "events"]) {
      const response = await request(form());
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      assert.equal((await response.json()).progress.stage, expected);
    }
    return form;
  }
  try {
    const create = await reachEvents(makePlan("Original"), "create_only");
    const created = await request(create());
    assert.equal(created.status, 200, JSON.stringify(await created.clone().json()));
    assert.equal((await created.json()).result.created.events, 1);
    assert.equal(
      sqlite.prepare('SELECT terms_reaccept_required FROM "user" WHERE id = ?').get("system_legacy_import").terms_reaccept_required,
      0, "test schema must preserve the canonical default for repeated imports",
    );
    const original = sqlite.prepare("SELECT created_at FROM events WHERE id = ?").get("replace-event");
    // Keep the earlier proof strictly older, since two equal latest timestamps
    // are deliberately ambiguous under CURRENT's provenance contract.
    sqlite.prepare("UPDATE audit_logs SET created_at = 1 WHERE table_name = 'legacy_import_entity_snapshots' AND target_id = ?").run("event:replace-event");

    const stale = await reachEvents(makePlan("Replacement"), "replace_imported");
    sqlite.prepare("UPDATE events SET title = ? WHERE id = ?").run("Manually edited", "replace-event");
    const staleBatches = stats.batches;
    assert.equal((await request(stale())).status, 409);
    assert.equal(stats.batches, staleBatches, "managed digest mismatch never enters the write batch");
    sqlite.prepare("UPDATE events SET title = ? WHERE id = ?").run("Original", "replace-event");

    const competing = await reachEvents(makePlan("Replacement"), "replace_imported");
    race = true;
    const competingResponse = await request(competing());
    assert.equal(competingResponse.status, 409);
    assert.equal(sqlite.prepare("SELECT title FROM events WHERE id = ?").get("replace-event").title, "Original");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'events'").get().n, 1);

    const visibility = await reachEvents(makePlan("Not yet supported", "public"), "replace_imported");
    const visibilityBatches = stats.batches;
    assert.equal((await request(visibility())).status, 409);
    assert.equal(stats.batches, visibilityBatches, "visibility change remains fail closed");

    const replace = await reachEvents(makePlan("Replacement"), "replace_imported");
    const reads = stats.reads;
    const batches = stats.batches;
    const response = await request(replace());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const result = await response.json();
    assert.equal(result.progress.stage, "custom_questions");
    assert.equal(result.result.replaced.events, 1);
    assert.equal(stats.reads - reads, 3, "replacement still uses one combined D1 snapshot");
    assert.equal(stats.batches - batches, 1, "replacement and receipt commit together");
    const saved = sqlite.prepare("SELECT title, created_at, accent_color, visibility_status FROM events WHERE id = ?").get("replace-event");
    assert.deepEqual({ ...saved }, {
      title: "Replacement", created_at: original.created_at, accent_color: "#334455", visibility_status: "private",
    });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff WHERE event_id = ?").get("replace-event").n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'events' AND operation = 'UPDATE'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_entity_snapshots' AND target_id = ?").get("event:replace-event").n, 2);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02ad Hono: empty events stage writes only its durable marker", async () => {
  const { bucket, record } = previewBucket();
  const { form } = await createApplyCredential(bucket);
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  extendLegacyImportEventSchema(sqlite);
  try {
    const systemUser = await request(form());
    assert.equal(systemUser.status, 200);
    const emptyXUsers = await request(form());
    assert.equal(emptyXUsers.status, 200);
    const emptySoftwares = await request(form());
    assert.equal(emptySoftwares.status, 200);
    const emptyEvents = await request(form());
    assert.equal(emptyEvents.status, 200, JSON.stringify(await emptyEvents.clone().json()));
    assert.equal((await emptyEvents.json()).progress.stage, "custom_questions");
    assert.equal(record().progress.stage, "custom_questions");
    assert.equal(stats.reads, 12);
    assert.equal(stats.batches, 4);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_staff").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_steps'").get().n, 4);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'legacy_import_entity_snapshots'").get().n, 0);
  } finally {
    sqlite.close();
  }
});


function extendLegacyImportQuestionSchema(sqlite) {
  sqlite.exec(`
    CREATE TABLE event_custom_questions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, question_key TEXT NOT NULL,
      label TEXT NOT NULL, description TEXT, type TEXT NOT NULL, required INTEGER NOT NULL,
      options_json TEXT, placeholder TEXT, max_length INTEGER, sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL, visibility TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(event_id, question_key)
    );
    CREATE TABLE videos (id TEXT PRIMARY KEY);
  `);
}

test("MIG-0645 U02ak: new video projection matches CURRENT audit key order and related-row defaults", async () => {
  const plan = questionPlan(2);
  const video = {
    id: "video-projection", primary_event_id: "ev-1", creator_x_user_id: "creator-1",
    collaboration_type: "collab", source_type: "youtube", creator_display_name: "Creator",
    creator_display_name_yomi: null, creator_icon_url: null, creator_youtube_channel_url: null,
    creator_profile_text: null, creator_other_social_links: "legacy-links",
    title: "Video", music: null, credit: null, music_reference_url: null, closing_comment: null,
    youtube_video_id: "abcdefghijk", intro_comment: null, highlights: null, production_story: null,
    visibility_status: "private", scheduling_type: "manual", scheduled_time: null, created_at: 100,
  };
  plan.videos.push(video);
  plan.videoEvents.push(
    { video_id: video.id, event_id: "ev-2" }, { video_id: video.id, event_id: "ev-1" },
  );
  plan.videoMembers.push(
    { id: "member-b", video_id: video.id, x_user_id: null, name: "B", role: null, order_index: 1 },
    { id: "member-a", video_id: video.id, x_user_id: "creator-1", name: "A", role: "Editor", order_index: 0 },
  );
  plan.videoChapters.push({ id: "chapter", video_id: video.id, x_user_id: null, chapter_time: 5, chapter_label: "Intro", note: null, visibility: "public" });
  plan.videoSoftwares.push({ video_id: video.id, label: "  Test   Software " });
  plan.videoCustomAnswers.push(
    { video_id: video.id, event_id: "ev-1", question_id: "question-1", question_key: "question_1", answer_text: "B", answer_json: null },
    { video_id: video.id, event_id: "ev-1", question_id: "question-0", question_key: "question_0", answer_text: "A", answer_json: null },
  );
  const args = {
    plan, videoId: video.id, creator: { profile_text: "fallback-profile", other_social_links: "fallback-links" },
    softwareIds: new Map([["test software", "software-1"]]), now: 200,
  };
  const before = JSON.stringify(plan);
  const projected = await projectLegacyVideoCreate(args);
  assert.equal(JSON.stringify(plan), before, "pure projection never changes the claimed plan");
  const expectedManaged = {
    id: video.id, primary_event_id: "ev-1", creator_x_user_id: "creator-1",
    submitted_by_user_id: "system_legacy_import", collaboration_type: "collab", part: null,
    source_type: "youtube", creator_display_name: "Creator", creator_display_name_yomi: null,
    creator_icon_url: null, creator_youtube_channel_url: null,
    creator_profile_text: "fallback-profile", creator_other_social_links: "legacy-links",
    title: "Video", music: null, credit: null, music_reference_url: null, closing_comment: null,
    youtube_video_id: "abcdefghijk", intro_comment: null, highlights: null, production_story: null,
    visibility_status: "private", scheduling_type: "manual", scheduled_time: null, created_at: 100,
  };
  assert.equal(JSON.stringify(projected.managed), JSON.stringify(expectedManaged));
  assert.deepEqual(projected.nextEvents, [
    { video_id: video.id, event_id: "ev-1" }, { video_id: video.id, event_id: "ev-2" },
  ]);
  assert.deepEqual(projected.nextMembers[0], {
    id: "member-a", video_id: video.id, x_user_id: "creator-1", name: "A", role: "Editor",
    comment: null, order_index: 0, can_edit: 0, is_public_member: 1,
    edit_granted_by_auth_user_id: null, edit_granted_at: null, edit_updated_at: null,
  });
  assert.deepEqual(projected.nextChapters, [{
    id: "chapter", video_id: video.id, x_user_id: null, chapter_time: 5,
    chapter_label: "Intro", note: null, visibility: "public", created_at: 200, updated_at: 200,
  }]);
  assert.deepEqual(projected.nextSoftwares, [{
    video_id: video.id, software_id: "software-1", raw_label: "  Test   Software ",
  }]);
  assert.deepEqual(projected.nextMetadata, [{
    video_id: video.id, youtube_privacy_status: null, youtube_availability_status: null,
    duration_seconds: null, view_count: 0, synced_at: null, sync_status: "pending",
    sync_error: null, updated_at: 200,
  }]);
  assert.deepEqual(projected.nextAnswers, [
    { video_id: video.id, event_id: "ev-1", question_id: "question-0", answer_text: "A", answer_json: null, created_at: 200, updated_at: 200 },
    { video_id: video.id, event_id: "ev-1", question_id: "question-1", answer_text: "B", answer_json: null, created_at: 200, updated_at: 200 },
  ]);
  const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  assert.deepEqual(projected.snapshotProof, {
    entity_kind: "video", managed_digest: digest(expectedManaged),
    events_digest: digest(projected.nextEvents), members_digest: digest(projected.nextMembers),
    chapters_digest: digest(projected.nextChapters), softwares_digest: digest(projected.nextSoftwares),
    metadata_digest: digest(projected.nextMetadata), custom_answers_digest: digest(projected.nextAnswers),
  });
  assert.equal(projected.rebuildTargets.length, 16);
  assert.deepEqual(projected.rebuildTargets.filter((row) => row.target_id === "ev-1").map((row) => row.target_type),
    ["event_base", "event_slots", "event_release"]);
  assert.equal(projected.youtubeWakeRequired, true);
  assert.deepEqual(await projectLegacyVideoCreate(args), projected);

  await assert.rejects(projectLegacyVideoCreate({ ...args, softwareIds: new Map() }));
  await assert.rejects(projectLegacyVideoCreate({ ...args, creator: { profile_text: "x".repeat(128 * 1024), other_social_links: null } }));
  const duplicate = structuredClone(plan);
  duplicate.videoEvents.push(duplicate.videoEvents[0]);
  await assert.rejects(projectLegacyVideoCreate({ ...args, plan: duplicate }));
  const missingQuestion = structuredClone(plan);
  missingQuestion.eventCustomQuestions.pop();
  await assert.rejects(projectLegacyVideoCreate({ ...args, plan: missingQuestion }));
  const external = structuredClone(plan);
  external.videos[0].youtube_video_id = null;
  external.videos[0].source_type = "external";
  const noYoutube = await projectLegacyVideoCreate({ ...args, plan: external });
  assert.deepEqual(noYoutube.nextMetadata, []);
  assert.equal(noYoutube.youtubeWakeRequired, false);
});

// Extend only the isolated D1 fixture, not the canonical runtime schema.
function extendLegacyImportVideoCreateSchema(sqlite) {
  sqlite.exec(`
    DROP TABLE videos;
    CREATE TABLE videos (
      id TEXT PRIMARY KEY, primary_event_id TEXT, creator_x_user_id TEXT,
      submitted_by_user_id TEXT NOT NULL, collaboration_type TEXT NOT NULL,
      part TEXT, source_type TEXT NOT NULL, creator_display_name TEXT NOT NULL,
      creator_display_name_yomi TEXT, creator_icon_url TEXT, creator_youtube_channel_url TEXT,
      creator_profile_text TEXT, creator_other_social_links TEXT, title TEXT NOT NULL,
      music TEXT, credit TEXT, music_reference_url TEXT, closing_comment TEXT,
      youtube_video_id TEXT, intro_comment TEXT, highlights TEXT, production_story TEXT,
      visibility_status TEXT NOT NULL, scheduling_type TEXT, scheduled_time INTEGER,
      app_like_count INTEGER NOT NULL DEFAULT 0, score REAL NOT NULL DEFAULT 0,
      score_updated_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX videos_active_youtube ON videos(youtube_video_id)
      WHERE youtube_video_id IS NOT NULL AND youtube_video_id <> ''
        AND visibility_status NOT IN ('archived', 'voided');
    CREATE TABLE video_events (video_id TEXT, event_id TEXT, PRIMARY KEY(video_id, event_id));
    CREATE TABLE video_members (id TEXT PRIMARY KEY, video_id TEXT, x_user_id TEXT, name TEXT,
      role TEXT, comment TEXT, order_index INTEGER, can_edit INTEGER, is_public_member INTEGER,
      edit_granted_by_auth_user_id TEXT, edit_granted_at INTEGER, edit_updated_at INTEGER);
    CREATE TABLE video_chapters (id TEXT PRIMARY KEY, video_id TEXT, x_user_id TEXT,
      chapter_time REAL, chapter_label TEXT, note TEXT, visibility TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE video_softwares (video_id TEXT, software_id TEXT, raw_label TEXT, PRIMARY KEY(video_id, software_id));
    CREATE TABLE video_youtube_metadata (video_id TEXT PRIMARY KEY, youtube_privacy_status TEXT,
      youtube_availability_status TEXT, duration_seconds INTEGER, view_count INTEGER, synced_at INTEGER,
      sync_status TEXT, sync_error TEXT, updated_at INTEGER);
    CREATE TABLE video_custom_answers (video_id TEXT, event_id TEXT, question_id TEXT,
      answer_text TEXT, answer_json TEXT, created_at INTEGER, updated_at INTEGER,
      PRIMARY KEY(video_id, event_id, question_id));
  `);
}

test("MIG-0645 U02al Hono: new video rows, provenance, queue and receipt are atomic; final R2 replay does not repeat wakes", async () => {
  const { bucket, failNextCompletion } = previewBucket({ failCompleteOnce: true });
  const wakes = [];
  let race = false;
  let creatorRace = false;
  let replacementRace = false;
  let serverDb;
  const { request, sqlite, stats } = setup({
    bucket, applyStep: (input) => {
      serverDb = input.db;
      return legacyImportD1ApplyStep(input);
    },
    bindings: {
      QUEUE_DISPATCH_ENABLED: "1", QUEUE_YOUTUBE_SYNC_ENABLED: "1",
      STATIC_REBUILD_WAKE_QUEUE: { send: async (message) => { wakes.push(message); } },
      YOUTUBE_SYNC_WAKE_QUEUE: { send: async (message) => { wakes.push(message); } },
    },
    beforeBatch: (db) => {
      if (creatorRace) {
        creatorRace = false;
        db.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?").run("Concurrent profile", "creator-video");
      }
      if (replacementRace) {
        replacementRace = false;
        db.prepare("UPDATE videos SET app_like_count = 11 WHERE id = ?").run("created-video");
      }
      if (!race) return;
      race = false;
      db.prepare("UPDATE event_custom_questions SET label = ? WHERE id = ?").run("Concurrent edit", "question-0");
    },
  });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  extendLegacyImportEventSchema(sqlite);
  extendLegacyImportQuestionSchema(sqlite);
  extendLegacyImportVideoCreateSchema(sqlite);
  seedEvent(sqlite, { visibility_status: "private" });
  const plan = questionPlan(1);
  plan.xUsers.push({
    id: "creator-video", x_name: "Creator", icon_url: null,
    youtube_channel_url: null, other_social_links: null,
  });
  const video = {
    id: "created-video", primary_event_id: "ev-1", creator_x_user_id: "creator-video",
    collaboration_type: "individual", source_type: "youtube", creator_display_name: "Creator",
    creator_display_name_yomi: null, creator_icon_url: null, creator_youtube_channel_url: null,
    creator_profile_text: null, creator_other_social_links: null, title: "New video",
    music: null, credit: null, music_reference_url: null, closing_comment: null,
    youtube_video_id: "abcdefghijk", intro_comment: null, highlights: null, production_story: null,
    visibility_status: "private", scheduling_type: "manual", scheduled_time: null, created_at: 1700000000,
  };
  plan.videos.push(video);
  plan.videoEvents.push({ video_id: video.id, event_id: "ev-1" });
  plan.videoMembers.push({ id: "member-video", video_id: video.id, x_user_id: "creator-video", name: "Creator", role: null, order_index: 0 });
  plan.videoChapters.push({ id: "chapter-video", video_id: video.id, x_user_id: null, chapter_time: 5, chapter_label: "Intro", note: null, visibility: "public" });
  plan.videoSoftwares.push({ video_id: video.id, label: "Test Software" });
  plan.videoCustomAnswers.push({ video_id: video.id, event_id: "ev-1", question_id: "question-0", question_key: "question_0", answer_text: "Answer", answer_json: null });
  try {
    const { form } = await createApplyCredential(bucket, ADMIN.id, plan);
    await reachQuestionStage(request, form);
    const questionResponse = await request(form());
    assert.equal(questionResponse.status, 200, JSON.stringify(await questionResponse.clone().json()));
    assert.equal((await questionResponse.json()).progress.stage, "videos");
    sqlite.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?").run("Fallback profile", "creator-video");
    const wakesBefore = wakes.length;
    const queueBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n;
    race = true;
    const failed = await request(form());
    assert.equal(failed.status, 409, "changed question definition refuses the batch");
    for (const table of ["videos", "video_events", "video_members", "video_chapters", "video_softwares", "video_youtube_metadata", "video_custom_answers"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n, 0);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, queueBefore);
    assert.equal(wakes.length, wakesBefore);
    sqlite.prepare("UPDATE event_custom_questions SET label = ? WHERE id = ?").run("Question 0", "question-0");

    // U02au: merging the support read must not weaken the D1 CAS for
    // creator-derived fallback data.
    creatorRace = true;
    const staleCreator = await request(form());
    assert.equal(staleCreator.status, 409, "creator snapshot race refuses the atomic batch");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'videos'").get().n, 0);
    assert.equal(wakes.length, wakesBefore);
    sqlite.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?").run("Fallback profile", "creator-video");

    const readsBefore = stats.reads;
    const batchesBefore = stats.batches;
    const pending = await request(form());
    assert.equal(pending.status, 503, JSON.stringify(await pending.clone().json()));
    const pendingBody = await pending.json();
    assert.equal(pendingBody.kind, "committed_progress_pending");
    assert.equal(pendingBody.progress.stage, "complete");
    assert.equal(pendingBody.result.created.videos, 1);
    assert.equal(stats.reads - readsBefore, 3, "creator/catalog share the receipt and video-ID query");
    assert.equal(stats.batches, batchesBefore + 1);
    const saved = sqlite.prepare("SELECT * FROM videos WHERE id = ?").get(video.id);
    assert.equal(saved.creator_profile_text, "Fallback profile");
    assert.equal(saved.submitted_by_user_id, "system_legacy_import");
    assert.equal(saved.created_at, video.created_at);
    assert.equal(saved.app_like_count, 0);
    assert.equal(sqlite.prepare("SELECT sync_status FROM video_youtube_metadata WHERE video_id = ?").get(video.id).sync_status, "pending");
    assert.equal(sqlite.prepare("SELECT answer_text FROM video_custom_answers WHERE video_id = ?").get(video.id).answer_text, "Answer");
    for (const table of ["video_events", "video_members", "video_chapters", "video_softwares"]) {
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM " + table + " WHERE video_id = ?").get(video.id).n, 1);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue WHERE target_type = 'video' AND target_id = ?").get(video.id).n, 1);
    const proof = JSON.parse(sqlite.prepare("SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_entity_snapshots' AND target_id = ?").get("video:created-video").after_json);
    const projected = await projectLegacyVideoCreate({
      plan, videoId: video.id, creator: { profile_text: "Fallback profile", other_social_links: null },
      softwareIds: new Map([["test software", sqlite.prepare("SELECT id FROM software_catalog WHERE normalized_name = ?").get("test software").id]]),
      now: saved.updated_at,
    });
    assert.deepEqual(proof, projected.snapshotProof);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'video_custom_answers' AND operation = 'CREATE'").get().n, 1);
    assert.deepEqual(wakes.slice(wakesBefore).map((message) => message.kind),
      ["static_rebuild_available", "youtube_sync_pending"]);
    // A durable receipt must replay even when current support data is no
    // longer admissible for a fresh write. The combined query selects no
    // support rows on the receipt branch.
    sqlite.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?").run("x".repeat(128 * 1024), "creator-video");
    const replayReads = stats.reads;
    const replay = await request(form());
    assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
    assert.equal((await replay.json()).result.created.videos, 1);
    assert.equal(stats.reads - replayReads, 3);
    assert.equal(stats.batches, batchesBefore + 1);
    assert.equal(wakes.length, wakesBefore + 2);
    sqlite.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?").run("Fallback profile", "creator-video");

    // U02am: exact CURRENT proof from the actual persisted rows, not just
    // the input projection. Read-only until replacement/CAS is implemented.
    assert.ok(serverDb);
    const snapshotReads = stats.reads;
    const snapshotBatches = stats.batches;
    const snapshot = await readLegacyVideoReplacementSnapshot(
      serverDb, video.id, ["created-video:ev-1:question-0"],
    );
    assert.equal(stats.reads - snapshotReads, 1);
    assert.equal(stats.batches, snapshotBatches);
    assert.deepEqual(snapshot.proof, proof);
    assert.equal(snapshot.raw.video.length, 1);
    assert.equal(snapshot.raw.proof.length, 1);
    assert.equal(snapshot.beforeAnswers.length, 1);
    assert.equal(snapshot.beforeMetadata.length, 1);
    assert.equal(snapshot.answerProofs.length, 1);
    await assert.rejects(readLegacyVideoReplacementSnapshot(serverDb, "missing-video"));

    // Change one field in each of the seven independently hashed projections.
    // Restore each value before checking the next projection.
    const drifts = [
      ["videos", "title", "Changed", "New video", "id"],
      ["video_events", "event_id", "ev-other", "ev-1", "video_id"],
      ["video_members", "name", "Changed member", "Creator", "video_id"],
      ["video_chapters", "chapter_label", "Changed chapter", "Intro", "video_id"],
      ["video_softwares", "raw_label", "Changed software", "Test Software", "video_id"],
      ["video_youtube_metadata", "sync_status", "synced", "pending", "video_id"],
      ["video_custom_answers", "answer_text", "Changed answer", "Answer", "video_id"],
    ];
    for (const [table, field, changed, original, key] of drifts) {
      const update = sqlite.prepare("UPDATE " + table + " SET " + field + " = ? WHERE " + key + " = ?");
      update.run(changed, video.id);
      await assert.rejects(readLegacyVideoReplacementSnapshot(serverDb, video.id));
      update.run(original, video.id);
    }
    // Unmanaged counters may drift, but the raw full-row snapshot must
    // retain them for the later transaction-time CAS.
    sqlite.prepare("UPDATE videos SET app_like_count = 7 WHERE id = ?").run(video.id);
    const unmanaged = await readLegacyVideoReplacementSnapshot(serverDb, video.id);
    assert.deepEqual(unmanaged.proof, proof);
    assert.equal(unmanaged.video.app_like_count, 7);
    assert.notEqual(unmanaged.raw.video[0], snapshot.raw.video[0]);
    sqlite.prepare("UPDATE videos SET app_like_count = 0 WHERE id = ?").run(video.id);
    sqlite.prepare("UPDATE videos SET submitted_by_user_id = ? WHERE id = ?").run(ADMIN.id, video.id);
    await assert.rejects(readLegacyVideoReplacementSnapshot(serverDb, video.id));
    sqlite.prepare("UPDATE videos SET submitted_by_user_id = ? WHERE id = ?").run("system_legacy_import", video.id);
    sqlite.prepare("UPDATE videos SET title = ? WHERE id = ?").run("x".repeat(128 * 1024), video.id);
    await assert.rejects(readLegacyVideoReplacementSnapshot(serverDb, video.id));
    sqlite.prepare("UPDATE videos SET title = ? WHERE id = ?").run("New video", video.id);

    // Same-timestamp latest provenance must be unique. Clone the actual
    // test-table audit entry (all its required columns), changing only id.
    const auditColumns = sqlite.prepare("PRAGMA table_info(audit_logs)").all().map((column) => column.name);
    const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
    sqlite.prepare("INSERT INTO audit_logs (" + auditColumns.map(quote).join(", ") + ") SELECT " +
      auditColumns.map((column) => column === "id" ? "?" : quote(column)).join(", ") +
      " FROM audit_logs WHERE id = ?").run("competing-video-proof", snapshot.audit.id);
    await assert.rejects(readLegacyVideoReplacementSnapshot(serverDb, video.id));
    sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("competing-video-proof");
    assert.deepEqual((await readLegacyVideoReplacementSnapshot(serverDb, video.id)).proof, proof);
    assert.equal(stats.batches, snapshotBatches, "proof checks never execute a D1 write batch");
    assert.equal(wakes.length, wakesBefore + 2, "proof checks never send queue wakes");

    // U02an: build the assertion before the mutation race, execute it
    // through the same D1 batch interface used by the future replacement.
    // A sentinel UPDATE following a rejected assertion must never execute.
    const assertBatch = async (captured) => runBoundTestBatch(serverDb, [
      buildLegacyVideoReplacementAssertion(serverDb, captured),
    ]);
    await assertBatch(snapshot);
    const guardedBatch = async (captured) => runBoundTestBatch(serverDb, [
      buildLegacyVideoReplacementAssertion(serverDb, captured),
      serverDb.run(sql`UPDATE videos SET score = 99 WHERE id = ${video.id}`),
    ]);
    sqlite.prepare("UPDATE videos SET app_like_count = 8 WHERE id = ?").run(video.id);
    await assert.rejects(guardedBatch(snapshot), /malformed JSON/i, "unmanaged column race must abort the D1 batch");
    assert.equal(sqlite.prepare("SELECT score FROM videos WHERE id = ?").get(video.id).score, 0);
    const currentCounterSnapshot = await readLegacyVideoReplacementSnapshot(serverDb, video.id);
    await assertBatch(currentCounterSnapshot);
    sqlite.prepare("UPDATE videos SET app_like_count = 0 WHERE id = ?").run(video.id);

    for (const [table, field, changed, original, key] of drifts) {
      const update = sqlite.prepare("UPDATE " + table + " SET " + field + " = ? WHERE " + key + " = ?");
      update.run(changed, video.id);
      await assert.rejects(guardedBatch(snapshot), /malformed JSON/i, "transaction guard must catch drift in " + table);
      assert.equal(sqlite.prepare("SELECT score FROM videos WHERE id = ?").get(video.id).score, 0);
      update.run(original, video.id);
    }
    sqlite.prepare("INSERT INTO video_events(video_id, event_id) VALUES (?, ?)").run(video.id, "ev-extra");
    await assert.rejects(guardedBatch(snapshot), /malformed JSON/i, "additional related row must abort");
    sqlite.prepare("DELETE FROM video_events WHERE video_id = ? AND event_id = ?").run(video.id, "ev-extra");
    sqlite.prepare("DELETE FROM video_events WHERE video_id = ?").run(video.id);
    await assert.rejects(guardedBatch(snapshot), /malformed JSON/i, "removed related row must abort");
    sqlite.prepare("INSERT INTO video_events(video_id, event_id) VALUES (?, ?)").run(video.id, "ev-1");

    sqlite.prepare("INSERT INTO audit_logs (" + auditColumns.map(quote).join(", ") + ") SELECT " +
      auditColumns.map((column) => column === "id" ? "?" : quote(column)).join(", ") +
      " FROM audit_logs WHERE id = ?").run("competing-video-proof", snapshot.audit.id);
    await assert.rejects(guardedBatch(snapshot), /malformed JSON/i, "ambiguous latest proof must abort");
    sqlite.prepare("UPDATE audit_logs SET created_at = created_at + 1 WHERE id = ?").run("competing-video-proof");
    await assert.rejects(guardedBatch(snapshot), /malformed JSON/i, "newer latest proof must abort");
    sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("competing-video-proof");
    await assertBatch(snapshot);
    assert.equal(sqlite.prepare("SELECT score FROM videos WHERE id = ?").get(video.id).score, 0);
    assert.equal(wakes.length, wakesBefore + 2, "transaction assertions never send queue wakes");

    // U02ao: omitted and identical answers keep their exact timestamps.
    // Changed answers require a separate unique latest legacy audit, even
    // though the seven-digest entity proof is still valid.
    const now = saved.updated_at + 10;
    const answerInput = { snapshot, projection: projected, now };
    const beforeUnchangedReads = stats.reads;
    const unchanged = await prepareLegacyVideoReplacementAnswers(answerInput);
    assert.deepEqual(unchanged.nextAnswers, snapshot.beforeAnswers);
    assert.equal(unchanged.replaced.length, 0);
    assert.equal(unchanged.created.length, 0);
    assert.equal(stats.reads, beforeUnchangedReads, "unchanged answers use the combined snapshot read");
    const omitted = await prepareLegacyVideoReplacementAnswers({
      ...answerInput, projection: { ...projected, nextAnswers: [] },
    });
    assert.deepEqual(omitted.nextAnswers, unchanged.nextAnswers);
    await assert.rejects(prepareLegacyVideoReplacementAnswers({
      ...answerInput, projection: { ...projected, nextEvents: [], nextAnswers: [] },
    }), "cannot orphan retained answers by removing their event");

    const incoming = [
      { ...projected.nextAnswers[0], answer_text: "Replacement answer" },
      { ...projected.nextAnswers[0], question_id: "another-question", answer_text: "New answer" },
    ];
    const changedInput = { ...answerInput, projection: { ...projected, nextAnswers: incoming } };
    const proofReads = stats.reads;
    const prepared = await prepareLegacyVideoReplacementAnswers(changedInput);
    assert.equal(stats.reads - proofReads, 0, "answer proofs were preloaded with the video snapshot");
    assert.equal(prepared.replaced.length, 1);
    assert.equal(prepared.created.length, 1);
    assert.equal(prepared.replaced[0].after.created_at, snapshot.beforeAnswers[0].created_at);
    assert.equal(prepared.replaced[0].after.updated_at, now);
    assert.equal(prepared.created[0].created_at, now);
    assert.equal(prepared.nextAnswers.length, 2);
    assert.equal(prepared.proofs.length, 1);
    assert.equal(prepared.custom_answers_digest, createHash("sha256").update(JSON.stringify(prepared.nextAnswers)).digest("hex"));
    await runBoundTestBatch(serverDb, [buildLegacyAnswerReplacementAssertion(serverDb, prepared)]);

    const answerProofId = prepared.proofs[0].id;
    const cloneAnswerProof = sqlite.prepare("INSERT INTO audit_logs (" + auditColumns.map(quote).join(", ") + ") SELECT " +
      auditColumns.map((column) => column === "id" ? "?" : quote(column)).join(", ") +
      " FROM audit_logs WHERE id = ?");
    cloneAnswerProof.run("competing-answer-proof", answerProofId);
    const tiedPrepared = await prepareLegacyVideoReplacementAnswers(changedInput);
    assert.deepEqual(tiedPrepared.proofs, prepared.proofs, "preloaded proof is checked by the atomic assertion after read-time races");
    const tiedSnapshot = await readLegacyVideoReplacementSnapshot(
      serverDb, video.id, ["created-video:ev-1:question-0"],
    );
    await assert.rejects(prepareLegacyVideoReplacementAnswers({
      ...changedInput, snapshot: tiedSnapshot,
    }), "a freshly read tied latest proof must refuse replacement");
    const answerGuardedBatch = async () => runBoundTestBatch(serverDb, [
      buildLegacyVideoReplacementAssertion(serverDb, snapshot),
      buildLegacyAnswerReplacementAssertion(serverDb, prepared),
      serverDb.run(sql`UPDATE videos SET score = 99 WHERE id = ${video.id}`),
    ]);
    await assert.rejects(answerGuardedBatch(), /malformed JSON/i, "a tied answer audit appearing after read must abort");
    sqlite.prepare("UPDATE audit_logs SET created_at = created_at + 1, context = ? WHERE id = ?")
      .run("manual-edit", "competing-answer-proof");
    assert.deepEqual((await prepareLegacyVideoReplacementAnswers(changedInput)).proofs, prepared.proofs,
      "the atomic assertion, not a second read, catches a later manual audit");
    await assert.rejects(answerGuardedBatch(), /malformed JSON/i, "newer non-import audit appearing after read must abort");
    assert.equal(sqlite.prepare("SELECT score FROM videos WHERE id = ?").get(video.id).score, 0);
    sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("competing-answer-proof");
    await runBoundTestBatch(serverDb, [buildLegacyAnswerReplacementAssertion(serverDb, prepared)]);

    const originalAfterJson = prepared.proofs[0].after_json;
    sqlite.prepare("UPDATE audit_logs SET after_json = ? WHERE id = ?")
      .run(JSON.stringify({ ...snapshot.beforeAnswers[0], updated_at: now }), answerProofId);
    assert.deepEqual((await prepareLegacyVideoReplacementAnswers(changedInput)).proofs, prepared.proofs,
      "the atomic assertion catches a changed proof payload after the snapshot");
    await assert.rejects(answerGuardedBatch(), /malformed JSON/i, "changed proof payload must abort");
    sqlite.prepare("UPDATE audit_logs SET after_json = ? WHERE id = ?").run(originalAfterJson, answerProofId);
    await assert.rejects(prepareLegacyVideoReplacementAnswers({
      ...changedInput, projection: {
        ...projected,
        nextAnswers: Array.from({ length: 4 }, (_, i) => ({
          ...projected.nextAnswers[0], question_id: "additional-" + i,
        })),
      },
    }), "existing plus incoming answers must respect the cap");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM video_custom_answers").get().n, 1);
    assert.equal(wakes.length, wakesBefore + 2);

    // U02ap: private-to-private replacement, only for proven imported rows.
    // Make previous proofs unambiguously older than the new proof.
    sqlite.prepare("UPDATE audit_logs SET created_at = 1 WHERE table_name IN ('legacy_import_entity_snapshots', 'video_custom_answers')").run();
    sqlite.prepare("UPDATE videos SET app_like_count = 7, score = 3, score_updated_at = 42 WHERE id = ?").run(video.id);
    // U02as: a failed future transition may only be considered for rollback
    // if the fresh token, full old entity and fence are unchanged, and there
    // is definitely no step receipt. This never writes or releases R2.
    sqlite.exec(`
      CREATE TABLE public_visibility_fences (
        entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, fence_token TEXT NOT NULL,
        state TEXT NOT NULL, reason TEXT, requirements_json TEXT, blocked_at INTEGER,
        release_requested_at INTEGER, requested_by_auth_user_id TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
      );
    `);
    const rollbackIdentity = { entityType: "video", entityId: video.id, fenceToken: "fresh-rollback-token" };
    const fenceBefore = await readLegacyImportFenceSnapshot(serverDb, rollbackIdentity);
    const entityBefore = await readLegacyVideoReplacementSnapshot(serverDb, video.id);
    const recoveryStep = { runDigest: "a".repeat(24), planHash: "b".repeat(64), stage: "videos", index: 0 };
    const recoveryInput = {
      db: serverDb, before: fenceBefore, beforeEntityJson: entityBefore.raw.video[0],
      step: recoveryStep, d1Outcome: "confirmed_rollback",
    };
    const recoveryReads = stats.reads;
    const recoveryBatches = stats.batches;
    const recoveryWakes = wakes.length;
    assert.equal(await inspectLegacyImportFenceRecovery({ ...recoveryInput, d1Outcome: "unknown" }), "retain");
    assert.equal(stats.reads, recoveryReads, "unknown outcome is fail-closed without D1 read");
    assert.equal(await inspectLegacyImportFenceRecovery(recoveryInput), "rollback_candidate");
    assert.equal(stats.reads - recoveryReads, 1, "all three recovery checks share a D1 snapshot");
    sqlite.prepare("UPDATE videos SET score = 4 WHERE id = ?").run(video.id);
    assert.equal(await inspectLegacyImportFenceRecovery(recoveryInput), "retain", "unmanaged drift blocks release");
    sqlite.prepare("UPDATE videos SET score = 3 WHERE id = ?").run(video.id);
    const missingBefore = await readLegacyImportFenceSnapshot(serverDb, { ...rollbackIdentity, entityId: "missing-video" });
    const missingEntity = JSON.stringify({ ...entityBefore.video, id: "missing-video" });
    assert.equal(await inspectLegacyImportFenceRecovery({
      ...recoveryInput, before: missingBefore, beforeEntityJson: missingEntity,
    }), "retain", "missing entity blocks release");

    const insertFence = sqlite.prepare(`
      INSERT INTO public_visibility_fences
        (entity_type, entity_id, fence_token, state, updated_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    insertFence.run("video", video.id, rollbackIdentity.fenceToken, "blocked", 1);
    assert.equal(await inspectLegacyImportFenceRecovery(recoveryInput), "retain", "committed or competing fence blocks release");
    const activeBefore = await readLegacyImportFenceSnapshot(serverDb, rollbackIdentity);
    const activeReads = stats.reads;
    assert.equal(await inspectLegacyImportFenceRecovery({ ...recoveryInput, before: activeBefore }), "retain");
    assert.equal(stats.reads, activeReads, "pre-existing active token is never a rollback candidate");
    sqlite.prepare("DELETE FROM public_visibility_fences WHERE entity_type = 'video' AND entity_id = ?").run(video.id);

    const receipt = sqlite.prepare("SELECT id FROM audit_logs WHERE table_name = 'legacy_import_steps' AND target_id LIKE '%:videos:%' LIMIT 1").get();
    assert.ok(receipt);
    sqlite.prepare("INSERT INTO audit_logs (" + auditColumns.map(quote).join(", ") + ") SELECT " +
      auditColumns.map((column) => column === "id" ? "?" : quote(column)).join(", ") +
      " FROM audit_logs WHERE id = ?").run("recovery-receipt", receipt.id);
    const recoveryTarget = recoveryStep.runDigest + ":" + recoveryStep.planHash.slice(0, 24) + ":videos:0";
    sqlite.prepare("UPDATE audit_logs SET target_id = ?, context = ? WHERE id = ?")
      .run(recoveryTarget, "unexpected-context", "recovery-receipt");
    assert.equal(await inspectLegacyImportFenceRecovery(recoveryInput), "retain", "even an ambiguous receipt blocks release");
    sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("recovery-receipt");
    assert.equal(await inspectLegacyImportFenceRecovery(recoveryInput), "rollback_candidate");
    assert.equal(stats.batches, recoveryBatches, "recovery inspection does not mutate D1");
    assert.equal(wakes.length, recoveryWakes);

    const replacementPlan = structuredClone(plan);
    replacementPlan.videos[0].title = "Replaced video";
    replacementPlan.videos[0].created_at = 1900000000; // must NOT overwrite original created_at.
    replacementPlan.videoCustomAnswers[0].answer_text = "Replacement answer";
    replacementPlan.videoChapters[0].chapter_label = "Replacement chapter";
    const publicPlan = structuredClone(replacementPlan);
    publicPlan.videos[0].visibility_status = "public";
    const publicRequest = await createApplyCredential(bucket, ADMIN.id, publicPlan, "replace_imported");
    await reachQuestionStage(request, publicRequest.form);
    assert.equal((await request(publicRequest.form())).status, 200);
    const beforePublic = stats.batches;
    assert.equal((await request(publicRequest.form())).status, 409, "visibility-changing replacement remains disabled");
    assert.equal(stats.batches, beforePublic);

    const replacement = await createApplyCredential(bucket, ADMIN.id, replacementPlan, "replace_imported");
    await reachQuestionStage(request, replacement.form);
    const ready = await request(replacement.form());
    assert.equal(ready.status, 200, JSON.stringify(await ready.clone().json()));
    const beforeReplaceWakes = wakes.length;
    // U02ax: route-level pre-read refusals must not reach an audited batch.
    // Unlike the standalone helper tests, this exercises the combined stage
    // query and the exact same preview credential that is retried below.
    const beforeRejectedBatches = stats.batches;
    const beforeRejectedAudits = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n;
    const queueBeforeRejection = sqlite.prepare(
      "SELECT * FROM static_rebuild_queue ORDER BY id",
    ).all();
    async function expectReplacementReadRefusal(label) {
      const reads = stats.reads;
      const response = await request(replacement.form());
      assert.equal(response.status, 409, label + ": " + JSON.stringify(await response.clone().json()));
      assert.equal(stats.reads - reads, 3, label + ": one stage read plus two preloads");
      assert.equal(stats.batches, beforeRejectedBatches, label + ": no batch");
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
        beforeRejectedAudits + extraProofRows, label + ": no new audit or receipt");
      assert.deepEqual(sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(),
        queueBeforeRejection, label + ": no queue mutation");
      assert.equal(wakes.length, beforeReplaceWakes, label + ": no wake");
      assert.equal(sqlite.prepare("SELECT title FROM videos WHERE id = ?").get(video.id).title,
        "New video", label + ": no video overwrite");
      assert.equal(sqlite.prepare("SELECT answer_text FROM video_custom_answers WHERE video_id = ?").get(video.id).answer_text,
        "Answer", label + ": no answer overwrite");
    }
    let extraProofRows = 0;
    // An oversized related snapshot is rejected in the consolidated read.
    sqlite.prepare("UPDATE video_members SET name = ? WHERE id = ?")
      .run("x".repeat(128 * 1024), "member-video");
    await expectReplacementReadRefusal("oversized related snapshot");
    sqlite.prepare("UPDATE video_members SET name = ? WHERE id = ?").run("Creator", "member-video");
    // A bounded row count sentinel must also reject a fresh replacement.
    const addRelation = sqlite.prepare("INSERT INTO video_events(video_id, event_id) VALUES (?, ?)");
    for (let i = 0; i < 16; i++) addRelation.run(video.id, "extra-relation-" + i);
    await expectReplacementReadRefusal("17 existing relations");
    sqlite.prepare("DELETE FROM video_events WHERE video_id = ? AND event_id LIKE 'extra-relation-%'").run(video.id);
    // Fresh reads must reject both tied and later non-import proofs, not
    // merely rely on a transaction-time check for after-read races.
    cloneAnswerProof.run("replacement-read-competing-proof", answerProofId);
    extraProofRows = 1;
    await expectReplacementReadRefusal("tied latest answer proof");
    sqlite.prepare("UPDATE audit_logs SET created_at = created_at + 1, context = ? WHERE id = ?")
      .run("manual-edit", "replacement-read-competing-proof");
    await expectReplacementReadRefusal("newer non-import answer proof");
    sqlite.prepare("DELETE FROM audit_logs WHERE id = ?").run("replacement-read-competing-proof");
    extraProofRows = 0;

    replacementRace = true;
    const refused = await request(replacement.form());
    assert.equal(refused.status, 409, "concurrent unmanaged edit must refuse replacement");
    assert.equal(sqlite.prepare("SELECT title FROM videos WHERE id = ?").get(video.id).title, "New video");
    assert.equal(sqlite.prepare("SELECT answer_text FROM video_custom_answers WHERE video_id = ?").get(video.id).answer_text, "Answer");
    assert.equal(wakes.length, beforeReplaceWakes);
    const beforeReplace = stats.batches;
    const beforeReplaceReads = stats.reads;
    // A failed final R2 CAS must leave the committed D1 receipt available
    // for recovery without rereading or reapplying canonical data.
    failNextCompletion();
    const accepted = await request(replacement.form());
    assert.equal(accepted.status, 503, JSON.stringify(await accepted.clone().json()));
    const result = await accepted.json();
    assert.equal(result.kind, "committed_progress_pending");
    assert.equal(result.result.replaced.videos, 1);
    assert.equal(result.result.complete, true);
    assert.equal(stats.batches - beforeReplace, 1);
    assert.equal(stats.reads - beforeReplaceReads, 3, "receipt, support, entity and answer proofs share one D1 read");
    const replacedVideo = sqlite.prepare("SELECT * FROM videos WHERE id = ?").get(video.id);
    assert.equal(replacedVideo.title, "Replaced video");
    assert.equal(replacedVideo.created_at, saved.created_at);
    assert.equal(replacedVideo.app_like_count, 11);
    assert.equal(replacedVideo.score, 3);
    assert.equal(replacedVideo.score_updated_at, 42);
    assert.equal(replacedVideo.visibility_status, "private");
    assert.equal(sqlite.prepare("SELECT chapter_label FROM video_chapters WHERE video_id = ?").get(video.id).chapter_label, "Replacement chapter");
    const replacedAnswer = sqlite.prepare("SELECT * FROM video_custom_answers WHERE video_id = ?").get(video.id);
    assert.equal(replacedAnswer.answer_text, "Replacement answer");
    assert.equal(replacedAnswer.created_at, snapshot.beforeAnswers[0].created_at);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'videos' AND operation = 'UPDATE'").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'video_custom_answers' AND operation = 'UPDATE'").get().n, 1);
    assert.equal((await readLegacyVideoReplacementSnapshot(serverDb, video.id)).beforeAnswers[0].answer_text, "Replacement answer");
    assert.deepEqual(wakes.slice(beforeReplaceWakes).map((message) => message.kind), ["static_rebuild_available", "youtube_sync_pending"]);
    // A replay must ignore current support and replacement snapshots even
    // if they now exceed the fresh-write cap or no longer match the proof.
    const queueAfterCommit = sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all();
    const auditCountAfterCommit = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n;
    sqlite.prepare("UPDATE video_members SET name = ? WHERE id = ?")
      .run("x".repeat(128 * 1024), "member-video");
    sqlite.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?")
      .run("x".repeat(128 * 1024), "creator-video");
    const replacementReplayReads = stats.reads;
    const recovered = await request(replacement.form());
    assert.equal(recovered.status, 200, JSON.stringify(await recovered.clone().json()));
    const recoveredBody = await recovered.json();
    assert.equal(recoveredBody.result.replaced.videos, 1);
    assert.equal(recoveredBody.result.complete, true);
    assert.equal(stats.reads - replacementReplayReads, 3, "replacement receipt recovery uses one stage read");
    assert.equal(stats.batches - beforeReplace, 1, "committed replacement must not repeat");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, auditCountAfterCommit);
    assert.deepEqual(sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(), queueAfterCommit);
    assert.equal(wakes.length, beforeReplaceWakes + 2);
    sqlite.prepare("UPDATE video_members SET name = ? WHERE id = ?").run("Creator", "member-video");
    sqlite.prepare("UPDATE x_users SET profile_text = ? WHERE id = ?").run("Fallback profile", "creator-video");
    assert.equal((await request(replacement.form())).status, 200);
    assert.equal(stats.batches - beforeReplace, 1, "completed replacement must not repeat");
    assert.equal(wakes.length, beforeReplaceWakes + 2);
  } finally {
    sqlite.close();
  }
});

function questionPlan(count) {
  const plan = normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  for (let index = 0; index < count; index++) {
    plan.eventCustomQuestions.push({
      id: "question-" + index, event_id: "ev-1", source_key: "source-" + index,
      question_key: "question_" + index, label: "Question " + index, description: "Legacy field",
      type: "textarea", required: 0, options_json: null, placeholder: null,
      max_length: 1000, sort_order: index, is_active: 1, visibility: "review",
    });
  }
  return plan;
}

async function reachQuestionStage(request, form) {
  for (const expected of ["x_users", "softwares", "events", "custom_questions"]) {
    const response = await request(form());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).progress.stage, expected);
  }
}

test("MIG-0645 U02ai Hono: bounded question creation, reuse, limit/collision refusal and durable receipt replay", async () => {
  const { bucket } = previewBucket({ failAdvanceOnce: true, failAdvanceStage: "videos", failCompleteOnce: true });
  const { request, sqlite, stats } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  extendLegacyImportEventSchema(sqlite);
  extendLegacyImportQuestionSchema(sqlite);
  seedEvent(sqlite, { visibility_status: "private" });
  try {
    const plan = questionPlan(7);
    const { form } = await createApplyCredential(bucket, ADMIN.id, plan);
    await reachQuestionStage(request, form);
    const reads = stats.reads;
    const batches = stats.batches;
    const first = await request(form());
    assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
    const firstBody = await first.json();
    assert.equal(firstBody.progress.stage, "custom_questions");
    assert.equal(firstBody.progress.index, 1);
    assert.deepEqual(firstBody.result.customQuestions, { created: 6, reused: 0 });
    assert.equal(stats.reads - reads, 3);
    assert.equal(stats.batches - batches, 1);
    const second = await request(form());
    assert.equal(second.status, 503, JSON.stringify(await second.clone().json()));
    const pending = await second.json();
    assert.equal(pending.kind, "committed_progress_pending");
    assert.equal(pending.progress.stage, "videos");
    assert.deepEqual(pending.result.customQuestions, { created: 7, reused: 0 });
    const afterCommitBatches = stats.batches;
    const replay = await request(form());
    assert.equal(replay.status, 200, JSON.stringify(await replay.clone().json()));
    assert.deepEqual((await replay.json()).result.customQuestions, { created: 7, reused: 0 });
    assert.equal(stats.batches, afterCommitBatches, "receipt replay does not duplicate inserts");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 7);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'event_custom_questions' AND context = 'legacy_import:custom-question'").get().n, 7);

    const again = await createApplyCredential(bucket, ADMIN.id, questionPlan(1));
    await reachQuestionStage(request, again.form);
    const reused = await request(again.form());
    assert.equal(reused.status, 200, JSON.stringify(await reused.clone().json()));
    assert.deepEqual((await reused.json()).result.customQuestions, { created: 0, reused: 1 });

    const conflictPlan = questionPlan(1);
    conflictPlan.eventCustomQuestions[0].label = "Changed definition";
    const conflict = await createApplyCredential(bucket, ADMIN.id, conflictPlan);
    await reachQuestionStage(request, conflict.form);
    const beforeConflict = stats.batches;
    assert.equal((await request(conflict.form())).status, 409);
    assert.equal(stats.batches, beforeConflict);
    assert.equal(sqlite.prepare("SELECT label FROM event_custom_questions WHERE id = 'question-0'").get().label, "Question 0");

    // The CURRENT import cap is 18 including existing definitions.
    const filler = sqlite.prepare(`INSERT INTO event_custom_questions
      SELECT ?, event_id, ?, label, description, type, required, options_json, placeholder,
             max_length, sort_order, is_active, visibility, created_at, updated_at
        FROM event_custom_questions WHERE id = 'question-0'`);
    for (let i = 7; i < 18; i++) filler.run("filler-" + i, "filler_" + i);
    const overPlan = questionPlan(1);
    overPlan.eventCustomQuestions[0].id = "overflow-question";
    overPlan.eventCustomQuestions[0].question_key = "overflow_question";
    const over = await createApplyCredential(bucket, ADMIN.id, overPlan);
    await reachQuestionStage(request, over.form);
    assert.equal((await request(over.form())).status, 409);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 18);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'event_custom_questions'").get().n, 7);

    const empty = await createApplyCredential(bucket, ADMIN.id, questionPlan(0));
    await reachQuestionStage(request, empty.form);
    const noQuestions = await request(empty.form());
    assert.equal(noQuestions.status, 200, JSON.stringify(await noQuestions.clone().json()));
    const emptyBody = await noQuestions.json();
    assert.equal(emptyBody.progress.stage, "videos");
    assert.deepEqual(emptyBody.result.customQuestions, { created: 0, reused: 0 });
    const beforeFinal = stats.batches;
    const failedComplete = await request(empty.form());
    assert.equal(failedComplete.status, 503, JSON.stringify(await failedComplete.clone().json()));
    const pendingFinal = await failedComplete.json();
    assert.equal(pendingFinal.kind, "committed_progress_pending");
    assert.equal(pendingFinal.progress.stage, "complete");
    assert.equal(pendingFinal.result.complete, true);
    assert.equal(stats.batches, beforeFinal + 1, "empty video step commits one durable receipt");
    const completed = await request(empty.form());
    assert.equal(completed.status, 200, JSON.stringify(await completed.clone().json()));
    const completedBody = await completed.json();
    assert.equal(completedBody.result.complete, true);
    assert.equal(completedBody.continuation_required, false);
    assert.equal(completedBody.progress.stage, "complete");
    assert.equal(stats.batches, beforeFinal + 1, "final receipt replay must not commit twice");
    const againComplete = await request(empty.form());
    assert.equal(againComplete.status, 200);
    assert.equal((await againComplete.json()).result.complete, true);
    assert.equal(stats.batches, beforeFinal + 1, "completed preview is idempotent");
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02ai/U02aj Hono: question and video skip use preview-confirmed existence", async () => {
  const { bucket } = previewBucket();
  const wakes = [];
  let deleteBeforeBatch = false;
  const { request, sqlite, stats } = setup({
    bucket, applyStep: legacyImportD1ApplyStep,
    bindings: {
      QUEUE_DISPATCH_ENABLED: "1",
      STATIC_REBUILD_WAKE_QUEUE: { send: async (message) => { wakes.push(message); } },
      YOUTUBE_SYNC_WAKE_QUEUE: { send: async (message) => { wakes.push(message); } },
    },
    beforeBatch: (db) => {
      if (!deleteBeforeBatch) return;
      deleteBeforeBatch = false;
      db.prepare("DELETE FROM videos WHERE id = ?").run("existing-video");
    },
  });
  extendLegacyImportUserSchema(sqlite);
  extendLegacyImportSoftwareSchema(sqlite);
  extendLegacyImportEventSchema(sqlite);
  extendLegacyImportQuestionSchema(sqlite);
  seedEvent(sqlite, { visibility_status: "private" });
  try {
    const plan = questionPlan(2);
    // Video stage only consumes IDs for marker-only skips; create/replace remain disabled.
    for (const id of ["existing-video", "new-video"]) {
      plan.videos.push({
        id, primary_event_id: "ev-1", creator_x_user_id: null, collaboration_type: "individual",
        source_type: "external", creator_display_name: "Creator", creator_display_name_yomi: null,
        creator_icon_url: null, creator_youtube_channel_url: null, creator_profile_text: null,
        creator_other_social_links: null, title: id, music: null, credit: null, music_reference_url: null,
        closing_comment: null, youtube_video_id: null, intro_comment: null, highlights: null,
        production_story: null, visibility_status: "private", scheduling_type: "manual",
        scheduled_time: null, created_at: 1700000000,
      });
    }
    plan.videoCustomAnswers.push(
      { video_id: "existing-video", event_id: "ev-1", question_id: "question-0", question_key: "question_0", answer_text: "old", answer_json: null },
      { video_id: "new-video", event_id: "ev-1", question_id: "question-1", question_key: "question_1", answer_text: "new", answer_json: null },
    );
    sqlite.prepare("INSERT INTO videos(id) VALUES (?)").run("existing-video");
    const snapshots = { skipExistingVideoIds: ["existing-video"] };
    const stale = await createApplyCredential(bucket, ADMIN.id, plan, "skip_existing", snapshots);
    await reachQuestionStage(request, stale.form);
    sqlite.prepare("INSERT INTO videos(id) VALUES (?)").run("new-video");
    assert.equal((await request(stale.form())).status, 409);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM event_custom_questions").get().n, 0);
    sqlite.prepare("DELETE FROM videos WHERE id = ?").run("new-video");
    const fresh = await createApplyCredential(bucket, ADMIN.id, plan, "skip_existing", snapshots);
    await reachQuestionStage(request, fresh.form);
    const accepted = await request(fresh.form());
    assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
    assert.deepEqual((await accepted.json()).result.customQuestions, { created: 1, reused: 0 });
    assert.deepEqual(sqlite.prepare("SELECT id FROM event_custom_questions ORDER BY id").all().map(row => row.id), ["question-1"]);

    const beforeDeleted = stats.batches;
    sqlite.prepare("DELETE FROM videos WHERE id = ?").run("existing-video");
    assert.equal((await request(fresh.form())).status, 409, "preview-confirmed skip cannot silently recreate a deleted video");
    assert.equal(stats.batches, beforeDeleted);
    sqlite.prepare("INSERT INTO videos(id) VALUES (?)").run("existing-video");

    deleteBeforeBatch = true;
    assert.equal((await request(fresh.form())).status, 409, "same-batch existence assertion catches concurrent deletion");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'videos'").get().n, 0);
    sqlite.prepare("INSERT INTO videos(id) VALUES (?)").run("existing-video");
    const beforeSkip = stats.batches;
    const skipped = await request(fresh.form());
    assert.equal(skipped.status, 200, JSON.stringify(await skipped.clone().json()));
    const skippedBody = await skipped.json();
    assert.equal(skippedBody.progress.stage, "videos");
    assert.equal(skippedBody.progress.index, 1);
    assert.equal(skippedBody.result.skipped.videos, 1);
    assert.equal(stats.batches, beforeSkip + 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM videos").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE table_name = 'videos'").get().n, 0);
    assert.equal(wakes.length, 0, "question and video skips must not dispatch wakes");

    const beforeUnsupported = stats.batches;
    assert.equal((await request(fresh.form())).status, 409, "a video answer outside its planned event relations is rejected");
    sqlite.prepare("INSERT INTO videos(id) VALUES (?)").run("new-video");
    assert.equal((await request(fresh.form())).status, 409, "post-preview video creation is rejected");
    assert.equal(stats.batches, beforeUnsupported);
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02p Hono: audit receipt INSERT failure rolls back the complete SQLite D1 batch", async () => {
  // This intentionally injected adapter is a transaction-boundary regression.
  // It is not evidence that the production import apply step is wired.
  const { sql } = await import("drizzle-orm");
  const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
  const { bucket, record } = previewBucket();
  const { credential, form } = await createApplyCredential(bucket);
  let markerInsertAttempts = 0;
  let committedSteps = 0;
  const { request, sqlite, stats, getD1ApplyCalls } = setup({
    bucket,
    applyStep: async (input) => {
      assert.equal(input.progress.stage, "system_user");
      assert.equal(input.actorAuthUserId, ADMIN.id);
      assert.equal(input.previewToken, credential.previewToken);
      assert.equal(input.planHash, credential.planHash);
      const fingerprint = previewFingerprint(input.previewToken);
      await mutateWithAudit(input.db, {
        mutationStatements: [
          input.db.run(sql.raw(
            "INSERT INTO x_users (id, x_name, approval_status) VALUES ('legacy_x_rollback', 'Rollback X', 'imported')",
          )),
          input.db.run(sql.raw(
            "INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status) VALUES ('rebuild-x-rollback', 'users_index', 'global', 'legacy_import_x_users', 'low', 'pending')",
          )),
        ],
        expectedMutationChanges: [1, 1],
        audits: [
          { table_name: "x_users_import_batch", target_id: "legacy_x_rollback",
            operation: "CREATE", before: null, after: { ids: ["legacy_x_rollback"] },
            actor_user_id: ADMIN.id, context: "legacy_import",
            retention_class: "long_audit", restore_strategy: "none" },
          { table_name: "legacy_import_steps", target_id: "hono-step:" + fingerprint,
            operation: "SYSTEM", before: null,
            after: { preview_fingerprint: fingerprint, plan_hash: input.planHash,
              actor: input.actorAuthUserId, stage: "system_user", next_stage: "x_users" },
            actor_user_id: ADMIN.id, context: "legacy_import:step",
            retention_class: "long_audit", restore_strategy: "none" },
        ],
      });
      committedSteps++;
      return { progress: { ...input.progress, stage: "x_users", index: 0 }, complete: false };
    },
  });
  try {
    // The JS observer counts actual trigger execution even when the SQL batch
    // rolls back. Reject only the receipt INSERT, after the earlier DML.
    sqlite.function("observe_rejected_receipt", () => {
      markerInsertAttempts++;
      return 0;
    });
    sqlite.exec(`
      CREATE TRIGGER reject_import_receipt
      BEFORE INSERT ON audit_logs
      WHEN NEW.table_name = 'legacy_import_steps'
      BEGIN
        SELECT observe_rejected_receipt();
        SELECT RAISE(ABORT, 'synthetic_marker_abort');
      END;
    `);
    const failed = await request(form());
    assert.equal(failed.status, 409, JSON.stringify(await failed.clone().json()));
    assert.equal(failed.headers.get("cache-control"), "private, no-store");
    const body = await failed.json();
    assert.equal(body.ok, false);
    assert.equal(body.retryable, false);
    assert.equal(body.requires_repreview, true);
    assert.notEqual(body.committed, true, "rolled-back mutation must not be reported as committed");
    assert.notEqual(body.kind, "committed_progress_pending");
    assert.ok(!JSON.stringify(body).includes("synthetic_marker_abort"), "no provider details in HTTP");
    assert.equal(markerInsertAttempts, 1, "fault injected at the actual receipt INSERT");
    assert.equal(getD1ApplyCalls(), 1, "no implicit retry in the handler");
    assert.equal(stats.batches, 1, "one attempted atomic batch");
    assert.equal(committedSteps, 0);
    for (const table of ["x_users", "static_rebuild_queue", "audit_logs"]) {
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, 0,
        table + " must roll back together");
    }
    assert.equal(record().status, "ready", "failed D1 step releases the R2 claim");
    assert.equal(record().attempt, 1);
    assert.equal(record().progress.stage, "system_user");
    assert.equal(record().progress.index, 0);
  } finally {
    sqlite.close();
  }
});
