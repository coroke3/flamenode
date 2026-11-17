import assert from "node:assert/strict";
import test from "node:test";
import { createSqlite, cookie } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";
import { createUnboundAdminVideoStatusCandidate, createUnboundManageVideoStatusCandidate } from "../src/routes/videos/videoStatusCandidate.ts";

const ORIGIN = "http://127.0.0.1";
const BODY = JSON.stringify({ event_id: "evA", video_id: "v1", status: "private" });

test("MIG-0603 unmounted manage candidate: guards run before parsing and never write", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted = 1');
    sqlite.exec("UPDATE system_settings SET operation_mode='normal', disabled_features_json=NULL WHERE id='default'");
    const d1 = createVideoStatusD1(sqlite);
    const candidate = createUnboundManageVideoStatusCandidate();
    async function request(name, { origin = ORIGIN, body = BODY, cookieValue, env = {} } = {}) {
      const headers = {
        "content-type": "application/json",
        ...(origin === null ? {} : { origin }),
        ...(cookieValue === null ? {} : cookieValue ? { cookie: cookieValue } : name ? cookie(`tok-${name}`) : {}),
      };
      const response = await candidate.request(ORIGIN + "/", {
        method: "POST", headers, body,
      }, {
        DB: d1,
        NEXT_PUBLIC_SITE_URL: ORIGIN,
        FLAMENODE_LOCAL_PREVIEW: "1",
        ...env,
      });
      const data = await response.json();
      assert.equal(response.headers.get("cache-control"), "private, no-store",
        "every success/failure decision is never publicly cached");
      assert.equal(d1.stats.batches, 0, "candidate must never begin an audited D1 batch");
      assert.equal(d1.stats.writes, 0, "candidate must never write D1");
      return { status: response.status, data };
    }
    const prior = d1.stats.statements;
    assert.deepEqual(await request("admin", { origin: "https://evil.example" }), {
      status: 403, data: { ok: false, reason: "invalid_origin" },
    }, "cross-site requests are rejected before session");
    assert.equal(d1.stats.statements, prior, "a rejected Origin must make zero D1 reads");
    assert.deepEqual(await request("admin", { cookieValue: null }), {
      status: 401,
      data: { ok: false, reason: "unauthenticated", message: "ログインが必要です。" },
    }, "absent cookie cannot obtain a status write");
    assert.equal(d1.stats.statements, prior, "no cookie should never start D1 resolution");

    assert.deepEqual(await request("banned"), {
      status: 403,
      data: { ok: false, reason: "banned", message: "現在、このアカウントは利用停止中です。" },
    });
    assert.deepEqual(await request("admin", { body: '{"event_id":{}' }), {
      status: 400,
      data: { ok: false, message: "入力が不正です。" },
    }, "malformed input is rejected after identity and cost checks");
    assert.deepEqual(await request("plain"), {
      status: 403,
      data: { ok: false, message: "このイベントの作品審査権限がありません。" },
    }, "submitter ownership is not event reviewer privilege");
    assert.deepEqual(await request("mgr", { body: JSON.stringify({
      event_id: "evB", video_id: "v1", status: "public",
    }) }), {
      status: 404, data: { ok: false, message: "このイベントに紐づく作品ではありません。" },
    }, "a manager of evB cannot mutate a video linked only to evA");
    for (const name of ["admin", "owner", "mgr", "rev"]) {
      assert.deepEqual(await request(name), {
        status: 503, data: { ok: false, reason: "status_candidate_unmounted" },
      }, "even authorized preflight MUST NEVER authorize an active write");
    }
    sqlite.exec("UPDATE system_settings SET disabled_features_json = '[\"manage_video_status\"]' WHERE id = 'default'");
    assert.deepEqual(await request("admin"), {
      status: 503,
      data: { ok: false, reason: "cost_guard_blocked", message: "現在、この機能の書き込みは一時的に無効化されています。" },
    }, "CostGuard must stop a site admin before status access");
  } finally {
    sqlite.close();
  }
});

