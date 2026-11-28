// MIG-0645: intentionally test-only mounted apply HTTP adapter.
// The real D1 adapter covers system_user, x_users, software catalog, and bounded event create/skip; production has no mount.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Hono } from "hono";
import { normalizeLegacyFiles } from "@flamenode/server-core/legacyImport/normalize";
import { createLegacyImportPreview } from "@flamenode/server-core/legacyImport/previewStore";
import {
  legacyImportReceiptMatchesProgress,
  legacyImportSkipSnapshotFingerprint,
} from "@flamenode/server-core/legacyImport/progress";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createLegacyImportApplyRoutes } from "../src/routes/admin/legacyImportApplyRoute.ts";
import { legacyImportD1ApplyStep } from "../src/routes/admin/legacyImportD1ApplyAdapter.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
// CURRENT RH-002 durable run identity; the bearer preview token itself is never persisted.
const previewFingerprint = (token) => createHash("sha256").update(token).digest("hex");
const runDigest = (token) => previewFingerprint(token).slice(0, 24);

function extendLegacyImportUserSchema(sqlite) {
  sqlite.exec('ALTER TABLE "user" ADD COLUMN "emailVerified" INTEGER; ALTER TABLE "user" ADD COLUMN can_create_events INTEGER; ALTER TABLE "user" ADD COLUMN is_notification_enabled INTEGER; ALTER TABLE "user" ADD COLUMN terms_reaccept_required INTEGER; ALTER TABLE "user" ADD COLUMN onboarding_completed_at INTEGER; ALTER TABLE "user" ADD COLUMN last_guild_check INTEGER; ALTER TABLE "user" ADD COLUMN created_at INTEGER; ALTER TABLE x_users ADD COLUMN profile_text TEXT; ALTER TABLE x_users ADD COLUMN portfolio_contact TEXT; ALTER TABLE x_users ADD COLUMN youtube_channel_url TEXT; ALTER TABLE x_users ADD COLUMN other_social_links TEXT; ALTER TABLE x_users ADD COLUMN creative_start_date INTEGER;');
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

function setup({ user = ADMIN, role = "admin", settings = "normal", bucket, applyStep } = {}) {
  const { db, sqlite, stats } = createAdminD1();
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
    }, { DB: db, BUCKET: bucket, NEXT_PUBLIC_SITE_URL: SITE });
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

async function createApplyCredential(bucket, authUserId = ADMIN.id, planOverride = null) {
  const plan = planOverride ?? normalizeLegacyFiles([], {
    eventVisibility: "private", videoVisibility: "private", now: 1700000000,
  });
  assert.deepEqual(plan.errors, []);
  const credential = await createLegacyImportPreview(bucket, {
    authUserId, strategy: "create_only", plan,
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

test("MIG-0645 U02 apply Hono: authenticated request DB and owner reach exactly one step, then R2 advances", async () => {
  const { bucket, record } = previewBucket();
  const { credential, form } = await createApplyCredential(bucket);
  const { request, stats, sqlite, getD1ApplyCalls } = setup({
    bucket,
    applyStep: async (input) => {
      assert.equal(typeof input.db.select, "function", "request-scoped Drizzle DB required");
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
  const { request, sqlite, stats, getD1ApplyCalls } = setup({ bucket, applyStep: legacyImportD1ApplyStep });
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
