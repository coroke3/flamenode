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
import { AdminWorkers, AdminWorkersView } from "../.test-dist/apps/ops/src/routes/admin/AdminWorkers.js";
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

// The operational endpoint is a fixed five-check set; generic rows are
// reserved for component-only tests.
const operationalIds = [
  "system_settings_single_row",
  "notification_processing_stuck",
  "notification_failed_volume",
  "open_moderation_cases_overdue",
  "x_id_merge_pending_stale",
];
const operationalResults = operationalIds.map((id, i) => ({
  ...(i < 3 ? results[i] : results[0]),
  id,
  ...(i === 0 ? { count: 1 } : {}),
  ...(i > 2 ? { label: "check " + id } : {}),
}));

// Full CURRENT runHealthChecks receipt (fixture only; per-ID orchestration waits for U03).
const deepIds = [
  "system_settings_single_row",
  "primary_event_sync",
  "orphan_event_ref",
  "orphan_video_ref",
  "available_slot_with_video",
  "submitted_slot_without_video",
  "reservation_group_user_mix",
  "public_video_without_youtube_id",
  "voided_video_visible",
  "slot_duplicate_start_time",
  "like_count_drift",
  "video_statistics_columns",
  "missing_video_youtube_metadata",
  "videos_outro_comment_legacy",
  "chapter_non_chapter_marker",
  "orphan_video_member",
  "notification_processing_stuck",
  "notification_failed_volume",
  "open_moderation_cases_overdue",
  "public_api_event_flag",
  "x_id_merge_pending_stale",
  "audit_logs_retention_candidates",
];
const deepResults = deepIds.map((id, i) => ({
  ...(i === 1 ? results[1] : i === 7 ? results[2] : results[0]),
  id,
  ...(i === 0 ? { count: 1 } : {}),
  ...(i > 2 ? { label: "check " + id } : {}),
}));

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
  ...(i >= 8 ? { count: 0 } : {}),
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
    { status: "ok", data: { diagnosticError: "invalid_receipt" } });
  assert.deepEqual(await getAdminSecurity(async () => response(200, { status: "all", ran: true, results: [], error: "unexpected" }), true),
    { status: "ok", data: { diagnosticError: "invalid_receipt" } });
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
  const base = { status: "ok", data: { status: "all", results: operationalResults, error: null } };
  const html = render(h(AdminHealthView, { data: base, fullRun: false, initialFilter: "all", onRefresh: () => {} }));
  assert.match(html, /全体診断を実行/);
  assert.match(html, /href="\/admin\/health\?deep=1"/);
  assert.match(html, /href="\/admin\/health\/integrity"/);
  assert.match(html, /DB ヘルスチェック/);
  const unsupported = render(h(AdminHealthView, { data: { status: "unsupported" }, fullRun: true, initialFilter: "all", onRefresh: () => {} }));
  assert.match(unsupported, /全体診断は現在利用できません/);
  assert.doesNotMatch(unsupported, /注意/);
});

test("MIG-0736 health and security errors retain CURRENT error panel without result data", () => {
  const cases = [
    [{ status: "unavailable" }, "診断結果を取得できませんでした。"],
    [{ status: "anonymous" }, "ログインが必要です。"],
    [{ status: "forbidden" }, "閲覧権限がありません。"],
    [{ status: "notFound" }, "閲覧権限がありません。"],
  ];
  for (const [View, path, mode, rows] of [
    [AdminHealthView, "/admin/health", { fullRun: false }, operationalResults],
    [AdminSecurityView, "/admin/security?run=1", { shouldRun: true }, securityResults],
  ]) {
    const failedReceipt = { status: "ok", data: {
      status: "all", ran: true, results: rows, error: "query_failed",
    } };
    const allCases = [...cases, [failedReceipt, "診断結果を取得できませんでした。"]];
    if (View === AdminHealthView) allCases.push(
      [{ status: "unsupported" }, "全体診断は現在利用できません。"]);
    for (const [data, message] of allCases) {
      const html = render(h(View, { data, ...mode, initialFilter: "all", onRefresh: () => {} }), path);
      const dom = new JSDOM(html);
      try {
        const doc = dom.window.document;
        const panels = doc.querySelectorAll('[role="alert"]');
        assert.equal(panels.length, 1, path);
        const panel = panels[0];
        assert.equal(panel.tagName, "DIV");
        assert.equal(panel.textContent.trim(), message);
        // Read SSR's serialized style: jsdom may not parse CSS custom-property values.
        const style = panel.getAttribute("style");
        for (const declaration of [
          "margin-top:20px", "padding:12px 16px", "background:var(--bg-surface)",
          "border:1px solid var(--color-danger, #e53e3e)",
          "border-radius:var(--radius-md)", "color:var(--color-danger, #e53e3e)", "font-size:13px",
        ]) assert.ok(style?.split(";").includes(declaration), path + ": " + declaration);
        assert.equal(doc.querySelectorAll("table").length, 0);
        assert.equal(doc.querySelectorAll('nav[aria-label="状態フィルタ"]').length, 0);
        assert.doesNotMatch(html, /query_failed/);
      } finally {
        dom.window.close();
      }
    }
  }
});

test("MIG-0736 operational health requires all five distinct CURRENT check identities", async () => {
  const clean = operationalResults.map(result => result.status === "warn"
    ? { ...result, status: "ok", count: 0, samples: [] } : result);
  const invalid = [
    [], clean.slice(0, 4), [clean[0]],
    [...clean.slice(0, 4), clean[0]],
    [...clean.slice(0, 4), { ...clean[4], id: "unknown" }],
    [...clean, { ...clean[4], id: "extra" }],
  ];
  const view = async (rows, initialFilter = "all") => {
    const data = await getAdminHealth(async () => response(200, {
      status: "all", results: rows, error: null,
    }), false);
    assert.equal(data.status, "ok", "the DTO is shape-valid");
    return render(h(AdminHealthView, {
      data, fullRun: false, initialFilter, onRefresh: () => {},
    }));
  };
  for (const rows of invalid) {
    const html = await view(rows);
    assert.match(html, /診断結果を取得できませんでした/);
    assert.doesNotMatch(html, /WARN はありません|状態フィルタ/);
    assert.equal(new JSDOM(html).window.document.querySelector("table"), null);
  }
  for (const rows of [clean, [...clean].reverse()]) {
    const html = await view(rows);
    assert.match(html, /WARN はありません/);
    assert.equal(new JSDOM(html).window.document.querySelectorAll("tbody tr").length, 5);
  }
  const warned = await view(operationalResults, "warn");
  assert.match(warned, /WARN 1 件/);
  assert.equal(new JSDOM(warned).window.document.querySelectorAll("tbody tr").length, 1);
});

