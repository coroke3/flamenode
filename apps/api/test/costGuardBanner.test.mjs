import test from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.ts";
import { CostGuardBannerResponseSchema } from "@flamenode/contracts";
import { readOperationModeKvMirror, resetOperationModeCachesForTests, resolvePublicOperationMode } from "../src/routes/live/operationMode.ts";
import { cookie, createD1, createSqlite } from "./support/personalHarness.mjs";
import { seed as seedAdminRead } from "./support/adminReadSeed.mjs";

function unavailableD1(calls) {
  return { prepare: () => {
    calls.count += 1;
    throw new Error("public CostGuardBanner must never touch D1");
  } };
}

function kvResponse(raw, count) {
  return { get: async (key, options) => {
    count.count += 1;
    assert.equal(key, "operation_mode:mirror");
    assert.deepEqual(options, { cacheTtl: 30 });
    return raw;
  } };
}

async function requestWith(env) {
  const response = await app.request("/api/operation-mode/banner", { method: "GET" }, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  return CostGuardBannerResponseSchema.parse(await response.json());
}

test("MIG-0661 T01: public economy mirror returns mode + reason without session or D1", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const data = await requestWith({
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({ mode: "economy", updated_at: 1, reason: "maintenance notice" }), kv),
  });
  assert.deepEqual(data, { mode: "economy", reason: "maintenance notice" });
  assert.equal(d1.count, 0);
  assert.equal(kv.count, 1); // CURRENT caches the mirror for mode and reason
});

test("MIG-0661 T02: missing/invalid mirror is normal, no D1 fallback", async () => {
  for (const raw of [null, "{broken-json", JSON.stringify({ mode: "economy", updated_at: "bad", reason: "x" })]) {
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    assert.deepEqual(await requestWith({ DB: unavailableD1(d1), KV: kvResponse(raw, kv) }),
      { mode: "normal", reason: null });
    assert.equal(d1.count, 0);
    assert.equal(kv.count, 1);
  }
});

test("MIG-0661 T02: FORCE_STATIC_ONLY dominates KV mode and retains mirror reason", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    FORCE_STATIC_ONLY: "1",
    KV: kvResponse(JSON.stringify({ mode: "read_only", updated_at: 1, reason: "limited access" }), kv),
  }), { mode: "static_only", reason: "limited access" });
  assert.equal(d1.count, 0);
  assert.equal(kv.count, 1); // forced mode skips the initial mode lookup
});

test("MIG-0661 T02: KV read errors do not fail the public endpoint or reach D1", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    KV: { get: async () => { throw new Error("KV offline"); } },
  }), { mode: "normal", reason: null });
  assert.equal(d1.count, 0);
});

test("MIG-0661 T07: throwing KV binding getter fails soft without D1 or leaked error", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 };
  let getters = 0;
  const env = {
    DB: unavailableD1(d1),
    get KV() {
      getters += 1;
      throw new Error("private KV binding error must never leak");
    },
  };
  assert.deepEqual(await requestWith(env), { mode: "normal", reason: null });
  assert.equal(getters, 1, "one KV getter attempt, no retry or extra reads");
  assert.equal(d1.count, 0);
});

