// MIG-0644 U01 + U02/U03: transport/inventory contracts AND full SQLite + mounted Hono
// differential parity (SA-092..097, SA-110) against real CURRENT xid-merge-admin.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/adminReadSeed.mjs";
import {
  AdminXIdMergeCreateBodySchema,
  AdminXIdMergeDecisionBodySchema,
  AdminXIdMergeConfirmBodySchema,
  AdminXIdMergeResultSchema,
} from "../../../packages/contracts/src/admin/xidMerges.ts";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const STUBS = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath(p) { globalThis.__mig0644Cur?.revalidated.push(p); }",
    "next/navigation": "export function unstable_rethrow() {}",
    "@opennextjs/cloudflare": `
      export function getCloudflareContext() {
        return { ctx: { waitUntil(p) { globalThis.__mig0644Cur?.waitUntils.push(p); } } };
      }
    `,
    "@/lib/cloudflare": `
      export function getEnv() {
        const s = globalThis.__mig0644Cur;
        if (!s) throw new Error("getEnv outside CURRENT parity case");
        return s.env;
      }
    `,
    "@/lib/serverCore/nextPorts": `
      export const nextQueueWakeHost = {
        readEnv: () => globalThis.__mig0644Cur?.env ?? null,
        readWaitUntil: () => (p) => globalThis.__mig0644Cur?.waitUntils.push(p),
        readKv: () => globalThis.__mig0644Cur?.env?.KV ?? null,
      };
    `,
    "@/lib/auth/writeGuard": `
      import { evaluateWriteIdentity } from "@flamenode/domain/admin";
      export async function requireAdminWrite(feature) {
        const s = globalThis.__mig0644Cur;
        if (!s) throw new Error("requireAdminWrite outside CURRENT parity case");
        if (!s.user) return { ok: false, message: "ログインが必要です。" };
        const userRow = s.sqlite.prepare('SELECT is_tos_accepted, accepted_terms_version_id FROM "user" WHERE id = ?').get(s.user.id);
        const major = s.sqlite.prepare("SELECT id, published_at FROM terms_versions WHERE severity = 'major' AND published_at IS NOT NULL ORDER BY published_at DESC, updated_at DESC LIMIT 1").get();
        let reaccept = 0;
        if (userRow?.is_tos_accepted === 1 && major?.published_at != null) {
          const ok = s.sqlite.prepare('SELECT 1 FROM "user" u WHERE u.id = ? AND (EXISTS (SELECT 1 FROM terms_versions t WHERE t.id = u.accepted_terms_version_id AND t.published_at IS NOT NULL AND (t.id = ? OR t.published_at > ?)) OR EXISTS (SELECT 1 FROM user_tos_consents c INNER JOIN terms_versions ct ON ct.id = c.terms_version_id WHERE c.user_id = u.id AND ct.published_at IS NOT NULL AND (ct.id = ? OR ct.published_at > ?)))').get(s.user.id, major.id, major.published_at, major.id, major.published_at);
          if (!ok) reaccept = 1;
        }
        const identity = evaluateWriteIdentity({ role: s.user.role, is_banned: s.user.is_banned, is_tos_accepted: userRow?.is_tos_accepted ?? 0, terms_reaccept_required: reaccept }, "admin");
        if (identity) return { ok: false, message: identity };
        const settings = s.sqlite.prepare("SELECT operation_mode, disabled_features_json FROM system_settings WHERE id = 'default'").get();
        if (!settings || settings.operation_mode === "maintenance" || settings.operation_mode === "static_only") {
          return { ok: false, message: "maintenance_mode" };
        }
        const disabled = settings.disabled_features_json ? JSON.parse(settings.disabled_features_json) : [];
        if (Array.isArray(disabled) && disabled.includes(feature)) {
          return { ok: false, message: "cost_guard_blocked" };
        }
        return { ok: true, db: s.db, user: s.user, activeXId: s.user.active_x_user_id ?? null, approvedXIds: [], hasPendingXRequest: false };
      }
    `,
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
        return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const schema = await import("../../../src/lib/db/schema.ts");
  const current = await import("../../../src/lib/actions/xid-merge-admin.ts");
  const { app } = await import("../src/app.ts");

  const SITE = "https://app.flamenode.example";
  const AUTH_SECRET = "test-auth-secret-mig-0644";
  const READ_RE = /^\s*(SELECT|WITH|PRAGMA)\b/i;

  function createAtomicD1(sqlite) {
    const stats = { statements: 0, reads: 0, writes: 0, batches: 0, maxBinds: 0 };
    function execSync(sqlText, params, inBatch = false) {
      if (!inBatch) {
        if (READ_RE.test(sqlText)) stats.reads += 1;
        else stats.writes += 1;
      }
      stats.statements += 1;
      stats.maxBinds = Math.max(stats.maxBinds, params.length);
      const results = sqlite.prepare(sqlText).all(...params).map((row) => ({ ...row }));
      return { results, success: true, meta: {} };
    }
    function statement(sqlText, params) {
      const self = {
        bind(...values) {
          return statement(sqlText, values);
        },
        async all() {
          return execSync(sqlText, params);
        },
        async first() {
          return execSync(sqlText, params).results[0] ?? null;
        },
        async run() {
          return execSync(sqlText, params);
        },
        async raw() {
          stats.reads += 1;
          stats.statements += 1;
          stats.maxBinds = Math.max(stats.maxBinds, params.length);
          const prepared = sqlite.prepare(sqlText);
          prepared.setReturnArrays(true);
          try {
            return prepared.all(...params).map((row) => [...row]);
          } finally {
            prepared.setReturnArrays(false);
          }
        },
      };
      self.__sql = sqlText;
      self.__params = params;
      return self;
    }
    return {
      stats,
      prepare: (sqlText) => statement(sqlText, []),
      async batch(statements) {
        stats.batches += 1;
        sqlite.exec("BEGIN");
        try {
          const out = statements.map((s) => execSync(s.__sql, s.__params, true));
          sqlite.exec("COMMIT");
          return out;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function createMemoryBucket() {
    const store = new Map();
    let version = 0;
    return {
      store,
      async get(key) {
        const entry = store.get(key);
        if (!entry) return null;
        return {
          etag: entry.etag,
          text: async () => entry.text,
          json: async () => JSON.parse(entry.text),
        };
      },
      async head(key) {
        const entry = store.get(key);
        return entry ? { etag: entry.etag, size: entry.text.length } : null;
      },
      async put(key, value, options) {
        const existing = store.get(key);
        if (options?.onlyIf?.etagMatches !== undefined && existing?.etag !== options.onlyIf.etagMatches) {
          throw new Error("R2 etag mismatch");
        }
        if (options?.onlyIf?.etagDoesNotMatch === "*" && existing) {
          throw new Error("R2 object already exists");
        }
        version += 1;
        const text = typeof value === "string" ? value : new TextDecoder().decode(value);
        const etag = `"etag-${version}"`;
        store.set(key, { text, etag });
        return { etag };
      },
    };
  }

  function createSide() {
    const sqlite = createSqlite();
    seed(sqlite);
    const d1 = createAtomicD1(sqlite);
    const db = drizzle(d1, { schema });
    const bucket = createMemoryBucket();
    const kv = new Map();
    const queueWakes = [];
    const env = {
      DB: d1,
      BUCKET: bucket,
      KV: {
        get: async (k) => kv.get(k) ?? null,
        put: async (k, v) => { kv.set(k, v); },
        delete: async (k) => { kv.delete(k); },
      },
      NEXT_PUBLIC_SITE_URL: SITE,
      AUTH_SECRET,
      QUEUE_DISPATCH_ENABLED: "1",
      STATIC_REBUILD_WAKE_QUEUE: {
        send: async (msg) => { queueWakes.push(msg); },
      },
    };
    return { sqlite, d1, db, bucket, env, queueWakes, revalidated: [], waitUntils: [] };
  }

  async function runCurrentAction(side, actionFn, formFields, userId = "u_root") {
    const user = userId
      ? side.sqlite.prepare('SELECT id, role, is_banned, active_x_user_id FROM "user" WHERE id = ?').get(userId)
      : null;
    globalThis.__mig0644Cur = { ...side, user };
    try {
      const fd = new FormData();
      for (const [key, val] of Object.entries(formFields)) {
        if (val !== undefined && val !== null) fd.set(key, String(val));
      }
      const res = await actionFn(fd);
      await Promise.allSettled(side.waitUntils);
      side.waitUntils.length = 0;
      return res;
    } finally {
      delete globalThis.__mig0644Cur;
    }
  }

  async function callHono(side, path, body, { token = "root", headers = { Origin: SITE }, envOverride } = {}) {
    const hasBody = body !== undefined;
    const res = await app.request(
      `${SITE}/api/admin/x-id-merges${path}`,
      {
        method: "POST",
        headers: {
          ...(token ? { cookie: `__Secure-authjs.session-token=tok-${token}` } : {}),
          ...(hasBody ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: hasBody ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      },
      envOverride ?? side.env,
    );
    return { status: res.status, headers: res.headers, body: await res.json() };
  }

  test("MIG-0644: forged zero Content-Length does not bypass JSON validation", async () => {
    const side = createSide();
    const writesBefore = side.d1.stats.writes;
    const batchesBefore = side.d1.stats.batches;
    const response = await callHono(side, "/missing/reject", "{malformed", {
      headers: { Origin: SITE, "content-length": "0" },
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.message, "入力エラー");
    assert.equal(response.headers.get("cache-control"), "private, no-store");

    // The same malformed stream must fail for the create endpoint, too;
    // a forged zero header cannot turn it into a valid empty payload.
    const create = await callHono(side, "", "{malformed", {
      headers: { Origin: SITE, "content-length": "0" },
    });
    assert.equal(create.status, 400, JSON.stringify(create.body));
    assert.equal(create.body.message, "入力エラー");
    assert.equal(create.headers.get("cache-control"), "private, no-store");

    // A forged zero must not bypass the actual 64 KiB stream limit either.
    const oversized = await callHono(side, "", JSON.stringify({
      from_x_user_id: "a".repeat(65536),
      to_x_user_id: "target",
    }), { headers: { Origin: SITE, "content-length": "0" } });
    assert.equal(oversized.status, 413, JSON.stringify(oversized.body));
    assert.equal(oversized.body.message, "リクエストが大きすぎます。");
    assert.equal(oversized.headers.get("cache-control"), "private, no-store");
    assert.equal(side.d1.stats.writes, writesBefore, "invalid requests must not write D1");
    assert.equal(side.d1.stats.batches, batchesBefore, "invalid requests must not open a D1 mutation batch");
    assert.deepEqual(side.queueWakes, [], "invalid requests must not wake the queue");

    // A valid JSON stream with the same forged header must still be parsed;
    // the nonexistent request ID is then rejected by the domain lookup.
    const valid = await callHono(side, "/missing/reject", "{}", {
      headers: { Origin: SITE, "content-length": "0" },
    });
    assert.equal(valid.status, 404, JSON.stringify(valid.body));
    assert.equal(valid.body.message, "対象の申請が見つかりません。");

    // The optional decision body remains optional when no stream exists.
    const absent = await callHono(side, "/missing/reject", undefined);
    assert.equal(absent.status, 404, JSON.stringify(absent.body));
  });

  function seedMergeScenario(sqlite, { source = "src_x", target = "tgt_x", rowCount = 1 } = {}) {
    const NOW = Math.floor(Date.now() / 1000);
    insert(sqlite, "x_users", { id: source, x_name: "Source X", approval_status: "approved" });
    insert(sqlite, "x_users", { id: target, x_name: "Target X", approval_status: "approved" });
    insert(sqlite, "user", {
      id: "u_holder",
      name: "Holder",
      email: "holder@example.test",
      role: "user",
      discord_id: "d_holder",
      is_tos_accepted: 1,
      active_x_user_id: `@${source}`,
      created_at: NOW,
    });
    insert(sqlite, "x_user_account_links", {
      x_user_id: source,
      auth_user_id: "u_holder",
      link_role: "owner",
      created_at: NOW,
      updated_at: NOW,
    });
    insert(sqlite, "x_user_aliases", { x_user_id: source, alias_x_id: "old_src_alias" });
    insert(sqlite, "videos", {
      id: "v-mrg-1",
      title: "Merge Video",
      submitted_by_user_id: "u_holder",
      creator_display_name: "Source X",
      creator_x_user_id: source,
      youtube_video_id: "yt-mrg-1",
      visibility_status: "public",
      created_at: NOW,
    });
    insert(sqlite, "video_members", {
      id: "vm-mrg-1",
      video_id: "v-mrg-1",
      name: "Src",
      role: "Editor",
      x_user_id: source,
      is_public_member: 1,
      order_index: 0,
      can_edit: 1,
    });
    insert(sqlite, "video_chapters", {
      id: "vc-mrg-1",
      video_id: "v-mrg-1",
      chapter_time: 12,
      chapter_label: "Intro",
      note: "",
      x_user_id: source,
      created_at: NOW,
      updated_at: NOW,
    });
    insert(sqlite, "slots", {
      id: "slot-mrg-1",
      event_id: "a-open",
      sort_order: 10,
      slot_label: "Merge Slot",
      status: "submitted",
      x_user_id: source,
      reserved_x_id_snapshot: `@${source}`,
      video_id: "v-mrg-1",
    });
    insert(sqlite, "slot_reservation_groups", {
      id: "srg-mrg-1",
      event_id: "a-open",
      x_user_id: source,
      reserved_by_auth_user_id: "u_holder",
      display_name: "Src Group",
      created_at: NOW,
      updated_at: NOW,
      version: 1,
    });
    insert(sqlite, "video_moderation_cases", {
      id: "vmc-mrg-1",
      video_id: "v-mrg-1",
      case_type: "duplicate",
      status: "open",
      related_x_user_id: source,
      created_at: NOW,
      attempt_count: 0,
    });
    insert(sqlite, "video_interactions", {
      video_id: "v-mrg-1",
      x_user_id: source,
      interaction_type: "like",
      created_at: NOW,
    });
    // Event staff + optional >100 bulk references across events/slots to test #376.
    for (let i = 0; i < rowCount; i += 1) {
      const eventId = `ev-mrg-${i}`;
      insert(sqlite, "events", { id: eventId, title: `Merge Event ${i}`, visibility_status: "private" });
      insert(sqlite, "event_staff", {
        id: `es-src-${i}`,
        event_id: eventId,
        x_user_id: source,
        display_name: "Src",
        permission_preset: "owner",
        is_public: 1,
        created_at: NOW,
        updated_at: NOW,
      });
      if (i > 0) {
        insert(sqlite, "event_staff", {
          id: `es-tgt-${i}`,
          event_id: eventId,
          x_user_id: target,
          display_name: "Tgt",
          permission_preset: "staff",
          is_public: 1,
          created_at: NOW,
          updated_at: NOW,
        });
      }
    }
    return { NOW };
  }

  test("MIG-0644 T01 & T02: full lifecycle (create -> approve -> execute -> revert) matches CURRENT field-for-field with wake=0", async () => {
    const cur = createSide();
    const hon = createSide();
    const { NOW } = seedMergeScenario(cur.sqlite);
    seedMergeScenario(hon.sqlite);

    // 1. SA-092 createXIdMergeRequest (check S3 D1 read budget: 4 pre-reads + 1 batch)
    const curCreate = await runCurrentAction(cur, current.createXIdMergeRequest, {
      from_x_user_id: "@src_x",
      to_x_user_id: "tgt_x",
    });
    const d1BeforeCreate = { ...hon.d1.stats };
    const honCreate = await callHono(hon, "", { from_x_user_id: "@src_x", to_x_user_id: "tgt_x" });
    assert.equal(curCreate.ok, true);
    assert.equal(honCreate.status, 200);
    assert.equal(honCreate.headers.get("cache-control"), "private, no-store");
    assert.equal(honCreate.body.ok, true);
    assert.equal(honCreate.body.message, curCreate.message);
    // 4 pre-reads (session+writeGuard+costGuard+1 IN lookup) + 1 loadApprovedActorXPairs in mutateWithAudit when active_x_user_id is set
    assert.equal(hon.d1.stats.reads - d1BeforeCreate.reads, 5);
    assert.equal(hon.d1.stats.batches - d1BeforeCreate.batches, 1);

    // Also verify reject path on a second request (SA-094).
    const curRejCreate = await runCurrentAction(cur, current.createXIdMergeRequest, {
      from_x_user_id: "src_x",
      to_x_user_id: "tgt_x",
    });
    const honRejCreate = await callHono(hon, "", { from_x_user_id: "src_x", to_x_user_id: "tgt_x" });
    const curRej = await runCurrentAction(cur, current.rejectXIdMergeRequest, { id: curRejCreate.id });
    const d1BeforeReject = { ...hon.d1.stats };
    const honRej = await callHono(hon, `/${honRejCreate.body.id}/reject`, {});
    const honRejectPreReads = hon.d1.stats.reads - d1BeforeReject.reads;
    console.log("[MIG-0644] SA-094 D1 pre-read baseline:", honRejectPreReads);
    assert.ok(Number.isInteger(honRejectPreReads) && honRejectPreReads >= 0);
    assert.equal(hon.d1.stats.batches - d1BeforeReject.batches, 1);
    assert.equal(curRej.ok, true);
    assert.equal(honRej.status, 200);
    assert.equal(honRej.body.message, curRej.message);

    // 2. SA-093 approveXIdMergeRequest (4 pre-reads + 1 batch, empty body allowed)
    const curApp = await runCurrentAction(cur, current.approveXIdMergeRequest, { id: curCreate.id });
    const d1BeforeApp = { ...hon.d1.stats };
    const honApp = await callHono(hon, `/${honCreate.body.id}/approve`);
    assert.equal(curApp.ok, true);
    assert.equal(honApp.status, 200);
    assert.equal(honApp.body.message, curApp.message);
    assert.equal(hon.d1.stats.reads - d1BeforeApp.reads, 5);
    assert.equal(hon.d1.stats.batches - d1BeforeApp.batches, 1);

    // 3. SA-096 executeXIdMergeRequest (check R2 fence, D1 tables, audit_logs, static_rebuild_queue, wake=0)
    const curExec = await runCurrentAction(cur, current.executeXIdMergeRequest, {
      id: curCreate.id,
      confirm: "MERGE",
    });
    const d1BeforeExec = { ...hon.d1.stats };
    const honExec = await callHono(hon, `/${honCreate.body.id}/execute`, { confirm: "MERGE" });
    const honExecPreReads = hon.d1.stats.reads - d1BeforeExec.reads;
    // Baseline measurement for S3 gate #724. This records the current cost;
    // it is not an acceptance assertion (the limit remains <=3).
    assert.equal(honExecPreReads, 21, "SA-096 current mounted path read baseline");
    assert.equal(hon.d1.stats.batches - d1BeforeExec.batches, 1);
    assert.equal(curExec.ok, true, curExec.message);
    assert.equal(honExec.status, 200, JSON.stringify(honExec.body));
    assert.equal(honExec.body.ok, true);
    assert.equal(honExec.body.message, curExec.message);

    // Attribution moved from src_x -> tgt_x in both DBs; src_x rejected + alias recorded.
    for (const side of [cur, hon]) {
      assert.equal(side.sqlite.prepare("SELECT approval_status FROM x_users WHERE id = 'src_x'").get().approval_status, "rejected");
      assert.equal(side.sqlite.prepare("SELECT creator_x_user_id FROM videos WHERE id = 'v-mrg-1'").get().creator_x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM video_members WHERE id = 'vm-mrg-1'").get().x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM video_chapters WHERE id = 'vc-mrg-1'").get().x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id, reserved_x_id_snapshot FROM slots WHERE id = 'slot-mrg-1'").get().x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM slot_reservation_groups WHERE id = 'srg-mrg-1'").get().x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT related_x_user_id FROM video_moderation_cases WHERE id = 'vmc-mrg-1'").get().related_x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM video_interactions WHERE video_id = 'v-mrg-1'").get().x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM event_staff WHERE id = 'es-src-0'").get().x_user_id, "tgt_x");
      assert.equal(side.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id = \'u_holder\'').get().active_x_user_id, "tgt_x");
      assert.ok(side.sqlite.prepare("SELECT 1 FROM x_user_aliases WHERE x_user_id = 'tgt_x' AND alias_x_id = 'src_x'").get());
    }
    // D-0603-1: queue rows identical; Hono sends 0 wakes while CURRENT sent >= 1.
    const queueSql = "SELECT target_type, target_id, reason, status, requested_by_user_id FROM static_rebuild_queue ORDER BY target_type, target_id";
    assert.deepEqual(hon.sqlite.prepare(queueSql).all(), cur.sqlite.prepare(queueSql).all());
    assert.equal(hon.queueWakes.length, 0, "D-0603-1: Hono must not wake Queue");
    assert.ok(cur.queueWakes.length >= 1);

    // R2 manifest parity (src_x marked non-public in visibility manifest).
    assert.ok(hon.bucket.store.size > 0);
    assert.equal(hon.bucket.store.size, cur.bucket.store.size);

    // Audit field-level parity (ignore random id / timestamp seconds).
    const auditSql = "SELECT table_name, target_id, operation, actor_user_id, actor_x_user_id, retention_class, context FROM audit_logs ORDER BY rowid ASC";
    const stripReqId = (rows) =>
      rows.map((r) => ({
        ...r,
        target_id: r.table_name === "x_identity_requests" ? "<req>" : r.target_id,
      }));
    assert.deepEqual(stripReqId(hon.sqlite.prepare(auditSql).all()), stripReqId(cur.sqlite.prepare(auditSql).all()));

    // 4. SA-095 rejectXIdMergeRevert + SA-097 approveXIdMergeRevert (attribution restored!)
    const seedReverts = (side, parentId) => {
      insert(side.sqlite, "x_identity_requests", {
        id: "rev-rej",
        request_type: "revert_merge",
        requested_by_auth_user_id: "u_root",
        parent_request_id: parentId,
        revert_deadline_at: NOW + 3600,
        status: "pending",
        requested_at: NOW,
        updated_at: NOW,
      });
      insert(side.sqlite, "x_identity_requests", {
        id: "rev-ok",
        request_type: "revert_merge",
        requested_by_auth_user_id: "u_root",
        parent_request_id: parentId,
        revert_deadline_at: NOW + 3600,
        status: "pending",
        requested_at: NOW,
        updated_at: NOW,
      });
    };
    seedReverts(cur, curCreate.id);
    seedReverts(hon, honCreate.body.id);

    const curRevRej = await runCurrentAction(cur, current.rejectXIdMergeRevert, { id: "rev-rej" });
    const d1BeforeRevertReject = { ...hon.d1.stats };
    const honRevRej = await callHono(hon, "/reverts/rev-rej/reject", {});
    const honRevertRejectPreReads = hon.d1.stats.reads - d1BeforeRevertReject.reads;
    console.log("[MIG-0644] SA-095 D1 pre-read baseline:", honRevertRejectPreReads);
    assert.ok(Number.isInteger(honRevertRejectPreReads) && honRevertRejectPreReads >= 0);
    assert.equal(hon.d1.stats.batches - d1BeforeRevertReject.batches, 1);
    assert.equal(curRevRej.ok, true);
    assert.equal(honRevRej.status, 200);
    assert.equal(honRevRej.body.message, curRevRej.message);

    const curRev = await runCurrentAction(cur, current.approveXIdMergeRevert, {
      id: "rev-ok",
      confirm: "REVERT",
    });
    const d1BeforeRev = { ...hon.d1.stats };
    const honRev = await callHono(hon, "/reverts/rev-ok/approve", { confirm: "REVERT" });
    const honRevPreReads = hon.d1.stats.reads - d1BeforeRev.reads;
    // The paired child/parent SELECT removes one pre-read from the prior
    // exact-head baseline (8). This is still over the S3 limit of 3.
    console.log("[MIG-0644] SA-097 D1 pre-read baseline:", honRevPreReads);
    assert.equal(honRevPreReads, 7, "SA-097 fused resource read; S3 gate remains open");
    assert.equal(curRev.ok, true, curRev.message);
    assert.equal(honRev.status, 200, JSON.stringify(honRev.body));
    assert.equal(honRev.body.message, curRev.message);
    assert.equal(hon.d1.stats.batches - d1BeforeRev.batches, 1);

    for (const side of [cur, hon]) {
      assert.equal(side.sqlite.prepare("SELECT approval_status FROM x_users WHERE id = 'src_x'").get().approval_status, "approved");
      assert.equal(side.sqlite.prepare("SELECT creator_x_user_id FROM videos WHERE id = 'v-mrg-1'").get().creator_x_user_id, "src_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM video_members WHERE id = 'vm-mrg-1'").get().x_user_id, "src_x");
      assert.equal(side.sqlite.prepare("SELECT x_user_id FROM event_staff WHERE id = 'es-src-0'").get().x_user_id, "src_x");
      assert.equal(side.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id = \'u_holder\'').get().active_x_user_id, "@src_x");
    }
    assert.equal(hon.queueWakes.length, 0);
  });


  test("MIG-0644 SA-097 paired read retains CURRENT rejection precedence and no side effects", async () => {
    const cur = createSide();
    const hon = createSide();
    const NOW = Math.floor(Date.now() / 1000);
    const row = (id, overrides = {}) => ({
      id, request_type: "revert_merge", requested_by_auth_user_id: "u_root",
      parent_request_id: "parent-empty", revert_deadline_at: NOW + 3600,
      status: "pending", requested_at: NOW, updated_at: NOW,
      ...overrides,
    });
    const records = [
      row("parent-empty", { request_type: "merge", status: "done", parent_request_id: null }),
      row("parent-bad", { request_type: "merge", status: "done", restore_snapshot_json: "{}" }),
      row("parent-pending", { request_type: "merge", status: "pending", restore_snapshot_json: "{}" }),
      row("wrong-kind", { request_type: "merge" }),
      row("missing-id", { parent_request_id: null, revert_deadline_at: 0 }),
      row("blank-id", { parent_request_id: "\u00a0\ufeff\u2003\t" }),
      row("bad-deadline", { revert_deadline_at: 0 }),
      row("fractional-deadline", { revert_deadline_at: NOW + 0.5 }),
      row("expired", { parent_request_id: "missing-parent", revert_deadline_at: NOW - 5 }),
      row("missing-parent-child", { parent_request_id: "missing-parent" }),
      row("empty-parent-child"),
      row("invalid-snapshot", { parent_request_id: "parent-bad" }),
      row("parent-not-done", { parent_request_id: "parent-pending" }),
      row("self-parent", { parent_request_id: "self-parent", restore_snapshot_json: "{}" }),
      row("invalid-child-status", { parent_request_id: "parent-pending", status: "rejected" }),
    ];
    for (const side of [cur, hon]) {
      for (const record of records) insert(side.sqlite, "x_identity_requests", record);
    }
    const cases = [
      ["absent", 404], ["wrong-kind", 404], ["missing-id", 400],
      ["blank-id", 400], ["bad-deadline", 400], ["fractional-deadline", 400],
      ["expired", 400], ["missing-parent-child", 404], ["empty-parent-child", 400],
      ["invalid-snapshot", 409], ["parent-not-done", 409], ["self-parent", 409],
      ["invalid-child-status", 409],
    ];
    const state = side => ({
      requests: side.sqlite.prepare("SELECT * FROM x_identity_requests ORDER BY id").all(),
      audits: side.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
      bucket: [...side.bucket.store.entries()],
      wakes: [...side.queueWakes],
      writes: side.d1.stats.writes, batches: side.d1.stats.batches,
    });
    const before = state(hon);
    for (const [id, status] of cases) {
      const expected = await runCurrentAction(cur, current.approveXIdMergeRevert, { id, confirm: "REVERT" });
      const reads = hon.d1.stats.reads;
      const actual = await callHono(hon, `/reverts/${id}/approve`, { confirm: "REVERT" });
      assert.equal(expected.ok, false, id);
      assert.equal(actual.status, status, id);
      assert.equal(actual.body.ok, false, id);
      assert.equal(actual.body.message, expected.message, id);
      assert.equal(actual.headers.get("cache-control"), "private, no-store", id);
      assert.equal(hon.d1.stats.reads - reads, 4, id + " guard + paired resource read");
      assert.deepEqual(state(hon), before, id + " must not mutate any state");
    }
    cur.sqlite.close();
    hon.sqlite.close();
  });

  test("MIG-0644 SA-097 paired lookup provider failure preserves private 503", async () => {
    const side = createSide();
    const originalPrepare = side.d1.prepare;
    let pairAttempts = 0;
    side.d1.prepare = sqlText => {
      if (sqlText.startsWith("WITH requested_revert AS")) {
        pairAttempts += 1;
        throw new Error("PRIVATE_PAIR_PROVIDER_CANARY");
      }
      return originalPrepare(sqlText);
    };
    try {
      const before = { ...side.d1.stats };
      const response = await callHono(side, "/reverts/missing/approve", { confirm: "REVERT" });
      assert.equal(pairAttempts, 1);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(response.body, {
        ok: false, message: "管理操作を処理できませんでした。再度お試しください。",
      });
      assert.equal(side.d1.stats.writes, before.writes);
      assert.equal(side.d1.stats.batches, before.batches);
      assert.equal(side.bucket.store.size, 0);
      assert.deepEqual(side.queueWakes, []);
    } finally {
      side.d1.prepare = originalPrepare;
      side.sqlite.close();
    }
  });

  test("MIG-0644 SA-097 backwards clock correction retains eligible parent lookup", async () => {
    const side = createSide();
    const NOW = Math.floor(Date.now() / 1000);
    const base = { requested_by_auth_user_id: "u_root", requested_at: NOW, updated_at: NOW };
    insert(side.sqlite, "x_identity_requests", {
      ...base, id: "clock-parent", request_type: "merge", status: "done",
    });
    insert(side.sqlite, "x_identity_requests", {
      ...base, id: "clock-child", request_type: "revert_merge", status: "pending",
      parent_request_id: "clock-parent", revert_deadline_at: NOW - 1,
    });
    const originalNow = Date.now;
    const originalPrepare = side.d1.prepare;
    let clock = NOW * 1000;
    let pairReads = 0;
    Date.now = () => clock;
    side.d1.prepare = sqlText => {
      const prepared = originalPrepare(sqlText);
      if (!sqlText.startsWith("WITH requested_revert AS")) return prepared;
      return {
        ...prepared,
        bind(...params) {
          const bound = prepared.bind(...params);
          return {
            ...bound,
            async all() {
              const result = await bound.all();
              pairReads += 1;
              assert.equal(result.results.length, 1, "expired at SQL lookup start");
              clock -= 2000;
              return result;
            },
          };
        },
      };
    };
    try {
      const before = { ...side.d1.stats };
      const response = await callHono(side, "/reverts/clock-child/approve", { confirm: "REVERT" });
      assert.equal(pairReads, 1);
      assert.equal(response.status, 400);
      assert.equal(response.body.message, "親統合申請に差し戻し用snapshotがありません。");
      assert.equal(side.d1.stats.reads - before.reads, 5);
      assert.equal(side.d1.stats.writes, before.writes);
      assert.equal(side.d1.stats.batches, before.batches);
      assert.deepEqual(side.queueWakes, []);
    } finally {
      Date.now = originalNow;
      side.d1.prepare = originalPrepare;
      side.sqlite.close();
    }
  });

  test("SEC: hostile diagnostics cannot replace fixed X merge failure responses", async () => {
    const side = createSide();
    seedMergeScenario(side.sqlite);
    const originalConsoleError = console.error;
    console.error = () => {
      throw new Error("diagnostic sink failure must not escape");
    };

    try {
      // SA-092: a failed atomic batch still returns the fixed 409 when logging throws.
      const originalBatch = side.d1.batch;
      side.d1.batch = async () => {
        throw new Error("private database failure");
      };
      const beforeCreateCount = side.sqlite.prepare(
        "SELECT COUNT(*) AS n FROM x_identity_requests",
      ).get().n;
      const createFailure = await callHono(side, "", {
        from_x_user_id: "src_x",
        to_x_user_id: "tgt_x",
      });
      assert.equal(createFailure.status, 409);
      assert.deepEqual(createFailure.body, {
        ok: false,
        message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
      });
      assert.equal(
        side.sqlite.prepare("SELECT COUNT(*) AS n FROM x_identity_requests").get().n,
        beforeCreateCount,
      );
      side.d1.batch = originalBatch;

      // SA-093: the decision path has the same fixed-response guarantee.
      const created = await callHono(side, "", {
        from_x_user_id: "src_x",
        to_x_user_id: "tgt_x",
      });
      assert.equal(created.status, 200);
      side.d1.batch = async () => {
        throw new Error("private decision batch failure");
      };
      const approveFailure = await callHono(side, `/${created.body.id}/approve`, {});
      assert.equal(approveFailure.status, 409);
      assert.deepEqual(approveFailure.body, {
        ok: false,
        message: "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。",
      });
      assert.equal(
        side.sqlite.prepare("SELECT status FROM x_identity_requests WHERE id = ?").get(created.body.id).status,
        "pending",
      );
      side.d1.batch = originalBatch;

      const approved = await callHono(side, `/${created.body.id}/approve`, {});
      assert.equal(approved.status, 200);

      // SA-096: an Error with a throwing message getter is classified as unknown.
      const errorWithThrowingMessage = new Error("must not be read");
      Object.defineProperty(errorWithThrowingMessage, "message", {
        configurable: true,
        get() {
          throw new Error("message getter failure");
        },
      });
      const writesBeforeGetterFailure = side.d1.stats.writes;
      const batchesBeforeGetterFailure = side.d1.stats.batches;
      side.bucket.get = async () => {
        throw errorWithThrowingMessage;
      };
      const getterFailure = await callHono(
        side,
        `/${created.body.id}/execute`,
        { confirm: "MERGE" },
      );
      assert.equal(getterFailure.status, 409);
      assert.deepEqual(getterFailure.body, {
        ok: false,
        id: created.body.id,
        message: "X ID統合を安全に確定できませんでした。",
      });
      assert.equal(side.d1.stats.writes, writesBeforeGetterFailure);
      assert.equal(side.d1.stats.batches, batchesBeforeGetterFailure);

      // A Proxy getPrototypeOf trap must likewise be treated as an unknown failure.
      side.bucket.get = async () => {
        throw new Proxy({}, {
          getPrototypeOf() {
            throw new Error("hostile getPrototypeOf trap");
          },
        });
      };
      const proxyFailure = await callHono(
        side,
        `/${created.body.id}/execute`,
        { confirm: "MERGE" },
      );
      assert.equal(proxyFailure.status, 409);
      assert.deepEqual(proxyFailure.body, {
        ok: false,
        id: created.body.id,
        message: "X ID統合を安全に確定できませんでした。",
      });
      assert.equal(side.d1.stats.writes, writesBeforeGetterFailure);
      assert.equal(side.d1.stats.batches, batchesBeforeGetterFailure);
      assert.equal(side.queueWakes.length, 0);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("MIG-0644 T03: guards reject non-admin, anonymous, cross-origin, CostGuard stop, and bad confirm with 0 writes", async () => {
    const side = createSide();
    seedMergeScenario(side.sqlite);
    const NOW = Math.floor(Date.now() / 1000);
    insert(side.sqlite, "x_identity_requests", {
      id: "req-pending",
      request_type: "merge",
      requested_by_auth_user_id: "u_root",
      source_x_user_id: "src_x",
      target_x_user_id: "tgt_x",
      status: "approved",
      requested_at: NOW,
      updated_at: NOW,
    });

    const beforeWrites = () => ({
      writes: side.d1.stats.writes,
      batches: side.d1.stats.batches,
      audits: side.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
    });
    const baseline = beforeWrites();

    // 1. Cross-origin -> 403 invalid_origin, 0 D1 reads/writes
    const r0 = side.d1.stats.reads;
    const badOrigin = await callHono(side, "", { from_x_user_id: "src_x", to_x_user_id: "tgt_x" }, {
      headers: { Origin: "https://evil.invalid" },
    });
    assert.equal(badOrigin.status, 403);
    assert.equal(side.d1.stats.reads, r0);

    // 2. Anonymous -> 401; non-admin / moderator / banned -> 403
    assert.equal((await callHono(side, "", { from_x_user_id: "src_x", to_x_user_id: "tgt_x" }, { token: null })).status, 401);
    for (const tok of ["alice", "bob", "badmin"]) {
      const r = await callHono(side, "/req-pending/execute", { confirm: "MERGE" }, { token: tok });
      assert.equal(r.status, 403, `token ${tok} must be denied`);
    }

    // 3. CostGuard maintenance -> 503
    side.sqlite.prepare("UPDATE system_settings SET operation_mode = 'maintenance' WHERE id = 'default'").run();
    const maint = await callHono(side, "", { from_x_user_id: "src_x", to_x_user_id: "tgt_x" });
    assert.equal(maint.status, 503);
    side.sqlite.prepare("UPDATE system_settings SET operation_mode = 'normal' WHERE id = 'default'").run();

    // 4. Missing/wrong confirm -> 400 matching CURRENT domain message
    const badConfirm = await callHono(side, "/req-pending/execute", { confirm: "NOPE" });
    assert.equal(badConfirm.status, 400);
    assert.deepEqual(badConfirm.body, { ok: false, message: "確認文字列 MERGE が必要です。" });

    // 5. Missing BUCKET on public fence transition fails closed with 503 and 0 D1 writes
    const noBucket = await callHono(
      side,
      "/req-pending/execute",
      { confirm: "MERGE" },
      { envOverride: { ...side.env, BUCKET: undefined } },
    );
    assert.equal(noBucket.status, 503);
    assert.equal(noBucket.body.ok, false);

    assert.deepEqual(beforeWrites(), baseline, "rejected requests must perform 0 DB writes");
  });

  test("MIG-0644 T04: #376 regression merging >100 X references succeeds without SQL bind limit failure", async () => {
    const side = createSide();
    // 115 event_staff rows (with 114 promoted target owners > 100 bind ceiling) across 15 events? Wait: 115 events * 3 = 345 targets > 100 queue target limit!
    // Instead: seed 115 video_chapters + 20 slots on 2 videos / 1 event -> >135 X references within 100 static_rebuild target limit!
    const { NOW } = seedMergeScenario(side.sqlite);
    for (let i = 0; i < 120; i += 1) {
      insert(side.sqlite, "video_chapters", {
        id: `vc-bulk-${i}`,
        video_id: "v-mrg-1",
        chapter_time: 100 + i,
        chapter_label: `Chapter ${i}`,
        note: "",
        x_user_id: "src_x",
        created_at: NOW,
        updated_at: NOW,
      });
    }
    const created = await callHono(side, "", { from_x_user_id: "src_x", to_x_user_id: "tgt_x" });
    assert.equal(created.status, 200);
    const approved = await callHono(side, `/${created.body.id}/approve`, {});
    assert.equal(approved.status, 200);
    const executed = await callHono(side, `/${created.body.id}/execute`, { confirm: "MERGE" });
    assert.equal(executed.status, 200, JSON.stringify(executed.body));
    assert.equal(executed.body.ok, true);
    assert.equal(
      side.sqlite.prepare("SELECT COUNT(*) AS n FROM video_chapters WHERE x_user_id = 'tgt_x'").get().n,
      121,
    );
    assert.equal(
      side.sqlite.prepare("SELECT COUNT(*) AS n FROM video_chapters WHERE x_user_id = 'src_x'").get().n,
      0,
    );
  });
} else {
  test("U01: create schema uses the two CURRENT FormData keys", () => {
  assert.deepEqual(
    AdminXIdMergeCreateBodySchema.parse({
      from_x_user_id: "@source",
      to_x_user_id: "@target",
    }),
    { from_x_user_id: "@source", to_x_user_id: "@target" },
  );
  // CURRENT handles missing/null values in the domain validator rather than
  // turning them into an unrelated transport error.
  assert.deepEqual(AdminXIdMergeCreateBodySchema.parse({}), {});
  assert.deepEqual(
    AdminXIdMergeCreateBodySchema.parse({
      from_x_user_id: null,
      to_x_user_id: 123,
    }),
    { from_x_user_id: null, to_x_user_id: 123 },
  );
  assert.equal(
    AdminXIdMergeCreateBodySchema.safeParse({
      from_x_user_id: { unexpected: "object" },
      to_x_user_id: "target",
    }).success,
    false,
  );
});

test("U01: IDs are path params, not JSON body fields", () => {
  assert.deepEqual(
    AdminXIdMergeDecisionBodySchema.parse({ id: "malicious-body-id" }),
    {},
  );
  assert.deepEqual(
    AdminXIdMergeConfirmBodySchema.parse({
      id: "body-id",
      confirm: "MERGE",
    }),
    { confirm: "MERGE" },
  );
  // Preserve CURRENT's domain-level missing/incorrect confirm messages.
  assert.deepEqual(AdminXIdMergeConfirmBodySchema.parse({}), {});
  assert.deepEqual(
    AdminXIdMergeConfirmBodySchema.parse({ confirm: "WRONG" }),
    { confirm: "WRONG" },
  );
});

test("U01: result contract keeps CURRENT success and failure shapes", () => {
  assert.deepEqual(
    AdminXIdMergeResultSchema.parse({
      ok: true,
      id: "xmerge-1",
      message: "created",
    }),
    { ok: true, id: "xmerge-1", message: "created" },
  );
  assert.deepEqual(
    AdminXIdMergeResultSchema.parse({ ok: false, message: "denied" }),
    { ok: false, message: "denied" },
  );
  assert.equal(AdminXIdMergeResultSchema.safeParse({ id: "no-ok" }).success, false);
});

test("U01: all six CURRENT actions and SA-110 dispatcher are present", () => {
  const source = readFileSync(
    new URL("../../../src/lib/actions/xid-merge-admin.ts", import.meta.url),
    "utf8",
  );
  for (const action of [
    "createXIdMergeRequest",
    "approveXIdMergeRequest",
    "rejectXIdMergeRequest",
    "rejectXIdMergeRevert",
    "executeXIdMergeRequest",
    "approveXIdMergeRevert",
  ]) {
    assert.match(source, new RegExp(`export async function ${action}\\(formData: FormData\\)`));
  }
  assert.match(source, /requireAdminWrite\("xid_links"\)/);
  const page = readFileSync(
    new URL("../../../app/(admin)/admin/x-id-merges/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /async function run\(action:/);
  assert.match(page, /await action\(formData\)/);
});

test("U01: documented D-17-4 method/URL agreement remains unchanged", () => {
  const decisions = readFileSync(
    new URL("../../../docs/migration/OPEN_DECISIONS.md", import.meta.url),
    "utf8",
  );
  const contractLine = decisions.split("\n").find((line) =>
    line.includes("- MIG-0644: SA-092"),
  );
  assert.ok(contractLine, "MIG-0644 D-17-4 path agreement must exist");
  for (const path of [
    "POST /api/admin/x-id-merges`",
    "POST /api/admin/x-id-merges/:id/approve",
    "POST /api/admin/x-id-merges/:id/reject",
    "POST /api/admin/x-id-merges/:id/execute",
    "POST /api/admin/x-id-merges/reverts/:id/approve",
    "POST /api/admin/x-id-merges/reverts/:id/reject",
  ]) {
    assert.ok(contractLine.includes(path), `Missing agreed endpoint: ${path}`);
  }
});

test("U01: nested JSON payloads never become legacy FormData scalars", () => {
  const nested = [{}, [], ["MERGE"], { confirmation: "MERGE" }];
  for (const value of nested) {
    assert.equal(
      AdminXIdMergeCreateBodySchema.safeParse({ from_x_user_id: value, to_x_user_id: "target" }).success,
      false,
      "from_x_user_id nested payload must be rejected",
    );
    assert.equal(
      AdminXIdMergeCreateBodySchema.safeParse({ from_x_user_id: "source", to_x_user_id: value }).success,
      false,
      "to_x_user_id nested payload must be rejected",
    );
    assert.equal(
      AdminXIdMergeConfirmBodySchema.safeParse({ confirm: value }).success,
      false,
      "confirm nested payload must be rejected",
    );
  }
  // CURRENT stringifies scalar FormData values after the authorization gate.
  // A valid transport scalar must reach domain validation unmodified.
    for (const scalar of [null, "", " ", false, 0]) {
      assert.deepEqual(AdminXIdMergeConfirmBodySchema.parse({ confirm: scalar }), { confirm: scalar });
    }
  });
}
