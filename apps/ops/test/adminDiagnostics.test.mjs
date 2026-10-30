// MIG-0736 U01/U02a: Hono DTO boundary, diagnostic filters, explicit security and worker monitoring reads.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { getAdminHealth, getAdminSecurity, getAdminWorkers, getAdminIntegrity } from "../.test-dist/apps/ops/src/api/adminDiagnostics.js";
import { AdminHealthView } from "../.test-dist/apps/ops/src/routes/admin/AdminHealth.js";
import { AdminSecurityView } from "../.test-dist/apps/ops/src/routes/admin/AdminSecurity.js";
import { AdminWorkersView } from "../.test-dist/apps/ops/src/routes/admin/AdminWorkers.js";
import { AdminIntegrityView } from "../.test-dist/apps/ops/src/routes/admin/AdminIntegrity.js";
import { DiagnosticStatusResults, normalizeDiagnosticFilter } from "../.test-dist/apps/ops/src/routes/admin/DiagnosticStatusResults.js";

const h = (type, props, ...children) => React.createElement(type, props, ...children);
const render = (element, path = "/admin/health") =>
  renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, element));
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const results = [
  { id: "a", label: "安全", status: "ok", count: 0, samples: [] },
  { id: "b", label: "注意", status: "warn", count: 2, samples: ["id:a", "id:b"], note: "要確認" },
  { id: "c", label: "情報", status: "info", count: 1, samples: [], note: "メモ" },
];

test("U01 health checks no-store GET, default vs deep URL, and preserves abort signal", async () => {
  const calls = [];
  const fn = async (path, init) => {
    calls.push({ path, init });
    return response(200, { status: "all", results, error: null });
  };
  const controller = new AbortController();
  assert.equal((await getAdminHealth(fn, false, controller.signal)).status, "ok");
  assert.equal((await getAdminHealth(fn, true)).status, "ok");
  assert.deepEqual(calls.map(x => x.path), ["/api/admin-read/ops/health", "/api/admin-read/ops/health?deep=1"]);
  assert.equal(calls[0].init.signal, controller.signal);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
});

test("U01 security is idle without a D1 request; explicit run fetches validated DTO", async () => {
  let requests = 0;
  const fn = async (path) => {
    requests++;
    assert.equal(path, "/api/admin-read/ops/security?run=1");
    return response(200, { status: "all", ran: true, results, error: null });
  };
  const idle = await getAdminSecurity(fn, false);
  assert.deepEqual(idle, { status: "ok", data: { status: "all", ran: false, results: [], error: null } });
  assert.equal(requests, 0);
  const ran = await getAdminSecurity(fn, true);
  assert.equal(ran.status, "ok");
  assert.equal(requests, 1);
});

test("U01 malformed diagnostic DTO and unsupported deep reads fail closed", async () => {
  assert.deepEqual(await getAdminHealth(async () => response(200, { status: "all", results: [{ ...results[0], status: "secret" }], error: null }), false),
    { status: "unavailable" });
  assert.deepEqual(await getAdminSecurity(async () => response(200, { status: "all", ran: true, results: [], error: "unexpected" }), true),
    { status: "unavailable" });
  assert.deepEqual(await getAdminHealth(async () => response(501, { error: "deep_unsupported" }), true),
    { status: "unsupported" });
  assert.deepEqual(await getAdminSecurity(async () => response(403, { redirect: "/dashboard" }), true),
    { status: "forbidden", redirect: "/dashboard" });
});

test("U01 CURRENT status filter stays on client; security warning and INFO count are preserved", () => {
  assert.equal(normalizeDiagnosticFilter("warn"), "warn");
  assert.equal(normalizeDiagnosticFilter("unsupported"), "all");
  const html = render(h(DiagnosticStatusResults, { kind: "health", results, initialFilter: "warn", onRefresh: () => {} }));
  const dom = new JSDOM(html).window.document;
  assert.equal(dom.querySelector('button[aria-pressed="true"]')?.textContent.trim(), "WARN (1)");
  assert.equal(dom.querySelectorAll("tbody tr").length, 1);
  assert.ok(dom.querySelector("tbody").textContent.includes("注意"));
  assert.ok(!dom.querySelector("tbody").textContent.includes("安全"));
  const security = render(h(DiagnosticStatusResults, { kind: "security", results, onRefresh: () => {} }));
  assert.match(security, /セキュリティ /);
  assert.match(security, /漏洩・権限矛盾の可能性/);
  assert.equal(new JSDOM(security).window.document.querySelectorAll("tbody tr")[2].children[2].textContent, "—");
});

