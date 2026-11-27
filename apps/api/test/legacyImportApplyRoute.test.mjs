// MIG-0645: intentionally test-only mounted apply HTTP adapter.
// The real D1 audited apply adapter is NOT wired, and production has no mount.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { normalizeLegacyFiles } from "@flamenode/server-core/legacyImport/normalize";
import { createLegacyImportPreview } from "@flamenode/server-core/legacyImport/previewStore";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createLegacyImportApplyRoutes } from "../src/routes/admin/legacyImportApplyRoute.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";

const SITE = "https://app.flamenode.example";
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
function previewBucket({ failAdvanceOnce = false, failCompleteOnce = false } = {}) {
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
            next.progress.stage === "x_users") {
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

async function createApplyCredential(bucket, authUserId = ADMIN.id) {
  const plan = normalizeLegacyFiles([], {
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


test("MIG-0645 U02o Hono: committed SQLite D1 audit receipt survives R2 CAS failure", async () => {
  const { sql } = await import("drizzle-orm");
  const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
  const { bucket, record } = previewBucket({ failAdvanceOnce: true });
  const { credential, form } = await createApplyCredential(bucket);
  let durableWrites = 0;
  const { request, sqlite, stats, getD1ApplyCalls } = setup({
    bucket,
    applyStep: async (input) => {
      assert.equal(input.actorAuthUserId, ADMIN.id);
      assert.equal(input.previewToken, credential.previewToken);
      assert.equal(input.planHash, credential.planHash);
      assert.equal(input.progress.stage, "system_user");
      const target = "hono-step:" + credential.previewToken;
      const receipts = sqlite.prepare(
        "SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_steps' AND target_id = ? AND context = 'legacy_import:step'",
      ).all(target);
      assert.ok(receipts.length <= 1, "a duplicate or conflicting marker must fail closed");
      if (receipts.length === 1) {
        const receipt = JSON.parse(receipts[0].after_json);
        assert.deepEqual(receipt, {
          token: credential.previewToken, plan_hash: credential.planHash,
          actor: ADMIN.id, stage: "system_user", next_stage: "x_users",
        }, "a replay must validate the durable marker identity");
      } else {
        await mutateWithAudit(input.db, {
          mutationStatements: [
            input.db.run(sql.raw(
              "INSERT INTO x_users (id, x_name, approval_status) VALUES ('legacy_x_hono', 'Hono X', 'imported')",
            )),
            input.db.run(sql.raw(
              "INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status) VALUES ('rebuild-x-hono', 'users_index', 'global', 'legacy_import_x_users', 'low', 'pending')",
            )),
          ],
          expectedMutationChanges: [1, 1],
          audits: [
            { table_name: "x_users_import_batch", target_id: "legacy_x_hono",
              operation: "CREATE", before: null, after: { ids: ["legacy_x_hono"] },
              actor_user_id: ADMIN.id, context: "legacy_import",
              retention_class: "long_audit", restore_strategy: "none" },
            { table_name: "legacy_import_steps", target_id: target,
              operation: "SYSTEM", before: null,
              after: { token: credential.previewToken, plan_hash: credential.planHash,
                actor: ADMIN.id, stage: "system_user", next_stage: "x_users" },
              actor_user_id: ADMIN.id, context: "legacy_import:step",
              retention_class: "long_audit", restore_strategy: "none" },
          ],
        });
        durableWrites++;
      }
      return { progress: { ...input.progress, stage: "x_users", index: 0 }, complete: false };
    },
  });
  try {
    const first = await request(form());
    assert.equal(first.status, 503, JSON.stringify(await first.clone().json()));
    const failed = await first.json();
    assert.equal(failed.kind, "committed_progress_pending");
    assert.equal(failed.committed, true);
    assert.equal(failed.requires_repreview, false);
    assert.equal(record().status, "ready");
    assert.equal(record().progress.stage, "system_user", "R2 still points to the committed step");
    assert.equal(stats.batches, 1);
    assert.equal(durableWrites, 1);
    // A committed receipt with hostile/mismatched identity is never evidence
    // that this request may advance R2. Reject, release and preserve D1.
    const auditRow = sqlite.prepare(
      "SELECT id, after_json FROM audit_logs WHERE table_name = 'legacy_import_steps'",
    ).get();
    assert.ok(auditRow);
    const originalReceipt = auditRow.after_json;
    const expected = JSON.parse(originalReceipt);
    const unsafeMarkers = [
      ["plan_hash mismatch", JSON.stringify({ ...expected, plan_hash: "0".repeat(64) })],
      ["preview token mismatch", JSON.stringify({ ...expected, token: "0".repeat(32) })],
      ["actor mismatch", JSON.stringify({ ...expected, actor: "different-admin" })],
      ["stage mismatch", JSON.stringify({ ...expected, stage: "videos" })],
      ["next stage mismatch", JSON.stringify({ ...expected, next_stage: "complete" })],
      ["malformed JSON", '{"incomplete":'],
    ];
    for (const [reason, brokenJson] of unsafeMarkers) {
      sqlite.prepare("UPDATE audit_logs SET after_json = ? WHERE id = ?")
        .run(brokenJson, auditRow.id);
      const blocked = await request(form());
      assert.equal(blocked.status, 409, reason + " " + JSON.stringify(await blocked.clone().json()));
      const blockedBody = await blocked.json();
      assert.equal(blockedBody.ok, false, reason);
      assert.equal(blockedBody.requires_repreview, true, reason);
      assert.equal(record().status, "ready", reason + " releases R2 claim");
      assert.equal(record().progress.stage, "system_user", reason + " cannot advance R2");
      assert.equal(stats.batches, 1, reason + " must not duplicate D1 transaction");
      assert.equal(durableWrites, 1);
    }
    // Restore valid persisted audit; only a fully matching marker can recover R2.
    sqlite.prepare("UPDATE audit_logs SET after_json = ? WHERE id = ?")
      .run(originalReceipt, auditRow.id);
    const second = await request(form());
    assert.equal(second.status, 200, JSON.stringify(await second.clone().json()));
    const recovered = await second.json();
    assert.equal(recovered.progress.stage, "x_users");
    assert.equal(recovered.attempt, 8, "all six rejected receipts consume an R2 claim");
    assert.equal(record().progress.stage, "x_users");
    assert.equal(getD1ApplyCalls(), 8, "all rejected receipts and recovery invoke the read-only adapter");
    assert.equal(stats.batches, 1, "replaying a committed D1 audit must never write another batch");
    assert.equal(durableWrites, 1);
    for (const [table, count] of [["x_users", 1], ["static_rebuild_queue", 1], ["audit_logs", 2]]) {
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, count, table);
    }
  } finally {
    sqlite.close();
  }
});