test("MIG-0736 operational health rejects contradictory count/status even with all five IDs", async () => {
  const clean = operationalResults.map(result => result.status === "warn"
    ? { ...result, status: "ok", count: 0, samples: [] } : result);
  // The producer distinguishes the one-row invariant and the failed-volume
  // threshold (INFO at 1..19, WARN from 20) from the other count checks.
  const counts = [0, 1, 2, 19, 20, Number.MAX_SAFE_INTEGER];
  const expected = [
    ["warn", "ok", "warn", "warn", "warn", "warn"],
    ["ok", "warn", "warn", "warn", "warn", "warn"],
    ["ok", "info", "info", "info", "warn", "warn"],
    ["ok", "warn", "warn", "warn", "warn", "warn"],
    ["ok", "warn", "warn", "warn", "warn", "warn"],
  ];
  const renderReceipt = async rows => {
    const data = await getAdminHealth(async () => response(200, {
      status: "all", results: rows, error: null,
    }), false);
    return render(h(AdminHealthView, { data, fullRun: false, initialFilter: "all", onRefresh: () => {} }));
  };
  const withRow = (index, count, status) => clean.map((row, i) => i === index
    ? { ...row, count, status, samples: [] } : row);
  for (let i = 0; i < clean.length; i++) {
    for (let j = 0; j < counts.length; j++) {
      for (const status of ["ok", "warn", "info"]) {
        const html = await renderReceipt(withRow(i, counts[j], status));
        const context = clean[i].id + ":" + counts[j] + ":" + status;
        if (status === expected[i][j]) {
          assert.match(html, status === "warn" ? /WARN 1 件/ : /WARN はありません/, context);
          assert.match(html, /状態フィルタ/, context);
        } else {
          assert.match(html, /診断結果を取得できませんでした/, context);
          assert.doesNotMatch(html, /WARN はありません|状態フィルタ|<table/, context);
        }
      }
    }
    for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const html = await renderReceipt(withRow(i, count, "ok"));
      assert.match(html, /診断結果を取得できませんでした/, clean[i].id);
      assert.doesNotMatch(html, /WARN はありません|状態フィルタ|<table/, clean[i].id);
    }
  }
});

