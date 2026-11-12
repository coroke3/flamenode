import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createVideoCollaboratorRoutes } from "../src/routes/videos/collaborators.ts";

const videoId = "v1";
const route = "/v1/collaborators";
const jsonHeaders = { "content-type": "application/json" };
const canonicalBatch = {
  video_id: videoId,
  intents: [{ x_user_id: "@alice", display_name: "Alice", intent: "on" }],
};

function fixture({ guardState = true } = {}) {
  let guarded = 0;
  let wakeCalls = 0;
  let prematureReads = 0;
  const host = {
    writeGuard: async (c, next) => {
      guarded++;
      c.header("Cache-Control", "private, no-store");
      if (guardState) {
        c.set("user", { id: "actor", role: null });
        if (guardState !== "missingPreload") {
          c.set("auditSettings", {});
          c.set("actorSnapshotJsonById", { actor: "{}" });
        }
        c.set("db", new Proxy({}, {
          get() {
            prematureReads++;
            throw Error("unexpected D1 read");
          },
        }));
      }
      await next();
    },
    loadWakeHost: async () => {
      wakeCalls++;
      throw Error("Queue port must not be reached before a valid atomic write");
    },
  };
  const app = createVideoCollaboratorRoutes(host);
  async function request(method, path, body) {
    return app.request(path, {
      method,
      headers: jsonHeaders,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }, { NEXT_PUBLIC_SITE_URL: "https://example.test" });
  }
  return {
    request,
    stats: () => ({ guarded, wakeCalls, prematureReads }),
  };
}