test("MIG-0661 T07: forced static-only survives throwing KV getter for optional reason", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 };
  let getters = 0;
  const env = {
    DB: unavailableD1(d1),
    FORCE_STATIC_ONLY: "1",
    get KV() {
      getters += 1;
      throw new Error("private KV binding error must never leak");
    },
  };
  assert.deepEqual(await requestWith(env), { mode: "static_only", reason: null });
  assert.equal(getters, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: invalid mirror reason is null while its mode remains valid", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({ mode: "read_only", updated_at: 1, reason: 22 }), kv),
  }), { mode: "read_only", reason: null });
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: two public banner reads share the bounded mirror cache", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const env = {
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({
      mode: "economy", updated_at: 1, reason: "cached reason",
    }), kv),
  };
  assert.deepEqual(await requestWith(env), { mode: "economy", reason: "cached reason" });
  assert.deepEqual(await requestWith(env), { mode: "economy", reason: "cached reason" });
  assert.equal(kv.count, 1, "warm public traffic must not read KV on each request");
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: cache prevents inconsistent reason when KV changes mid-request", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 };
  let reads = 0;
  const env = {
    DB: unavailableD1(d1),
    KV: { get: async () => {
      reads += 1;
      return reads === 1
        ? JSON.stringify({ mode: "read_only", updated_at: 1, reason: "original" })
        : JSON.stringify({ mode: "normal", updated_at: 2, reason: "later" });
    } },
  };
  assert.deepEqual(await requestWith(env), { mode: "read_only", reason: "original" });
  assert.equal(reads, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T02: forced static-only mode still reads at most one mirror", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const env = {
    DB: unavailableD1(d1),
    FORCE_STATIC_ONLY: "true",
    KV: kvResponse(JSON.stringify({
      mode: "normal", updated_at: 1, reason: "operator note",
    }), kv),
  };
  assert.deepEqual(await requestWith(env), { mode: "static_only", reason: "operator note" });
  assert.deepEqual(await requestWith(env), { mode: "static_only", reason: "operator note" });
  assert.equal(kv.count, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T08: simultaneous cold reads share one KV request and cache the result", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, reads = { count: 0 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const raw = JSON.stringify({ mode: "read_only", updated_at: 1, reason: "one snapshot" });
  const kv = { get: async (key, options) => {
    reads.count += 1;
    assert.equal(key, "operation_mode:mirror");
    assert.deepEqual(options, { cacheTtl: 30 });
    await gate;
    return raw;
  } };
  const first = readOperationModeKvMirror(kv);
  const second = readOperationModeKvMirror(kv);
  try {
    assert.equal(reads.count, 1, "concurrent misses must not duplicate the KV GET");
  } finally {
    release();
  }
  assert.deepEqual(await first, { mode: "read_only", updated_at: 1, reason: "one snapshot" });
  assert.deepEqual(await second, { mode: "read_only", updated_at: 1, reason: "one snapshot" });
  assert.deepEqual(await requestWith({ DB: unavailableD1(d1), KV: kv }),
    { mode: "read_only", reason: "one snapshot" });
  assert.equal(reads.count, 1, "subsequent banner reads use the populated cache");
  assert.equal(d1.count, 0);
});

test("MIG-0661 T08: concurrent KV errors share a failure and retain short error cache", async () => {
  resetOperationModeCachesForTests();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const kv = { get: async () => {
    reads += 1;
    await gate;
    throw new Error("private KV driver failure");
  } };
  const first = readOperationModeKvMirror(kv);
  const second = readOperationModeKvMirror(kv);
  try {
    assert.equal(reads, 1, "a failing KV read must also be single-flight");
  } finally {
    release();
  }
  assert.equal(await first, null);
  assert.equal(await second, null);
  assert.equal(await readOperationModeKvMirror(kv), null);
  assert.equal(reads, 1, "cached error must not cause an immediate retry");
});

test("MIG-0661 T03: admin banner mirrors CURRENT D1 mode/reason with a single bounded read", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    sqlite.prepare("UPDATE system_settings SET operation_mode = ?, cost_guard_reason = ? WHERE id = 'default'")
      .run("read_only", "temporary freeze");
    const db = createD1(sqlite);
    const response = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: db },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { mode: "read_only", reason: "temporary freeze" });
    assert.equal(db.stats.statements, 2, "one auth session SELECT and one settings SELECT only");
    assert.equal(db.stats.writes, 0);
    assert.equal(db.stats.batches, 0);
    sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
    const missingDb = createD1(sqlite);
    const missing = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: missingDb },
    );
    assert.equal(missing.status, 200);
    assert.deepEqual(await missing.json(), { mode: "normal", reason: null });
    assert.equal(missingDb.stats.statements, 2);
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T03: admin D1 settings failure fails soft without exposing internals", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    const base = createD1(sqlite);
    let settingsQueries = 0;
    const wrapped = {
      prepare(query) {
        if (query.includes("cost_guard_reason")) {
          settingsQueries += 1;
          throw new Error("SENSITIVE-D1-DRIVER-DETAIL");
        }
        return base.prepare(query);
      },
    };
    const response = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: wrapped },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { mode: "normal", reason: null });
    assert.doesNotMatch(body, /SENSITIVE-D1/);
    assert.equal(settingsQueries, 1);
    assert.equal(base.stats.statements, 1, "authentication must still be required");
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T04: admin banner inherits guest/user/moderator/banned refusal", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    for (const [token, expected, body] of [
      [null, 401, null],
      ["tok-alice", 403, { error: "Forbidden", redirect: "/dashboard" }],
      ["tok-bob", 403, { error: "Forbidden", redirect: "/dashboard" }],
      ["tok-badmin", 403, { error: "Forbidden", message: "User is banned" }],
    ]) {
      const db = createD1(sqlite);
      const response = await app.request(
        "/api/admin-read/cost-guard-banner",
        { method: "GET", headers: token ? cookie(token) : {} },
        { DB: db },
      );
      assert.equal(response.status, expected, String(token));
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const actual = await response.json();
      if (body) assert.deepEqual(actual, body);
      assert.ok(db.stats.statements <= 1, "denied callers cannot query settings");
      assert.equal(db.stats.writes, 0);
    }
    const db = createD1(sqlite);
    const mutation = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "POST", headers: cookie("tok-root") },
      { DB: db },
    );
    assert.equal(mutation.status, 404, "admin-read endpoint is GET-only");
    assert.equal(db.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T05: shared response contract recognizes every mode and nullable reason", () => {
  for (const mode of ["normal", "economy", "read_only", "static_only", "maintenance"]) {
    assert.deepEqual(
      CostGuardBannerResponseSchema.parse({ mode, reason: null }),
      { mode, reason: null },
    );
  }
  assert.deepEqual(
    CostGuardBannerResponseSchema.parse({ mode: "maintenance", reason: "scheduled" }),
    { mode: "maintenance", reason: "scheduled" },
  );
  for (const invalid of [
    { mode: "arbitrary", reason: null },
    { mode: "normal" },
    { mode: "normal", reason: 3 },
    { mode: null, reason: null },
  ]) {
    assert.equal(CostGuardBannerResponseSchema.safeParse(invalid).success, false);
  }
});