test("MIG-0736 deep diagnosis requires all CURRENT check identities and consistent results", async () => {
  const clean = deepResults.map(row => row.id === "primary_event_sync"
    ? { ...row, status: "ok", count: 0, samples: [] } : row);
  const change = (id, fields) => clean.map(row => row.id === id ? { ...row, ...fields } : row);
  const receipts = [
    { rows: [], message: /全体診断は現在利用できません/, checkIds: deepIds },
    { rows: [], message: /全体診断は現在利用できません/ },
    { rows: [results[0]], message: /診断結果を取得できませんでした/ },
    { rows: [clean[0]], message: /診断結果を取得できませんでした/ },
    { rows: operationalResults, message: /診断結果を取得できませんでした/ },
    { rows: clean.slice(0, -1), message: /診断結果を取得できませんでした/ },
    { rows: [...clean, clean[0]], message: /診断結果を取得できませんでした/ },
    { rows: [...clean.slice(0, -1), clean[0]], message: /診断結果を取得できませんでした/ },
    { rows: change("audit_logs_retention_candidates", { id: "unknown" }), message: /診断結果を取得できませんでした/ },
    { rows: change("primary_event_sync", { count: 1 }), message: /診断結果を取得できませんでした/ },
    { rows: change("system_settings_single_row", { count: 0 }), message: /診断結果を取得できませんでした/ },
    { rows: change("notification_failed_volume", { status: "info", count: 20 }), message: /診断結果を取得できませんでした/ },
    { rows: change("video_statistics_columns", { count: 1 }), message: /診断結果を取得できませんでした/ },
    { rows: change("public_video_without_youtube_id", { status: "warn" }), message: /診断結果を取得できませんでした/ },
    { rows: change("orphan_video_ref", { count: -1 }), message: /診断結果を取得できませんでした/ },
    { rows: change("orphan_video_ref", { count: 0.5 }), message: /診断結果を取得できませんでした/ },
    { rows: change("orphan_video_ref", { count: Number.MAX_SAFE_INTEGER + 1, status: "warn" }), message: /診断結果を取得できませんでした/ },
  ];
  for (const { rows, message, checkIds } of receipts) {
    const calls = [];
    const data = await getAdminHealth(async (path) => {
      calls.push(path);
      return response(200, { status: "all", results: rows, error: null, ...(checkIds ? { checkIds } : {}) });
    }, true);
    assert.deepEqual(calls, ["/api/admin-read/ops/health?deep=1"]);
    const html = render(h(AdminHealthView, { data, fullRun: true, initialFilter: "all", onRefresh: () => {} }), "/admin/health?deep=1");
    assert.match(html, message);
    assert.doesNotMatch(html, /WARN はありません|状態フィルタ|<table/);
    if (rows.length === 0) {
      assert.doesNotMatch(html, /最新状態を再チェック/, "staged empty deep catalog is still unsupported");
    } else {
      assert.match(html, /最新状態を再チェック/, "rejected nonempty deep receipt can be retried manually");
    }
  }
  for (const { rows, warning } of [{ rows: clean, warning: false }, { rows: deepResults, warning: true }]) {
    const data = await getAdminHealth(async () => response(200, {
      status: "all", results: rows, error: null,
    }), true);
    const html = render(h(AdminHealthView, { data, fullRun: true, initialFilter: "all", onRefresh: () => {} }), "/admin/health?deep=1");
    assert.match(html, warning ? /WARN 1 件/ : /WARN はありません/);
    assert.match(html, /安全/);
    assert.doesNotMatch(html, /全体診断は現在利用できません|診断結果を取得できませんでした/);
    const dom = new JSDOM(html);
    try {
      assert.equal(dom.window.document.querySelectorAll("tbody tr").length, 22);
    } finally {
      dom.window.close();
    }
  }
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


test("MIG-0736 security rejects contradictory count/status even with all ten IDs", async () => {
  const clean = securityResults.map(result => result.status === "warn"
    ? { ...result, status: "ok", count: 0, samples: [] } : result);
  const counts = [0, 1, 2, 20, Number.MAX_SAFE_INTEGER];
  const risk = [["ok"], ["warn"], ["warn"], ["warn"], ["warn"]];
  const staticOk = [["ok"], [], [], [], []];
  const staticInfo = [["info"], [], [], [], []];
  const orphan = [["ok"], ["info", "warn"], ["info"], ["info"], ["info"]];
  const expected = [risk, risk, risk, risk, risk, staticOk, risk, orphan, staticInfo, staticInfo];
  const view = async rows => {
    const data = await getAdminSecurity(async () => response(200, {
      status: "all", ran: true, results: rows, error: null,
    }), true);
    return render(h(AdminSecurityView, {
      data, shouldRun: true, initialFilter: "all", onRefresh: () => {},
    }), "/admin/security?run=1");
  };
  const withRow = (index, count, status) => clean.map((row, i) => i === index
    ? { ...row, count, status, samples: [] } : row);
  for (let i = 0; i < clean.length; i++) {
    for (let j = 0; j < counts.length; j++) {
      for (const status of ["ok", "warn", "info"]) {
        const html = await view(withRow(i, counts[j], status));
        const context = clean[i].id + ":" + counts[j] + ":" + status;
        if (expected[i][j].includes(status)) {
          assert.match(html, status === "warn" ? /セキュリティ WARN 1 件/ : /セキュリティ WARN はありません/, context);
          assert.match(html, /状態フィルタ/, context);
        } else {
          assert.match(html, /診断結果を取得できませんでした/, context);
          assert.doesNotMatch(html, /WARN はありません|状態フィルタ|<table/, context);
        }
      }
    }
    for (const count of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const html = await view(withRow(i, count, "ok"));
      assert.match(html, /診断結果を取得できませんでした/, clean[i].id);
      assert.doesNotMatch(html, /WARN はありません|状態フィルタ|<table/, clean[i].id);
    }
  }
  // Preserve the real producer's four-check group-failure receipt. In
  // particular, a failed orphan check is WARN/1, not INFO/1.
  const failedGroup = clean.map((row, i) => [3, 4, 6, 7].includes(i)
    ? { ...row, count: 1, status: "warn", samples: [],
      note: "検査自体の実行に失敗しました。DB接続、schema適用状況、サーバーログを確認してください。" }
    : row);
  assert.match(await view(failedGroup), /セキュリティ WARN 4 件/);
  assert.match(await view(withRow(7, 2, "info")), /セキュリティ WARN はありません/);
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


function workerMonitoringFixture() {
  const emptyQueue = { pending: 1, processing: 0, failed: 2, deadLetter: 3, stuck: 0, oldestPendingAt: 1_700_000_000 };
  return {
    generatedAt: 1_700_000_000,
    operationMode: "normal", overallLevel: "critical", overallMessage: "通知が滞留しています",
    jobs: [
      ["sync-jobs", "YouTube同期", "/admin/youtube-sync", 3600],
      ["fast-jobs", "通知", "/admin/notifications", 3600],
      ["content-jobs", "静的JSON", "/admin/static-builds", 3600],
      ["fast-jobs:slot-deadline-reminders", "締切", "/admin/notifications", 3600],
      ["content-jobs:cleanup", "整理", "/admin/static-builds", 86400],
    ].map(([jobName, label, detailHref, cadenceSeconds], i) => ({
      jobName, label, detailHref, cadenceSeconds, level: i === 0 ? "critical" : "ok",
      message: i === 0 ? "ジョブ失敗" : "正常", leaseExpiresAt: null, lastStartedAt: null,
      lastSucceededAt: null, lastFailedAt: null, lastErrorCode: i === 0 ? "sync_failed" : null,
      nextExpectedAt: null,
    })),
    notifications: emptyQueue, staticRebuilds: { ...emptyQueue, pending: 0, failed: 0, deadLetter: 0 },
    youtube: { eligible: 1, pending: 2, stale: 0, failed: 4, oldestPendingAt: null },
    scores: { eligible: 1, stale: 0, oldestUpdatedAt: null },
    artifacts: [{ targetType: "top", generatedAt: null }],
    pipelines: [
      ["youtube", "YouTube", "/admin/youtube-sync", 2400],
      ["notifications", "通知", "/admin/notifications", 8000],
      ["static", "静的JSON", "/admin/static-builds", 1500],
      ["scores", "スコア", "/admin/static-builds", 3600],
    ].map(([id, label, detailHref, capacityPerDay], i) => ({
      id, label, detailHref, capacityPerDay, level: i === 0 ? "warn" : "ok",
      backlog: i === 0 ? 4 : 0, estimatedDrainMinutes: i === 0 ? 70 : 0, note: "stale",
    })),
    queueWakeFailures: { notification_available: { at: 1_700_000_000, reason: "wake_failed" }, static_rebuild_available: null },
  };
}

test("U02b Worker dashboard shows CURRENT cron, queue, pipelines, artifacts and wake failure details", () => {
  const snapshot = workerMonitoringFixture();
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
  const dynamicSyncCount = [...snapshot.jobs, ...snapshot.pipelines]
    .filter(row => row.detailHref === "/admin/youtube-sync").length;
  const baselineSyncLinks = dom.querySelectorAll('a[href="/admin/youtube-sync"]').length;
  assert.equal(baselineSyncLinks, dynamicSyncCount + 1,
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
      baselineSyncLinks - dynamicSyncCount,
      "invalid worker and pipeline links are removed but the trusted static queue link remains",
    );
  }
});

test("MIG-0736 Worker queue, pipeline and total counts preserve CURRENT numeric formatting", async () => {
  const baseline = workerMonitoringFixture();
  const formatCases = [
    [-1, "0"], [-0.1, "0"], [-1000000, "0"], [0, "0"], [0.5, "0.5"],
    [999, "999"], [1000, "1.0k"], [1500, "1.5k"], [9999, "10.0k"],
    [10000, "10k"], [999999, "999k"], [1000000, "1.0M"],
    [1500000, "1.5M"], [10000000, "10M"], [15000000, "15M"],
  ];
  function snapshotWithCount(value) {
    return {
      ...baseline,
      notifications: { ...baseline.notifications, pending: value, failed: value, deadLetter: 0, stuck: value },
      staticRebuilds: { ...baseline.staticRebuilds, failed: 0, deadLetter: 0 },
      youtube: { ...baseline.youtube, failed: 0, pending: value },
      pipelines: baseline.pipelines.map(pipeline => ({ ...pipeline, backlog: value, capacityPerDay: value })),
    };
  }
  function assertRenderedCounts(data, expected) {
    const html = render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
    const dom = new JSDOM(html).window.document;
    const tables = dom.querySelectorAll("table");
    assert.equal(tables.length, 3);
    const queueRows = tables[1].querySelectorAll("tbody tr");
    for (const index of [1, 3, 5]) assert.equal(queueRows[0].children[index].textContent, expected);
    assert.equal(queueRows[2].children[1].textContent, expected);
    for (const row of tables[2].querySelectorAll("tbody tr")) {
      assert.equal(row.children[2].textContent, expected);
      assert.equal(row.children[3].textContent, expected);
    }
    const totalLabel = [...dom.querySelectorAll("div")].find(node => node.textContent === "失敗データ");
    assert.equal(totalLabel?.nextElementSibling?.textContent, expected);
  }
  for (const [value, expected] of formatCases) {
    const snapshot = snapshotWithCount(value);
    const data = await getAdminWorkers(async () => response(200, { snapshot, error: null }));
    assert.equal(data.status, "ok");
    assertRenderedCounts(data, expected);
  }
  // JSON cannot carry these numeric values, so exercise the view directly.
  // A total of individually finite values can also overflow during addition.
  for (const value of [NaN, Infinity, -Infinity]) {
    assertRenderedCounts({ status: "ok", data: { snapshot: snapshotWithCount(value), error: null } }, "0");
  }
  const overflow = snapshotWithCount(0);
  overflow.notifications.failed = Number.MAX_VALUE;
  overflow.staticRebuilds.failed = Number.MAX_VALUE;
  const data = await getAdminWorkers(async () => response(200, { snapshot: overflow, error: null }));
  assert.equal(data.status, "ok");
  const html = render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
  const dom = new JSDOM(html).window.document;
  const totalLabel = [...dom.querySelectorAll("div")].find(node => node.textContent === "失敗データ");
  assert.equal(totalLabel?.nextElementSibling?.textContent, "0");
  assert.doesNotMatch(html, /InfinityM|NaNM/);
});

test("MIG-0736 Worker monitoring requires complete identities and a consistent aggregate level", async () => {
  const baseline = workerMonitoringFixture();
  const clean = {
    ...baseline, overallLevel: "ok", overallMessage: "内部記録上、バックグラウンド処理は想定範囲内です。",
    jobs: baseline.jobs.map(job => ({ ...job, level: "ok", lastErrorCode: null })),
    pipelines: baseline.pipelines.map(pipeline => ({ ...pipeline, level: "ok" })),
  };
  const show = async snapshot => {
    const data = await getAdminWorkers(async () => response(200, { snapshot, error: null }));
    return render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
  };
  const changeJob = (index, fields) => clean.jobs.map((row, i) => i === index ? { ...row, ...fields } : row);
  const changePipeline = (index, fields) => clean.pipelines.map((row, i) => i === index ? { ...row, ...fields } : row);
  const invalid = [
    { ...clean, jobs: [] },
    { ...clean, pipelines: [] },
    ...clean.jobs.map((_, i) => ({ ...clean, jobs: clean.jobs.filter((_, j) => i !== j) })),
    ...clean.pipelines.map((_, i) => ({ ...clean, pipelines: clean.pipelines.filter((_, j) => i !== j) })),
    ...clean.jobs.map((row, i) => ({ ...clean, jobs: changeJob(i, { jobName: clean.jobs[(i + 1) % clean.jobs.length].jobName }) })),
    ...clean.pipelines.map((row, i) => ({ ...clean, pipelines: changePipeline(i, { id: clean.pipelines[(i + 1) % clean.pipelines.length].id }) })),
    { ...clean, jobs: [...clean.jobs, clean.jobs[0]] },
    { ...clean, pipelines: [...clean.pipelines, clean.pipelines[0]] },
    { ...clean, jobs: changeJob(0, { jobName: "unexpected-job" }) },
    { ...clean, pipelines: changePipeline(0, { id: "unexpected-pipeline" }) },
    { ...clean, overallLevel: "warn" },
    { ...clean, overallLevel: "critical" },
    { ...clean, overallLevel: "unknown" },
    ...["warn", "unknown", "critical"].map(level => ({ ...clean, jobs: changeJob(0, { level }) })),
    ...["warn", "critical", "running", "unknown"].map(level => ({ ...clean, pipelines: changePipeline(0, { level }) })),
    { ...baseline, overallLevel: "warn" },
  ];
  for (const snapshot of invalid) {
    const html = await show(snapshot);
    assert.match(html, /監視情報の取得に失敗しました/);
    assert.doesNotMatch(html, /Cron実行状態|処理能力と滞留|内部記録上|グローバル静的JSONの最終生成/);
  }

  // Normal running Cron, optional artifact history and queue wake alert
  // are not reasons to reclassify the producer's overall level.
  for (const snapshot of [
    clean,
    { ...clean, jobs: [...clean.jobs].reverse(), pipelines: [...clean.pipelines].reverse(), artifacts: [] },
    { ...clean, jobs: changeJob(0, { level: "running" }) },
    { ...clean, jobs: changeJob(0, { level: "unknown" }), overallLevel: "warn" },
    { ...clean, jobs: changeJob(0, { level: "warn" }), overallLevel: "warn" },
    { ...clean, pipelines: changePipeline(0, { level: "warn" }), overallLevel: "warn" },
    { ...clean, jobs: changeJob(0, { level: "critical" }), pipelines: changePipeline(0, { level: "warn" }), overallLevel: "critical" },
    baseline,
  ]) {
    const html = await show(snapshot);
    assert.match(html, /Cron実行状態/);
    assert.match(html, /処理能力と滞留/);
    assert.match(html, /Queue wake 最終失敗/);
    assert.doesNotMatch(html, /監視情報の取得に失敗しました/);
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


test("MIG-0736 Worker error panel preserves CURRENT presentation without stale snapshot data", () => {
  const snapshot = workerMonitoringFixture();
  const cases = [
    [{ status: "anonymous" }, "ログインが必要です。"],
    [{ status: "forbidden" }, "閲覧権限がありません。"],
    [{ status: "notFound" }, "閲覧権限がありません。"],
    [{ status: "unsupported" }, "監視機能は現在利用できません。"],
    [{ status: "unavailable" }, "監視情報の取得に失敗しました。"],
    [{ status: "ok", data: { snapshot, error: "query_failed" } }, "監視情報の取得に失敗しました。"],
    [{ status: "ok", data: { snapshot: { ...snapshot, jobs: [] }, error: null } }, "監視情報の取得に失敗しました。"],
  ];
  for (const [data, message] of cases) {
    const html = render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
    const dom = new JSDOM(html);
    try {
      const doc = dom.window.document;
      const panels = doc.querySelectorAll('[role="alert"]');
      assert.equal(panels.length, 1, data.status);
      const panel = panels[0];
      assert.equal(panel.tagName, "DIV");
      assert.equal(panel.textContent.trim(), message);
      const style = panel.getAttribute("style");
      for (const declaration of [
        "margin-top:18px", "padding:12px 16px",
        "border:1px solid var(--accent-danger, #dc2626)",
        "border-radius:var(--radius-md)", "color:var(--accent-danger, #991b1b)",
      ]) assert.ok(style?.split(";").includes(declaration), declaration);
      assert.equal(doc.querySelectorAll("table").length, 0);
      assert.doesNotMatch(html, /query_failed|sync_failed|wake_failed|通知が滞留しています/);
      assert.ok([...doc.querySelectorAll("button")].some(button => button.textContent.trim() === "最新状態へ更新"));
    } finally {
      dom.window.close();
    }
  }
  for (const [data, message] of [
    [{ status: "loading" }, "読み込み中…"],
    [{ status: "ok", data: { snapshot: null, error: null } }, "監視スナップショットがありません。"],
  ]) {
    const html = render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
    const dom = new JSDOM(html);
    try {
      assert.equal(dom.window.document.querySelectorAll('[role="alert"]').length, 0);
      assert.equal(dom.window.document.querySelector('[role="status"]')?.textContent.trim(), message);
    } finally {
      dom.window.close();
    }
  }
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
  // T03: preserve CURRENT read-only warning and exact idle action; no result cards.
  const idleDom = new JSDOM(idle);
  try {
    const doc = idleDom.window.document;
    const card = [...doc.querySelectorAll("section.fn-card")].find(node =>
      node.querySelector("strong")?.textContent === "DB整合性診断は未実行です");
    assert.ok(card);
    const warning = card.querySelector("p.fn-muted");
    assert.equal(warning?.textContent.trim(),
      "全件走査を含む読み取り専用診断です。必要なときだけ実行してください。");
    assert.equal(warning.style.lineHeight, "1.6");
    assert.equal(warning.style.fontSize, "12px");
    assert.equal(card.querySelectorAll("a").length, 1);
    const action = card.querySelector("a");
    assert.equal(action?.getAttribute("href"), "/admin/health/integrity?run=1");
    assert.equal(action?.textContent.trim(), "DB整合性診断を実行");
    assert.equal(card.querySelectorAll("button, article").length, 0);
  } finally {
    idleDom.window.close();
  }
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

test("MIG-0736 integrity preserves CURRENT read-only header and failure card without inventing results", () => {
  const description = "videos / video_events / video_members / slots / 派生行 / audit_logs の参照整合性を読み取り専用で確認します。初期表示では実行せず、必要なときだけ明示的に実行します。";
  const cases = [
    { shouldRun: false, data: { status: "ok", data: { ran: false, results: [] } }, message: "DB整合性診断は未実行です", role: null },
    { shouldRun: true, data: { status: "loading" }, message: "読み込み中…", role: "status" },
    { shouldRun: true, data: { status: "unavailable" }, message: "診断結果を取得できませんでした。", role: "alert" },
    { shouldRun: true, data: { status: "unsupported" }, message: "DB整合性診断は現在利用できません。", role: "alert" },
    { shouldRun: true, data: { status: "anonymous" }, message: "ログインが必要です。", role: "alert" },
    { shouldRun: true, data: { status: "forbidden" }, message: "閲覧権限がありません。", role: "alert" },
    { shouldRun: true, data: { status: "notFound" }, message: "閲覧権限がありません。", role: "alert" },
    { shouldRun: true, data: { status: "ok", data: { ran: false, results: [] } }, message: "診断は実行されませんでした。", role: "status" },
  ];
  for (const { shouldRun, data, message, role } of cases) {
    const html = render(h(AdminIntegrityView, { data, shouldRun, onRefresh: () => {} }), "/admin/health/integrity");
    const dom = new JSDOM(html);
    try {
      const doc = dom.window.document;
      assert.equal(doc.querySelector(".fn-console-lead")?.textContent, description);
      assert.match(doc.querySelector(".fn-console-back")?.textContent ?? "", /ヘルスチェックへ/);
      assert.ok(doc.body.textContent.includes(message));
      if (role) {
        assert.ok([...doc.querySelectorAll(`[role="${role}"]`)].some(node => node.textContent.includes(message)), message);
      }
      const refresh = [...doc.querySelectorAll("button")].find(node => node.textContent.trim() === "最新状態で再チェック");
      if (shouldRun) {
        assert.ok(refresh);
        assert.equal(refresh.parentElement.style.marginTop, "16px");
        assert.equal(refresh.style.marginTop, "");
      } else {
        assert.equal(refresh, undefined);
      }
      const errorCard = doc.querySelector('.fn-card[role="alert"]');
      if (data.status === "unavailable") {
        assert.ok(errorCard);
        assert.equal(errorCard.style.marginTop, "18px");
        assert.match(errorCard.getAttribute("style") ?? "", /border-color:var\(--accent-danger\)/);
        assert.equal(errorCard.querySelector("strong")?.textContent, "エラー");
        assert.equal(errorCard.querySelector("p")?.textContent, message);
      } else {
        assert.equal(errorCard, null);
      }
      assert.doesNotMatch(doc.body.textContent, /総検出件数|危険チェック|警告チェック|確認チェック|問題なし/);
      assert.equal(doc.querySelectorAll("article, table, pre").length, 0);
    } finally {
      dom.window.close();
    }
  }
});

// T03: exercise actual mounted run/idle navigation and refresh cancellation.
// A transport ignoring AbortSignal must not resurrect a cancelled receipt.
test("MIG-0736 integrity explicit run and refresh discard obsolete receipts", async () => {
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
    const target = dom.window.document.createElement("div");
    dom.window.document.body.append(target);
    const root = createRoot(target);
    let mounted = true;
    let navigate;
    const pending = [];
    const fetchFn = (url, init) => new Promise(resolve => pending.push({ url, init, resolve }));
    function Harness() {
      navigate = useNavigate();
      return h(AdminIntegrity, { fetchFn });
    }
    const path = "/admin/health/integrity";
    const go = async to => { await React.act(async () => { navigate(to); }); };
    const finish = async (request, status, body) => {
      await React.act(async () => { request.resolve(response(status, body)); });
    };
    const currentRequest = () => {
      const request = pending.at(-1);
      assert.ok(request);
      assert.equal(request.url, "/api/admin-read/ops/integrity?run=1");
      assert.equal(request.init.method, "GET");
      assert.equal(request.init.cache, "no-store");
      assert.equal(request.init.credentials, "same-origin");
      assert.equal(request.init.signal.aborted, false);
      return request;
    };
    const refreshButton = () => [...target.querySelectorAll("button")]
      .find(node => node.textContent.trim() === "最新状態で再チェック");
    const refresh = async () => {
      const button = refreshButton();
      assert.ok(button);
      const count = pending.length;
      await React.act(async () => { button.click(); });
      assert.equal(pending.length, count + 1);
      return currentRequest();
    };
    const assertNoResults = () => {
      assert.doesNotMatch(target.textContent, /総検出件数|危険チェック|警告チェック|確認チェック|問題なし|private-integrity-marker/);
      assert.equal(target.querySelectorAll("article, table, pre").length, 0);
    };
    const assertMessage = (role, message) => {
      assert.ok([...target.querySelectorAll(`[role="${role}"]`)]
        .some(node => node.textContent.includes(message)), message);
      assertNoResults();
    };
    const assertIdle = () => {
      assert.match(target.textContent, /DB整合性診断は未実行です/);
      assert.equal(refreshButton(), undefined);
      assert.equal(target.querySelector('[role="alert"]'), null);
      assert.doesNotMatch(target.textContent, /診断は実行されませんでした|現在利用できません|ログインが必要|閲覧権限がありません|診断結果を取得できませんでした/);
      assertNoResults();
    };
    try {
      await React.act(async () => {
        root.render(h(MemoryRouter, { initialEntries: [path] }, h(Harness)));
      });
      assert.equal(pending.length, 0);
      assertIdle();
      const action = [...target.querySelectorAll("a")]
        .find(node => node.textContent.trim() === "DB整合性診断を実行");
      assert.ok(action);
      assert.equal(action.getAttribute("href"), path + "?run=1");
      await React.act(async () => { action.click(); });
      assert.equal(pending.length, 1);
      const obsolete = currentRequest();
      assertMessage("status", "読み込み中…");

      // Browser Back and malformed duplicate run do not initiate any reads.
      await go(-1);
      assert.equal(obsolete.init.signal.aborted, true);
      assert.equal(pending.length, 1);
      assertIdle();
      await finish(obsolete, 401, {});
      assertIdle();
      await go(1);
      assert.equal(pending.length, 2);
      const duplicateObsolete = currentRequest();
      await go(path + "?run=1&run=1");
      assert.equal(duplicateObsolete.init.signal.aborted, true);
      assert.equal(pending.length, 2);
      assertIdle();
      await finish(duplicateObsolete, 501, {});
      assertIdle();
      await go(-1);
      assert.equal(pending.length, 3);
      await finish(currentRequest(), 501, {});
      assertMessage("alert", "DB整合性診断は現在利用できません。");

      // Newest explicit denial wins over older late responses, and each new
      // retry gets one cancellable GET. Never display a fabricated result.
      for (const [status, body, message] of [
        [401, {}, "ログインが必要です。"],
        [403, { redirect: "/dashboard" }, "閲覧権限がありません。"],
        [404, {}, "閲覧権限がありません。"],
        [501, {}, "DB整合性診断は現在利用できません。"],
      ]) {
        const stale = await refresh();
        const active = await refresh();
        assert.equal(stale.init.signal.aborted, true);
        await finish(active, status, body);
        assertMessage("alert", message);
        await finish(stale, 200, { ran: false, results: [] });
        assertMessage("alert", message);
        assert.doesNotMatch(target.textContent, /診断は実行されませんでした/);
      }
      // A fresh key rejects a shape-invalid result with fixed error text.
      const count = pending.length;
      await go(path);
      assert.equal(pending.length, count);
      assertIdle();
      await go(path + "?run=1");
      assert.equal(pending.length, count + 1);
      await finish(currentRequest(), 200, { ran: true, results: [{ id: "private-integrity-marker" }] });
      assertMessage("alert", "診断結果を取得できませんでした。");
      await finish(await refresh(), 200, { ran: false, results: [] });
      assertMessage("status", "診断は実行されませんでした。");
      assert.equal(target.querySelector('[role="alert"]'), null);

      const departing = await refresh();
      await React.act(async () => root.unmount());
      mounted = false;
      assert.equal(departing.init.signal.aborted, true);
      await finish(departing, 501, {});
      assert.equal(target.textContent, "");
    } finally {
      if (mounted) await React.act(async () => root.unmount());
      target.remove();
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
        return response(200, { status: "all", results: security ? securityResults : url.includes("?deep=1") ? deepResults : operationalResults, error: null, ...(security ? { ran: true } : {}) });
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
      ["/api/admin-read/ops/health"], /運用チェック/, "すべて (5)");
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
            results: (idleUrl ? request.url === idleUrl ? operationalResults : deepResults : securityResults).map((result, i) =>
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
        assert.equal(activeFilter(), idleUrl ? "すべて (22)" : "すべて (10)", path);

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
        assert.equal(activeFilter(), idleUrl ? "すべて (22)" : "すべて (10)", path);
        assert.equal(target.querySelectorAll("tbody tr").length, idleUrl ? 22 : 10, path);
        await go(1);
        assert.equal(activeFilter(), "WARN (1)", path);
        assert.equal(pending.length, count, path);

        // T01/T04: click the actual filter controls, not just URL-derived state.
        // Filtering is local; the global summary/counts remain unchanged.
        const completeRows = idleUrl ? deepResults : securityResults;
        const nav = target.querySelector('nav[aria-label="状態フィルタ"]');
        assert.ok(nav, path);
        const filterButtons = [...nav.querySelectorAll("button")];
        assert.equal(filterButtons.length, 4, path);
        const filterCases = [
          ["all", "すべて"], ["warn", "WARN"], ["info", "INFO"], ["ok", "OK"],
        ];
        const chooseFilter = async (index, rows) => {
          const [status, label] = filterCases[index];
          const expected = status === "all" ? rows : rows.filter(row => row.status === status);
          const button = filterButtons[index];
          assert.equal(button.textContent.trim(), label + " (" + expected.length + ")", path);
          const before = pending.length;
          await React.act(async () => { button.click(); });
          assert.equal(pending.length, before, path);
          assert.equal(activeFilter(), label + " (" + expected.length + ")", path);
          assert.equal(nav.querySelectorAll('button[aria-pressed="true"]').length, 1, path);
          const shown = [...target.querySelectorAll("tbody tr")];
          assert.equal(shown.length, Math.max(expected.length, 1), path);
          if (expected.length === 0) {
            assert.equal(shown[0].cells.length, 1, path);
            assert.equal(shown[0].cells[0].colSpan, 4, path);
            assert.equal(shown[0].textContent.trim(), "フィルタ条件に該当する項目はありません。", path);
          } else {
            assert.deepEqual(shown.map(row => row.cells[1].textContent.trim()),
              expected.map(row => row.status.toUpperCase()), path);
          }
        };
        for (const index of [0, 2, 3, 1]) {
          await chooseFilter(index, completeRows);
          assert.match(target.querySelector('[role="status"]').textContent, /WARN 1 件/, path);
        }
        assert.equal(pending.length, count, path);

        // A fresh complete result can resolve the only warning while WARN is
        // selected. Preserve the selection, report zero rows honestly and
        // allow the user to inspect the remaining OK/INFO rows without refetch.
        const clickRefresh = async () => {
          const button = [...target.querySelectorAll("button")]
            .find(node => node.textContent.trim() === "最新状態を再チェック");
          assert.ok(button, path);
          const before = pending.length;
          await React.act(async () => { button.click(); });
          assert.equal(pending.length, before + 1, path);
          assert.equal(pending.at(-1).url, runUrl, path);
          return pending.at(-1);
        };
        const cleanRows = completeRows.map((row, i) => i === 1
          ? { ...row, status: "ok", count: 0, samples: [] }
          : i === 0 ? { ...row, label: "clean-private-marker" } : row);
        const clean = await clickRefresh();
        await React.act(async () => {
          clean.resolve(response(200, { status: "all", ran: true, error: null, results: cleanRows }));
        });
        assert.equal(activeFilter(), "WARN (0)", path);
        assert.match(target.querySelector('[role="status"]').textContent, /WARN はありません/, path);
        await chooseFilter(1, cleanRows);
        await chooseFilter(3, cleanRows);
        assert.match(target.querySelector("tbody").textContent, /clean-private-marker/, path);
        await chooseFilter(2, cleanRows);
        await chooseFilter(1, cleanRows);
        // Restore the warning on another genuine refresh; no filter reset.
        await finish(await clickRefresh(), "new-run-WARN");
        assert.equal(activeFilter(), "WARN (1)", path);
        assert.match(target.querySelector("tbody").textContent, /new-run-WARN/, path);
        assert.doesNotMatch(target.textContent, /clean-private-marker/, path);

        // Same-key refresh must not retain prior admin results after denial.
        const beforeDenial = pending.length;
        const refresh = [...target.querySelectorAll("button")]
          .find(button => button.textContent.trim() === "最新状態を再チェック");
        assert.ok(refresh, path);
        await React.act(async () => { refresh.click(); });
        assert.equal(pending.length, beforeDenial + 1, path);
        assert.equal(pending.at(-1).url, runUrl, path);
        await React.act(async () => {
          pending.at(-1).resolve(response(403, { redirect: "/dashboard" }));
        });
        assert.match(target.textContent, /閲覧権限がありません/, path);
        assert.doesNotMatch(target.textContent, /new-run-WARN|obsolete-private-result/, path);
        assert.equal(target.querySelector("table"), null, path);

        if (idleUrl) {
          // Return to the operational view after the deep-run denial. A
          // shape-valid partial operational refresh must clear the old table.
          await go(path);
          const fresh = pending.at(-1);
          assert.equal(fresh.url, idleUrl, path);
          assert.notEqual(fresh, current, path);
          await finish(fresh, "full-operational-before-partial");
          assert.match(target.textContent, /full-operational-before-partial/, path);
          const retry = [...target.querySelectorAll("button")]
            .find(button => button.textContent.trim() === "最新状態を再チェック");
          assert.ok(retry, path);
          await React.act(async () => { retry.click(); });
          assert.notEqual(pending.at(-1), fresh, path);
          assert.equal(pending.at(-1).url, idleUrl, path);
          await React.act(async () => {
            pending.at(-1).resolve(response(200, {
              status: "all", error: null, results: [operationalResults[0]],
            }));
          });
          assert.match(target.textContent, /診断結果を取得できませんでした/, path);
          assert.doesNotMatch(target.textContent, /WARN はありません|full-operational-before-partial/, path);
          assert.equal(target.querySelector("table"), null, path);

          // Recover on a fresh operational read, then reject a complete receipt
          // whose positive stuck count claims OK. Neither the old summary nor
          // the contradictory new receipt may survive a refresh.
          await go(runPath);
          await go(path);
          const freshComplete = pending.at(-1);
          assert.equal(freshComplete.url, idleUrl, path);
          await finish(freshComplete, "full-operational-before-contradiction");
          assert.match(target.textContent, /full-operational-before-contradiction/, path);
          const retryComplete = [...target.querySelectorAll("button")]
            .find(button => button.textContent.trim() === "最新状態を再チェック");
          assert.ok(retryComplete, path);
          await React.act(async () => { retryComplete.click(); });
          assert.notEqual(pending.at(-1), freshComplete, path);
          assert.equal(pending.at(-1).url, idleUrl, path);
          await React.act(async () => {
            pending.at(-1).resolve(response(200, {
              status: "all", error: null,
              results: operationalResults.map((row, i) => i === 1 ? { ...row, status: "ok" } : row),
            }));
          });
          assert.match(target.textContent, /診断結果を取得できませんでした/, path);
          assert.doesNotMatch(target.textContent, /WARN はありません|full-operational-before-contradiction/, path);
          assert.equal(target.querySelector("table"), null, path);
        } else {
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

          // Recover via explicit re-entry, then reject a full receipt with
          // a positive risk count mislabeled OK on a same-key refresh.
          await go(runPath + "&run=1");
          assert.match(target.textContent, idleText, path);
          await go(-1);
          const freshComplete = pending.at(-1);
          assert.notEqual(freshComplete, fresh);
          await finish(freshComplete, "full-security-before-contradiction");
          assert.match(target.textContent, /full-security-before-contradiction/, path);
          const retryComplete = [...target.querySelectorAll("button")]
            .find(button => button.textContent.trim() === "最新状態を再チェック");
          assert.ok(retryComplete, path);
          await React.act(async () => { retryComplete.click(); });
          assert.notEqual(pending.at(-1), freshComplete, path);
          assert.equal(pending.at(-1).url, runUrl, path);
          await React.act(async () => {
            pending.at(-1).resolve(response(200, {
              status: "all", ran: true, error: null,
              results: securityResults.map((row, i) => i === 1 ? { ...row, status: "ok" } : row),
            }));
          });
          assert.match(target.textContent, /診断結果を取得できませんでした/, path);
          assert.doesNotMatch(target.textContent, /WARN はありません|full-security-before-contradiction/, path);
          assert.equal(target.querySelector("table"), null, path);
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


// Exercise the mounted refresh controller, rather than just handing a denial
// to AdminWorkersView. The transport deliberately ignores cancellation.
test("MIG-0736 Worker refresh rejects late receipts after authority loss", async () => {
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
    const target = dom.window.document.createElement("div");
    dom.window.document.body.append(target);
    const root = createRoot(target);
    const pending = [];
    const fetchFn = (url, init) => new Promise(resolve => {
      pending.push({ url, init, resolve });
    });
    const refresh = async () => {
      const button = [...target.querySelectorAll("button")]
        .find(node => node.textContent.trim() === "最新状態へ更新");
      assert.ok(button, "refresh remains available");
      const count = pending.length;
      await React.act(async () => { button.click(); });
      assert.equal(pending.length, count + 1);
      const request = pending.at(-1);
      assert.equal(request.url, "/api/admin-read/ops/workers");
      assert.equal(request.init.method, "GET");
      assert.equal(request.init.cache, "no-store");
      assert.equal(request.init.credentials, "same-origin");
      assert.equal(request.init.signal.aborted, false);
      return request;
    };
    const finish = async (request, status, body) => {
      await React.act(async () => { request.resolve(response(status, body)); });
    };
    const snapshot = label => ({ ...workerMonitoringFixture(), overallMessage: label });
    const show = async (request, label) => {
      await finish(request, 200, { snapshot: snapshot(label), error: null });
      assert.ok(target.textContent.includes(label), label);
      assert.equal(target.querySelectorAll("table").length, 3);
    };
    const assertNoSnapshot = (message, prior, late) => {
      assert.ok([...target.querySelectorAll('[role="alert"]')]
        .some(node => node.textContent.trim() === message), message);
      assert.equal(target.querySelectorAll("table").length, 0);
      for (const marker of [prior, late, "Queue wake 最終失敗", "sync_failed", "wake_failed"]) {
        assert.equal(target.textContent.includes(marker), false, marker);
      }
    };
    try {
      await React.act(async () => {
        root.render(h(MemoryRouter, { initialEntries: ["/admin/workers"] }, h(AdminWorkers, { fetchFn })));
      });
      assert.equal(pending.length, 1);
      assert.match(target.textContent, /読み込み中/);
      assert.equal(target.querySelectorAll("table").length, 0);
      await show(pending[0], "private-worker-0");
      const cases = [
        [401, {}, "ログインが必要です。"],
        [403, { redirect: "/dashboard" }, "閲覧権限がありません。"],
        [404, {}, "閲覧権限がありません。"],
        [501, {}, "監視機能は現在利用できません。"],
      ];
      for (const [i, [status, body, message]] of cases.entries()) {
        const prior = "private-worker-" + i;
        const late = "obsolete-worker-" + i;
        const obsolete = await refresh();
        const current = await refresh();
        assert.equal(obsolete.init.signal.aborted, true);
        await finish(current, status, body);
        assertNoSnapshot(message, prior, late);
        // Even a complete, well-formed older response must not restore tables.
        await finish(obsolete, 200, { snapshot: snapshot(late), error: null });
        assertNoSnapshot(message, prior, late);
        await show(await refresh(), "private-worker-" + (i + 1));
      }
      // A shape-valid but incomplete current snapshot must also clear old data.
      const obsolete = await refresh();
      const current = await refresh();
      assert.equal(obsolete.init.signal.aborted, true);
      await finish(current, 200, {
        snapshot: { ...snapshot("incomplete-worker"), jobs: [] }, error: null,
      });
      assertNoSnapshot("監視情報の取得に失敗しました。", "private-worker-4", "incomplete-worker");
      await finish(obsolete, 200, { snapshot: snapshot("obsolete-incomplete"), error: null });
      assertNoSnapshot("監視情報の取得に失敗しました。", "private-worker-4", "obsolete-incomplete");
      await show(await refresh(), "recovered-worker");
      // Unmount aborts the outstanding request as well.
      const departing = await refresh();
      await React.act(async () => root.unmount());
      assert.equal(departing.init.signal.aborted, true);
      await finish(departing, 200, { snapshot: snapshot("after-unmount"), error: null });
      assert.equal(target.textContent, "");
    } finally {
      // unmount() is harmless after the successful explicit unmount above.
      await React.act(async () => root.unmount());
      target.remove();
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


test("MIG-0736 Worker detail links are bound to their CURRENT job and pipeline identity", async () => {
  const baseline = workerMonitoringFixture();
  const destinations = ["/admin/notifications", "/admin/static-builds", "/admin/youtube-sync"];
  const renderSnapshot = async snapshot => {
    const data = await getAdminWorkers(async () => response(200, { snapshot, error: null }));
    assert.equal(data.status, "ok");
    const html = render(h(AdminWorkersView, { data, onRefresh: () => {} }), "/admin/workers");
    return new JSDOM(html);
  };
  // Exercise every valid pair, every other allowlisted destination for that
  // identity, and malformed paths through the actual validated read + view.
  for (const [collection, tableIndex] of [["jobs", 0], ["pipelines", 2]]) {
    for (const [index, row] of baseline[collection].entries()) {
      for (const href of [...destinations, "", "/admin/health", "https://attacker.invalid/"]) {
        const snapshot = {
          ...baseline,
          [collection]: baseline[collection].map((item, i) => i === index ? { ...item, detailHref: href } : item),
        };
        const dom = await renderSnapshot(snapshot);
        try {
          const tables = dom.window.document.querySelectorAll("table");
          assert.equal(tables.length, 3, "a bad detail destination does not discard the valid monitor data");
          for (const [key, otherTable] of [["jobs", 0], ["pipelines", 2]]) {
            const rows = tables[otherTable].querySelectorAll("tbody tr");
            assert.equal(rows.length, baseline[key].length);
            for (const [i, expected] of baseline[key].entries()) {
              const changed = key === collection && i === index;
              const cell = rows[i].lastElementChild;
              const anchor = cell.querySelector("a");
              const context = [key, i, href].join(":");
              if (changed && href !== row.detailHref) {
                assert.equal(anchor === null, true, context);
                assert.equal(cell.textContent, "—", context);
              } else {
                assert.equal(anchor?.getAttribute("href"), expected.detailHref, context);
                assert.equal(anchor?.textContent, key === "jobs" ? "詳細" : "管理", context);
              }
            }
          }
          const queueLinks = [...tables[1].querySelectorAll("tbody tr td:last-child a")];
          assert.deepEqual(queueLinks.map(a => a.getAttribute("href")), destinations);
        } finally {
          dom.window.close();
        }
      }
    }
  }
});

test("MIG-0736 invalid successful diagnostic receipt is distinct from transient transport failure", async () => {
  for (const read of [
    (fn, signal) => getAdminHealth(fn, false, signal),
    (fn, signal) => getAdminHealth(fn, true, signal),
    (fn, signal) => getAdminSecurity(fn, true, signal),
  ]) {
    const invalid = { status: "ok", data: { diagnosticError: "invalid_receipt" } };
    for (const fn of [
      async () => response(200, { status: "all", ran: true, error: null }),
      async () => response(200, { status: "all", ran: true, error: null,
        results: [{ ...results[0], count: "0" }] }),
      async () => response(200, { status: "all", ran: true, error: null,
        results: [{ ...results[0], status: "unexpected" }] }),
      async () => new Response("{", { status: 200 }),
      async () => new Response(new ReadableStream({ start(controller) {
        controller.error(new Error("incomplete receipt"));
      } }), { status: 200 }),
    ]) assert.deepEqual(await read(fn), invalid);
    assert.deepEqual(await read(async () => response(503, {})), { status: "unavailable" });
    assert.deepEqual(await read(async () => { throw new Error("offline"); }), { status: "unavailable" });
    assert.deepEqual(await read(async () => new Response("{", { status: 401 })), { status: "anonymous" });
    assert.deepEqual(await read(async () => new Response("{", { status: 403 })), { status: "forbidden" });
    assert.deepEqual(await read(async () => response(404, {})), { status: "notFound" });
    assert.deepEqual(await read(async () => response(501, {})), { status: "unsupported" });
    const controller = new AbortController();
    assert.deepEqual(await read(async () => {
      controller.abort();
      return new Response("{", { status: 200 });
    }, controller.signal), { status: "unavailable" });
  }
});

test("MIG-0736 invalid 200 replaces old diagnosis and explicit same-key retry recovers", async () => {
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
    for (const [Component, path, endpoint, rows] of [
      [AdminHealth, "/admin/health", "/api/admin-read/ops/health", operationalResults],
      [AdminHealth, "/admin/health?deep=1", "/api/admin-read/ops/health?deep=1", deepResults],
      [AdminSecurity, "/admin/security?run=1", "/api/admin-read/ops/security?run=1", securityResults],
    ]) {
      const target = dom.window.document.createElement("div");
      dom.window.document.body.append(target);
      const root = createRoot(target);
      const pending = [];
      const fetchFn = (url, init) => new Promise((resolve, reject) => {
        pending.push({ url, init, resolve, reject });
      });
      const healthy = label => ({
        status: "all", ran: true, error: null,
        results: rows.map((row, index) => ({
          ...row, ...(row.status === "warn" ? { status: "ok", count: 0, samples: [] } : {}),
          ...(index === 0 ? { label } : {}),
        })),
      });
      const finish = async (request, value) => {
        await React.act(async () => { request.resolve(value); });
      };
      const confirmHealthy = label => {
        assert.ok(target.textContent.includes(label), path);
        assert.match(target.textContent, /WARN はありません/, path);
        assert.ok(target.querySelector("table"), path);
      };
      const retry = async () => {
        const button = [...target.querySelectorAll("button")]
          .find(element => element.textContent.trim() === "最新状態を再チェック");
        assert.ok(button, path);
        const count = pending.length;
        await React.act(async () => button.click());
        assert.equal(pending.length, count + 1, path);
        const request = pending.at(-1);
        assert.equal(request.url, endpoint, path);
        assert.equal(request.init.method, "GET");
        assert.equal(request.init.credentials, "same-origin");
        assert.equal(request.init.cache, "no-store");
        return request;
      };
      try {
        await React.act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(Component, { fetchFn }))));
        assert.equal(pending.length, 1, path);
        assert.equal(pending[0].url, endpoint);
        await finish(pending[0], response(200, healthy("fresh-receipt-0")));
        confirmHealthy("fresh-receipt-0");
        const invalidReceipts = [
          () => response(200, { status: "all", ran: true, error: null }),
          () => new Response("{", { status: 200 }),
          () => new Response(new ReadableStream({ start(controller) {
            controller.error(new Error("provider-only-marker"));
          } }), { status: 200 }),
          () => response(200, { ...healthy("invalid-private"), results: [
            { ...rows[0], count: "0" }, ...rows.slice(1),
          ] }),
          // Schema-valid receipts which fail the existing completeness rules.
          () => { const dto = healthy("invalid-private"); return response(200, {
            ...dto, results: dto.results.slice(0, -1),
          }); },
          () => { const dto = healthy("invalid-private"); return response(200, {
            ...dto, results: [...dto.results.slice(0, -1), dto.results[0]],
          }); },
          () => { const dto = healthy("invalid-private"); return response(200, {
            ...dto, results: [{ ...dto.results[0], count: -1 }, ...dto.results.slice(1)],
          }); },
          () => { const dto = healthy("invalid-private"); return response(200, {
            ...dto, results: [{ ...dto.results[0], status: "warn" }, ...dto.results.slice(1)],
          }); },
          ...(Component === AdminSecurity ? [() => response(200, {
            ...healthy("invalid-private"), ran: false,
          })] : []),
        ];
        for (const [index, invalid] of invalidReceipts.entries()) {
          const request = await retry();
          const afterRequest = pending.length;
          await finish(request, invalid());
          assert.equal(pending.length, afterRequest, path + ": no automatic retry");
          assert.match(target.textContent, /診断結果を取得できませんでした/, path);
          assert.doesNotMatch(target.textContent, /WARN はありません|fresh-receipt-|provider-only-marker|invalid-private/, path);
          assert.equal(target.querySelector("table"), null, path);
          const next = "fresh-receipt-" + (index + 1);
          await finish(await retry(), response(200, healthy(next)));
          confirmHealthy(next);
        }
        // Real transient failures preserve the last successful same-key receipt.
        await finish(await retry(), response(503, {}));
        confirmHealthy("fresh-receipt-" + invalidReceipts.length);
        const offline = await retry();
        await React.act(async () => offline.reject(new Error("offline")));
        confirmHealthy("fresh-receipt-" + invalidReceipts.length);
        // A newer manual refresh wins over an obsolete malformed response.
        const obsolete = await retry();
        const current = await retry();
        assert.equal(obsolete.init.signal.aborted, true);
        await finish(current, response(200, healthy("fresh-after-race")));
        await finish(obsolete, new Response("{", { status: 200 }));
        confirmHealthy("fresh-after-race");
        // Denial clears the prior receipt and never offers the invalid-receipt retry.
        await finish(await retry(), new Response("{", { status: 403 }));
        assert.match(target.textContent, /閲覧権限がありません/, path);
        assert.doesNotMatch(target.textContent, /fresh-after-race|WARN はありません|最新状態を再チェック/, path);
        assert.equal(target.querySelector("table"), null, path);
      } finally {
        await React.act(async () => root.unmount());
        target.remove();
      }
    }
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