test("U01 health preserves deep and integrity navigation; errors never show diagnostics", () => {
  const base = { status: "ok", data: { status: "all", results, error: null } };
  const html = render(h(AdminHealthView, { data: base, fullRun: false, initialFilter: "all", onRefresh: () => {} }));
  assert.match(html, /全体診断を実行/);
  assert.match(html, /href="\/admin\/health\?deep=1"/);
  assert.match(html, /href="\/admin\/health\/integrity"/);
  assert.match(html, /DB ヘルスチェック/);
  const unsupported = render(h(AdminHealthView, { data: { status: "unsupported" }, fullRun: true, initialFilter: "all", onRefresh: () => {} }));
  assert.match(unsupported, /全体診断は現在利用できません/);
  assert.doesNotMatch(unsupported, /注意/);
});

test("U01 security first view shows run prompt without result table", () => {
  const data = { status: "ok", data: { status: "all", ran: false, results: [], error: null } };
  const idle = render(h(AdminSecurityView, { data, shouldRun: false, initialFilter: "all", onRefresh: () => {} }), "/admin/security");
  assert.match(idle, /診断は未実行です/);
  assert.match(idle, /href="\/admin\/security\?run=1"/);
  assert.doesNotMatch(idle, /状態フィルタ/);
  const running = render(h(AdminSecurityView, { data: { status: "ok", data: { status: "all", ran: true, results, error: null } }, shouldRun: true, initialFilter: "warn", onRefresh: () => {} }), "/admin/security?run=1");
  assert.match(running, /セキュリティ WARN 1 件/);
  assert.match(running, /注意/);
});


