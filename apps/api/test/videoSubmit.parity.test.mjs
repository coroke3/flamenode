// MIG-0651 U02 SA-086: real CURRENT createFreeVideo vs mounted Hono POST /api/videos/free.
// Only Next/env/guard host ports are replaced; DB, domain, server-core, audit,
// queue rows, R2 icon upload/compensation and notification templates run for real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite, insert } from "./support/personalHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation": "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__submitGuard(o); }",
    "@/lib/cloudflare": "export function getEnv() { return globalThis.__cfEnv(); }",
    "@/lib/serverCore/nextPorts":
      "export const nextQueueWakeHost = { readEnv: () => globalThis.__wakeEnv(), readWaitUntil: () => null, readKv: () => null };",
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier in stubs) {
        return {
          url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`,
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const { Hono } = await import("hono");
  const { createVideosRoutes } = await import("../src/routes/videos/index.ts");
  const { NOOP_SA086_WAKE_HOST, validateFreeVideoDbReadPreflight } = await import("../src/routes/videos/submit.ts");
  const { UnslottedEventSyncError } = await import("@flamenode/domain/video");
  const { atomicD1, SITE, SESSION_USER } = await import("./support/chapterSeed.mjs");
  const { createFreeVideo } = await import("../../../src/lib/actions/video/createFreeVideo.ts");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import("../../../packages/server-core/src/queues/wakeBudget.ts");
  const { VideoSubmitResultSchema } = await import("@flamenode/contracts");

  function buildPng({ width = 64, height = 64 } = {}) {
    const parts = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const pushChunk = (type, data) => {
      const length = data.length;
      parts.push((length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
      for (let i = 0; i < 4; i += 1) parts.push(type.charCodeAt(i));
      for (const byte of data) parts.push(byte);
      parts.push(0, 0, 0, 0);
    };
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 2;
    pushChunk("IHDR", ihdr);
    pushChunk("IDAT", new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff]));
    pushChunk("IEND", new Uint8Array(0));
    return new Uint8Array(parts);
  }

  function createMemoryBucket() {
    const objects = new Map();
    const puts = [];
    const deletes = [];
    return {
      objects,
      puts,
      deletes,
      async put(key, value, options) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer ?? value);
        puts.push({ key, byteLength: bytes.byteLength, options });
        objects.set(key, { bytes: new Uint8Array(bytes), options });
      },
      async delete(key) {
        deletes.push(key);
        objects.delete(key);
      },
    };
  }

  function seedWorld(options = {}) {
    const sqlite = createSqlite();
    sqlite.prepare("UPDATE system_settings SET operation_mode = 'normal', disabled_features_json = '[]' WHERE id = 'default'").run();
    insert(sqlite, "user", {
      id: "u_owner",
      name: "Owner User",
      discord_id: "disc_owner",
      role: "user",
      active_x_user_id: "x_owner",
      is_banned: 0,
      is_tos_accepted: 1,
    });
    insert(sqlite, "x_users", {
      id: "x_owner",
      x_name: "Owner X",
      approval_status: "approved",
      icon_url: "/api/media/xicons/x_owner/current.png",
    });
    insert(sqlite, "x_user_account_links", {
      x_user_id: "x_owner",
      auth_user_id: "u_owner",
      link_role: "owner",
    });
    insert(sqlite, "user", {
      id: "u_banned",
      name: "Banned",
      role: "user",
      active_x_user_id: "x_banned",
      is_banned: 1,
      is_tos_accepted: 1,
    });
    insert(sqlite, "x_users", { id: "x_banned", x_name: "Banned", approval_status: "approved" });
    insert(sqlite, "x_user_account_links", { x_user_id: "x_banned", auth_user_id: "u_banned", link_role: "owner" });
    insert(sqlite, "user", {
      id: "u_notos",
      name: "NoTos",
      role: "user",
      active_x_user_id: "x_notos",
      is_banned: 0,
      is_tos_accepted: 0,
    });
    insert(sqlite, "x_users", { id: "x_notos", x_name: "NoTos", approval_status: "approved" });
    insert(sqlite, "x_user_account_links", { x_user_id: "x_notos", auth_user_id: "u_notos", link_role: "owner" });
    insert(sqlite, "user", {
      id: "u_nox",
      name: "NoX",
      role: "user",
      active_x_user_id: null,
      is_banned: 0,
      is_tos_accepted: 1,
    });
    insert(sqlite, "user", {
      id: "u_pend",
      name: "PendX",
      role: "user",
      active_x_user_id: "x_pend",
      is_banned: 0,
      is_tos_accepted: 1,
    });
    insert(sqlite, "x_users", { id: "x_pend", x_name: "Pend", approval_status: "pending" });
    insert(sqlite, "x_user_account_links", { x_user_id: "x_pend", auth_user_id: "u_pend", link_role: "owner" });

    // Collaborator alias & software catalog for rich submission parity
    insert(sqlite, "x_users", { id: "x_canon", x_name: "Canonical", approval_status: "approved" });
    insert(sqlite, "x_user_aliases", { alias_x_id: "x_alias", x_user_id: "x_canon" });
    insert(sqlite, "software_catalog", {
      id: "sw_ae",
      name: "After Effects",
      normalized_name: "after effects",
      is_active: 1,
      is_verified: 1,
      created_at: 100,
      updated_at: 100,
    });
    insert(sqlite, "software_aliases", {
      software_id: "sw_ae",
      alias: "AE",
      normalized_alias: "ae",
    });

    insert(sqlite, "events", {
      id: "ev_open",
      title: "Open Festival",
      visibility_status: "public",
      allow_unslotted_posts: 1,
      end_time: 2_000_000_000,
      required_video_fields_json: '["music"]',
      created_at: 100,
      updated_at: 100,
    });
    insert(sqlite, "event_custom_questions", {
      id: "q_reason",
      event_id: "ev_open",
      question_key: "reason",
      label: "応募理由",
      type: "text",
      is_active: 1,
      required: 1,
      sort_order: 1,
      visibility: "review",
      updated_at: 100,
    });
    insert(sqlite, "events", {
      id: "ev_closed",
      title: "Closed Festival",
      visibility_status: "public",
      allow_unslotted_posts: 0,
      created_at: 100,
      updated_at: 100,
    });

    return { sqlite, d1: atomicD1(sqlite, options), bucket: createMemoryBucket() };
  }

  const freezeClockAndUuids = (fixedMs = 1_800_000_000_000) => {
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    let seq = 0;
    Date.now = () => fixedMs;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  };

  function submitApp(d1, userId, bucket, wakesOut = null) {
    const app = new Hono();
    app.route("/api/videos", createVideosRoutes({
      session: async (c, next) => {
        if (userId) {
          c.set("user", { ...SESSION_USER(userId), is_banned: userId === "u_banned" ? 1 : 0 });
          c.set("sessionState", "user");
        } else {
          c.set("user", null);
          c.set("sessionState", "none");
        }
        await next();
      },
    }));
    return (formData, { origin = SITE, extraHeaders = {} } = {}) => {
      const headers = new Headers(extraHeaders);
      if (origin !== null) headers.set("Origin", origin);
      const env = {
        DB: d1,
        NEXT_PUBLIC_SITE_URL: SITE,
        ...(bucket !== undefined ? { BUCKET: bucket } : {}),
        ...(wakesOut
          ? {
              [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
              [QUEUE_BINDING_NAMES.notificationWake]: { send: async (p) => wakesOut.push(p) },
              [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (p) => wakesOut.push(p) },
              [QUEUE_BINDING_NAMES.youtubeSyncWake]: { send: async (p) => wakesOut.push(p) },
            }
          : {}),
      };
      return app.fetch(new Request(`${SITE}/api/videos/free`, { method: "POST", headers, body: formData }), env);
    };
  }

  async function runCurrentCreateFreeVideo(world, userId, formData) {
    const prevSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = SITE;
    const wakes = [];
    const userRow = world.sqlite.prepare("SELECT id, name, role, active_x_user_id FROM user WHERE id = ?").get(userId);
    const approvedRows = world.sqlite.prepare(
      `SELECT l.x_user_id FROM x_user_account_links l
       JOIN x_users x ON x.id = l.x_user_id
       WHERE l.auth_user_id = ? AND x.approval_status = 'approved'`,
    ).all(userId).map((r) => r.x_user_id);

    globalThis.__cfEnv = () => ({
      DB: world.d1,
      BUCKET: world.bucket,
      NEXT_PUBLIC_SITE_URL: SITE,
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.notificationWake]: { send: async (p) => wakes.push({ kind: "notification", p }) },
      [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (p) => wakes.push({ kind: "rebuild", p }) },
      [QUEUE_BINDING_NAMES.youtubeSyncWake]: { send: async (p) => wakes.push({ kind: "youtube", p }) },
    });
    globalThis.__wakeEnv = () => globalThis.__cfEnv();
    globalThis.__submitGuard = async (opts) => {
      assert.equal(opts.feature, "post_video_unslotted");
      assert.equal(opts.requireApprovedActiveXId, true);
      return {
        ok: true,
        db: drizzle(world.d1),
        user: {
          id: userRow.id,
          name: userRow.name,
          role: userRow.role,
          active_x_user_id: userRow.active_x_user_id,
        },
        activeXId: userRow.active_x_user_id,
        approvedXIds: approvedRows,
        hasPendingXRequest: false,
      };
    };

    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await createFreeVideo(formData);
      return { result: JSON.parse(JSON.stringify(result)), wakes };
    } finally {
      console.warn = origWarn;
      if (prevSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = prevSiteUrl;
    }
  }

  function snapshotDb(sqlite) {
    const stripVolatile = (rows, dropKeys = []) =>
      rows.map((r) => {
        const copy = { ...r };
        for (const k of dropKeys) delete copy[k];
        return copy;
      });
    const outbox = stripVolatile(
      sqlite.prepare("SELECT * FROM notification_outbox ORDER BY dedupe_key").all(),
      ["id"],
    );
    const rebuild = stripVolatile(
      sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY target_type, target_id, reason").all(),
      ["id"],
    );
    const members = stripVolatile(
      sqlite.prepare("SELECT * FROM video_members ORDER BY order_index").all(),
      ["id"],
    );
    const chapters = stripVolatile(
      sqlite.prepare("SELECT * FROM video_chapters ORDER BY x_user_id, chapter_time, chapter_label").all(),
      ["id"],
    );
    const answers = stripVolatile(
      sqlite.prepare("SELECT * FROM video_custom_answers ORDER BY event_id, question_id").all(),
      ["id"],
    );
    const softwareCatalog = sqlite.prepare("SELECT * FROM software_catalog ORDER BY normalized_name").all();
    const videoSoftwares = sqlite.prepare("SELECT * FROM video_softwares ORDER BY video_id, software_id").all();
    const audits = sqlite
      .prepare("SELECT table_name, target_id, operation, before_json, after_json, changed_keys_json, actor_user_id, actor_snapshot_json, restore_strategy, restore_status, retention_class, context FROM audit_logs")
      .all()
      .map((a) => ({
        ...a,
        // Normalize synthetic IDs embedded inside after_json for generated member/answer/catalog rows when comparing cross-impl
        target_id: a.target_id.startsWith("vm_") ? "<vm>" : a.target_id.startsWith("vca_") ? "<vca>" : a.target_id,
      }))
      .sort((a, b) => `${a.table_name}:${a.context}`.localeCompare(`${b.table_name}:${b.context}`));
    return {
      videos: sqlite.prepare("SELECT * FROM videos ORDER BY id").all(),
      ytMeta: sqlite.prepare("SELECT * FROM video_youtube_metadata ORDER BY video_id").all(),
      videoEvents: sqlite.prepare("SELECT * FROM video_events ORDER BY video_id, event_id").all(),
      members,
      chapters,
      answers,
      softwareCatalog,
      videoSoftwares,
      xUsers: sqlite.prepare("SELECT id, x_name, approval_status FROM x_users ORDER BY id").all(),
      outbox,
      rebuild,
      auditsSummary: audits.map((a) => ({
        table_name: a.table_name,
        operation: a.operation,
        before_json: a.before_json,
        actor_user_id: a.actor_user_id,
        actor_snapshot_json: a.actor_snapshot_json,
        restore_strategy: a.restore_strategy,
        restore_status: a.restore_status,
        retention_class: a.retention_class,
        context: a.context,
      })),
    };
  }

  function baseForm({ eventId = null, youtubeUrl = "https://youtu.be/dQw4w9WgXcQ" } = {}) {
    const fd = new FormData();
    fd.set("active_x_snapshot", "@x_owner");
    fd.set("display_name", "Owner Display");
    fd.set("title", "Parity Test Video");
    fd.set("youtube_url", youtubeUrl);
    fd.set("icon_mode", "none");
    fd.set("scheduled_time", "2026-11-25T10:30");
    if (eventId !== null) fd.set("event_ids", eventId);
    return fd;
  }

  test("T01: writeGuard denies (origin / auth / banned / TOS / CostGuard / missing or unapproved active X) never mutate D1 or R2", async () => {
    const w = seedWorld();
    try {
      // Cross-origin
      let res = await submitApp(w.d1, "u_owner", w.bucket)(baseForm(), { origin: "https://evil.example" });
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, reason: "invalid_origin" });

      // Unauthenticated
      res = await submitApp(w.d1, null, w.bucket)(baseForm());
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { ok: false, reason: "unauthenticated", message: "ログインが必要です。" });

      // Banned
      res = await submitApp(w.d1, "u_banned", w.bucket)(baseForm());
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, reason: "banned", message: "現在、このアカウントは利用停止中です。" });

      // TOS required
      res = await submitApp(w.d1, "u_notos", w.bucket)(baseForm());
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, reason: "tos_required", message: "利用規約への同意が必要です。" });

      // No active X
      res = await submitApp(w.d1, "u_nox", w.bucket)(baseForm());
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, reason: "active_x_required", message: "X ID を選択してから操作してください。" });

      // Pending (unapproved) active X
      res = await submitApp(w.d1, "u_pend", w.bucket)(baseForm());
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { ok: false, reason: "active_x_not_approved", message: "承認済みの X ID が必要です。" });

      // CostGuard disabled feature
      w.sqlite.prepare("UPDATE system_settings SET disabled_features_json = ?").run('["post_video_unslotted"]');
      res = await submitApp(w.d1, "u_owner", w.bucket)(baseForm());
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), {
        ok: false,
        reason: "cost_guard_blocked",
        message: "現在、この機能の書き込みは一時的に無効化されています。",
      });

      assert.equal(w.d1.stats.batches, 0);
      assert.equal(w.bucket.puts.length, 0);
    } finally {
      w.sqlite.close();
    }
  });

  test("T02: 8 MiB body limit, active_x_snapshot conflict, duplicate YouTube (archived blocks, voided allows) and required fields", async () => {
    const w = seedWorld();
    try {
      const send = submitApp(w.d1, "u_owner", w.bucket);

      // 8 MiB + 1 byte -> 413 body_too_large before DB writes
      const tooBig = new Uint8Array(8 * 1024 * 1024 + 1);
      const res413 = await send(tooBig, {
        extraHeaders: { "content-type": "multipart/form-data; boundary=x", "content-length": String(tooBig.byteLength) },
      });
      assert.equal(res413.status, 413);
      assert.deepEqual(await res413.json(), { ok: false, reason: "body_too_large" });

      // active_x_snapshot stale -> 409
      const staleFd = baseForm();
      staleFd.set("active_x_snapshot", "@other");
      const resSnap = await send(staleFd);
      assert.equal(resSnap.status, 409);
      assert.equal((await resSnap.json()).ok, false);

      // Required music field missing on ev_open -> 400
      const missingMusic = baseForm({ eventId: "ev_open" });
      missingMusic.set("custom_answer:ev_open:reason", "because");
      const resMissing = await send(missingMusic);
      assert.equal(resMissing.status, 400);
      assert.deepEqual(await resMissing.json(), { ok: false, message: "「使用楽曲」は必須です。" });

      // Ineligible event -> 400
      const resIneligible = await send(baseForm({ eventId: "ev_closed" }));
      assert.equal(resIneligible.status, 400);
      assert.match((await resIneligible.json()).message, /受け付けていません/);

      // Archived YouTube video still blocks (409)
      insert(w.sqlite, "videos", {
        id: "v_archived",
        creator_x_user_id: "x_owner",
        submitted_by_user_id: "u_owner",
        creator_display_name: "Owner",
        title: "Old",
        youtube_video_id: "dQw4w9WgXcQ",
        visibility_status: "public",
        created_at: 100,
        updated_at: 100,
      });
      w.sqlite.prepare("UPDATE videos SET visibility_status = 'archived' WHERE id = 'v_archived'").run();
      const resDup = await send(baseForm());
      assert.equal(resDup.status, 409);
      assert.deepEqual(await resDup.json(), { ok: false, message: "このYouTube動画は既に登録されています。" });

      // Voided YouTube video allows new submission (200)
      w.sqlite.prepare("UPDATE videos SET visibility_status = 'voided' WHERE id = 'v_archived'").run();
      const resVoidedOk = await send(baseForm());
      assert.equal(resVoidedOk.status, 200);
      const bodyOk = await resVoidedOk.json();
      assert.equal(VideoSubmitResultSchema.safeParse(bodyOk).success, true);
      assert.equal(bodyOk.ok, true);
      assert.equal(bodyOk.youtubeVideoId, "dQw4w9WgXcQ");
      assert.equal(bodyOk.pendingPublicReflection, true);
    } finally {
      w.sqlite.close();
    }
  });

  test("T03a: differential parity vs CURRENT createFreeVideo for base unaffiliated submission (S3 <= 3 reads, 1 batch, wake=0)", async () => {
    const wCurrent = seedWorld();
    const wHono = seedWorld();
    const honoWakes = [];

    try {
      const thawA = freezeClockAndUuids();
      let cur;
      try {
        cur = await runCurrentCreateFreeVideo(wCurrent, "u_owner", baseForm());
      } finally {
        thawA();
      }

      const thawB = freezeClockAndUuids();
      let res;
      let honoBody;
      try {
        res = await submitApp(wHono.d1, "u_owner", wHono.bucket, honoWakes)(baseForm());
        honoBody = await res.json();
      } finally {
        thawB();
      }

      assert.equal(res.status, 200);
      assert.equal(VideoSubmitResultSchema.safeParse(honoBody).success, true);
      assert.deepEqual(honoBody, cur.result);

      // S3 & D-0603-1 checks
      assert.equal(wHono.d1.stats.reads, 3, "S3 <= 3 pre-batch D1 reads (2 guard + 1 duplicate probe)");
      assert.equal(wHono.d1.stats.batches, 1);
      assert.ok(cur.wakes.length > 0, "CURRENT sends queue wakes");
      assert.equal(NOOP_SA086_WAKE_HOST.wakeCount, 0);
      assert.equal(honoWakes.length, 0, "DOCUMENTED DIFFERENCE D-0603-1: Hono sends 0 queue wakes");

      // Exact row-by-row parity (videos, metadata, outbox DM + ops channel, rebuild queue, strict audits)
      assert.deepEqual(snapshotDb(wHono.sqlite), snapshotDb(wCurrent.sqlite));
    } finally {
      wCurrent.sqlite.close();
      wHono.sqlite.close();
    }
  });

  test("T03b: differential parity vs CURRENT createFreeVideo for linked event + collab + alias + chapters + software + custom answers + R2 PNG icon", async () => {
    const wCurrent = seedWorld();
    const wHono = seedWorld();
    const honoWakes = [];

    const buildRichForm = () => {
      const fd = baseForm({ eventId: "ev_open", youtubeUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0" });
      fd.set("music", "Gangnam");
      fd.set("credit", "Director: Owner");
      fd.set("youtube_channel_url", "https://www.youtube.com/@ownerchannel");
      fd.set("other_social_links", JSON.stringify([{ type: "X", url: "https://x.com/owner" }]));
      fd.set("used_software", "AE, Blender");
      fd.set("is_collab", "on");
      fd.set(
        "members_json",
        JSON.stringify([
          {
            name: "Canonical Display",
            x_user_id: "@x_alias",
            role: "Editor",
            comment: "Great",
            chapters: [{ time: "01:15", label: "Intro", note: "Opening cut" }],
          },
          {
            name: "Newcomer",
            x_user_id: "new_x_user",
            role: "Effects",
            comment: "",
          },
          {
            name: "NameOnly Member",
            x_user_id: "",
            role: "Sound",
            comment: "",
          },
        ]),
      );
      fd.set("custom_answer:ev_open:reason", "Submitted for parity");
      fd.set("icon_mode", "upload");
      fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
      return fd;
    };

    try {
      const thawA = freezeClockAndUuids();
      let cur;
      try {
        cur = await runCurrentCreateFreeVideo(wCurrent, "u_owner", buildRichForm());
      } finally {
        thawA();
      }

      const thawB = freezeClockAndUuids();
      let res;
      let honoBody;
      try {
        res = await submitApp(wHono.d1, "u_owner", wHono.bucket, honoWakes)(buildRichForm());
        honoBody = await res.json();
      } finally {
        thawB();
      }

      assert.equal(res.status, 200);
      assert.equal(VideoSubmitResultSchema.safeParse(honoBody).success, true);
      assert.deepEqual(honoBody, cur.result);
      assert.equal(wHono.d1.stats.batches, 1);
      assert.equal(honoWakes.length, 0, "D-0603-1 wake=0");

      const snapA = snapshotDb(wCurrent.sqlite);
      const snapB = snapshotDb(wHono.sqlite);
      assert.deepEqual(snapB.videos, snapA.videos);
      assert.deepEqual(snapB.ytMeta, snapA.ytMeta);
      assert.deepEqual(snapB.videoEvents, snapA.videoEvents);
      assert.deepEqual(snapB.members, snapA.members);
      assert.deepEqual(snapB.chapters, snapA.chapters);
      assert.deepEqual(snapB.answers, snapA.answers);
      assert.deepEqual(snapB.xUsers, snapA.xUsers);
      assert.deepEqual(snapB.outbox, snapA.outbox);
      assert.deepEqual(snapB.rebuild, snapA.rebuild);
      assert.equal(snapB.videoSoftwares.length, 2);
      assert.equal(snapB.softwareCatalog.length, 2);
      assert.equal(wHono.bucket.objects.size, 1);
      assert.equal(wHono.bucket.deletes.length, 0);
      const [r2Key] = [...wHono.bucket.objects.keys()];
      assert.match(r2Key, /^video-icons\/x_owner\/v_/);
      assert.equal(snapB.videos[0].creator_icon_url, `/api/media/${r2Key}`);
      assert.deepEqual(wHono.bucket.objects.get(r2Key).bytes, buildPng());
    } finally {
      wCurrent.sqlite.close();
      wHono.sqlite.close();
    }
  });

  test("T04: R2 compensation delete when D1 batch fails (YouTube race), plus fail-closed missing BUCKET and invalid image", async () => {
    // 1. Missing BUCKET binding -> 503, 0 D1 batches
    {
      const w = seedWorld();
      try {
        const fd = baseForm();
        fd.set("icon_mode", "upload");
        fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
        const res = await submitApp(w.d1, "u_owner", undefined)(fd);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { ok: false, message: "ストレージが利用できません。" });
        assert.equal(w.d1.stats.batches, 0);
      } finally {
        w.sqlite.close();
      }
    }

    // 2. Oversized (>2 MiB) or corrupt icon bytes -> 400, 0 R2 puts, 0 D1 batches
    {
      const w = seedWorld();
      try {
        const fdBig = baseForm();
        fdBig.set("icon_mode", "upload");
        fdBig.set("icon_file", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
        const resBig = await submitApp(w.d1, "u_owner", w.bucket)(fdBig);
        assert.equal(resBig.status, 400);
        assert.equal((await resBig.json()).message, "変換後の画像サイズが2MBを超えています。");
        assert.equal(w.bucket.puts.length, 0);
        assert.equal(w.d1.stats.batches, 0);
      } finally {
        w.sqlite.close();
      }
    }

    // 3. Concurrent YouTube duplicate inserted at batch edge -> batch fails (409) AND R2 object deleted!
    {
      const w = seedWorld();
      const origBatch = w.d1.batch.bind(w.d1);
      let injected = false;
      w.d1.batch = async (statements) => {
        if (!injected) {
          injected = true;
          insert(w.sqlite, "videos", {
            id: "v_racer",
            creator_x_user_id: "x_owner",
            submitted_by_user_id: "u_owner",
            creator_display_name: "Racer",
            title: "Racer",
            youtube_video_id: "dQw4w9WgXcQ",
            visibility_status: "public",
            created_at: 100,
            updated_at: 100,
          });
        }
        return origBatch(statements);
      };
      try {
        const fd = baseForm();
        fd.set("icon_mode", "upload");
        fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
        const res = await submitApp(w.d1, "u_owner", w.bucket)(fd);
        assert.equal(res.status, 409);
        assert.equal(w.bucket.puts.length, 1, "R2 object was uploaded before batch");
        assert.equal(w.bucket.deletes.length, 1, "R2 compensation delete executed on batch failure");
        assert.equal(w.bucket.objects.size, 0, "no orphaned R2 icon remains");
        assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS c FROM videos").get().c, 1, "only racer video exists");
      } finally {
        w.sqlite.close();
      }
    }
  });

  test("T04 SEC: failed R2 compensation and throwing diagnostic sink preserve original SA-086 conflict", async () => {
    const cleanupMarker = "video_icon_orphan_cleanup_failed";
    const unrelatedKey = "video-icons/x_other/v_unrelated/keep.png";
    for (const failure of ["duplicate", "audit-abort"]) {
      for (const cleanup of ["deleted", "delete-rejected", "delete-and-log-rejected"]) {
        const label = failure + "/" + cleanup;
        const w = seedWorld();
        const wakes = [];
        const logs = [];
        const originalError = console.error;
        const origBatch = w.d1.batch.bind(w.d1);
        let attemptedBatches = 0;
        let expectedState = snapshotDb(w.sqlite);
        const unrelated = { bytes: new Uint8Array([1, 2, 3]) };
        w.bucket.objects.set(unrelatedKey, unrelated);
        // Abort inside the real SQLite transaction, after business statements
        // have been prepared. The duplicate case instead races at the batch edge.
        if (failure === "audit-abort") {
          w.sqlite.exec("CREATE TEMP TRIGGER reject_video_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_AUDIT_FAILURE'); END");
        }
        w.d1.batch = async (statements) => {
          attemptedBatches++;
          if (failure === "duplicate" && attemptedBatches === 1) {
            insert(w.sqlite, "videos", {
              id: "v_racer",
              creator_x_user_id: "x_owner",
              submitted_by_user_id: "u_owner",
              creator_display_name: "Racer",
              title: "Racer",
              youtube_video_id: "dQw4w9WgXcQ",
              visibility_status: "public",
              created_at: 100,
              updated_at: 100,
            });
            expectedState = snapshotDb(w.sqlite);
          }
          return origBatch(statements);
        };
        // Keep the real fixture deletion for the successful baseline.
        if (cleanup !== "deleted") {
          w.bucket.delete = async (key) => {
            w.bucket.deletes.push(key);
            throw new Error("SYNTHETIC_R2_DELETE_FAILURE");
          };
        }
        console.error = (...args) => {
          logs.push(args);
          if (cleanup === "delete-and-log-rejected") throw new Error("SYNTHETIC_DIAGNOSTIC_FAILURE");
        };
        try {
          const fd = baseForm();
          fd.set("icon_mode", "upload");
          fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
          const res = await submitApp(w.d1, "u_owner", w.bucket, wakes)(fd);
          assert.equal(res.status, 409, label);
          assert.equal(res.headers.get("cache-control"), "private, no-store");
          // A concurrent duplicate trips the leading atomic batch assertion,
          // not the UNIQUE classifier. T02 separately pins the preflight
          // duplicate-specific response. Neither cleanup outcome changes 409.
          assert.deepEqual(await res.json(), {
            ok: false,
            message: "イベント設定が変更されたか、保存内容が競合しました。入力内容を確認して再試行してください。",
          }, label);
          assert.equal(attemptedBatches, 1, "do not replay a failed mutation");
          assert.equal(w.d1.stats.batches, 1);
          assert.ok(w.d1.stats.batchStatements > 1);
          assert.deepEqual(snapshotDb(w.sqlite), expectedState, "no partial business/audit/outbox commit");
          assert.deepEqual(wakes, []);
          assert.equal(w.bucket.puts.length, 1);
          const uploadedKey = w.bucket.puts[0].key;
          assert.match(uploadedKey, /^video-icons\/x_owner\/v_/);
          assert.deepEqual(w.bucket.deletes, [uploadedKey], "one attempt for only the new icon");
          if (cleanup === "deleted") {
            assert.equal(w.bucket.objects.size, 1, "successful compensation removes only the new icon");
            assert.equal(w.bucket.objects.has(uploadedKey), false);
            assert.deepEqual(logs, []);
          } else {
            assert.equal(w.bucket.objects.size, 2, "failed deletion leaves an orphan, not successful compensation");
            assert.ok(w.bucket.objects.has(uploadedKey));
            assert.deepEqual(logs, [[cleanupMarker]]);
          }
          assert.equal(w.bucket.objects.get(unrelatedKey), unrelated);
        } finally {
          console.error = originalError;
          w.sqlite.close();
        }
      }
    }
  });

  test("T04 SEC: hostile failed-batch error classification preserves SA-086 response and compensates upload", async () => {
    const genericConflict = "イベント設定が変更されたか、保存内容が競合しました。入力内容を確認して再試行してください。";
    const duplicateMessage = "このYouTube動画は既に登録されています。";
    const memberMessage = "合作メンバーの入力内容を確認してください。";
    const revoked = Proxy.revocable(new Error("synthetic"), {});
    revoked.revoke();
    const cases = [
      ["throwing message getter", Object.defineProperty(new Error(), "message", {
        get() { throw new Error("SYNTHETIC_MESSAGE_ACCESS"); },
      }), 409, genericConflict],
      ["non-string message", Object.defineProperty(new Error(), "message", { value: 7 }), 409, genericConflict],
      ["revoked proxy", revoked.proxy, 409, genericConflict],
      ["throwing prototype lookup", new Proxy({}, {
        getPrototypeOf() { throw new Error("SYNTHETIC_PROTOTYPE_ACCESS"); },
      }), 409, genericConflict],
      ["ordinary failure", new Error("SYNTHETIC_BATCH_FAILURE"), 409, genericConflict],
      ["member error", new Error("free_video_new_member_invalid"), 400, memberMessage],
      ["YouTube unique error", new Error("UNIQUE constraint failed: videos.youtube_video_id"), 409, duplicateMessage],
      ["non-Error duplicate string", "UNIQUE constraint failed: videos.youtube_video_id", 409, duplicateMessage],
      ["non-Error member string remains generic", "free_video_new_member_invalid", 409, genericConflict],
    ];
    for (const [label, error, status, message] of cases) {
      const w = seedWorld();
      const wakes = [];
      const before = snapshotDb(w.sqlite);
      let attemptedBatches = 0;
      const unrelatedKey = "video-icons/x_other/v_unrelated/keep.png";
      const unrelated = { bytes: new Uint8Array([1, 2, 3]) };
      w.bucket.objects.set(unrelatedKey, unrelated);
      // Reject at the D1 port before SQLite executes any statement. This
      // exercises actual route error handling, not an ambiguous commit.
      w.d1.batch = async () => {
        attemptedBatches++;
        throw error;
      };
      try {
        const fd = baseForm();
        fd.set("icon_mode", "upload");
        fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
        const res = await submitApp(w.d1, "u_owner", w.bucket, wakes)(fd);
        assert.equal(res.status, status, label);
        assert.equal(res.headers.get("cache-control"), "private, no-store", label);
        assert.deepEqual(await res.json(), { ok: false, message }, label);
        assert.equal(attemptedBatches, 1, label);
        assert.equal(w.d1.stats.batches, 0, label);
        assert.deepEqual(snapshotDb(w.sqlite), before, label);
        assert.deepEqual(wakes, [], label);
        assert.equal(w.bucket.puts.length, 1, label);
        const uploadedKey = w.bucket.puts[0].key;
        assert.match(uploadedKey, /^video-icons\/x_owner\/v_/);
        assert.deepEqual(w.bucket.deletes, [uploadedKey], label);
        assert.equal(w.bucket.objects.size, 1, label);
        assert.equal(w.bucket.objects.get(unrelatedKey), unrelated, label);
      } finally {
        w.sqlite.close();
      }
    }
  });

  test("T02 SEC: event-read exception classification fails closed before any write", async () => {
    const temporary = "投稿処理中に一時的なエラーが発生しました。入力内容を確認して、もう一度お試しください。";
    const invalidSelection = "枠なし投稿で所属できるイベントは1件までです。";
    const notAllowed = "選択したイベントは枠なし投稿を受け付けていません。公開状態・終了日時・イベント設定を確認してください。";
    const revoked = Proxy.revocable(new Error("SYNTHETIC_REVOKED"), {});
    revoked.revoke();
    const poisonedCode = Object.defineProperty(
      new UnslottedEventSyncError("unslotted_event_not_allowed"), "code", {
        get() { throw new Error("SYNTHETIC_CODE_ACCESS"); },
      },
    );
    const cases = [
      ["revoked proxy", revoked.proxy, temporary],
      ["throwing prototype", new Proxy({}, {
        getPrototypeOf() { throw new Error("SYNTHETIC_PROTOTYPE_ACCESS"); },
      }), temporary],
      ["throwing typed code accessor", poisonedCode, temporary],
      ["unknown typed code", Object.defineProperty(new UnslottedEventSyncError("unslotted_event_not_allowed"), "code", { value: 7 }), temporary],
      ["ordinary provider error", new Error("SYNTHETIC_PROVIDER_FAILURE"), temporary],
      ["plain object imitating domain error", { code: "unslotted_event_not_allowed" }, temporary],
      ["non-Error rejection", "SYNTHETIC_PROVIDER_FAILURE", temporary],
      ["typed invalid selection", new UnslottedEventSyncError("unslotted_event_selection_invalid"), invalidSelection],
      ["typed not allowed", new UnslottedEventSyncError("unslotted_event_not_allowed"), notAllowed],
    ];
    // Exercise the real read helper at the exact throwing DB boundary without
    // relying on driver-specific wrapping/coercion of a rejected exception.
    for (const [label, error, message] of cases) {
      let selections = 0;
      const db = { select() { selections++; throw error; } };
      const result = await validateFreeVideoDbReadPreflight(db, {
        requestedEventId: "ev_open",
        videoForm: { youtube_url: "https://youtu.be/dQw4w9WgXcQ" },
      }, 1_800_000_000, true);
      assert.deepEqual(result, { ok: false, message }, label);
      assert.equal(selections, 1, label);
    }

    // Mounted HTTP path: fail only the combined event/required fields/duplicate
    // projection at D1 prepare; preserve the real guard and route/SQLite fixture.
    for (const [label, error] of cases.filter((entry) => entry[2] === temporary)) {
      const w = seedWorld();
      const before = snapshotDb(w.sqlite);
      const originalPrepare = w.d1.prepare;
      const wakes = [];
      let attempted = 0;
      w.d1.prepare = (sql) => {
        if (sql.includes("required_video_fields_json") && sql.includes("json_group_array") &&
            sql.includes("youtube_video_id") && sql.includes("event_custom_questions")) {
          attempted++;
          throw error;
        }
        return originalPrepare(sql);
      };
      try {
        const fd = baseForm({ eventId: "ev_open" });
        fd.set("music", "Track");
        fd.set("custom_answer:ev_open:reason", "Accepted");
        fd.set("icon_mode", "upload");
        fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
        const res = await submitApp(w.d1, "u_owner", w.bucket, wakes)(fd);
        assert.equal(attempted, 1, label);
        assert.equal(res.status, 503, label);
        assert.equal(res.headers.get("cache-control"), "private, no-store", label);
        assert.deepEqual(await res.json(), { ok: false, message: temporary }, label);
        assert.equal(w.d1.stats.batches, 0, label);
        assert.deepEqual(snapshotDb(w.sqlite), before, label);
        assert.deepEqual(w.bucket.puts, [], label);
        assert.deepEqual(w.bucket.deletes, [], label);
        assert.deepEqual(wakes, [], label);
      } finally {
        w.sqlite.close();
      }
    }
  });

  test("T05: icon_mode='existing' validates /api/media/... candidate ownership", async () => {
    const w = seedWorld();
    try {
      const send = submitApp(w.d1, "u_owner", w.bucket);

      // Foreign /api/media/ URL rejected (400)
      const fdBad = baseForm({ youtubeUrl: "https://youtu.be/oHg5SJYRHA0" });
      fdBad.set("icon_mode", "existing");
      fdBad.set("icon_url", "/api/media/xicons/other/evil.png");
      const resBad = await send(fdBad);
      assert.equal(resBad.status, 400);
      assert.deepEqual(await resBad.json(), { ok: false, message: "選択できないアイコンです。" });
      assert.equal(w.d1.stats.batches, 0);

      // Owned /api/media/ URL from x_users.icon_url accepted (200)
      const fdGood = baseForm({ youtubeUrl: "https://youtu.be/oHg5SJYRHA0" });
      fdGood.set("icon_mode", "existing");
      fdGood.set("icon_url", "/api/media/xicons/x_owner/current.png");
      const resGood = await send(fdGood);
      assert.equal(resGood.status, 200);
      const saved = w.sqlite.prepare("SELECT creator_icon_url FROM videos WHERE youtube_video_id = 'oHg5SJYRHA0'").get();
      assert.equal(saved.creator_icon_url, "/api/media/xicons/x_owner/current.png");
    } finally {
      w.sqlite.close();
    }
  });

  test("U03a SA-088: CURRENT slot identity and Active X snapshot precedence, no writes", async () => {
    const { submitSlotVideo } = await import("../../../src/lib/actions/video/submitSlotVideo.ts");
    const missing = "枠が見つかりません。";
    const stale =
      "投稿画面を開いた後にActive X IDが変更されました。最新の活動名義を確認してからもう一度投稿してください。";
    const chooseApproved = "承認済みのX IDを選択してください。";
    const own = { reserved_by_user_id: "u_owner", x_user_id: "x_owner" };
    const cases = [
      { name: "guard denial precedes missing ID", slotId: null, deny: true, reads: 0,
        expected: { ok: false, reason: "unauthenticated", message: "denied" } },
      { name: "missing slot ID", slotId: null, reads: 0,
        expected: { ok: false, message: "枠IDがありません。" } },
      { name: "unknown slot", reads: 1, expected: { ok: false, message: missing } },
      { name: "different account and X", row: { reserved_by_user_id: "u_notos", x_user_id: "x_notos" },
        snapshot: "@stale", reads: 1, expected: { ok: false, message: missing } },
      { name: "same account but different X", row: { ...own, x_user_id: "x_notos" },
        snapshot: "@stale", reads: 1, expected: { ok: false, message: missing } },
      { name: "no reserving account even with same X", row: { ...own, reserved_by_user_id: null, status: "available" },
        snapshot: "@stale", reads: 1, expected: { ok: false, message: missing } },
      { name: "other account with same approved X reaches snapshot check",
        row: { ...own, reserved_by_user_id: "u_notos" }, snapshot: "@stale", reads: 1,
        expected: { ok: false, message: stale } },
      { name: "own unassigned reservation reaches snapshot check", row: { ...own, x_user_id: null },
        snapshot: "@stale", reads: 1, expected: { ok: false, message: stale } },
      { name: "own reservation with stale snapshot", row: own, snapshot: "@stale", reads: 1,
        expected: { ok: false, message: stale } },
      { name: "valid snapshot still requires approved-list membership", row: own, approved: [],
        reads: 1, expected: { ok: false, message: chooseApproved } },
      { name: "normalized cross-account snapshot reaches approved-list check",
        row: { ...own, reserved_by_user_id: "u_notos" }, snapshot: " @X_OWNER ", approved: [],
        reads: 1, expected: { ok: false, message: chooseApproved } },
    ];
    const previousGuard = globalThis.__submitGuard;
    try {
      for (const scenario of cases) {
        const w = seedWorld();
        try {
          if (scenario.row) {
            insert(w.sqlite, "slots", {
              id: "slot_submit", event_id: "ev_closed", status: "reserved",
              updated_at: 100, version: 1, ...scenario.row,
            });
          }
          const before = snapshotDb(w.sqlite);
          const beforeSlots = w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all();
          let guardCalls = 0;
          globalThis.__submitGuard = async (opts) => {
            guardCalls++;
            assert.deepEqual(opts, {
              requireApprovedActiveXId: true, feature: "post_video_slotted",
            });
            if (scenario.deny) return { ok: false, reason: "unauthenticated", message: "denied" };
            return {
              ok: true, db: drizzle(w.d1),
              user: { id: "u_owner", name: "Owner User", role: "user", active_x_user_id: "x_owner" },
              activeXId: "x_owner", approvedXIds: scenario.approved ?? ["x_owner"],
              hasPendingXRequest: false,
            };
          };
          const fd = new FormData();
          if (scenario.slotId !== null) fd.set("slot_id", "slot_submit");
          fd.set("active_x_snapshot", scenario.snapshot ?? "@x_owner");
          const actual = await submitSlotVideo(fd);
          assert.deepEqual(actual, scenario.expected, scenario.name);
          assert.equal(guardCalls, 1, scenario.name);
          assert.equal(w.d1.stats.reads, scenario.reads, scenario.name);
          assert.equal(w.d1.stats.batches, 0, scenario.name);
          assert.deepEqual(snapshotDb(w.sqlite), before, scenario.name);
          assert.deepEqual(w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all(), beforeSlots, scenario.name);
          assert.deepEqual(w.bucket.puts, [], scenario.name);
          assert.deepEqual(w.bucket.deletes, [], scenario.name);
        } finally {
          w.sqlite.close();
        }
      }
    } finally {
      globalThis.__submitGuard = previousGuard;
    }
  });

  test("U03a SA-088: same-statement anchor and group receipt is complete or explicit overflow", async () => {
    const { readSlotSubmissionReceipt } = await import("../src/routes/videos/submit.ts");
    const cases = [
      { name: "missing anchor", count: 0, group: "g", missing: true },
      { name: "null group", count: 1, group: null },
      { name: "empty group", count: 1, group: "" },
      { name: "legacy singleton group", count: 1, group: "g" },
      { name: "two grouped rows", count: 2, group: "g" },
      { name: "twenty rows", count: 20, group: "g" },
      { name: "twenty-one rows", count: 21, group: "g" },
      { name: "overflow with late anchor", count: 40, group: "g", anchor: 39 },
      { name: "twenty rows with late anchor", count: 20, group: "g", anchor: 19 },
      { name: "anchor changes after the one read", count: 2, group: "g", mutate: true },
      { name: "existing video is preserved in all rows", count: 2, group: "g", linked: true },
    ];
    const columns = "id, event_id, reserved_by_user_id, x_user_id, reserved_x_id_snapshot, display_name, slot_label, start_time, sort_order, reservation_group_id, video_id, status, updated_at, version";
    for (const scenario of cases) {
      const slotId = scenario.missing ? "missing" : "receipt_" + (scenario.anchor ?? 0);
      const w = seedWorld({
        beforeRead(sql, sqlite) {
          if (scenario.mutate && sql.includes("WITH anchor AS")) {
            sqlite.prepare("UPDATE slots SET video_id='v_receipt', status='submitted', version=2 WHERE id=?").run(slotId);
          }
        },
      });
      try {
        if (scenario.mutate || scenario.linked) {
          insert(w.sqlite, "videos", {
            id: "v_receipt", submitted_by_user_id: "u_owner", creator_x_user_id: "x_owner",
            creator_display_name: "Owner", title: "Existing", visibility_status: "pending",
            created_at: 100, updated_at: 100,
          });
        }
        const add = (id, event, group, index) => insert(w.sqlite, "slots", {
          id, event_id: event, reservation_group_id: group, reserved_by_user_id: "u_owner",
          x_user_id: "x_owner", reserved_x_id_snapshot: "x_owner", display_name: "Owner",
          slot_label: "slot", start_time: index % 2 ? 1000 + index : null, sort_order: index,
          status: "reserved", video_id: scenario.linked ? "v_receipt" : null, updated_at: 100, version: 1,
        });
        for (let i = 0; i < scenario.count; i++) add("receipt_" + i, "ev_closed", scenario.group, i);
        add("other_event", "ev_open", scenario.group, 0);
        add("other_group", "ev_closed", "different", 0);
        if (!scenario.group) add("unrelated", "ev_closed", scenario.group, 0);
        const before = w.sqlite.prepare("SELECT " + columns + " FROM slots WHERE id=?").get(slotId);
        const expectedRows = before?.reservation_group_id
          ? w.sqlite.prepare("SELECT " + columns + " FROM slots WHERE reservation_group_id=? AND event_id=? LIMIT 21")
            .all(before.reservation_group_id, before.event_id)
          : before ? [before] : [];
        const snapshot = snapshotDb(w.sqlite);
        const actual = await readSlotSubmissionReceipt(w.d1, slotId);
        assert.equal(w.d1.stats.reads, 1, scenario.name);
        assert.equal(w.d1.stats.maxBinds, 2, scenario.name);
        assert.equal(w.d1.stats.batches, 0, scenario.name);
        assert.deepEqual(snapshotDb(w.sqlite), snapshot, scenario.name);
        assert.deepEqual(w.bucket.puts, [], scenario.name);
        assert.deepEqual(w.bucket.deletes, [], scenario.name);
        if (scenario.missing) {
          assert.equal(actual, null, scenario.name);
          continue;
        }
        assert.deepEqual(actual.anchor, { ...before }, scenario.name);
        if (scenario.count > 20) {
          assert.deepEqual(actual.group, { kind: "overflow" }, scenario.name);
          continue;
        }
        assert.equal(actual.group.kind, "ready", scenario.name);
        assert.deepEqual(actual.group.rows.map((row) => row.id).sort(), expectedRows.map((row) => row.id).sort(), scenario.name);
        for (const row of actual.group.rows) {
          assert.deepEqual(row, { ...expectedRows.find((expected) => expected.id === row.id) }, scenario.name);
        }
        assert.deepEqual(actual.group.rows.find((row) => row.id === slotId), actual.anchor, scenario.name);
        if (scenario.mutate) {
          assert.equal(actual.anchor.version, 1);
          assert.equal(w.sqlite.prepare("SELECT version FROM slots WHERE id=?").get(slotId).version, 2);
        }
      } finally {
        w.sqlite.close();
      }
    }
  });

  test("U03a SA-088: reservation receipt CAS precedes audited mutation in one batch", async () => {
    const { readSlotSubmissionReceipt, buildSlotSubmissionReceiptAssertions } = await import("../src/routes/videos/submit.ts");
    const { mutateWithAudit, assertCondition } = await import("@flamenode/server-core/audit/mutate");
    const { sql } = await import("drizzle-orm");
    const cases = [
      { name: "normal group", accept: true },
      { name: "maximum group and nonnull fields", count: 20, accept: true },
      { name: "null singleton", count: 1, group: null, accept: true },
      { name: "empty singleton", count: 1, group: "", accept: true },
      { name: "legacy singleton", count: 1, accept: true },
      { name: "other event same group", add: { id: "cross", event_id: "ev_open" }, accept: true },
      { name: "other group same event", add: { id: "other", reservation_group_id: "other" }, accept: true },
      { name: "sibling added", add: { id: "extra" } },
      { name: "sibling removed", remove: "cas_1" },
      { name: "same-count sibling replacement", remove: "cas_1", add: { id: "replacement" } },
      { name: "anchor status changes without version bump", change: { status: "submitted" } },
      { name: "anchor linked video changes without version bump", change: { video_id: null } },
      { name: "anchor X snapshot changes without version bump", change: { reserved_x_id_snapshot: "x_notos" } },
      { name: "anchor display name changes without version bump", change: { display_name: "New" } },
      { name: "last chunk changes", count: 20, target: "cas_19", change: { slot_label: "New" } },
      { name: "version changes", change: { version: 2 } },
      { name: "timestamp changes", change: { updated_at: 101 } },
      { name: "late failure rolls back resource and audit", lateFail: true },
    ];
    for (const scenario of cases) {
      const w = seedWorld();
      try {
        const group = Object.hasOwn(scenario, "group") ? scenario.group : "cas_group";
        insert(w.sqlite, "videos", {
          id: "v_cas", creator_x_user_id: "x_owner", submitted_by_user_id: "u_owner",
          creator_display_name: "Owner", title: "Before", visibility_status: "pending",
          created_at: 100, updated_at: 100,
        });
        const add = (id, i, extra = {}) => insert(w.sqlite, "slots", {
          id, event_id: "ev_closed", reservation_group_id: group, reserved_by_user_id: "u_owner",
          x_user_id: "x_owner", reserved_x_id_snapshot: "x_owner", display_name: "Owner", slot_label: "slot",
          start_time: 1000 + i, sort_order: i, status: "reserved", video_id: "v_cas",
          updated_at: 100, version: 1, ...extra,
        });
        for (let i = 0; i < (scenario.count ?? 2); i++) add("cas_" + i, i);
        const receipt = await readSlotSubmissionReceipt(w.d1, "cas_0");
        assert.equal(receipt.group.kind, "ready", scenario.name);
        assert.equal(w.d1.stats.reads, 1, scenario.name);
        const conditions = buildSlotSubmissionReceiptAssertions(receipt);
        assert.equal(conditions.length, Math.ceil((scenario.count ?? 2) / 6), scenario.name);
        if (scenario.remove) w.sqlite.prepare("DELETE FROM slots WHERE id=?").run(scenario.remove);
        if (scenario.add) add(scenario.add.id, 100, scenario.add);
        if (scenario.change) {
          const [column, value] = Object.entries(scenario.change)[0];
          w.sqlite.prepare("UPDATE slots SET " + column + "=? WHERE id=?").run(value, scenario.target ?? "cas_0");
        }
        const before = snapshotDb(w.sqlite);
        const beforeSlots = w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all();
        const video = { ...w.sqlite.prepare("SELECT * FROM videos WHERE id='v_cas'").get() };
        const db = drizzle(w.d1);
        const write = () => mutateWithAudit(db, {
          preMutationAssertions: conditions.map((condition) => db.run(condition)),
          mutationStatements: [db.run(sql`UPDATE videos SET title='After' WHERE id='v_cas'`)],
          expectedMutationChanges: [1],
          audits: [{ table_name: "videos", target_id: "v_cas", operation: "UPDATE",
            before: video, after: { ...video, title: "After" }, actor_user_id: "u_owner",
            context: "video-save:submit-slot", retention_class: "normal", strict: true }],
          callerQueryCount: 1,
          ...(scenario.lateFail ? { postAuditStatements: [db.run(assertCondition(sql`0 = 1`))] } : {}),
        });
        if (scenario.accept) {
          const ids = await write();
          assert.equal(ids.length, 1, scenario.name);
          assert.equal(w.sqlite.prepare("SELECT title FROM videos WHERE id='v_cas'").get().title, "After", scenario.name);
          assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE target_id='v_cas' AND table_name='videos'").get().n, 1, scenario.name);
        } else {
          await assert.rejects(write, /malformed JSON/i, scenario.name);
          assert.deepEqual(snapshotDb(w.sqlite), before, scenario.name);
        }
        assert.equal(w.d1.stats.batches, 1, scenario.name);
        assert.ok(w.d1.stats.maxBinds <= 100, scenario.name);
        assert.deepEqual(w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all(), beforeSlots, scenario.name);
        assert.deepEqual(w.bucket.puts, [], scenario.name);
        assert.deepEqual(w.bucket.deletes, [], scenario.name);
      } finally {
        w.sqlite.close();
      }
    }
  });

  test("U03a SA-088: incomplete or ambiguous receipt cannot build batch assertions", async () => {
    const { readSlotSubmissionReceipt, buildSlotSubmissionReceiptAssertions } = await import("../src/routes/videos/submit.ts");
    const w = seedWorld();
    try {
      for (let i = 0; i < 2; i++) insert(w.sqlite, "slots", {
        id: "invalid_cas_" + i, event_id: "ev_closed", reservation_group_id: "invalid_cas_group",
        reserved_by_user_id: "u_owner", x_user_id: "x_owner", reserved_x_id_snapshot: "x_owner",
        display_name: "Owner", status: "reserved", updated_at: 100, version: 1,
      });
      const receipt = await readSlotSubmissionReceipt(w.d1, "invalid_cas_0");
      const sibling = receipt.group.rows.find((row) => row.id !== receipt.anchor.id);
      const bad = [
        { ...receipt, group: { kind: "overflow" } },
        { ...receipt, group: { kind: "ready", rows: [] } },
        { ...receipt, group: { kind: "ready", rows: [receipt.anchor, receipt.anchor] } },
        { ...receipt, group: { kind: "ready", rows: [sibling] } },
        { ...receipt, anchor: { ...receipt.anchor, display_name: "different" } },
        { ...receipt, group: { kind: "ready", rows: [receipt.anchor, { ...sibling, event_id: "ev_open" }] } },
        { ...receipt, group: { kind: "ready", rows: [receipt.anchor, { ...sibling, extra: "unexpected" }] } },
        { ...receipt, group: { kind: "ready", rows: [receipt.anchor, { ...sibling, display_name: undefined }] } },
      ];
      for (const value of bad) assert.throws(() => buildSlotSubmissionReceiptAssertions(value), /slot_submission_receipt_invalid/);
      assert.equal(w.d1.stats.batches, 0);
    } finally {
      w.sqlite.close();
    }
  });

  test("U03a SA-088: CURRENT reservation group denial order and absolute cap, no writes (including preflight)", async () => {
    const { submitSlotVideo } = await import("../../../src/lib/actions/video/submitSlotVideo.ts");
    const inconsistent = "連続枠の予約者情報が不整合です。運営へ連絡してください。";
    const cases = [
      { name: "21 rows rejected before identity checks", count: 21,
        sibling: { reserved_x_id_snapshot: "x_notos" },
        message: "連続枠の件数が上限を超えています。" },
      { name: "snapshot mismatch precedes mixed owner",
        sibling: { reserved_x_id_snapshot: "x_notos", reserved_by_user_id: "u_notos" },
        message: "予約グループのX IDスナップショットが一致しません。" },
      { name: "mixed owner", sibling: { reserved_by_user_id: "u_notos" }, message: inconsistent },
      { name: "mixed X", sibling: { x_user_id: "x_notos" }, message: inconsistent },
      { name: "mixed assigned and unassigned X", sibling: { x_user_id: null }, message: inconsistent },
      { name: "mixed display names", sibling: { display_name: "Other" }, message: inconsistent },
      { name: "status precedes mismatched video",
        sibling: { status: "submitted", video_id: "v_group_other" },
        message: "予約中でない枠を含む連続枠は提出できません。" },
      { name: "different video on still-reserved sibling",
        sibling: { video_id: "v_group_other" },
        message: "連続枠に別の作品が紐づいています。" },
      { name: "gap exceeds configured part boundary", sibling: { start_time: 1901 },
        message: "連続していない枠をまとめて提出できません。" },
      // A missing upload stops after reservation authorization and contiguity, before any mutation.
      // Reaching that error proves valid legacy group shapes are not rejected earlier.
      { name: "same X on a different Discord account reaches icon validation",
        anchor: { reserved_by_user_id: "u_notos" }, sibling: { reserved_by_user_id: "u_notos" },
        form: { icon_mode: "upload" }, message: "画像ファイルが必要です。" },
      { name: "20 slots grandfathered despite current event max of one",
        count: 20, form: { icon_mode: "upload" }, message: "画像ファイルが必要です。" },
      { name: "exact 900 second part gap reaches icon validation",
        sibling: { start_time: 1900 }, form: { icon_mode: "upload" },
        message: "画像ファイルが必要です。" },
      { name: "JST midnight breaks continuity even with a one-second gap",
        anchor: { start_time: 53999 }, sibling: { start_time: 54000 },
        message: "連続していない枠をまとめて提出できません。" },
      { name: "untimed consecutive sort orders reach icon validation",
        anchor: { start_time: null }, sibling: { start_time: null },
        form: { icon_mode: "upload" }, message: "画像ファイルが必要です。" },
      { name: "untimed nonconsecutive sort orders break continuity",
        anchor: { start_time: null }, sibling: { start_time: null, sort_order: 3 },
        message: "連続していない枠をまとめて提出できません。" },
      { name: "timed and untimed slots cannot share a submission",
        sibling: { start_time: null }, message: "連続していない枠をまとめて提出できません。" },
      // The same late group denial is deliberately present in each preflight fixture.
      // These cases lock CURRENT ordering without adding a new deadline or receipt policy.
      // 0044/0045 normalize legacy archived rows to private (or voided for duplicates).
      // The migrated schema rejects archived inserts; private is still a non-voided duplicate.
      { name: "private duplicate precedes invalid member JSON and group denial",
        duplicateStatus: "private", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
        form: { is_collab: "true", members_json: "not-json" },
        sibling: { reserved_by_user_id: "u_notos" },
        message: "このYouTube動画は既に登録されています。" },
      { name: "voided duplicate does not mask invalid member JSON",
        duplicateStatus: "voided", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
        form: { is_collab: "true", members_json: "not-json" },
        sibling: { reserved_by_user_id: "u_notos" },
        message: "合作メンバーの JSON が不正です。" },
      { name: "existing linked video is excluded from duplicate lookup",
        duplicateStatus: "public", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ",
        anchor: { video_id: "v_group_other" },
        form: { is_collab: "true", members_json: "not-json" },
        sibling: { video_id: "v_group_other", reserved_by_user_id: "u_notos" },
        message: "合作メンバーの JSON が不正です。" },
      { name: "required custom answer precedes missing music and group denial",
        question: true, requiredFields: ["music"],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "枠応募理由を入力してください。" },
      { name: "answered custom question reaches required music before group denial",
        question: true, requiredFields: ["music"],
        form: { "custom_answer:ev_closed:slot_reason": "応募します" },
        sibling: { reserved_by_user_id: "u_notos" },
        message: "「使用楽曲」は必須です。" },
      { name: "forged form part cannot satisfy missing authoritative part",
        requiredFields: ["part"], form: { part: "偽の部" },
        sibling: { reserved_by_user_id: "u_notos" },
        message: "「部」は必須です。" },
      { name: "configured slot part satisfies required part even with empty form part",
        requiredFields: ["part"], parts: ["第1部"], form: { part: "" },
        sibling: { reserved_by_user_id: "u_notos" }, message: inconsistent },
      // Stage-permission questions have a distinct multipart namespace and run
      // before general custom answers, required video fields and group checks.
      { name: "missing stage answer precedes all later denials",
        stage: {}, question: true, requiredFields: ["music"],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "ステージ確認を入力してください。" },
      { name: "stage answer 1001 characters precedes general question",
        stage: {}, question: true, requiredFields: ["music"],
        stageIds: ["stage_permission"], stageValues: ["x".repeat(1001)],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "ステージ確認は1000文字以内で入力してください。" },
      { name: "stage answer 1000 characters reaches general question",
        stage: {}, question: true, requiredFields: ["music"],
        stageIds: ["stage_permission"], stageValues: ["x".repeat(1000)],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "枠応募理由を入力してください。" },
      { name: "both stage and general answers reach missing music",
        stage: {}, question: true, requiredFields: ["music"],
        stageIds: ["stage_permission"], stageValues: ["許諾済み"],
        form: { "custom_answer:ev_closed:slot_reason": "応募します" },
        sibling: { reserved_by_user_id: "u_notos" },
        message: "「使用楽曲」は必須です。" },
      { name: "duplicate stage IDs use last valid answer",
        stage: {}, requiredFields: ["music"],
        stageIds: ["stage_permission", "stage_permission"],
        stageValues: ["x".repeat(1001), " 許諾済み "],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "「使用楽曲」は必須です。" },
      { name: "last duplicate stage answer can explicitly clear required value",
        stage: {}, question: true,
        stageIds: ["stage_permission", "stage_permission"],
        stageValues: ["許諾済み", "  "],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "ステージ確認を入力してください。" },
      { name: "inactive required stage question is ignored",
        stage: { is_active: 0 }, question: true,
        sibling: { reserved_by_user_id: "u_notos" },
        message: "枠応募理由を入力してください。" },
      { name: "missing paired stage value is treated as empty",
        stage: {}, stageIds: ["stage_permission"],
        sibling: { reserved_by_user_id: "u_notos" },
        message: "ステージ確認を入力してください。" },
      { name: "general answer namespace cannot satisfy stage permission",
        stage: {}, question: true,
        form: { "custom_answer:ev_closed:stage_permission": "許諾済み",
          "custom_answer:ev_closed:slot_reason": "応募します" },
        sibling: { reserved_by_user_id: "u_notos" },
        message: "ステージ確認を入力してください。" },
      { name: "valid stage and general answers reach icon validation",
        stage: {}, question: true,
        stageIds: ["stage_permission"], stageValues: ["許諾済み"],
        form: { "custom_answer:ev_closed:slot_reason": "応募します", icon_mode: "upload" },
        message: "画像ファイルが必要です。" },
      { name: "single already-submitted slot", count: 1,
        anchor: { reservation_group_id: null, status: "submitted", video_id: "v_group_other" },
        message: "予約中の枠だけ作品を提出できます。" },
    ];
    const previousGuard = globalThis.__submitGuard;
    const previousEnv = globalThis.__cfEnv;
    const previousWake = globalThis.__wakeEnv;
    try {
      for (const scenario of cases) {
        const w = seedWorld();
        try {
          w.sqlite.prepare("UPDATE events SET slot_part_gap_minutes=15, max_slots_per_video=1, parts_json=?, required_video_fields_json=? WHERE id='ev_closed'")
            .run(scenario.parts ? JSON.stringify(scenario.parts) : null,
              scenario.requiredFields ? JSON.stringify(scenario.requiredFields) : null);
          if (scenario.stage) {
            insert(w.sqlite, "event_custom_questions", {
              id: "q_slot_stage", event_id: "ev_closed", question_key: "stage_permission",
              label: "ステージ確認", type: "textarea", max_length: 1000,
              is_active: 1, required: 1, sort_order: 0, visibility: "review", updated_at: 100,
              ...scenario.stage,
            });
          }
          if (scenario.question) {
            insert(w.sqlite, "event_custom_questions", {
              id: "q_slot_reason", event_id: "ev_closed", question_key: "slot_reason",
              label: "枠応募理由", type: "text", is_active: 1, required: 1,
              sort_order: 1, visibility: "review", updated_at: 100,
            });
          }
          if (scenario.anchor?.video_id || scenario.sibling?.video_id || scenario.duplicateStatus) {
            insert(w.sqlite, "videos", {
              id: "v_group_other", creator_x_user_id: "x_owner", submitted_by_user_id: "u_owner",
              creator_display_name: "Owner", title: "Previously linked",
              visibility_status: scenario.duplicateStatus ?? "pending",
              ...(scenario.duplicateStatus ? { youtube_video_id: "dQw4w9WgXcQ" } : {}),
              created_at: 100, updated_at: 100,
            });
          }
          for (let index = 0; index < (scenario.count ?? 2); index++) {
            insert(w.sqlite, "slots", {
              id: index === 0 ? "slot_submit" : "slot_sibling_" + index,
              event_id: "ev_closed", reservation_group_id: "group_submit",
              reserved_by_user_id: "u_owner", x_user_id: "x_owner", reserved_x_id_snapshot: "x_owner",
              display_name: "Owner", status: "reserved", video_id: null,
              start_time: 1000 + index * 100, sort_order: index + 1,
              updated_at: 100, version: 1,
              ...(index === 0 ? scenario.anchor : index === 1 ? scenario.sibling : undefined),
            });
          }
          const before = snapshotDb(w.sqlite);
          const beforeSlots = w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all();
          let guardCalls = 0;
          const wakes = [];
          globalThis.__cfEnv = () => ({
            DB: w.d1, BUCKET: w.bucket, NEXT_PUBLIC_SITE_URL: SITE,
            [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
            [QUEUE_BINDING_NAMES.notificationWake]: { send: async (p) => wakes.push(p) },
            [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (p) => wakes.push(p) },
            [QUEUE_BINDING_NAMES.youtubeSyncWake]: { send: async (p) => wakes.push(p) },
          });
          globalThis.__wakeEnv = () => globalThis.__cfEnv();
          globalThis.__submitGuard = async (opts) => {
            guardCalls++;
            assert.deepEqual(opts, { requireApprovedActiveXId: true, feature: "post_video_slotted" });
            return {
              ok: true, db: drizzle(w.d1),
              user: { id: "u_owner", name: "Owner User", role: "user", active_x_user_id: "x_owner" },
              activeXId: "x_owner", approvedXIds: ["x_owner"], hasPendingXRequest: false,
            };
          };
          const fd = baseForm({ youtubeUrl: scenario.youtubeUrl ?? "" });
          fd.set("slot_id", "slot_submit");
          for (const [key, value] of Object.entries(scenario.form ?? {})) fd.set(key, value);
          for (const id of scenario.stageIds ?? []) fd.append("custom_question_answer_id", id);
          for (const value of scenario.stageValues ?? []) fd.append("custom_question_answer_value", value);
          const actual = await submitSlotVideo(fd);
          assert.deepEqual(actual, { ok: false, message: scenario.message }, scenario.name);
          assert.equal(guardCalls, 1, scenario.name);
          assert.equal(w.d1.stats.batches, 0, scenario.name);
          assert.deepEqual(snapshotDb(w.sqlite), before, scenario.name);
          assert.deepEqual(w.sqlite.prepare("SELECT * FROM slots ORDER BY id").all(), beforeSlots, scenario.name);
          assert.deepEqual(w.bucket.puts, [], scenario.name);
          assert.deepEqual(w.bucket.deletes, [], scenario.name);
          assert.deepEqual(wakes, [], scenario.name);
        } finally {
          w.sqlite.close();
        }
      }
    } finally {
      globalThis.__submitGuard = previousGuard;
      globalThis.__cfEnv = previousEnv;
      globalThis.__wakeEnv = previousWake;
    }
  });
}
