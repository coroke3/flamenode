// MIG-0640 SA-087: real CURRENT Server Action vs Hono on the same migrated SQLite schema.
// Only Next/router/auth host ports are replaced; DB, audit, queue and action stay real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite } from "./support/personalHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation": "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__interactionGuard(o); }",
    "@/lib/serverCore/nextPorts":
      "export const nextQueueWakeHost = { readEnv: () => globalThis.__wakeEnv(), readWaitUntil: () => null, readKv: () => null };",
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier in stubs) return {
        url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true,
      };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/d1");
  const { atomicD1, chapterApp, seedChapterWorld, SITE, SESSION_USER } = await import("./support/chapterSeed.mjs");
  const { Hono } = await import("hono");
  const { createVideosRoutes } = await import("../src/routes/videos/index.ts");
  const { VIDEO_SNAPSHOT_COLUMNS } = await import("../src/routes/videos/interaction.ts");
  const { toggleVideoInteraction } = await import("../../../src/lib/actions/video/interaction.ts");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import("../../../packages/server-core/src/queues/wakeBudget.ts");
  const { getTableColumns } = await import("drizzle-orm");
  const schema = await import("../../../src/lib/db/schema.ts");
  const { VideoInteractionBodySchema, VideoInteractionResultSchema } = await import("@flamenode/contracts");

  function world(options) {
    const sqlite = createSqlite();
    seedChapterWorld(sqlite);
    // SQLite unixepoch() defaults drift between the two freshly built worlds.
    // A fixed baseline is necessary for byte-exact CURRENT / Hono audit parity.
    sqlite.prepare("UPDATE videos SET created_at = 100, updated_at = 100").run();
    return { sqlite, d1: atomicD1(sqlite, options) };
  }
  const freeze = () => {
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    let n = 0;
    Date.now = () => 1800000000000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => { Date.now = originalNow; globalThis.crypto.randomUUID = originalUuid; };
  };
  function state(w) {
    return {
      interactions: w.sqlite.prepare("SELECT * FROM video_interactions_auth ORDER BY auth_user_id, video_id, interaction_type").all(),
      videos: w.sqlite.prepare("SELECT id, app_like_count, updated_at FROM videos ORDER BY id").all(),
      queue: w.sqlite.prepare("SELECT * FROM static_rebuild_queue ORDER BY id").all(),
      audits: w.sqlite.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
    };
  }
  async function current(w, user, videoId, kind) {
    const row = w.sqlite.prepare("SELECT id, name, role, active_x_user_id FROM user WHERE id = ?").get(user);
    const wakes = [];
    globalThis.__wakeEnv = () => ({
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (payload) => { wakes.push(payload); } },
    });
    globalThis.__interactionGuard = async (opts) => {
      assert.equal(opts.feature, "like_or_bookmark");
      assert.equal(opts.requireActiveXId, false);
      assert.equal(opts.requireApprovedActiveXId, false);
      return {
        ok: true, db: drizzle(w.d1), user: {
          id: row.id, name: row.name, role: row.role, active_x_user_id: row.active_x_user_id,
        }, activeXId: row.active_x_user_id, approvedXIds: [], hasPendingXRequest: false,
      };
    };
    const form = new FormData();
    form.set("video_id", videoId);
    form.set("kind", kind);
    const original = { warn: console.warn, log: console.log, info: console.info };
    console.warn = () => {}; console.log = () => {}; console.info = () => {};
    try {
      const result = await toggleVideoInteraction(form);
      return { result: JSON.parse(JSON.stringify(result)), wakes: wakes.length };
    } finally {
      Object.assign(console, original);
    }
  }
  async function target(w, user, videoId, kind, headers) {
    const res = await chapterApp(w.d1, user)("POST", `/api/videos/${videoId}/interaction`, { kind }, headers);
    return { status: res.status, result: await res.json() };
  }
  async function compare(user, videoId, kind, expectedStatus) {
    const a = world(), b = world();
    const thawA = freeze();
    let expected;
    try { expected = await current(a, user, videoId, kind); } finally { thawA(); }
    const thawB = freeze();
    let actual;
    try { actual = await target(b, user, videoId, kind); } finally { thawB(); }
    assert.deepEqual(actual.result, expected.result, `result ${user} / ${videoId} / ${kind}`);
    assert.deepEqual(state(b), state(a), `database ${user} / ${videoId} / ${kind}`);
    assert.equal(actual.status, expectedStatus);
    if (kind === "like" && videoId === "v_pub") {
      assert.equal(b.d1.stats.reads, 3, "D-13-45: two guard reads + one snapshot read; audit is preloaded");
      assert.equal(b.d1.stats.batches, 1, "interaction, count, queue and audit are one transaction");
    }
    return { expected, actual, a, b };
  }

  test("T01/T02: approved Active X and no Active X both toggle like and bookmark with exact DB/audit parity", async () => {
    for (const user of ["u_owner", "u_nox"]) for (const kind of ["like", "bookmark"]) {
      const { a, b, expected } = await compare(user, "v_pub", kind, 200);
      assert.equal(expected.result.active, true);
      assert.equal(a.sqlite.prepare("SELECT COUNT(*) AS n FROM video_interactions_auth").get().n, 1);
      const aRestore = freeze();
      const currentOff = await current(a, user, "v_pub", kind).finally(aRestore);
      const bRestore = freeze();
      const mineOff = await target(b, user, "v_pub", kind).finally(bRestore);
      assert.deepEqual(mineOff.result, currentOff.result, "toggle off parity");
      assert.equal(mineOff.status, 200);
      assert.deepEqual(state(b), state(a), "toggle off DB/audit/queue parity");
      assert.equal(mineOff.result.active, false);
      // The CURRENT Next action wakes the queue (Hono deliberately does not).
      assert.equal(expected.wakes, kind === "like" ? 1 : 0);
      assert.equal(currentOff.wakes, kind === "like" ? 1 : 0);
    }
  });

  test("T05: absent/private videos fail closed with the CURRENT message and zero mutation", async () => {
    for (const kind of ["like", "bookmark"]) {
      for (const [videoId, status, message] of [
        ["ghost", 404, "対象作品が見つかりません。"],
        ["v_priv", 403, "公開中の作品だけ操作できます。"],
      ]) {
        const { actual, b } = await compare("u_owner", videoId, kind, status);
        assert.equal(actual.result.message, message);
        assert.equal(b.d1.stats.batches, 0);
      }
    }
  });

  test("T04: invalid input, anonymous, banned and cross-origin never reach mutation", async () => {
    const worldAuth = world();
    const call = chapterApp(worldAuth.d1, null);
    const anonymous = await call("POST", "/api/videos/v_pub/interaction", { kind: "like" });
    assert.equal(anonymous.status, 401);
    assert.equal(worldAuth.d1.stats.batches, 0);
    const crossOrigin = await chapterApp(worldAuth.d1, "u_owner")(
      "POST", "/api/videos/v_pub/interaction", { kind: "like" }, { Origin: "https://attacker.example" },
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(worldAuth.d1.stats.batches, 0);
    const blockedApp = new Hono();
    blockedApp.route("/api/videos", createVideosRoutes({
      session: async (c, next) => {
        c.set("user", { ...SESSION_USER("u_owner"), is_banned: 1 });
        c.set("sessionState", "user");
        await next();
      },
    }));
    const banned = await blockedApp.request("https://app.flamenode.example/api/videos/v_pub/interaction", {
      method: "POST", headers: { Origin: SITE, "content-type": "application/json" },
      body: JSON.stringify({ kind: "like" }),
    }, { DB: worldAuth.d1, NEXT_PUBLIC_SITE_URL: SITE });
    assert.equal(banned.status, 403);
    assert.equal(worldAuth.d1.stats.batches, 0);

    const goodWorld = world();
    const invalid = await chapterApp(goodWorld.d1, "u_owner")(
      "POST", "/api/videos/v_pub/interaction", { kind: "invalid" },
    );
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { ok: false, message: "不正な操作種別です。" });
    assert.equal(goodWorld.d1.stats.batches, 0);
  });

  test("T03: concurrent insert UNIQUE returns ok:true and does not increment like count twice", async () => {
    let inserted = false;
    const w = world({
      beforeRead(sql, sqlite) {
        if (!inserted && sql.includes("__interaction_created_at")) {
          inserted = true;
          sqlite.prepare(
            "INSERT INTO video_interactions_auth(auth_user_id, video_id, interaction_type, created_at) VALUES ('u_owner','v_pub','like',123)",
          ).run();
        }
      },
    });
    const res = await target(w, "u_owner", "v_pub", "like");
    assert.equal(res.status, 200);
    assert.deepEqual(res.result, { ok: true, active: true, videoId: "v_pub" });
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM video_interactions_auth").get().n, 1);
    assert.equal(w.sqlite.prepare("SELECT app_like_count FROM videos WHERE id = 'v_pub'").get().app_like_count, 0);
    assert.equal(w.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 0);
  });

  test("D-0603-1 DOCUMENTED DIFFERENCE: queued rows are equal; Next wakes once, Hono wakes zero times", async () => {
    const { expected, b } = await compare("u_owner", "v_pub", "like", 200);
    assert.equal(expected.wakes, 1);
    assert.equal(b.d1.stats.batches, 1);
    assert.equal(b.sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 2);
  });

  test("contract is strict on kind and preserves original action result fields", () => {
    assert.equal(VideoInteractionBodySchema.safeParse({ kind: "like" }).success, true);
    assert.equal(VideoInteractionBodySchema.safeParse({ kind: "BAD" }).success, false);
    assert.equal(VideoInteractionResultSchema.safeParse({ ok: true, active: false, videoId: "v_pub" }).success, true);
    const w = world();
    const dbRow = w.sqlite.prepare("SELECT * FROM videos WHERE id = ?").get("v_pub");
    assert.deepEqual([...VIDEO_SNAPSHOT_COLUMNS], Object.keys(getTableColumns(schema.videos)), "snapshot order is CURRENT Drizzle object order");
    assert.deepEqual(Object.keys(dbRow).sort(), [...VIDEO_SNAPSHOT_COLUMNS].sort(), "all physical SQLite columns are captured");
  });
} else {
  test("videoInteraction parity (tsx child process)", () => {});
}
