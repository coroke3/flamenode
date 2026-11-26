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
  const { NOOP_SA086_WAKE_HOST } = await import("../src/routes/videos/submit.ts");
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
      for (const throwSink of [false, true]) {
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
        w.bucket.delete = async (key) => {
          w.bucket.deletes.push(key);
          throw new Error("SYNTHETIC_R2_DELETE_FAILURE");
        };
        console.error = (...args) => {
          logs.push(args);
          if (throwSink) throw new Error("SYNTHETIC_DIAGNOSTIC_FAILURE");
        };
        try {
          const fd = baseForm();
          fd.set("icon_mode", "upload");
          fd.set("icon_file", new File([buildPng()], "icon.png", { type: "image/png" }));
          const res = await submitApp(w.d1, "u_owner", w.bucket, wakes)(fd);
          assert.equal(res.status, 409, failure + "/" + throwSink);
          assert.equal(res.headers.get("cache-control"), "private, no-store");
          assert.deepEqual(await res.json(), {
            ok: false,
            message: failure === "duplicate"
              ? "このYouTube動画は既に登録されています。"
              : "イベント設定が変更されたか、保存内容が競合しました。入力内容を確認して再試行してください。",
          });
          assert.equal(attemptedBatches, 1, "do not replay a failed mutation");
          assert.equal(w.d1.stats.batches, 1);
          assert.ok(w.d1.stats.batchStatements > 1);
          assert.deepEqual(snapshotDb(w.sqlite), expectedState, "no partial business/audit/outbox commit");
          assert.deepEqual(wakes, []);
          assert.equal(w.bucket.puts.length, 1);
          const uploadedKey = w.bucket.puts[0].key;
          assert.match(uploadedKey, /^video-icons\/x_owner\/v_/);
          assert.deepEqual(w.bucket.deletes, [uploadedKey], "one attempt for only the new icon");
          assert.equal(w.bucket.objects.size, 2, "failed deletion leaves an orphan, not successful compensation");
          assert.ok(w.bucket.objects.has(uploadedKey));
          assert.equal(w.bucket.objects.get(unrelatedKey), unrelated);
          assert.deepEqual(logs, [[cleanupMarker]]);
        } finally {
          console.error = originalError;
          w.sqlite.close();
        }
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
}
