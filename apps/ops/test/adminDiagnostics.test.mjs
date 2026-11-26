// MIG-0736 U01/U02a: Hono DTO boundary, diagnostic filters, explicit security and worker monitoring reads.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { JSDOM } from "jsdom";
import { getAdminHealth, getAdminSecurity, getAdminWorkers, getAdminIntegrity } from "../.test-dist/apps/ops/src/api/adminDiagnostics.js";
import { AdminHealth, AdminHealthView } from "../.test-dist/apps/ops/src/routes/admin/AdminHealth.js";
import { AdminSecurity, AdminSecurityView } from "../.test-dist/apps/ops/src/routes/admin/AdminSecurity.js";
import { AdminWorkersView } from "../.test-dist/apps/ops/src/routes/admin/AdminWorkers.js";
import { AdminIntegrity, AdminIntegrityView } from "../.test-dist/apps/ops/src/routes/admin/AdminIntegrity.js";
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

// Fixed CURRENT/Hono identities, not fabricated generic IDs for a complete security run.
const securityIds = [
  "access_token_not_null",
  "rejected_xid_active",
  "unapproved_creator_videos",
  "banned_user_videos",
  "tos_not_accepted_user_videos",
  "custom_page_dangerous_html",
  "banned_user_chapters",
  "orphan_approved_xid",
  "public_api_leak",
  "notification_table_mismatch",
];
const securityResults = securityIds.map((id, i) => ({
  ...(i < 2 ? results[i] : i >= 8 ? results[2] : results[0]),
  id,
  ...(i > 2 ? { label: "check " + id } : {}),
}));


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
    return response(200, { status: "all", ran: true, results: securityResults, error: null });
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

test("MIG-0736 deep catalog or empty results never show an all-clear before U03", async () => {
  for (const payload of [
    { status: "all", results: [], error: null, checkIds: ["system_settings_single_row", "primary_event_sync"] },
    { status: "all", results: [], error: null },
  ]) {
    const calls = [];
    const data = await getAdminHealth(async (path) => {
      calls.push(path);
      return response(200, payload);
    }, true);
    assert.deepEqual(calls, ["/api/admin-read/ops/health?deep=1"]);
    const html = render(h(AdminHealthView, { data, fullRun: true, initialFilter: "all", onRefresh: () => {} }), "/admin/health?deep=1");
    assert.match(html, /全体診断は現在利用できません/);
    assert.doesNotMatch(html, /WARN はありません|状態フィルタ|最新状態を再チェック/);
    assert.equal(new JSDOM(html).window.document.querySelectorAll("tbody tr").length, 0);
  }
  const completed = await getAdminHealth(async () => response(200, {
    status: "all", results: [results[0]], error: null,
  }), true);
  const valid = render(h(AdminHealthView, { data: completed, fullRun: true, initialFilter: "all", onRefresh: () => {} }), "/admin/health?deep=1");
  assert.match(valid, /WARN はありません/);
  assert.match(valid, /安全/);
  assert.doesNotMatch(valid, /全体診断は現在利用できません/);
});

test("U01 security first view shows run prompt without result table", () => {
  const data = { status: "ok", data: { status: "all", ran: false, results: [], error: null } };
  const idle = render(h(AdminSecurityView, { data, shouldRun: false, initialFilter: "all", onRefresh: () => {} }), "/admin/security");
  assert.match(idle, /診断は未実行です/);
  assert.match(idle, /href="\/admin\/security\?run=1"/);
  assert.doesNotMatch(idle, /状態フィルタ/);
  const running = render(h(AdminSecurityView, { data: { status: "ok", data: { status: "all", ran: true, results: securityResults, error: null } }, shouldRun: true, initialFilter: "warn", onRefresh: () => {} }), "/admin/security?run=1");
  assert.match(running, /セキュリティ WARN 1 件/);
  assert.match(running, /注意/);
});