test("MIG-0603 unmounted manage candidate: permission D1 outage returns a fixed 503", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted = 1');
    sqlite.exec("UPDATE system_settings SET operation_mode='normal' WHERE id='default'");
    sqlite.exec("DROP TABLE event_staff");
    const d1 = createVideoStatusD1(sqlite);
    const candidate = createUnboundManageVideoStatusCandidate();
    const response = await candidate.request(ORIGIN + "/", {
      method: "POST",
      headers: { origin: ORIGIN, ...cookie("tok-mgr"), "content-type": "application/json" },
      body: BODY,
    }, { DB: d1, NEXT_PUBLIC_SITE_URL: ORIGIN, FLAMENODE_LOCAL_PREVIEW: "1" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, reason: "database_unavailable" },
      "no table name, SQL or provider exception can be exposed to caller");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(d1.stats.batches, 0);
    assert.equal(d1.stats.writes, 0);
  } finally {
    sqlite.close();
  }
});

test("MIG-0603 unmounted admin candidate: admin-only guards precede input, mutation always disabled", async () => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted = 1');
    sqlite.exec("UPDATE system_settings SET operation_mode='normal', disabled_features_json=NULL WHERE id='default'");
    const d1 = createVideoStatusD1(sqlite);
    const candidate = createUnboundAdminVideoStatusCandidate();
    const defaultBody = JSON.stringify({ video_id: "v1", status: "private" });

    async function request(name, { body = defaultBody, origin = ORIGIN, env = {}, noCookie = false } = {}) {
      const response = await candidate.request(ORIGIN + "/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(origin === null ? {} : { origin }),
          ...(!noCookie ? cookie(`tok-${name}`) : {}),
        },
        body,
      }, { DB: d1, NEXT_PUBLIC_SITE_URL: ORIGIN, FLAMENODE_LOCAL_PREVIEW: "1", ...env });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(d1.stats.batches, 0, "unmounted admin candidate never opens an audited transaction");
      assert.equal(d1.stats.writes, 0, "unmounted admin candidate never writes to D1");
      return { status: response.status, data: await response.json() };
    }

    const before = d1.stats.statements;
    assert.deepEqual(await request("admin", { origin: "https://evil.example" }), {
      status: 403, data: { ok: false, reason: "invalid_origin" },
    });
    assert.deepEqual(await request("admin", { origin: null }), {
      status: 403, data: { ok: false, reason: "invalid_origin" },
    });
    assert.deepEqual(await request("admin", { env: { NEXT_PUBLIC_SITE_URL: null } }), {
      status: 503, data: { ok: false, reason: "origin_verification_unavailable" },
    });
    assert.equal(d1.stats.statements, before, "Origin denial must precede all D1 reads");

    assert.deepEqual(await request("admin", { noCookie: true }), {
      status: 401, data: { ok: false, reason: "unauthenticated", message: "ログインが必要です。" },
    });
    assert.equal(d1.stats.statements, before, "missing session cannot cause a D1 query");
    assert.deepEqual(await request("mgr", { body: '{"broken":' }), {
      status: 403, data: { ok: false, reason: "forbidden", message: "この操作を実行する権限がありません。" },
    }, "manager video.status privileges do not bypass site-admin role; role check precedes JSON");
    assert.deepEqual(await request("admin", { body: '{"broken":' }), {
      status: 400, data: { ok: false, message: "入力が不正です。" },
    });
    assert.deepEqual(await request("admin", { body: JSON.stringify({
      video_id: "v1", status: "voided",
    }) }), {
      status: 400, data: { ok: false, message: "voidedへの変更には理由が必要です。" },
    }, "CURRENT admin voided reason is required");
    for (const body of [
      JSON.stringify({ video_id: "v1", status: "public" }),
      JSON.stringify({ video_id: "v1", status: "voided", reason: "review case" }),
    ]) {
      assert.deepEqual(await request("admin", { body }), {
        status: 503, data: { ok: false, reason: "status_candidate_unmounted" },
      }, "even valid site-admin / moderation inputs can never mutate via this unbound candidate");
    }

    // The manage and admin feature switches are independent.
    sqlite.exec("UPDATE system_settings SET disabled_features_json='[\"manage_video_status\"]' WHERE id='default'");
    assert.deepEqual(await request("admin"), {
      status: 503, data: { ok: false, reason: "status_candidate_unmounted" },
    }, "manage feature disabled must not incorrectly disable the admin feature");
    sqlite.exec("UPDATE system_settings SET disabled_features_json='[\"admin_video_status\"]' WHERE id='default'");
    assert.deepEqual(await request("admin"), {
      status: 503,
      data: { ok: false, reason: "cost_guard_blocked", message: "現在、この機能の書き込みは一時的に無効化されています。" },
    });
    sqlite.exec("UPDATE system_settings SET disabled_features_json=NULL WHERE id='default'");
    sqlite.exec("UPDATE user SET is_tos_accepted=0 WHERE id='u_admin'");
    assert.deepEqual(await request("admin"), {
      status: 403, data: { ok: false, reason: "tos_required", message: "利用規約への同意が必要です。" },
    }, "admin role never bypasses the CURRENT TOS guard");
  } finally {
    sqlite.close();
  }
});

