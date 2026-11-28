// MIG-0650 T01–T05 differential parity: the REAL CURRENT Server Actions
// (src/lib/actions/video-collab-perms.ts: SA-082..084 and
// src/lib/actions/video/adminMembers.ts: SA-085) run on one seeded real-schema
// SQLite copy; the mounted Hono /api/videos endpoints run on an identical copy.
// Only Next framework edges (server-only, next/cache, next/navigation,
// writeGuard, nextQueueWakeHost) are stubbed on the CURRENT side.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite, insert } from "./support/personalHarness.mjs";
import { ACTIVE, atomicD1, chapterApp, seedChapterWorld, SESSION_USER, SITE } from "./support/chapterSeed.mjs";
import { MAX_COLLABORATOR_PERMISSION_BATCH, MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";

if (runUnderRootTsx(import.meta.url)) {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;

  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation":
      "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/cloudflare": "export function getDatabase() { return null; } export function getEnv() { return {}; }",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__mig0650Guard(o); }",
    "@/lib/serverCore/nextPorts":
      "export const nextQueueWakeHost = { readEnv: () => globalThis.__mig0650WakeEnv(), readWaitUntil: () => null, readKv: () => null }; export const nextRethrowFrameworkControl = () => {};",
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier in stubs) {
        return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import("../../../packages/server-core/src/queues/wakeBudget.ts");
  const collabActions = await import("../../../src/lib/actions/video-collab-perms.ts");
  const adminMemberActions = await import("../../../src/lib/actions/video/adminMembers.ts");
  const { VideoCollabResultSchema, VideoAdminMembersResultSchema } = await import("@flamenode/contracts");
  const { Hono } = await import("hono");
  const { createVideosRoutes } = await import("../src/routes/videos/index.ts");

  const NOW_MS = 1_800_000_000_000;
  function freeze() {
    let n = 0;
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    Date.now = () => NOW_MS;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return {
      reset(start = 0) { n = start; },
      restore() {
        Date.now = originalNow;
        globalThis.crypto.randomUUID = originalUuid;
      },
    };
  }

  function world({ withCollaborator = false, beforeBatch } = {}) {
    const sqlite = createSqlite();
    seedChapterWorld(sqlite);
    sqlite.prepare("UPDATE videos SET updated_at = 100").run();
    if (withCollaborator) {
      insert(sqlite, "user", {
        id: "u_collab", name: "u_collab", discord_id: "d_u_collab",
        role: "user", is_banned: 0, is_tos_accepted: 1, active_x_user_id: "x_collab",
      });
      insert(sqlite, "x_users", { id: "x_collab", x_name: "name_x_collab", approval_status: "approved" });
      insert(sqlite, "x_user_account_links", { auth_user_id: "u_collab", x_user_id: "x_collab" });
      insert(sqlite, "video_members", {
        id: "vm_collab", video_id: "v_pub", x_user_id: "x_collab",
        name: "Collab", role: null, comment: null, order_index: 9999,
        can_edit: 1, is_public_member: 0,
        edit_granted_by_auth_user_id: "u_owner", edit_granted_at: 100, edit_updated_at: 100,
      });
    }
    const baseD1 = atomicD1(sqlite);
    const d1 = beforeBatch ? {
      ...baseD1,
      async batch(statements) {
        await beforeBatch(sqlite);
        return baseD1.batch(statements);
      },
    } : baseD1;
    return { sqlite, d1 };
  }

  const approvedOf = (sqlite, userId) =>
    sqlite
      .prepare(
        `SELECT DISTINCT l.x_user_id AS id FROM x_user_account_links l
         JOIN x_users x ON x.id = l.x_user_id
         WHERE l.auth_user_id = ? AND x.approval_status = 'approved'`,
      )
      .all(userId)
      .map((row) => row.id);

  async function runCurrent(w, as, fn) {
    const row = as
      ? w.sqlite.prepare('SELECT id, name, role, is_banned, active_x_user_id FROM "user" WHERE id = ?').get(as)
      : null;
    const wakes = [];
    globalThis.__mig0650WakeEnv = () => ({
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.notificationWake]: { send: async (msg) => void wakes.push(msg) },
      [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (msg) => void wakes.push(msg) },
    });
    globalThis.__mig0650Guard = async (options) => {
      assert.equal(options.feature, "edit_video");
      if (!row) return { ok: false, reason: "anonymous", message: "ログインしてください。" };
      if (row.is_banned) return { ok: false, reason: "banned", message: "利用が制限されています。" };
      return {
        ok: true,
        db: drizzle(w.d1),
        user: { id: row.id, name: row.name, role: row.role, active_x_user_id: row.active_x_user_id },
        activeXId: row.active_x_user_id,
        approvedXIds: approvedOf(w.sqlite, as),
        hasPendingXRequest: false,
      };
    };
    const { log, info, warn, error } = console;
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};
    try {
      const result = await fn();
      return { result, wakes };
    } finally {
      console.log = log;
      console.info = info;
      console.warn = warn;
      console.error = error;
      delete globalThis.__mig0650Guard;
      delete globalThis.__mig0650WakeEnv;
    }
  }

  function honoWithWakes(d1, as, { isBanned = 0 } = {}) {
    const roles = { u_admin: "admin", u_mod: "moderator" };
    const active = { ...ACTIVE, u_collab: "x_collab" };
    const user = as ? { ...SESSION_USER(as, roles[as] ?? "user", active[as] ?? null), is_banned: isBanned } : null;
    const wakes = [];
    const hono = new Hono();
    hono.route(
      "/api/videos",
      createVideosRoutes({
        session: async (c, next) => {
          c.set("user", user);
          c.set("sessionState", user ? "user" : "none");
          await next();
        },
      }),
    );
    const send = (method, path, body, headers = { Origin: SITE }) =>
      hono.request(
        path,
        {
          method,
          headers: { "content-type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        {
          DB: d1,
          NEXT_PUBLIC_SITE_URL: SITE,
          [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
          [QUEUE_BINDING_NAMES.notificationWake]: { send: async (msg) => void wakes.push(msg) },
          [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (msg) => void wakes.push(msg) },
        },
      );
    return { send, wakes };
  }

  const normalizeNotificationPayload = (json) => {
    if (!json) return null;
    const parsed = JSON.parse(json);
    const { trace_id: _omit, ...rest } = parsed;
    return rest;
  };

  const normalizeAuditJson = (tableName, json) => {
    if (!json || tableName !== "video_members_set") return json;
    return json.replace(/"id":"vm_00000000-0000-4000-8000-\d{12}"/g, '"id":"<vm_id>"');
  };

  function snapshot(sqlite) {
    return {
      videos: sqlite.prepare("SELECT id, collaboration_type, updated_at FROM videos ORDER BY id").all(),
      members: sqlite
        .prepare(
          "SELECT video_id, x_user_id, name, role, comment, order_index, can_edit, is_public_member, edit_granted_by_auth_user_id FROM video_members ORDER BY video_id, is_public_member, order_index, x_user_id",
        )
        .all(),
      chapters: sqlite
        .prepare("SELECT video_id, x_user_id, chapter_time, chapter_label, note, visibility FROM video_chapters ORDER BY id")
        .all(),
      audits: sqlite
        .prepare("SELECT table_name, target_id, operation, actor_user_id, actor_x_user_id, before_json, after_json FROM audit_logs ORDER BY created_at, id")
        .all()
        .map((row) => ({
          ...row,
          before_json: normalizeAuditJson(row.table_name, row.before_json),
          after_json: normalizeAuditJson(row.table_name, row.after_json),
        })),
      queue: sqlite
        .prepare("SELECT target_type, target_id, status FROM static_rebuild_queue ORDER BY target_type, target_id")
        .all(),
      outbox: sqlite
        .prepare("SELECT recipient_user_id, type, status, payload_json FROM notification_outbox ORDER BY id")
        .all()
        .map((row) => ({
          recipient_user_id: row.recipient_user_id,
          type: row.type,
          status: row.status,
          payload: normalizeNotificationPayload(row.payload_json),
        })),
    };
  }

  function toFormData(fields) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        for (const v of value) fd.append(key, v);
      } else if (value !== undefined && value !== null) {
        fd.set(key, String(value));
      }
    }
    return fd;
  }

  test("MIG-0650 T01: owner / collaborator / event staff / admin / other permission decisions match CURRENT across SA-082..085", async () => {
    const actors = [
      { actor: "u_owner", mode: "normal" },
      { actor: "u_collab", mode: "normal" },
      { actor: "u_staff", mode: "event" },
      { actor: "u_admin", mode: "admin" },
      { actor: "u_other", mode: "normal" },
    ];
    for (const { actor, mode } of actors) {
      // SA-082 upsert
      {
        const cw = world({ withCollaborator: true });
        const hw = world({ withCollaborator: true });
        try {
          const cur = await runCurrent(cw, actor, () =>
            collabActions.upsertVideoCollaborator(toFormData({
              video_id: "v_pub", edit_privilege_mode: mode,
              x_user_id: "x_other", display_name: "Other", can_edit: "1", notify: "0",
            })),
          );
          const hon = honoWithWakes(hw.d1, actor);
          const res = await hon.send("PUT", "/api/videos/v_pub/collaborators/x_other", {
            edit_privilege_mode: mode, display_name: "Other", can_edit: true, notify: false,
          });
          const body = VideoCollabResultSchema.parse(await res.json());
          assert.equal(body.ok, cur.result.ok, `SA-082 ok mismatch for ${actor} (${mode})`);
          assert.equal(body.message, cur.result.message, `SA-082 message mismatch for ${actor}`);
          if (!body.ok) assert.equal(hw.d1.stats.batches, 0);
        } finally {
          cw.sqlite.close();
          hw.sqlite.close();
        }
      }
      // SA-083 delete
      {
        const cw = world({ withCollaborator: true });
        const hw = world({ withCollaborator: true });
        try {
          const cur = await runCurrent(cw, actor, () =>
            collabActions.deleteVideoCollaborator(toFormData({
              video_id: "v_pub", edit_privilege_mode: mode, x_user_id: "x_collab",
            })),
          );
          const hon = honoWithWakes(hw.d1, actor);
          const res = await hon.send("DELETE", `/api/videos/v_pub/collaborators/x_collab?edit_privilege_mode=${mode}`);
          const body = VideoCollabResultSchema.parse(await res.json());
          assert.equal(body.ok, cur.result.ok, `SA-083 ok mismatch for ${actor} (${mode})`);
          assert.equal(body.message, cur.result.message, `SA-083 message mismatch for ${actor}`);
          if (!body.ok) assert.equal(hw.d1.stats.batches, 0);
        } finally {
          cw.sqlite.close();
          hw.sqlite.close();
        }
      }
      // SA-084 batch
      {
        const cw = world({ withCollaborator: true });
        const hw = world({ withCollaborator: true });
        try {
          const cur = await runCurrent(cw, actor, () =>
            collabActions.applyVideoCollaboratorPermissionsBatch({
              video_id: "v_pub", edit_privilege_mode: mode, notify: false,
              intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
            }),
          );
          const hon = honoWithWakes(hw.d1, actor);
          const res = await hon.send("POST", "/api/videos/v_pub/collaborators/batch", {
            edit_privilege_mode: mode, notify: false,
            intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
          });
          const body = VideoCollabResultSchema.parse(await res.json());
          assert.equal(body.ok, cur.result.ok, `SA-084 ok mismatch for ${actor} (${mode})`);
          assert.equal(body.message, cur.result.message, `SA-084 message mismatch for ${actor}`);
          if (!body.ok) assert.equal(hw.d1.stats.batches, 0);
        } finally {
          cw.sqlite.close();
          hw.sqlite.close();
        }
      }
      // SA-085 admin members
      {
        const cw = world({ withCollaborator: true });
        const hw = world({ withCollaborator: true });
        try {
          const membersJson = JSON.stringify([{ name: "Owner", x_user_id: "x_owner", chapters: [] }]);
          const cur = await runCurrent(cw, actor, () =>
            adminMemberActions.updateVideoMembersAdmin(toFormData({
              video_id: "v_two", is_collab: ["false", "true"], members_json: membersJson,
            })),
          );
          const hon = honoWithWakes(hw.d1, actor);
          const res = await hon.send("PUT", "/api/videos/v_two/members", {
            is_collab: ["false", "true"], members_json: membersJson,
          });
          const body = VideoAdminMembersResultSchema.parse(await res.json());
          assert.equal(body.ok, cur.result.ok, `SA-085 ok mismatch for ${actor}`);
          if (body.ok) {
            assert.equal(body.message, cur.result.message, `SA-085 message mismatch for ${actor}`);
          } else {
            assert.equal(res.status, 403);
            assert.equal(hw.d1.stats.batches, 0);
          }
        } finally {
          cw.sqlite.close();
          hw.sqlite.close();
        }
      }
    }
  });

  test("MIG-0650 T02 & T05: SA-082..085 success produces field-by-field DB/audit/outbox/queue parity with wake=0 on Hono", async () => {
    const clock = freeze();
    const cw = world();
    const hw = world();
    try {
      const hon = honoWithWakes(hw.d1, "u_admin");

      // 1) SA-082 grant via PUT /:videoId/collaborators/:xUserId (with boolean JSON)
      clock.reset(0);
      const c82 = await runCurrent(cw, "u_admin", () =>
        collabActions.upsertVideoCollaborator(toFormData({
          video_id: "v_pub", edit_privilege_mode: "admin",
          x_user_id: "x_staff", display_name: "Staff", can_edit: "1", notify: "0",
        })),
      );
      clock.reset(0);
      const h82Res = await hon.send("PUT", "/api/videos/v_pub/collaborators/x_staff", {
        edit_privilege_mode: "admin", display_name: "Staff", can_edit: true, notify: false,
      });
      assert.equal(h82Res.status, 200);
      const h82 = VideoCollabResultSchema.parse(await h82Res.json());
      assert.equal(h82.ok, c82.result.ok);
      assert.equal(h82.message, c82.result.message);
      assert.equal(h82.videoId, "v_pub");
      assert.deepEqual(snapshot(hw.sqlite), snapshot(cw.sqlite));

      // 2) SA-083 revoke via DELETE /:videoId/collaborators/:xUserId (empty body, query mode)
      clock.reset(100);
      const c83 = await runCurrent(cw, "u_admin", () =>
        collabActions.deleteVideoCollaborator(toFormData({
          video_id: "v_pub", edit_privilege_mode: "admin", x_user_id: "x_staff",
        })),
      );
      clock.reset(100);
      const h83Res = await hon.send("DELETE", "/api/videos/v_pub/collaborators/x_staff?edit_privilege_mode=admin");
      assert.equal(h83Res.status, 200);
      const h83 = VideoCollabResultSchema.parse(await h83Res.json());
      assert.equal(h83.ok, c83.result.ok);
      assert.equal(h83.message, c83.result.message);
      assert.deepEqual(snapshot(hw.sqlite), snapshot(cw.sqlite));

      // 3) SA-084 batch grant with notify=true (checks outbox DM + static_rebuild_queue + wake difference D-0603-1)
      clock.reset(200);
      const c84 = await runCurrent(cw, "u_admin", () =>
        collabActions.applyVideoCollaboratorPermissionsBatch({
          video_id: "v_pub", edit_privilege_mode: "admin", notify: true,
          intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
        }),
      );
      clock.reset(200);
      const h84Res = await hon.send("POST", "/api/videos/v_pub/collaborators/batch", {
        edit_privilege_mode: "admin", notify: true,
        intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
      });
      assert.equal(h84Res.status, 200);
      const h84 = VideoCollabResultSchema.parse(await h84Res.json());
      assert.deepEqual(
        { ok: h84.ok, message: h84.message, granted: h84.granted, revoked: h84.revoked, unchanged: h84.unchanged },
        c84.result,
      );
      assert.deepEqual(snapshot(hw.sqlite), snapshot(cw.sqlite));
      // T05 D-0603-1: CURRENT dispatches notification + rebuild wakes; Hono sends 0 wakes.
      assert.equal(c84.wakes.length, 2, "CURRENT SA-084 notify+rebuild dispatches 2 wakes");
      assert.equal(hon.wakes.length, 0, "DOCUMENTED DIFFERENCE D-0603-1: Hono wake count is 0");

      // 4) SA-085 admin members atomic write
      const membersJson = JSON.stringify([{
        name: "Owner", x_user_id: "x_owner", role: "Editor", comment: "Lead",
        chapters: [{ time: "0:12", label: "Intro", note: "Note" }],
      }]);
      clock.reset(300);
      const c85 = await runCurrent(cw, "u_admin", () =>
        adminMemberActions.updateVideoMembersAdmin(toFormData({
          video_id: "v_two", is_collab: ["false", "true"], members_json: membersJson,
        })),
      );
      clock.reset(300);
      const h85Res = await hon.send("PUT", "/api/videos/v_two/members", {
        is_collab: ["false", "true"], members_json: membersJson,
      });
      assert.equal(h85Res.status, 200);
      const h85 = VideoAdminMembersResultSchema.parse(await h85Res.json());
      assert.equal(h85.ok, c85.result.ok);
      assert.equal(h85.message, c85.result.message);
      assert.equal(h85.videoId, c85.result.videoId);
      assert.equal(h85.pendingPublicReflection, c85.result.pendingPublicReflection);
      assert.deepEqual(snapshot(hw.sqlite), snapshot(cw.sqlite));
      assert.equal(c85.wakes.length, 1, "CURRENT SA-085 dispatches 1 static rebuild wake");
      assert.equal(hon.wakes.length, 0, "DOCUMENTED DIFFERENCE D-0603-1: Hono SA-085 wake count is 0");
    } finally {
      clock.restore();
      cw.sqlite.close();
      hw.sqlite.close();
    }
  });

  test("MIG-0650 T03: atomic limits and CAS conflicts reject with CURRENT semantics and 0 D1 mutations", async () => {
    // 1) Limit exceeded (> 100 batch intents in SA-084; > 100 members in SA-085)
    {
      const cw = world();
      const hw = world();
      try {
        const hon = honoWithWakes(hw.d1, "u_admin");
        const tooManyIntents = Array.from({ length: MAX_COLLABORATOR_PERMISSION_BATCH + 1 }, (_, i) => ({
          x_user_id: `u_${i}`, display_name: `U ${i}`, intent: "on",
        }));
        const cBatch = await runCurrent(cw, "u_admin", () =>
          collabActions.applyVideoCollaboratorPermissionsBatch({
            video_id: "v_pub", edit_privilege_mode: "admin", notify: false, intents: tooManyIntents,
          }),
        );
        const hBatchRes = await hon.send("POST", "/api/videos/v_pub/collaborators/batch", {
          edit_privilege_mode: "admin", notify: false, intents: tooManyIntents,
        });
        assert.equal(hBatchRes.status, 400);
        const hBatch = await hBatchRes.json();
        assert.equal(hBatch.ok, false);
        assert.equal(cBatch.result.ok, false);
        assert.equal(hw.d1.stats.batches, 0);
        assert.equal(cw.d1.stats.batches, 0);

        const tooManyMembers = JSON.stringify(
          Array.from({ length: MAX_VIDEO_MEMBERS + 1 }, (_, i) => ({ name: `M${i}`, x_user_id: `x_${i}`, chapters: [] })),
        );
        const cMem = await runCurrent(cw, "u_admin", () =>
          adminMemberActions.updateVideoMembersAdmin(toFormData({
            video_id: "v_two", is_collab: ["false", "true"], members_json: tooManyMembers,
          })),
        );
        const hMemRes = await hon.send("PUT", "/api/videos/v_two/members", {
          is_collab: ["false", "true"], members_json: tooManyMembers,
        });
        assert.equal(hMemRes.status, 400);
        const hMem = await hMemRes.json();
        assert.equal(hMem.ok, false);
        assert.equal(cMem.result.ok, false);
        assert.equal(hMem.message, cMem.result.message);
        assert.equal(hw.d1.stats.batches, 0);
      } finally {
        cw.sqlite.close();
        hw.sqlite.close();
      }
    }

    // 2) Concurrent snapshot CAS conflict in SA-084 and SA-085 rolls back cleanly with 0 audits/rebuilds
    {
      const injectHiddenEditor = (sqlite) => {
        sqlite.prepare(
          "INSERT INTO video_members (id,video_id,x_user_id,name,role,comment,order_index,can_edit,is_public_member,edit_granted_at,edit_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ).run("race_perm", "v_pub", "x_other", "Race", null, null, 9999, 1, 0, 1, 1);
      };
      const cw = world({ beforeBatch: injectHiddenEditor });
      const hw = world({ beforeBatch: injectHiddenEditor });
      try {
        const cur = await runCurrent(cw, "u_admin", () =>
          collabActions.applyVideoCollaboratorPermissionsBatch({
            video_id: "v_pub", edit_privilege_mode: "admin", notify: false,
            intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
          }),
        );
        const hon = honoWithWakes(hw.d1, "u_admin");
        const res = await hon.send("POST", "/api/videos/v_pub/collaborators/batch", {
          edit_privilege_mode: "admin", notify: false,
          intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
        });
        assert.equal(res.status, 500);
        const hBody = await res.json();
        assert.equal(hBody.ok, false);
        assert.equal(hBody.message, cur.result.message);
        assert.deepEqual(snapshot(hw.sqlite), snapshot(cw.sqlite));
        assert.equal(hon.wakes.length, 0);
      } finally {
        cw.sqlite.close();
        hw.sqlite.close();
      }
    }
  });

  test("MIG-0650 T04: cross-origin, anonymous, and banned requests fail closed with 0 D1 mutations across SA-082..085", async () => {
    const requests = [
      ["PUT", "/api/videos/v_pub/collaborators/x_other", { display_name: "Other", can_edit: true, notify: false }],
      ["DELETE", "/api/videos/v_pub/collaborators/x_other", undefined],
      ["POST", "/api/videos/v_pub/collaborators/batch", { intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }] }],
      ["PUT", "/api/videos/v_two/members", { is_collab: ["false", "true"], members_json: "[]" }],
    ];
    for (const [method, path, body] of requests) {
      // Cross-origin: 403, 0 D1 reads & 0 batches
      {
        const w = world();
        try {
          const hon = honoWithWakes(w.d1, "u_admin");
          const res = await hon.send(method, path, body, { Origin: "https://evil.example" });
          assert.equal(res.status, 403);
          assert.equal(res.headers.get("cache-control"), "private, no-store");
          assert.equal(w.d1.stats.reads, 0);
          assert.equal(w.d1.stats.batches, 0);
          assert.equal(hon.wakes.length, 0);
        } finally {
          w.sqlite.close();
        }
      }
      // Anonymous: 401, 0 batches
      {
        const w = world();
        try {
          const hon = honoWithWakes(w.d1, null);
          const res = await hon.send(method, path, body);
          assert.equal(res.status, 401);
          assert.equal(res.headers.get("cache-control"), "private, no-store");
          assert.equal(w.d1.stats.batches, 0);
          assert.equal(hon.wakes.length, 0);
        } finally {
          w.sqlite.close();
        }
      }
      // Banned: 403, 0 batches
      {
        const w = world();
        try {
          const hon = honoWithWakes(w.d1, "u_admin", { isBanned: 1 });
          const res = await hon.send(method, path, body);
          assert.equal(res.status, 403);
          assert.equal(res.headers.get("cache-control"), "private, no-store");
          assert.equal(w.d1.stats.batches, 0);
          assert.equal(hon.wakes.length, 0);
        } finally {
          w.sqlite.close();
        }
      }
    }
  });
}