test("U02a worker monitoring fetches one guarded no-store snapshot with cancellation signal", async () => {
  const calls = [];
  const controller = new AbortController();
  const fetchFn = async (path, init) => {
    calls.push({ path, init });
    return response(200, { snapshot: null, error: null });
  };
  assert.deepEqual(await getAdminWorkers(fetchFn, controller.signal), {
    status: "ok", data: { snapshot: null, error: null },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/admin-read/ops/workers");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.signal, controller.signal);
});

test("U02a workers rejects partial/error-leaking snapshots and keeps 401/403/404/501 fail-closed", async () => {
  assert.deepEqual(await getAdminWorkers(async () => response(200, {
    snapshot: { operationMode: "normal" }, error: null,
  })), { status: "unavailable" });
  assert.deepEqual(await getAdminWorkers(async () => response(200, {
    snapshot: null, error: "database password: secret",
  })), { status: "unavailable" });
  assert.deepEqual(await getAdminWorkers(async () => response(401, {})), { status: "anonymous" });
  assert.deepEqual(await getAdminWorkers(async () => response(403, { redirect: "/dashboard" })),
    { status: "forbidden", redirect: "/dashboard" });
  assert.deepEqual(await getAdminWorkers(async () => response(404, {})), { status: "notFound" });
  assert.deepEqual(await getAdminWorkers(async () => response(501, {})), { status: "unsupported" });
});


test("U02b Worker dashboard shows CURRENT cron, queue, pipelines, artifacts and wake failure details", () => {
  const emptyQueue = { pending: 1, processing: 0, failed: 2, deadLetter: 3, stuck: 0, oldestPendingAt: 1_700_000_000 };
  const snapshot = {
    generatedAt: 1_700_000_000,
    operationMode: "normal", overallLevel: "critical", overallMessage: "通知が滞留しています",
    jobs: [{ jobName: "sync", label: "YouTube同期", cadenceSeconds: 60, detailHref: "/admin/youtube-sync",
      level: "critical", message: "ジョブ失敗", leaseExpiresAt: null, lastStartedAt: null,
      lastSucceededAt: null, lastFailedAt: null, lastErrorCode: "sync_failed", nextExpectedAt: null }],
    notifications: emptyQueue, staticRebuilds: { ...emptyQueue, pending: 0, failed: 0, deadLetter: 0 },
    youtube: { eligible: 1, pending: 2, stale: 0, failed: 4, oldestPendingAt: null },
    scores: { eligible: 1, stale: 0, oldestUpdatedAt: null },
    artifacts: [{ targetType: "top", generatedAt: null }],
    pipelines: [{ id: "youtube", label: "YouTube", level: "warn", backlog: 4,
      capacityPerDay: 100, estimatedDrainMinutes: 70, note: "stale", detailHref: "/admin/youtube-sync" }],
    queueWakeFailures: { notification_available: { at: 1_700_000_000, reason: "wake_failed" }, static_rebuild_available: null },
  };
  const html = render(h(AdminWorkersView, {
    data: { status: "ok", data: { snapshot, error: null } }, onRefresh: () => {},
  }), "/admin/workers");
  const dom = new JSDOM(html).window.document;
  assert.match(html, /通知が滞留しています/);
  assert.match(html, /Queue wake 最終失敗/);
  assert.match(html, /wake_failed/);
  assert.match(html, /Cron実行状態/);
  assert.match(html, /キュー状態/);
  assert.match(html, /処理能力と滞留/);
  assert.match(html, /グローバル静的JSONの最終生成/);
  assert.match(html, /sync_failed/);
  assert.match(html, /operation_mode/);
  assert.match(html, /Cloudflare Dashboard/);
  assert.equal(dom.querySelectorAll("table").length, 3);
  assert.equal(dom.querySelectorAll('button[type="button"]').length, 1);
  assert.ok(dom.querySelector('a[href="/admin/health"]'));
});

test("U02b Worker dashboard does not expose stale snapshot on denied, failed or empty read", () => {
  for (const data of [
    { status: "loading" }, { status: "anonymous" }, { status: "forbidden" },
    { status: "notFound" }, { status: "unavailable" }, { status: "unsupported" },
    { status: "ok", data: { snapshot: null, error: null } },
    { status: "ok", data: { snapshot: null, error: "query_failed" } },
  ]) {
    const html = render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
    assert.doesNotMatch(html, /Queue wake 最終失敗|Cron実行状態|グローバル静的JSONの最終生成/);
    assert.doesNotMatch(html, /query_failed/);
  }
  const denied = render(h(AdminWorkersView, { data: { status: "forbidden" }, onRefresh: () => {} }), "/admin/workers");
  assert.match(denied, /閲覧権限がありません/);
});


test("U02c integrity does not query D1 before explicit run; run=1 preserves unsupported status", async () => {
  let calls = 0;
  const fetchFn = async (path, init) => {
    calls++;
    assert.equal(path, "/api/admin-read/ops/integrity?run=1");
    assert.equal(init.method, "GET");
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    return response(501, { error: "integrity_run_unsupported" });
  };
  assert.deepEqual(await getAdminIntegrity(fetchFn, false), { status: "ok", data: { ran: false, results: [] } });
  assert.equal(calls, 0);
  assert.deepEqual(await getAdminIntegrity(fetchFn, true), { status: "unsupported" });
  assert.equal(calls, 1);
  assert.deepEqual(await getAdminIntegrity(async () => response(200, {
    ran: true, results: [{ id: "unsafe", count: 10 }],
  }), true), { status: "unavailable" }); // Await the contract from MIG-0626; never infer parity.
});

test("U02c integrity idle/unsupported/denied views show no fabricated check counts", () => {
  const idle = render(h(AdminIntegrityView, {
    data: { status: "ok", data: { ran: false, results: [] } }, shouldRun: false, onRefresh: () => {},
  }), "/admin/health/integrity");
  assert.match(idle, /DB整合性診断は未実行です/);
  assert.match(idle, /href="\/admin\/health\/integrity\?run=1"/);
  assert.doesNotMatch(idle, /総検出件数|危険チェック/);
  const unavailable = render(h(AdminIntegrityView, {
    data: { status: "unsupported" }, shouldRun: true, onRefresh: () => {},
  }), "/admin/health/integrity?run=1");
  assert.match(unavailable, /DB整合性診断は現在利用できません/);
  assert.doesNotMatch(unavailable, /総検出件数|危険チェック/);
  const denied = render(h(AdminIntegrityView, {
    data: { status: "forbidden" }, shouldRun: true, onRefresh: () => {},
  }), "/admin/health/integrity?run=1");
  assert.match(denied, /閲覧権限がありません/);
});