test("MIG-0736 security requires all ten distinct CURRENT check identities before a summary", async () => {
  const clean = securityResults.map(result => result.status === "warn"
    ? { ...result, status: "ok", count: 0, samples: [] } : result);
  const malformed = [
    [],
    clean.slice(0, 9),
    [clean[0]],
    [...clean.slice(0, 9), clean[0]],
    [...clean.slice(0, 9), { ...clean[9], id: "unregistered" }],
    [...clean, { ...clean[9], id: "extra" }],
  ];
  const view = async rows => {
    const data = await getAdminSecurity(async () => response(200, {
      status: "all", ran: true, results: rows, error: null,
    }), true);
    // These are shape-valid responses; the screen must reject incomplete
    // receipts rather than keeping an earlier successful summary.
    assert.equal(data.status, "ok");
    return render(h(AdminSecurityView, {
      data, shouldRun: true, initialFilter: "all", onRefresh: () => {},
    }), "/admin/security?run=1");
  };
  for (const rows of malformed) {
    const html = await view(rows);
    assert.match(html, /診断結果を取得できませんでした/);
    assert.doesNotMatch(html, /WARN はありません|状態フィルタ/);
    assert.equal(new JSDOM(html).window.document.querySelector("table"), null);
  }
  for (const rows of [clean, [...clean].reverse()]) {
    const html = await view(rows);
    assert.match(html, /セキュリティ WARN はありません/);
    assert.equal(new JSDOM(html).window.document.querySelectorAll("tbody tr").length, 10);
  }
  assert.match(await view(securityResults), /セキュリティ WARN 1 件/);
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
  // A finite but out-of-range Unix timestamp must never throw RangeError in SSR.
  const invalidDate = render(h(AdminWorkersView, {
    data: { status: "ok", data: { snapshot: { ...snapshot, generatedAt: Number.MAX_VALUE }, error: null } },
    onRefresh: () => {},
  }), "/admin/workers");
  assert.match(invalidDate, /取得: -/);
  assert.equal(dom.querySelectorAll("table").length, 3);
  assert.equal(dom.querySelectorAll('button[type="button"]').length, 1);
  assert.ok(dom.querySelector('a[href="/admin/health"]'));
  const dynamicDetailCount = snapshot.jobs.length + snapshot.pipelines.length;
  const baselineSyncLinks = dom.querySelectorAll('a[href="/admin/youtube-sync"]').length;
  assert.equal(baselineSyncLinks, dynamicDetailCount + 1,
    "two dynamic action links plus the independent static YouTube queue link are retained");
  for (const unsafeHref of [
    "javascript:alert(1)", "https://attacker.invalid/steal",
    "//attacker.invalid/steal", "/admin/../manage",
    "/admin/youtube-sync?redirect=https://attacker.invalid",
  ]) {
    const poisoned = render(h(AdminWorkersView, {
      data: { status: "ok", data: {
        snapshot: {
          ...snapshot,
          jobs: snapshot.jobs.map((job) => ({ ...job, detailHref: unsafeHref })),
          pipelines: snapshot.pipelines.map((pipeline) => ({ ...pipeline, detailHref: unsafeHref })),
        },
        error: null,
      } },
      onRefresh: () => {},
    }), "/admin/workers");
    const links = [...new JSDOM(poisoned).window.document.querySelectorAll("a")];
    assert.equal(links.some((anchor) => anchor.getAttribute("href") === unsafeHref), false,
      "unsafe destination must not become a link: " + unsafeHref);
    assert.equal(
      links.filter((anchor) => anchor.getAttribute("href") === "/admin/youtube-sync").length,
      baselineSyncLinks - dynamicDetailCount,
      "invalid worker and pipeline links are removed but the trusted static queue link remains",
    );
  }
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

// CURRENT Next page searchParams represents repeated query keys as arrays.
test("MIG-0736 diagnostic route query parity: duplicate keys never opt in or select a filter", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test" });
  const keys = ["window", "document", "navigator", "HTMLElement", "Node", "ResizeObserver", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const key of keys) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        // jsdom has no layout observer; TableScroll needs only its lifecycle.
        value: key === "IS_REACT_ACT_ENVIRONMENT" ? true
          : key === "ResizeObserver" ? class { observe() {} disconnect() {} }
          : dom.window[key],
      });
    }
    async function check(Component, path, expectedRequests, expectedText, filter) {
      const calls = [];
      const target = dom.window.document.createElement("div");
      dom.window.document.body.append(target);
      const root = createRoot(target);
      const fetchFn = async (url) => {
        calls.push(url);
        if (url.includes("/integrity")) return response(501, { error: "unsupported" });
        const security = url.includes("/security");
        return response(200, { status: "all", results: security ? securityResults : results, error: null, ...(security ? { ran: true } : {}) });
      };
      try {
        await React.act(async () => {
          root.render(h(MemoryRouter, { initialEntries: [path] }, h(Component, { fetchFn })));
        });
        assert.deepEqual(calls, expectedRequests, path);
        assert.match(target.textContent, expectedText, path);
        if (filter) assert.equal(target.querySelector('button[aria-pressed="true"]')?.textContent.trim(), filter, path);
      } finally {
        await React.act(async () => root.unmount());
        target.remove();
      }
    }
    await check(AdminHealth, "/admin/health?deep=1&deep=0&run=1&run=1&status=warn&status=ok",
      ["/api/admin-read/ops/health"], /運用チェック/, "すべて (3)");
    await check(AdminHealth, "/admin/health?deep=1&deep=1&run=1&status=warn",
      ["/api/admin-read/ops/health?deep=1"], /全体診断/, "WARN (1)");
    await check(AdminHealth, "/admin/health?deep=1&run=1&run=0",
      ["/api/admin-read/ops/health?deep=1"], /全体診断/);
    for (const duplicate of ["run=1&run=0", "run=1&run=1", "run=0&run=1"]) {
      await check(AdminSecurity, "/admin/security?" + duplicate, [], /セキュリティ診断は未実行です/);
      await check(AdminIntegrity, "/admin/health/integrity?" + duplicate, [], /DB整合性診断は未実行です/);
    }
    await check(AdminSecurity, "/admin/security?run=1&status=warn&status=ok",
      ["/api/admin-read/ops/security?run=1"], /セキュリティ WARN 1 件/, "すべて (10)");
    await check(AdminSecurity, "/admin/security?run=1&status=warn",
      ["/api/admin-read/ops/security?run=1"], /セキュリティ WARN 1 件/, "WARN (1)");
    await check(AdminIntegrity, "/admin/health/integrity?run=1",
      ["/api/admin-read/ops/integrity?run=1"], /DB整合性診断は現在利用できません/);
  } finally {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

// U01: route reuse must not resurrect a response from an earlier explicit run.
test("MIG-0736 diagnostic history rejects obsolete run receipts and filter-only navigation does not fetch", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://flamenode.test" });
  const keys = ["window", "document", "navigator", "HTMLElement", "Node", "ResizeObserver", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const key of keys) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value: key === "IS_REACT_ACT_ENVIRONMENT" ? true
          : key === "ResizeObserver" ? class { observe() {} disconnect() {} }
          : dom.window[key],
      });
    }
    for (const scenario of [
      {
        Component: AdminHealth, path: "/admin/health", flag: "deep",
        runUrl: "/api/admin-read/ops/health?deep=1",
        idleUrl: "/api/admin-read/ops/health",
      },
      {
        Component: AdminSecurity, path: "/admin/security", flag: "run",
        runUrl: "/api/admin-read/ops/security?run=1",
        idleText: /セキュリティ診断は未実行です/,
      },
    ]) {
      const { Component, path, flag, runUrl, idleUrl, idleText } = scenario;
      const target = dom.window.document.createElement("div");
      dom.window.document.body.append(target);
      const root = createRoot(target);
      const pending = [];
      const fetchFn = (url, init) => new Promise(resolve => {
        pending.push({ url, signal: init.signal, resolve });
      });
      let navigate;
      function Harness() {
        navigate = useNavigate();
        return h(Component, { fetchFn });
      }
      const runPath = path + "?" + flag + "=1";
      const go = async to => {
        await React.act(async () => { navigate(to); });
      };
      const finish = async (request, label) => {
        await React.act(async () => {
          request.resolve(response(200, {
            status: "all",
            ran: true,
            error: null,
            results: (idleUrl ? results.slice(0, 2) : securityResults).map((result, i) =>
              i === 0 ? { ...result, label: label + " OK" } : i === 1 ? { ...result, label } : result),
          }));
        });
      };
      const activeFilter = () => target.querySelector('button[aria-pressed="true"]')?.textContent.trim();
      try {
        await React.act(async () => {
          root.render(h(MemoryRouter, { initialEntries: [runPath] }, h(Harness)));
        });
        assert.equal(pending.length, 1, path);
        const obsolete = pending[0];
        assert.equal(obsolete.url, runUrl, path);

        await go(runPath + "&" + flag + "=1");
        assert.equal(obsolete.signal.aborted, true, path);
        if (idleUrl) {
          assert.equal(pending.length, 2, path);
          assert.equal(pending[1].url, idleUrl, path);
          await finish(pending[1], "operational-current");
          assert.match(target.textContent, /operational-current/, path);
        } else {
          assert.equal(pending.length, 1, path);
          assert.match(target.textContent, idleText, path);
          assert.equal(target.querySelector("table"), null, path);
        }

        // Back returns to the same component instance, but starts a new run.
        await go(-1);
        assert.equal(pending.length, idleUrl ? 3 : 2, path);
        const current = pending.at(-1);
        assert.equal(current.url, runUrl, path);
        assert.doesNotMatch(target.textContent, /operational-current/, path);
        await finish(current, "new-run-WARN");
        assert.match(target.textContent, /new-run-WARN/, path);
        assert.equal(activeFilter(), idleUrl ? "すべて (2)" : "すべて (10)", path);

        // The transport deliberately ignores abort and resolves the first run late.
        await finish(obsolete, "obsolete-private-result");
        assert.doesNotMatch(target.textContent, /obsolete-private-result/, path);
        assert.match(target.textContent, /new-run-WARN/, path);

        const count = pending.length;
        await go(runPath + "&status=warn");
        assert.equal(activeFilter(), "WARN (1)", path);
        assert.equal(target.querySelectorAll("tbody tr").length, 1, path);
        assert.doesNotMatch(target.textContent, /new-run-WARN OK/, path);
        await go(-1);
        assert.equal(activeFilter(), idleUrl ? "すべて (2)" : "すべて (10)", path);
        assert.equal(target.querySelectorAll("tbody tr").length, idleUrl ? 2 : 10, path);
        await go(1);
        assert.equal(activeFilter(), "WARN (1)", path);
        assert.equal(pending.length, count, path);

        // Same-key refresh must not retain prior admin results after denial.
        const refresh = [...target.querySelectorAll("button")]
          .find(button => button.textContent.trim() === "最新状態を再チェック");
        assert.ok(refresh, path);
        await React.act(async () => { refresh.click(); });
        assert.equal(pending.length, count + 1, path);
        assert.equal(pending.at(-1).url, runUrl, path);
        await React.act(async () => {
          pending.at(-1).resolve(response(403, { redirect: "/dashboard" }));
        });
        assert.match(target.textContent, /閲覧権限がありません/, path);
        assert.doesNotMatch(target.textContent, /new-run-WARN|obsolete-private-result/, path);
        assert.equal(target.querySelector("table"), null, path);

        if (!idleUrl) {
          // Re-enter after the denial, then prove a shape-valid partial refresh
          // replaces (rather than retains) the previous full diagnostic.
          await go(runPath + "&run=1");
          assert.match(target.textContent, idleText, path);
          await go(-1);
          const fresh = pending.at(-1);
          assert.notEqual(fresh, current);
          await finish(fresh, "full-before-partial");
          assert.match(target.textContent, /full-before-partial/, path);
          const retry = [...target.querySelectorAll("button")]
            .find(button => button.textContent.trim() === "最新状態を再チェック");
          assert.ok(retry);
          await React.act(async () => { retry.click(); });
          assert.notEqual(pending.at(-1), fresh);
          await React.act(async () => {
            pending.at(-1).resolve(response(200, {
              status: "all", ran: true, error: null, results: [securityResults[0]],
            }));
          });
          assert.match(target.textContent, /診断結果を取得できませんでした/);
          assert.doesNotMatch(target.textContent, /WARN はありません|full-before-partial/);
          assert.equal(target.querySelector("table"), null);
        }
      } finally {
        await React.act(async () => root.unmount());
        target.remove();
      }
    }
  } finally {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
