// MIG-0636 SA-098, SA-102..105: real CURRENT Server Actions (src/lib/actions/xid.ts) vs mounted Hono app
// on the real migrated SQLite schema. Only Next/router/auth/env ports are replaced; DB, audit, queue and actions stay real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runUnderRootTsx, createSqlite, insert } from "./support/personalHarness.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  const stubs = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath() {}",
    "next/navigation": "export function unstable_rethrow() {} export function redirect() {} export function notFound() {}",
    "@/lib/auth/writeGuard": "export async function writeGuard(o) { return globalThis.__xidGuard(o); }",
    "@/lib/cloudflare": "export function getEnv() { return { BUCKET: globalThis.__xidBucket }; }",
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
  const { atomicD1, seedChapterWorld, SITE } = await import("./support/chapterSeed.mjs");
  const { app: mountedApp } = await import("../src/app.ts");
  const current = await import("../../../src/lib/actions/xid.ts");
  const { QUEUE_BINDING_NAMES, QUEUE_FEATURE_FLAG_NAMES } = await import(
    "../../../packages/server-core/src/queues/wakeBudget.ts"
  );
  const { XIdWriteResultSchema } = await import("@flamenode/contracts");
  process.env.NEXT_PUBLIC_SITE_URL = SITE;

  const buildPng = () => {
    const parts = [137, 80, 78, 71, 13, 10, 26, 10];
    const chunk = (name, data) => {
      const n = data.length;
      parts.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255,
        ...Array.from(name, (c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0);
    };
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 64);
    new DataView(ihdr.buffer).setUint32(4, 64);
    ihdr[8] = 8;
    ihdr[9] = 2;
    chunk("IHDR", ihdr);
    chunk("IDAT", new Uint8Array([0x78, 1, 1, 0, 0, 255, 255]));
    chunk("IEND", new Uint8Array(0));
    return new Uint8Array(parts);
  };

  function createBucket() {
    const objects = new Map([["xicons/x_owner/old.png", new Uint8Array([1, 2, 3])]]);
    const ops = { puts: [], deletes: [] };
    return {
      objects,
      ops,
      put: async (key, data, opts) => {
        ops.puts.push(key);
        objects.set(key, new Uint8Array(data));
        void opts;
      },
      delete: async (key) => {
        ops.deletes.push(key);
        objects.delete(key);
      },
    };
  }

  function world() {
    const sqlite = createSqlite();
    seedChapterWorld(sqlite);
    sqlite.prepare("UPDATE x_users SET icon_url = ? WHERE id = ?")
      .run("/api/media/xicons/x_owner/old.png", "x_owner");
    insert(sqlite, "videos", {
      id: "v_icon_pub",
      submitted_by_user_id: "u_owner",
      creator_display_name: "Creator",
      creator_x_user_id: "x_owner",
      creator_icon_url: "https://cdn.example/pub-icon.png",
      title: "Pub Icon Video",
      visibility_status: "public",
      created_at: 500,
    });
    insert(sqlite, "videos", {
      id: "v_icon_priv",
      submitted_by_user_id: "u_owner",
      creator_display_name: "Creator",
      creator_x_user_id: "x_owner",
      creator_icon_url: "https://cdn.example/priv-icon.png",
      title: "Priv Icon Video",
      visibility_status: "private",
      created_at: 600,
    });
    // Free unlinked-dependency X ID for u_multi to test SA-103 unlink parity
    insert(sqlite, "x_users", { id: "x_free", x_name: "Free X", approval_status: "approved" });
    insert(sqlite, "x_user_account_links", { auth_user_id: "u_multi", x_user_id: "x_free", link_role: "owner" });
    // Session tokens for real Auth.js sessionMiddleware resolution
    for (const userId of ["u_owner", "u_multi", "u_pend"]) {
      insert(sqlite, "session", {
        sessionToken: `tok_${userId}`,
        userId,
        expires: 2_000_000_000_000,
      });
    }
    // Pin schema unixepoch() default timestamps so sequential world() calls never straddle a second boundary.
    sqlite.exec(`
      UPDATE "user" SET created_at = 1800000000 WHERE created_at IS NOT NULL;
      UPDATE x_user_account_links SET created_at = 1800000000, updated_at = 1800000000;
      UPDATE videos SET created_at = 1800000000, updated_at = 1800000000 WHERE id NOT IN ('v_icon_pub', 'v_icon_priv');
      UPDATE videos SET updated_at = 1800000000 WHERE id IN ('v_icon_pub', 'v_icon_priv');
      UPDATE events SET created_at = 1800000000, updated_at = 1800000000;
      UPDATE system_settings SET audit_updated_at = 1800000000;
    `);
    return { sqlite, d1: atomicD1(sqlite), bucket: createBucket() };
  }

  const freeze = (initialId = 0) => {
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    let n = initialId;
    Date.now = () => 1_800_000_000_000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  };

  const quiet = async (fn) => {
    const original = { warn: console.warn, log: console.log, info: console.info, error: console.error };
    console.warn = () => {}; console.log = () => {}; console.info = () => {}; console.error = () => {};
    try { return await fn(); } finally { Object.assign(console, original); }
  };

  function snapshot(w) {
    return {
      users: w.sqlite.prepare('SELECT id, active_x_user_id FROM "user" ORDER BY id').all(),
      xUsers: w.sqlite.prepare("SELECT * FROM x_users ORDER BY id").all(),
      links: w.sqlite.prepare("SELECT * FROM x_user_account_links ORDER BY x_user_id, auth_user_id").all(),
      audits: w.sqlite
        .prepare(
          "SELECT table_name, target_id, operation, before_json, after_json, changed_keys_json, actor_user_id, actor_x_user_id, actor_snapshot_json, reason, retention_class FROM audit_logs ORDER BY rowid",
        )
        .all(),
      queue: w.sqlite
        .prepare("SELECT target_type, target_id, reason, priority, status, requested_by_user_id FROM static_rebuild_queue ORDER BY target_type, target_id")
        .all(),
      r2Keys: [...w.bucket.objects.keys()].sort(),
    };
  }

  async function runCurrent(w, userId, action, formEntries) {
    const row = w.sqlite.prepare("SELECT id, name, role, active_x_user_id FROM user WHERE id = ?").get(userId);
    const wakes = [];
    globalThis.__wakeEnv = () => ({
      [QUEUE_FEATURE_FLAG_NAMES.dispatch]: "1",
      [QUEUE_BINDING_NAMES.notificationWake]: { send: async (payload) => wakes.push(payload) },
      [QUEUE_BINDING_NAMES.staticRebuildWake]: { send: async (payload) => wakes.push(payload) },
    });
    globalThis.__xidBucket = w.bucket;
    globalThis.__xidGuard = async (opts) => {
      assert.equal(opts.feature, "xid_links");
      return {
        ok: true,
        db: drizzle(w.d1),
        user: { id: row.id, name: row.name, role: row.role, active_x_user_id: row.active_x_user_id },
        activeXId: row.active_x_user_id,
        approvedXIds: [],
        hasPendingXRequest: false,
      };
    };
    const form = new FormData();
    for (const [k, v] of formEntries) form.set(k, v);
    const result = await quiet(() => action(form));
    return { result: JSON.parse(JSON.stringify(result)), wakes: wakes.length };
  }

  async function runHono(w, userId, method, path, body, { multipart = false } = {}) {
    const headers = {
      Origin: SITE,
      Cookie: `__Secure-authjs.session-token=tok_${userId}`,
    };
    let reqBody;
    if (multipart) {
      const form = new FormData();
      for (const [k, v] of body) form.set(k, v);
      reqBody = form;
    } else {
      headers["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
    const res = await mountedApp.request(
      SITE + path,
      { method, headers, body: reqBody },
      { DB: w.d1, BUCKET: w.bucket, NEXT_PUBLIC_SITE_URL: SITE },
    );
    const json = await res.json();
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(XIdWriteResultSchema.safeParse(json).success, true);
    return { status: res.status, result: json };
  }


  test("SEC-726: SA-098 valid 128-codepoint legacy IDs survive the next Auth.js session", async () => {
    const { resolveSessionUser } = await import("../src/auth/session.ts");
    for (const [label, id] of [
      ["Japanese128", "あ".repeat(128)],
      ["Emoji128", "🌀".repeat(128)],
    ]) {
      const w = world();
      insert(w.sqlite, "x_users", { id, x_name: label, approval_status: "approved" });
      insert(w.sqlite, "x_user_account_links", {
        x_user_id: id, auth_user_id: "u_multi", link_role: "manager",
      });
      const beforeReads = w.d1.stats.reads;
      const beforeBatches = w.d1.stats.batches;
      const thaw = freeze(800);
      let response;
      try {
        response = await runHono(w, "u_multi", "POST", "/api/xid/active", { x_user_id: id });
      } finally {
        thaw();
      }
      assert.equal(response.status, 200, label);
      assert.equal(response.result.ok, true, label);
      assert.equal(w.d1.stats.reads - beforeReads, 3, "S3 auth + selected identity + guard");
      assert.equal(w.d1.stats.batches - beforeBatches, 1, "one atomic user+audit batch");
      assert.equal(w.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id = ?')
        .get("u_multi").active_x_user_id, id, label);
      const session = await resolveSessionUser(w.d1, "tok_u_multi", { now: 1_800_000_000_000 });
      assert.equal(session?.active_x_user_id, id, "next valid cookie sees the selected Unicode identity");
      assert.equal(w.bucket.ops.puts.length + w.bucket.ops.deletes.length, 0);
    }
  });

  test("SEC-726: oversized, embedded-NUL and normalized-invalid selected X IDs fail before mutation", async () => {
    for (const [label, id] of [
      ["ASCII129", "x".repeat(129)],
      ["Japanese129", "あ".repeat(129)],
      ["Emoji129", "🌀".repeat(129)],
      ["LeadingNul", "\0" + "x".repeat(20)],
      ["EmbeddedNul", "valid\0invalid"],
      ["UnpairedSurrogateAndOverCap", "x".repeat(129) + "\uD800"],
    ]) {
      const w = world();
      insert(w.sqlite, "x_users", { id, x_name: label, approval_status: "approved" });
      insert(w.sqlite, "x_user_account_links", {
        x_user_id: id, auth_user_id: "u_multi", link_role: "owner",
      });
      const before = snapshot(w);
      const beforeBatches = w.d1.stats.batches;
      const response = await runHono(w, "u_multi", "POST", "/api/xid/active", { x_user_id: id });
      assert.equal(response.status, 403, label);
      assert.equal(response.result.ok, false, label);
      assert.equal(w.d1.stats.batches - beforeBatches, 0, "zero mutation/audit batches: " + label);
      assert.deepEqual(snapshot(w), before, "preserve linked identity, audit and queues: " + label);
    }
  });

  test("SEC-726: a short approved alias to an oversized target is bounded in the SQL D1 row", async () => {
    const w = world();
    const unsafe = "🌀".repeat(129);
    insert(w.sqlite, "x_users", { id: unsafe, x_name: "Legacy", approval_status: "approved" });
    insert(w.sqlite, "x_user_account_links", {
      x_user_id: unsafe, auth_user_id: "u_multi", link_role: "manager",
    });
    insert(w.sqlite, "x_user_aliases", { alias_x_id: "safe_short_alias", x_user_id: unsafe });
    let boundedRead = 0;
    const prepare = w.d1.prepare.bind(w.d1);
    w.d1.prepare = (sql) => {
      const stmt = prepare(sql);
      if (!sql.includes("AS resolved_x_user_id")) return stmt;
      assert.match(sql, /bounded_resolved AS/);
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...values) => {
        const bound = bind(...values);
        const first = bound.first.bind(bound);
        bound.first = async () => {
          const row = await first();
          boundedRead++;
          assert.equal(row?.resolved_x_user_id, null,
            "D1 must not project an oversized alias target to JS");
          assert.equal(row?.linked_approval_status, null,
            "unsafe target cannot be authorized through its short alias");
          assert.ok(Buffer.byteLength(JSON.stringify(row)) < 64 * 1024);
          assert.ok(!JSON.stringify(row).includes(unsafe));
          return row;
        };
        return bound;
      };
      return stmt;
    };
    const before = snapshot(w);
    const beforeBatches = w.d1.stats.batches;
    const response = await runHono(w, "u_multi", "POST", "/api/xid/active", {
      x_user_id: "safe_short_alias",
    });
    assert.equal(boundedRead, 1, "exactly one inspected identity SELECT");
    assert.equal(response.status, 403);
    assert.equal(w.d1.stats.batches - beforeBatches, 0);
    assert.deepEqual(snapshot(w), before, "no user, audit, queue or X-link mutation");
  });

  test("SEC-726: valid short alias remains authorized; TOS and origin failures do not mutate", async () => {
    const valid = "🌀".repeat(128);
    const w = world();
    insert(w.sqlite, "x_users", { id: valid, x_name: "Legacy valid", approval_status: "approved" });
    insert(w.sqlite, "x_user_account_links", {
      x_user_id: valid, auth_user_id: "u_multi", link_role: "manager",
    });
    insert(w.sqlite, "x_user_aliases", { alias_x_id: "legacy_alias", x_user_id: valid });

    const before = snapshot(w);
    w.sqlite.prepare('UPDATE "user" SET is_tos_accepted = 0 WHERE id = ?').run("u_multi");
    const noTos = snapshot(w);
    const deniedTos = await runHono(w, "u_multi", "POST", "/api/xid/active", { x_user_id: "legacy_alias" });
    assert.equal(deniedTos.result.ok, false);
    assert.deepEqual(snapshot(w), noTos, "ToS denial must not mutate");
    w.sqlite.prepare('UPDATE "user" SET is_tos_accepted = 1 WHERE id = ?').run("u_multi");
    assert.deepEqual(snapshot(w), before);

    // A valid alias must not bypass the existing CostGuard release gate.
    w.sqlite.prepare("UPDATE system_settings SET operation_mode = ? WHERE id = 'default'")
      .run("maintenance");
    const deniedCost = await runHono(w, "u_multi", "POST", "/api/xid/active", {
      x_user_id: "legacy_alias",
    });
    assert.equal(deniedCost.status, 503, "maintenance mode must block SA-098");
    assert.equal(deniedCost.result.ok, false);
    assert.deepEqual(snapshot(w), before, "CostGuard denial has no user/audit/queue mutation");
    w.sqlite.prepare("UPDATE system_settings SET operation_mode = ? WHERE id = 'default'")
      .run("normal");

    const crossOrigin = await mountedApp.request(
      SITE + "/api/xid/active",
      { method: "POST", headers: {
        Origin: "https://attacker.example",
        Cookie: "__Secure-authjs.session-token=tok_u_multi",
        "Content-Type": "application/json",
      }, body: JSON.stringify({ x_user_id: "legacy_alias" }) },
      { DB: w.d1, BUCKET: w.bucket, NEXT_PUBLIC_SITE_URL: SITE },
    );
    assert.equal(crossOrigin.status, 403);
    assert.deepEqual(snapshot(w), before, "origin denial must not mutate");

    const batchBefore = w.d1.stats.batches;
    const thaw = freeze(1000);
    let result;
    try {
      result = await runHono(w, "u_multi", "POST", "/api/xid/active", { x_user_id: "legacy_alias" });
    } finally {
      thaw();
    }
    assert.equal(result.status, 200, "valid alias preserves CURRENT linked approval");
    assert.equal(w.d1.stats.batches - batchBefore, 1);
    assert.equal(w.sqlite.prepare('SELECT active_x_user_id FROM "user" WHERE id = ?')
      .get("u_multi").active_x_user_id, valid);
  });

  test("SA-098, SA-102..105 full differential parity vs CURRENT on real migrated schema (3 D1 pre-reads + 1 batch)", async () => {
    const a = world();
    const b = world();

    // 1. SA-098: u_multi switches active X from x_m1 to x_free
    {
      const readsBefore = b.d1.stats.reads;
      const batchesBefore = b.d1.stats.batches;
      const t1 = freeze(0);
      const cur = await runCurrent(a, "u_multi", current.setActiveXId, [["x_user_id", "x_free"]]);
      t1();
      const t2 = freeze(0);
      const hon = await runHono(b, "u_multi", "POST", "/api/xid/active", { x_user_id: "x_free" });
      t2();
      assert.equal(hon.status, 200);
      assert.deepEqual(hon.result, cur.result);
      assert.deepEqual(snapshot(b), snapshot(a));
      assert.equal(b.d1.stats.reads - readsBefore, 3, "SA-098 real session uses 3 D1 pre-reads");
      assert.equal(b.d1.stats.batches - batchesBefore, 1, "SA-098 uses 1 atomic batch");
    }

    // 2. SA-102: u_owner updates x_owner profile (DOCUMENTED DIFFERENCE D-0603-1: wake 0 vs CURRENT 1)
    {
      const readsBefore = b.d1.stats.reads;
      const batchesBefore = b.d1.stats.batches;
      const payload = {
        x_user_id: "x_owner",
        x_name: "Updated Owner",
        profile_text: "Motion creator",
        portfolio_contact: "dm@example.com",
        youtube_channel_url: "https://www.youtube.com/@owner",
        other_social_links: JSON.stringify([{ type: "X", url: "https://x.com/x_owner" }]),
      };
      const t1 = freeze(10);
      const cur = await runCurrent(a, "u_owner", current.updateXIdProfile, Object.entries(payload));
      t1();
      const t2 = freeze(10);
      const hon = await runHono(b, "u_owner", "PATCH", "/api/xid/x_owner/profile", payload);
      t2();
      assert.equal(hon.status, 200);
      assert.deepEqual(hon.result, cur.result);
      assert.deepEqual(snapshot(b), snapshot(a));
      assert.equal(cur.wakes, 1, "DOCUMENTED DIFFERENCE D-0603-1: CURRENT wakes static rebuild");
      assert.equal(b.d1.stats.reads - readsBefore, 3, "SA-102 real session uses 3 D1 pre-reads");
      assert.equal(b.d1.stats.batches - batchesBefore, 1);
    }

    // 3. SA-104: u_owner selects public video icon & deletes unreferenced old R2 icon post-commit
    {
      const readsBefore = b.d1.stats.reads;
      const batchesBefore = b.d1.stats.batches;
      const t1 = freeze(20);
      const cur = await runCurrent(a, "u_owner", current.setXIdIcon, [
        ["x_user_id", "x_owner"],
        ["icon_url", "https://cdn.example/pub-icon.png"],
      ]);
      t1();
      const t2 = freeze(20);
      const hon = await runHono(b, "u_owner", "PUT", "/api/xid/x_owner/icon", {
        x_user_id: "x_owner",
        icon_url: "https://cdn.example/pub-icon.png",
      });
      t2();
      assert.equal(hon.status, 200);
      assert.deepEqual(hon.result, cur.result);
      assert.deepEqual(snapshot(b), snapshot(a));
      assert.equal(cur.wakes, 1, "DOCUMENTED DIFFERENCE D-0603-1: CURRENT wakes static rebuild");
      // 3 pre-reads + 1 post-commit orphan cleanup reference check = 4 total reads (3 pre-reads before batch).
      assert.equal(b.d1.stats.reads - readsBefore, 4, "SA-104: 3 pre-reads + 1 post-commit orphan check");
      assert.equal(b.d1.stats.batches - batchesBefore, 1);
      assert.equal(b.bucket.objects.has("xicons/x_owner/old.png"), false);
    }

    // 4. SA-105: u_owner uploads PNG icon (staging + final R2, strict audit, rebuild queue, staging cleanup)
    {
      const readsBefore = b.d1.stats.reads;
      const batchesBefore = b.d1.stats.batches;
      const pngBytes = buildPng();
      const fileA = new File([pngBytes], "icon.png", { type: "image/png" });
      const fileB = new File([pngBytes], "icon.png", { type: "image/png" });
      const t1 = freeze(30);
      const cur = await runCurrent(a, "u_owner", current.uploadXIdIcon, [
        ["x_user_id", "x_owner"],
        ["icon_file", fileA],
      ]);
      t1();
      // CURRENT allocates one traceId UUID before generateId("xicon").
      const t2 = freeze(31);
      const hon = await runHono(
        b,
        "u_owner",
        "POST",
        "/api/xid/x_owner/icon/upload",
        [
          ["x_user_id", "x_owner"],
          ["icon_file", fileB],
        ],
        { multipart: true },
      );
      t2();
      assert.equal(hon.status, 200);
      assert.deepEqual(hon.result, cur.result);
      assert.deepEqual(snapshot(b), snapshot(a));
      assert.equal(cur.wakes, 1, "DOCUMENTED DIFFERENCE D-0603-1: CURRENT wakes static rebuild");
      // Old icon is https://cdn.example/pub-icon.png (not /api/media/), so post-commit cleanup skips D1 check -> 3 reads total!
      assert.equal(b.d1.stats.reads - readsBefore, 3, "SA-105 real session uses 3 D1 pre-reads");
      assert.equal(b.d1.stats.batches - batchesBefore, 1);
    }

    // 5. SA-103: u_multi unlinks active x_free -> resets active_x_user_id and writes 2 strict audits
    {
      const readsBefore = b.d1.stats.reads;
      const batchesBefore = b.d1.stats.batches;
      const t1 = freeze(40);
      const cur = await runCurrent(a, "u_multi", current.deleteLinkedXId, [
        ["x_user_id", "x_free"],
        ["confirm", "DELETE x_free"],
      ]);
      t1();
      const t2 = freeze(40);
      const hon = await runHono(b, "u_multi", "DELETE", "/api/xid/x_free", {
        x_user_id: "x_free",
        confirm: "DELETE x_free",
      });
      t2();
      assert.equal(hon.status, 200);
      assert.deepEqual(hon.result, cur.result);
      assert.deepEqual(snapshot(b), snapshot(a));
      assert.equal(b.d1.stats.reads - readsBefore, 3, "SA-103 real session uses 3 D1 pre-reads");
      assert.equal(b.d1.stats.batches - batchesBefore, 1);
    }

    // 6. SA-103 blocker parity: u_owner cannot unlink x_owner when event owner/video dependency exists
    {
      insert(a.sqlite, "event_staff", {
        id: "es_own",
        event_id: "ev1",
        x_user_id: "x_owner",
        display_name: "Owner",
        permission_preset: "owner",
        created_at: 1_800_000_000,
        updated_at: 1_800_000_000,
      });
      insert(b.sqlite, "event_staff", {
        id: "es_own",
        event_id: "ev1",
        x_user_id: "x_owner",
        display_name: "Owner",
        permission_preset: "owner",
        created_at: 1_800_000_000,
        updated_at: 1_800_000_000,
      });
      const cur = await runCurrent(a, "u_owner", current.deleteLinkedXId, [
        ["x_user_id", "x_owner"],
        ["confirm", "DELETE x_owner"],
      ]);
      const hon = await runHono(b, "u_owner", "DELETE", "/api/xid/x_owner", {
        x_user_id: "x_owner",
        confirm: "DELETE x_owner",
      });
      assert.equal(hon.status, 409);
      assert.deepEqual(hon.result, cur.result);
      assert.deepEqual(snapshot(b), snapshot(a));
    }

    // 7. SA-102, SA-104, SA-105 canonical-alias collision parity: both CURRENT and Hono fail closed (403)
    {
      insert(a.sqlite, "x_user_aliases", { x_user_id: "x_other", alias_x_id: "x_owner" });
      insert(b.sqlite, "x_user_aliases", { x_user_id: "x_other", alias_x_id: "x_owner" });

      const curProfile = await runCurrent(a, "u_owner", current.updateXIdProfile, [
        ["x_user_id", "x_owner"],
        ["x_name", "Hijacked"],
      ]);
      const honProfile = await runHono(b, "u_owner", "PATCH", "/api/xid/x_owner/profile", {
        x_user_id: "x_owner",
        x_name: "Hijacked",
      });
      assert.equal(honProfile.status, 403);
      assert.deepEqual(honProfile.result, curProfile.result);

      const curIcon = await runCurrent(a, "u_owner", current.setXIdIcon, [
        ["x_user_id", "x_owner"],
        ["icon_url", "https://cdn.example/pub-icon.png"],
      ]);
      const honIcon = await runHono(b, "u_owner", "PUT", "/api/xid/x_owner/icon", {
        x_user_id: "x_owner",
        icon_url: "https://cdn.example/pub-icon.png",
      });
      assert.equal(honIcon.status, 403);
      assert.deepEqual(honIcon.result, curIcon.result);

      const pngBytes = buildPng();
      const curUpload = await runCurrent(a, "u_owner", current.uploadXIdIcon, [
        ["x_user_id", "x_owner"],
        ["icon_file", new File([pngBytes], "icon.png", { type: "image/png" })],
      ]);
      const honUpload = await runHono(
        b,
        "u_owner",
        "POST",
        "/api/xid/x_owner/icon/upload",
        [
          ["x_user_id", "x_owner"],
          ["icon_file", new File([pngBytes], "icon.png", { type: "image/png" })],
        ],
        { multipart: true },
      );
      assert.equal(honUpload.status, 403);
      assert.deepEqual(honUpload.result, curUpload.result);
      assert.deepEqual(snapshot(b), snapshot(a));
    }
  });
} else {
  test("xidWrite parity (tsx child process)", () => {});
}