test("MIG-0650 candidate is explicitly unmounted in the active videos router", async () => {
  const source = await readFile(
    new URL("../src/routes/videos/index.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /collaborators\.ts/);
  assert.doesNotMatch(source, /createVideoCollaboratorRoutes/);
});

test("SA-082 invalid upsert is rejected before D1 or Queue wake", async () => {
  const f = fixture();
  const res = await f.request("POST", route, {
    video_id: videoId, x_user_id: "http://evil.invalid/",
    display_name: "Invalid", can_edit: "1",
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal((await res.json()).ok, false);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("SA-082 path and submitted video IDs must match", async () => {
  const f = fixture();
  const res = await f.request("POST", route, {
    video_id: "other-video", x_user_id: "@alice", display_name: "Alice",
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /video_id/);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("SA-083 delete rejects oversized video ID before D1", async () => {
  const f = fixture();
  const res = await f.request("DELETE", "/" + "v".repeat(65) + "/collaborators", {
    x_user_id: "alice",
  });
  assert.equal(res.status, 400);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("SA-083 delete rejects missing or malformed X identities before D1", async () => {
  const f = fixture();
  for (const bad of [{}, { x_user_id: "../admin" }, { x_user_id: "a".repeat(33) }]) {
    const res = await f.request("DELETE", route, bad);
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /X ID/);
  }
  assert.deepEqual(f.stats(), { guarded: 3, wakeCalls: 0, prematureReads: 0 });
});

test("SA-084 rejects empty, 101-row and malformed batches before D1", async () => {
  const f = fixture();
  for (const intents of [
    [],
    Array.from({ length: 101 }, (_, i) => ({
      x_user_id: "user" + i, display_name: "User", intent: "on",
    })),
    [{ x_user_id: "admin/evil", display_name: "Admin", intent: "on" }],
  ]) {
    const res = await f.request("POST", route + "/batch", { video_id: videoId, intents });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
  assert.deepEqual(f.stats(), { guarded: 3, wakeCalls: 0, prematureReads: 0 });
});

test("SA-084 rejects mismatching video ID before authorization DB query", async () => {
  const f = fixture();
  const res = await f.request("POST", route + "/batch", {
    ...canonicalBatch, video_id: "other",
  });
  assert.equal(res.status, 400);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});

test("all endpoints limit body bytes even without Content-Length honesty", async () => {
  const f = fixture();
  const huge = JSON.stringify({ video_id: videoId, extra: "x".repeat(66000) });
  for (const [method, path] of [
    ["POST", route], ["DELETE", route], ["POST", route + "/batch"],
  ]) {
    const res = await f.request(method, path, huge);
    assert.equal(res.status, 413);
    assert.match((await res.json()).message, /大きすぎ/);
  }
  assert.deepEqual(f.stats(), { guarded: 3, wakeCalls: 0, prematureReads: 0 });
});

test("valid batch with missing authenticated guard context fails closed", async () => {
  const f = fixture({ guardState: false });
  const res = await f.request("POST", route + "/batch", canonicalBatch);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, false);
  assert.deepEqual(f.stats(), { guarded: 1, wakeCalls: 0, prematureReads: 0 });
});


// Candidate integration is still unmounted, but exercise the real production
// origin/session/CostGuard/Drizzle stack against a local transactional D1 shim.
import { Hono } from "hono";
import { dbMiddleware } from "../src/middleware/db.ts";
import { costGuardMiddleware } from "../src/middleware/costGuard.ts";
import { originGuardMiddleware, writeGuardMiddleware } from "../src/middleware/writeOrigin.ts";
import { createSqlite } from "./support/personalHarness.mjs";
import { atomicD1, seedChapterWorld, SESSION_USER, SITE } from "./support/chapterSeed.mjs";

function integration({ as = "u_admin", mode = "normal" } = {}) {
  const sqlite = createSqlite();
  seedChapterWorld(sqlite);
  sqlite.prepare("UPDATE system_settings SET operation_mode = ? WHERE id = 'default'").run(mode);
  const d1 = atomicD1(sqlite);
  const actor = as ? SESSION_USER(as, as === "u_admin" ? "admin" : "user", "x_admin") : null;
  let wakeLoadCount = 0;
  const originOptions = (c) => ({
    loadSiteUrl: () => c.env.NEXT_PUBLIC_SITE_URL,
    allowLocalPreview: () => false,
  });
  const session = async (c, next) => {
    c.set("user", actor);
    c.set("sessionState", actor ? "user" : "none");
    await next();
  };
  const stack = [
    (c, next) => originGuardMiddleware(originOptions(c))(c, next),
    session,
    (c, next) => writeGuardMiddleware({
      ...originOptions(c), requiredRole: null,
    })(c, next),
    costGuardMiddleware("edit_video"),
    dbMiddleware,
  ];
  const writeGuard = async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const run = async (index) => {
      if (index === stack.length) return next();
      let inner;
      const own = await stack[index](c, async () => {
        inner = await run(index + 1);
      });
      return own ?? inner;
    };
    return run(0);
  };
  const host = {
    writeGuard,
    loadWakeHost: async () => {
      wakeLoadCount++;
      return {
        readEnv: () => ({ QUEUE_DISPATCH_ENABLED: "0" }),
        readWaitUntil: () => null,
        readKv: () => null,
      };
    },
  };
  const app = new Hono();
  app.route("/api/videos", createVideoCollaboratorRoutes(host));
  const send = (method, path, data, headers = { Origin: SITE }) =>
    app.request(path, {
      method, headers: { "content-type": "application/json", ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    }, { DB: d1, NEXT_PUBLIC_SITE_URL: SITE });
  const count = (table) => sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n;
  return { sqlite, d1, send, count, wakeLoads: () => wakeLoadCount };
}

test("SA-084 authenticated middleware + real SQLite D1: permission, strict audit and rebuild queue commit together", async () => {
  const s = integration();
  try {
    const input = {
      video_id: "v_pub", edit_privilege_mode: "admin", notify: false,
      intents: [{ x_user_id: "x_other", display_name: "Other", intent: "on" }],
    };
    const res = await s.send("POST", "/api/videos/v_pub/collaborators/batch", input);
    assert.equal(res.status, 200, await res.clone().text());
    const result = await res.json();
    assert.equal(result.ok, true);
    assert.equal(result.granted.length, 1);
    const rows = s.sqlite.prepare("SELECT can_edit,is_public_member FROM video_members WHERE video_id='v_pub' AND x_user_id='x_other'").all();
    assert.deepEqual(rows.map(x => [x.can_edit, x.is_public_member]), [[1, 0]]);
    assert.equal(s.count("audit_logs"), 1);
    assert.equal(s.sqlite.prepare("SELECT table_name FROM audit_logs LIMIT 1").get().table_name, "video_member_permissions_batch");
    assert.ok(s.count("static_rebuild_queue") >= 1);
    assert.equal(s.d1.stats.batches, 1, "DML + audit + rebuild are a single atomic D1 batch");
    assert.equal(s.wakeLoads(), 1, "load wake host only AFTER the atomic commit");
  } finally {
    s.sqlite.close();
  }
});

test("SA-084 production origin guard rejects cross-site request before any D1 read", async () => {
  const s = integration();
  try {
    const res = await s.send("POST", "/api/videos/v_pub/collaborators/batch", {
      video_id: "v_pub", edit_privilege_mode: "admin", intents: canonicalBatch.intents,
    }, { Origin: "https://evil.example" });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, "invalid_origin");
    assert.equal(s.d1.stats.reads, 0);
    assert.equal(s.count("audit_logs"), 0);
    assert.equal(s.wakeLoads(), 0);
  } finally {
    s.sqlite.close();
  }
});

test("SA-084 production write stack rejects anonymous and maintenance requests", async () => {
  for (const cfg of [{ as: null, expected: 401 }, { mode: "maintenance", expected: 503 }]) {
    const s = integration(cfg);
    try {
      const res = await s.send("POST", "/api/videos/v_pub/collaborators/batch", {
        video_id: "v_pub", edit_privilege_mode: "admin", intents: canonicalBatch.intents,
      });
      assert.equal(res.status, cfg.expected, await res.clone().text());
      assert.equal(s.count("audit_logs"), 0);
      assert.equal(s.count("video_members"), 0);
      assert.equal(s.wakeLoads(), 0);
    } finally {
      s.sqlite.close();
    }
  }
});


test("SA-082/083 fail closed before any D1 access when guard omitted CostGuard/audit preloads", async () => {
  const f = fixture({ guardState: "missingPreload" });
  const requests = [
    ["POST", route, {
      video_id: videoId, x_user_id: "@alice", display_name: "Alice", can_edit: "1",
    }],
    ["DELETE", route, { video_id: videoId, x_user_id: "@alice" }],
  ];
  for (const [method, path, body] of requests) {
    const res = await f.request(method, path, body);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).ok, false);
  }
  assert.deepEqual(f.stats(), { guarded: 2, wakeCalls: 0, prematureReads: 0 });
});

test("SA-084 candidate maps a shared preflight limit rejection to a non-success HTTP status", async () => {
  const src = await readFile(new URL("../src/routes/videos/collaborators.ts", import.meta.url), "utf8");
  assert.match(src, /preparation\.result\.ok \? 200 : 400/);
});
