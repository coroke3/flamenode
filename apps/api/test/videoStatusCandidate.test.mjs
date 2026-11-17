import assert from "node:assert/strict";
import test from "node:test";
import { createSqlite, cookie } from "./support/personalHarness.mjs";
import { seed } from "./support/manageSeed.mjs";
import { createVideoStatusD1 } from "./support/videoStatusD1.mjs";
import { createUnboundManageVideoStatusCandidate } from "../src/routes/videos/videoStatusCandidate.ts";

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