test("MIG-0603 S3 D1 pre-read budget characterization: unmounted status candidates exceed the limit", async (t) => {
  const sqlite = createSqlite();
  try {
    seed(sqlite);
    sqlite.exec('UPDATE "user" SET is_tos_accepted = 1');
    sqlite.exec("UPDATE system_settings SET operation_mode='normal', disabled_features_json=NULL WHERE id='default'");
    const d1 = createVideoStatusD1(sqlite);
    const S3_PRE_READ_LIMIT = 3;
    const cases = [
      ["site-admin", createUnboundAdminVideoStatusCandidate(), JSON.stringify({
        video_id: "v1", status: "private",
      }), 3, "admin"],
      ["manage-site-admin", createUnboundManageVideoStatusCandidate(), BODY, 4, "admin"],
      ["manage-event-staff", createUnboundManageVideoStatusCandidate(), BODY, 5, "mgr"],
    ];
    for (const [name, candidate, body, expectedReads, user] of cases) {
      const start = d1.stats.statements;
      const response = await candidate.request(ORIGIN + "/", {
        method: "POST",
        headers: { origin: ORIGIN, ...cookie(`tok-${user}`), "content-type": "application/json" },
        body,
      }, { DB: d1, NEXT_PUBLIC_SITE_URL: ORIGIN, FLAMENODE_LOCAL_PREVIEW: "1" });
      const reads = d1.stats.statements - start;
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false, reason: "status_candidate_unmounted",
      }, "this test cannot activate an over-budget write endpoint");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(reads, expectedReads,
        "this is a characterization of the CURRENT unmounted implementation, NOT S3 acceptance");
      if (name === "site-admin") {
        assert.equal(reads, S3_PRE_READ_LIMIT,
          "admin-only preflight uses the full S3 read budget before any mutation");
      } else {
        assert.ok(reads > S3_PRE_READ_LIMIT,
          "the manage authorization preflight exceeds S3 and MUST NOT be mounted");
      }
      assert.equal(d1.stats.batches, 0);
      assert.equal(d1.stats.writes, 0);
      t.diagnostic(`${name}: ${reads} D1 pre-reads (S3 max ${S3_PRE_READ_LIMIT}); full mutation budget NOT accepted`);
    }
  } finally {
    sqlite.close();
  }
});

// Acceptance remains intentionally TODO. Passing the characterization above
// demonstrates a known budget VIOLATION, not readiness for status writes.
test.todo("MIG-0603 S3 acceptance: admin/manage authenticated status writes each use <=3 D1 pre-reads plus one audited batch");