test("MIG-0661 T05: admin success and missing-row fallback validate the same DTO", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    for (const [mode, reason] of [["maintenance", "scheduled"], ["invalid-mode", null]]) {
      sqlite.prepare("UPDATE system_settings SET operation_mode = ?, cost_guard_reason = ? WHERE id = 'default'")
        .run(mode, reason);
      const db = createD1(sqlite);
      const response = await app.request(
        "/api/admin-read/cost-guard-banner",
        { method: "GET", headers: cookie("tok-root") },
        { DB: db },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(CostGuardBannerResponseSchema.parse(await response.json()), {
        mode: mode === "invalid-mode" ? "normal" : mode,
        reason,
      });
      assert.equal(db.stats.statements, 2);
    }
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T06: public KV reason beyond accepted size is omitted, not a 500", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const oversizedReason = "X".repeat(4096);
  const body = await requestWith({
    DB: unavailableD1(d1),
    KV: kvResponse(JSON.stringify({
      mode: "maintenance", updated_at: 1, reason: oversizedReason,
    }), kv),
  });
  assert.deepEqual(body, { mode: "maintenance", reason: null });
  assert.equal(kv.count, 1);
  assert.equal(d1.count, 0);
  assert.equal(
    CostGuardBannerResponseSchema.safeParse({ mode: "maintenance", reason: oversizedReason }).success,
    false,
  );
});

test("MIG-0661 T06: oversized valid KV reason never clears the live operation mode", async () => {
  for (const mode of ["maintenance", "read_only", "static_only", "economy"]) {
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    const env = {
      DB: unavailableD1(d1),
      KV: kvResponse(JSON.stringify({
        mode, updated_at: 1, reason: "X".repeat(70 * 1024),
      }), kv),
    };
    assert.equal(await resolvePublicOperationMode(env, { allowD1: false }), mode);
    assert.deepEqual(await requestWith(env), { mode, reason: null });
    assert.equal(kv.count, 1, "live resolver and banner must share the same mirror");
    assert.equal(d1.count, 0);
  }
});

test("MIG-0661 T06: oversized malformed KV remains normal without D1", async () => {
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  assert.deepEqual(await requestWith({
    DB: unavailableD1(d1),
    KV: kvResponse('{"mode":"maintenance","updated_at":1,"reason":"' + "X".repeat(70 * 1024), kv),
  }), { mode: "normal", reason: null });
  assert.equal(kv.count, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T06: admin DB legacy oversized reason stays under S2 response budget", async () => {
  const sqlite = createSqlite();
  try {
    seedAdminRead(sqlite);
    const overlong = "X".repeat(70 * 1024);
    sqlite.prepare("UPDATE system_settings SET operation_mode = ?, cost_guard_reason = ? WHERE id = 'default'")
      .run("economy", overlong);
    const db = createD1(sqlite);
    const response = await app.request(
      "/api/admin-read/cost-guard-banner",
      { method: "GET", headers: cookie("tok-root") },
      { DB: db },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const text = await response.text();
    assert.ok(Buffer.byteLength(text, "utf8") < 64 * 1024);
    assert.deepEqual(CostGuardBannerResponseSchema.parse(JSON.parse(text)),
      { mode: "economy", reason: null });
    assert.equal(db.stats.statements, 2);
    assert.equal(db.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0661 T09: oversized mirror never JSON.parses and preserves mode (bounded scan)", async () => {
  const realParse = JSON.parse;
  for (const mode of ["maintenance", "read_only", "static_only", "economy"]) {
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    const text = JSON.stringify({ mode, reason: "Y".repeat(70 * 1024), updated_at: 1700000000000 });
    assert.ok(text.length > 64 * 1024);
    const env = { DB: unavailableD1(d1), KV: kvResponse(text, kv) };
    let bigParses = 0;
    JSON.parse = (t, ...r) => { if (typeof t === "string" && t.length > 64 * 1024) bigParses++; return realParse(t, ...r); };
    try {
      assert.equal(await resolvePublicOperationMode(env, { allowD1: false }), mode);
      assert.deepEqual(await requestWith(env), { mode, reason: null });
    } finally {
      JSON.parse = realParse;
    }
    assert.equal(bigParses, 0);
    assert.equal(kv.count, 1);
    assert.equal(d1.count, 0);
  }
});

test("MIG-0661 T09: oversized mirror with bad mode or missing updated_at stays normal", async () => {
  for (const text of [
    JSON.stringify({ mode: "bogus", reason: "Y".repeat(70 * 1024), updated_at: 1 }),
    JSON.stringify({ mode: "maintenance", reason: "Y".repeat(70 * 1024) }),
  ]) {
    resetOperationModeCachesForTests();
    const kv = { count: 0 };
    assert.deepEqual(await requestWith({ DB: unavailableD1({ count: 0 }), KV: kvResponse(text, kv) }),
      { mode: "normal", reason: null });
  }
});

test("MIG-0661 T09 / #916: oversized root properties honor nested keys, last key wins and escaped spelling", async () => {
  const large = "X".repeat(70 * 1024);
  const cases = [
    ['{"mode":"normal","updated_at":1,"reason":"' + large + '","mode":"maintenance"}', "maintenance"],
    ['{"other":{"mode":"normal"},"mode":"maintenance","updated_at":1,"reason":"' + large + '"}', "maintenance"],
    ['{"reason":"' + large + '","updated_at":1,"\\u006dode":"static_only"}', "static_only"],
    ['{"mode":"read_only","reason":"' + large + '","updated_at":3}', "read_only"],
  ];
  for (const [raw, expected] of cases) {
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    const env = { DB: unavailableD1(d1), KV: kvResponse(raw, kv) };
    assert.equal(await resolvePublicOperationMode(env, { allowD1: false }), expected);
    assert.deepEqual(await requestWith(env), { mode: expected, reason: null });
    assert.equal(kv.count, 1);
    assert.equal(d1.count, 0);
  }
});

test("MIG-0661 T09 / #916: oversized malformed or invalid last root fields fail closed", async () => {
  const large = "X".repeat(70 * 1024);
  const cases = [
    '{"mode":"maintenance","updated_at":1,"reason":"' + large + '","mode":null}',
    '{"mode":"maintenance","updated_at":1,"reason":"' + large + '","updated_at":1e999}',
    '{"mode":"maintenance","updated_at":1,"reason":"' + large + '","extra":[1,]}',
    '{"mode":"maintenance","updated_at":1,"reason":"' + large + '"}garbage',
    '{"mode":"maintenance","updated_at":1,"reason":"' + large + '","nested":{"x":1,}}',
  ];
  for (const raw of cases) {
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    assert.deepEqual(await requestWith({ DB: unavailableD1(d1), KV: kvResponse(raw, kv) }),
      { mode: "normal", reason: null });
    assert.equal(kv.count, 1);
    assert.equal(d1.count, 0);
  }
});

test("MIG-0661 T09 / #916: oversized finite exponent underflow matches JSON.parse without large JSON.parse", async () => {
  const hugeExponent = "9".repeat(150);
  const raw = '{"mode":"maintenance","updated_at":1e-' + hugeExponent
    + ',"reason":"' + "X".repeat(70 * 1024) + '"}';
  assert.equal(JSON.parse(raw).updated_at, 0);
  resetOperationModeCachesForTests();
  const d1 = { count: 0 }, kv = { count: 0 };
  const env = { DB: unavailableD1(d1), KV: kvResponse(raw, kv) };
  assert.equal(await resolvePublicOperationMode(env, { allowD1: false }), "maintenance");
  assert.deepEqual(await requestWith(env), { mode: "maintenance", reason: null });
  assert.equal(kv.count, 1);
  assert.equal(d1.count, 0);
});

test("MIG-0661 T09 / #916: UTF-8 byte ceiling with multibyte JSON preserves mode and cache", async () => {
  const limit = 64 * 1024;
  const prefix = '{"mode":"normal","updated_at":1,"reason":"bounded note","extra":"';
  const suffix = '","mode":"maintenance"}';
  const overhead = Buffer.byteLength(prefix + suffix, "utf8");
  const realParse = JSON.parse;
  for (const unit of ["\u65e5", "\u{1f680}"]) {
    const unitBytes = Buffer.byteLength(unit, "utf8");
    for (const byteSize of [limit - 1, limit, limit + 1]) {
      const padding = byteSize - overhead;
      const raw = prefix + unit.repeat(Math.floor(padding / unitBytes))
        + "x".repeat(padding % unitBytes) + suffix;
      assert.equal(Buffer.byteLength(raw, "utf8"), byteSize);
      assert.ok(raw.length < limit, "UTF-16 length alone must not choose the parse path");
      assert.equal(realParse(raw).mode, "maintenance");
      resetOperationModeCachesForTests();
      const d1 = { count: 0 }, kv = { count: 0 };
      const env = { DB: unavailableD1(d1), KV: kvResponse(raw, kv) };
      let oversizedParses = 0;
      let wholeMirrorParses = 0;
      JSON.parse = (value, ...args) => {
        if (typeof value === "string" && Buffer.byteLength(value, "utf8") > limit) oversizedParses++;
        if (value === raw) wholeMirrorParses++;
        return realParse(value, ...args);
      };
      try {
        assert.equal(await resolvePublicOperationMode(env, { allowD1: false }), "maintenance");
        assert.deepEqual(await requestWith(env), {
          mode: "maintenance",
          reason: byteSize > limit ? null : "bounded note",
        });
      } finally {
        JSON.parse = realParse;
      }
      assert.equal(oversizedParses, 0, "request-time JSON.parse input must remain within 64 KiB");
      assert.equal(wholeMirrorParses, byteSize > limit ? 0 : 1,
        "at the byte limit use the ordinary parser; above it use the bounded scanner");
      assert.equal(kv.count, 1, "the live resolver and banner share a mirror");
      assert.equal(d1.count, 0);
    }
  }
});

test("MIG-0661 T09 / #916: long whitespace and numeric tokens retain JSON grammar and mode", async () => {
  const spaces = " \t\r\n".repeat(18 * 1024);
  const digits = "9".repeat(70 * 1024);
  const prefix = '{"mode":"maintenance","updated_at":';
  const cases = [
    [prefix + spaces + '1}', 1],
    [prefix + '-1e-' + digits + '}', -0],
    [prefix + '1,"extra":[' + digits + ']}', 1],
    [prefix + '1,"extra":[0.' + digits + ']}', 1],
    [prefix + '1,"extra":[1e-' + digits + ']}', 1],
    [prefix + '1,' + spaces + '"extra":[01]}', null],
    [prefix + '1,' + spaces + '"extra":[1.]}', null],
    [prefix + '1,' + spaces + '"extra":[1e+]}', null],
    [prefix + '1,' + spaces + '\u00a0"extra":0}', null],
    [prefix + '1,' + spaces + '\u2028"extra":0}', null],
    [prefix + '1e' + digits + '}', null],
  ];
  for (const [raw, timestamp] of cases) {
    assert.ok(Buffer.byteLength(raw, "utf8") > 64 * 1024);
    if (timestamp !== null) {
      assert.ok(Object.is(JSON.parse(raw).updated_at, timestamp));
    } else {
      // The final case is valid JSON but an invalid non-finite timestamp.
      if (raw.startsWith(prefix + "1e")) assert.equal(JSON.parse(raw).updated_at, Infinity);
      else assert.throws(() => JSON.parse(raw), SyntaxError);
    }
    resetOperationModeCachesForTests();
    const d1 = { count: 0 }, kv = { count: 0 };
    const binding = kvResponse(raw, kv);
    const env = { DB: unavailableD1(d1), KV: binding };
    const expectedMode = timestamp === null ? "normal" : "maintenance";
    assert.equal(await resolvePublicOperationMode(env, { allowD1: false }), expectedMode);
    assert.deepEqual(await readOperationModeKvMirror(binding), timestamp === null
      ? null : { mode: "maintenance", updated_at: timestamp, reason: null });
    assert.deepEqual(await requestWith(env), { mode: expectedMode, reason: null });
    assert.equal(kv.count, 1);
    assert.equal(d1.count, 0);
  }
});
