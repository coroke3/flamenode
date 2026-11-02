// MIG-0642 (SA-045..049, SA-051..055): Hono admin writes against the atomic
// node:sqlite D1 fake. Offline: never touches production D1/KV/Queue.
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { createAdminRoutes } from "../src/routes/admin/index.ts";
import { createAdminD1, seedBase } from "./helpers/sqliteD1.mjs";
import {
  AdminTermsDraftBodySchema,
  AdminEditableFieldsBodySchema,
} from "@flamenode/contracts";

const SITE = "https://app.flamenode.example";
const ADMIN = { id: "admin-1", name: "Admin", email: null, image: null, role: "admin", is_banned: 0, active_x_user_id: null };

function setup({ user = ADMIN, settings = "normal", beforeRead } = {}) {
  const { db: rawDb, sqlite, stats } = createAdminD1();
  sqlite.exec(`
    ALTER TABLE "user" ADD COLUMN is_notification_enabled INTEGER DEFAULT 1;
    DROP TABLE terms_versions;
    CREATE TABLE terms_versions (
      id TEXT PRIMARY KEY, version_label TEXT NOT NULL, body_markdown TEXT NOT NULL, status TEXT DEFAULT 'draft',
      severity TEXT DEFAULT 'minor', published_at INTEGER, created_by_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE notification_outbox (
      id TEXT PRIMARY KEY, recipient_user_id TEXT, type TEXT NOT NULL, payload_json TEXT NOT NULL,
      delivery_route TEXT, correlation_id TEXT, status TEXT DEFAULT 'pending', attempt_count INTEGER DEFAULT 0,
      processing_started_at INTEGER, lease_token TEXT, lease_expires_at INTEGER, next_attempt_at INTEGER,
      last_error TEXT, processed_at INTEGER, event_id TEXT, dedupe_key TEXT, created_at INTEGER NOT NULL
    );
  `);
  seedBase(sqlite, { role: user?.role ?? "admin", settings });
  sqlite.prepare("INSERT INTO \"user\" (id,name,role,is_tos_accepted,is_banned,is_notification_enabled) VALUES ('u-off','Off','user',1,0,0)").run();
  // Wrap D1 so a test can race a concurrent writer right after a handler preflight read.
  const db = {
    ...rawDb,
    prepare: (s) => {
      const p = rawDb.prepare(s);
      return {
        bind: (...params) => {
          const q = p.bind(...params);
          const hook = (fn) => async () => {
            const r = await fn();
            if (beforeRead) beforeRead(s, sqlite);
            return r;
          };
          return { ...q, first: hook(q.first), all: hook(q.all) };
        },
      };
    },
  };
  const sends = [];
  const queue = { send: async (m) => sends.push(m), sendBatch: async (m) => sends.push(m) };
  const hono = new Hono();
  hono.route("/api/admin", createAdminRoutes({ session: async (c, next) => { c.set("user", user); c.set("sessionState", user ? "user" : "none"); await next(); } }));
  const env = { DB: db, NEXT_PUBLIC_SITE_URL: SITE, NOTIFICATION_QUEUE: queue, STATIC_REBUILD_QUEUE: queue };
  const request = (method, path, body, headers = { Origin: SITE }) =>
    hono.request("/api/admin" + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const seedTerms = (row) => sqlite.prepare(
    "INSERT INTO terms_versions (id,version_label,body_markdown,status,severity,published_at,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(row.id, row.version_label ?? "v", row.body_markdown ?? "b", row.status ?? "draft", row.severity ?? "minor", row.published_at ?? null, "admin-1", 100, 100);
  const seedNotification = (row) => sqlite.prepare(
    "INSERT INTO notification_outbox (id,recipient_user_id,type,payload_json,delivery_route,status,attempt_count,last_error,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(row.id, row.recipient ?? "admin-1", row.type ?? "video_approved", row.payload ?? '{"content":"hi"}', row.route ?? "dm", row.status ?? "failed", row.attempts ?? 5, row.error ?? "boom", row.dedupe ?? null, row.created_at ?? 100);
  const audits = () => sqlite.prepare("SELECT * FROM audit_logs ORDER BY created_at, id").all();
  return { sqlite, stats, request, count, seedTerms, seedNotification, audits, sends };
}

const ROUTES = [
  ["POST", "/terms", { version_label: "v1", body_markdown: "x" }],
  ["PATCH", "/terms/t1", { version_label: "v1", body_markdown: "x" }],
  ["POST", "/terms/t1/publish", {}],
  ["POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS" }],
  ["POST", "/terms/t1/archive", {}],
  ["PUT", "/permissions/editable-fields", { default_editable_fields: [], upcoming_editable_fields: [] }],
  ["POST", "/notifications/n1/retry", {}],
  ["POST", "/notifications/n1/cancel", {}],
  ["POST", "/notifications/n1/force-resend", {}],
  ["POST", "/notifications/retry-failed", {}],
];

test("MIG-0642 contracts keep the CURRENT FormData key names", () => {
  assert.equal(AdminTermsDraftBodySchema.safeParse({ version_label: "a", body_markdown: "b", severity: "major" }).success, true);
  assert.equal(AdminEditableFieldsBodySchema.safeParse({ default_editable_fields: ["title"] }).success, true);
  assert.equal(AdminEditableFieldsBodySchema.safeParse({ default_editable_fields: "title" }).success, false);
});

test("MIG-0642 T02: another origin stops all ten operations before any D1 read", async () => {
  for (const [method, path, body] of ROUTES) {
    const x = setup();
    const r = await x.request(method, path, body, { Origin: "https://evil.invalid" });
    assert.equal(r.status, 403, path);
    assert.equal((await r.json()).reason, "invalid_origin");
    assert.equal(x.stats.reads, 0, path);
    assert.equal(x.count("audit_logs"), 0);
  }
});

test("MIG-0642 T02: a non-admin and a stopped CostGuard write nothing", async () => {
  for (const [method, path, body] of ROUTES) {
    const x = setup({ user: { ...ADMIN, role: "moderator" } });
    const r = await x.request(method, path, body);
    assert.equal(r.status, 403, path);
    assert.equal(x.count("audit_logs"), 0);
    const m = setup({ settings: "maintenance" });
    m.seedTerms({ id: "t1" });
    const denied = await m.request(method, path, body);
    assert.equal(denied.status, 503, path);
    assert.equal((await denied.json()).reason, "maintenance_mode");
    assert.equal(m.count("audit_logs"), 0);
    assert.equal(m.count("static_rebuild_queue"), 0);
  }
});

const FEATURE_KEYS = [
  "admin_terms_create", "admin_terms_update", "admin_terms_publish", "admin_terms_broadcast", "admin_terms_archive",
  "admin_permissions", "admin_notifications", "admin_notifications", "admin_notifications", "admin_notifications",
];

test("MIG-0642 T02: each route is stopped only by its own CostGuard feature key", async () => {
  for (const disabled of new Set(FEATURE_KEYS)) {
    for (const [i, [method, path, body]] of ROUTES.entries()) {
      const x = setup();
      x.sqlite.prepare("UPDATE system_settings SET disabled_features_json = ?").run(JSON.stringify([disabled]));
      const r = await x.request(method, path, body);
      const j = await r.json().catch(() => ({}));
      const blocked = r.status === 503 && j.reason === "cost_guard_blocked";
      assert.equal(blocked, FEATURE_KEYS[i] === disabled, `${disabled} vs ${method} ${path} -> ${r.status}`);
      if (blocked) assert.equal(x.count("audit_logs"), 0);
    }
  }
});

test("MIG-0642 T01 SA-051: create inserts a draft + CREATE long_audit, no queue", async () => {
  const x = setup();
  const r = await x.request("POST", "/terms", { id: "t-new", version_label: " v1 ", body_markdown: "本文", severity: "major" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: "t-new" });
  const row = x.sqlite.prepare("SELECT * FROM terms_versions").get();
  assert.equal(row.status, "draft");
  assert.equal(row.version_label, "v1");
  assert.equal(row.severity, "major");
  assert.equal(row.published_at, null);
  assert.equal(row.created_by_user_id, "admin-1");
  const [audit] = x.audits();
  assert.equal(audit.operation, "CREATE");
  assert.equal(audit.context, "admin_terms_create");
  assert.equal(audit.retention_class, "long_audit");
  assert.deepEqual(Object.keys(JSON.parse(audit.after_json)), ["id", "version_label", "body_markdown", "status", "severity", "published_at", "created_by_user_id", "created_at", "updated_at"]);
  assert.equal(x.count("static_rebuild_queue"), 0);
  const bad = await x.request("POST", "/terms", { version_label: "", body_markdown: "x" });
  assert.equal(bad.status, 400);
  assert.equal(x.count("terms_versions"), 1);
});

test("MIG-0642 T01 SA-052: update is draft-only; the path id wins", async () => {
  const x = setup();
  x.seedTerms({ id: "t1" });
  x.seedTerms({ id: "t2", status: "published", published_at: 50 });
  const r = await x.request("PATCH", "/terms/t1", { id: "t2", version_label: "new", body_markdown: "nb", severity: "major" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: "t1" });
  assert.equal(x.sqlite.prepare("SELECT version_label FROM terms_versions WHERE id='t1'").get().version_label, "new");
  assert.equal(x.sqlite.prepare("SELECT version_label FROM terms_versions WHERE id='t2'").get().version_label, "v");
  const [audit] = x.audits();
  assert.equal(audit.context, "admin_terms_update");
  assert.equal(JSON.parse(audit.before_json).version_label, "v");
  assert.equal(JSON.parse(audit.after_json).version_label, "new");
  const published = await x.request("PATCH", "/terms/t2", { version_label: "n", body_markdown: "b" });
  assert.equal(published.status, 409);
  assert.equal((await published.json()).message, "下書き状態のバージョンのみ編集できます。");
  assert.equal((await x.request("PATCH", "/terms/none", { version_label: "n", body_markdown: "b" })).status, 404);
  assert.equal(x.audits().length, 1);
});

test("MIG-0642 T01 SA-053: publish archives the old version and queues rules/global in one batch", async () => {
  const x = setup();
  x.seedTerms({ id: "old", status: "published", published_at: 500 });
  x.seedTerms({ id: "t1" });
  const r = await x.request("POST", "/terms/t1/publish", {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: "t1", pendingPublicReflection: true });
  const old = x.sqlite.prepare("SELECT * FROM terms_versions WHERE id='old'").get();
  const next = x.sqlite.prepare("SELECT * FROM terms_versions WHERE id='t1'").get();
  assert.equal(old.status, "archived");
  assert.equal(next.status, "published");
  assert.ok(next.published_at >= 501);
  const q = x.sqlite.prepare("SELECT * FROM static_rebuild_queue").all();
  assert.equal(q.length, 1);
  assert.deepEqual([q[0].target_type, q[0].target_id, q[0].reason, q[0].priority, q[0].status], ["rules", "global", "admin_terms_publish", "high", "pending"]);
  const audits = x.audits();
  assert.equal(audits.length, 2);
  assert.ok(audits.every((a) => a.context === "admin_terms_publish" && a.retention_class === "long_audit"));
  assert.deepEqual(audits.map((a) => a.reason).sort(), ["新しい規約公開に伴う旧版アーカイブ", "規約版の公開"].sort());
  assert.equal(x.stats.batches, 1);
  // idempotent for an already published version; archived is rejected
  const again = await x.request("POST", "/terms/t1/publish", {});
  assert.deepEqual(await again.json(), { ok: true, id: "t1" });
  const archivedBody = await (await x.request("POST", "/terms/old/publish", {})).json();
  assert.equal(archivedBody.message, "アーカイブ済みの規約は再公開できません。");
  assert.equal(x.count("static_rebuild_queue"), 1);
});

test("MIG-0642 T01 SA-053: two published rows stop the publish", async () => {
  const x = setup();
  x.seedTerms({ id: "p1", status: "published", published_at: 1 });
  x.seedTerms({ id: "p2", status: "published", published_at: 2 });
  x.seedTerms({ id: "t1" });
  const r = await x.request("POST", "/terms/t1/publish", {});
  assert.equal(r.status, 409);
  assert.equal((await r.json()).message, "公開中の規約が複数存在するため処理を停止しました。");
  assert.equal(x.count("audit_logs"), 0);
});

test("MIG-0642 T01 SA-054: broadcast audits only (no DM, no outbox, no queue), 30 per page", async () => {
  const x = setup();
  x.seedTerms({ id: "t1", status: "published", severity: "major", published_at: 900 });
  // the acting admin already accepted the latest major version (CURRENT identity guard)
  x.sqlite.prepare("UPDATE \"user\" SET accepted_terms_version_id='t1' WHERE id='admin-1'").run();
  for (let i = 0; i < 31; i++) {
    x.sqlite.prepare("INSERT INTO \"user\" (id,name,role,is_tos_accepted,is_banned,is_notification_enabled) VALUES (?,?,?,?,?,?)")
      .run(`m-${String(i).padStart(2, "0")}`, "n", "user", 1, 0, 1);
  }
  const bad = await x.request("POST", "/terms/t1/reaccept-broadcast", { confirm: "no" });
  assert.equal(bad.status, 400);
  const r = await x.request("POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS", content: "お知らせ" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.enqueued, 0);
  assert.equal(body.cursor, "m-29");
  assert.equal(body.message, "Discord DM は送信しません。対象ユーザーにはサイト上の再同意案内が表示されます。");
  const [audit] = x.audits();
  assert.equal(audit.context, "admin_terms_broadcast");
  assert.equal(audit.reason, "再同意案内（DMなし） batch cursor= targets=30 note=お知らせ");
  assert.equal(x.count("notification_outbox"), 0);
  assert.equal(x.count("static_rebuild_queue"), 0);
  const next = await (await x.request("POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS", cursor: "m-29" })).json();
  assert.equal(next.cursor, "m-30");
  const done = await (await x.request("POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS", cursor: "m-30" })).json();
  assert.deepEqual(done, { ok: true, message: "対象がありません。", enqueued: 0, cursor: "m-30" });
  x.seedTerms({ id: "d", status: "draft" });
  const draft = await x.request("POST", "/terms/d/reaccept-broadcast", { confirm: "TERMS" });
  assert.equal(draft.status, 409);
  assert.equal((await draft.json()).message, "公開中の規約だけ通知できます。");
});

test("MIG-0642 T01 SA-055: archive queues a rebuild only when it was published", async () => {
  const x = setup();
  x.seedTerms({ id: "pub", status: "published", published_at: 5 });
  x.seedTerms({ id: "dr" });
  const draft = await x.request("POST", "/terms/dr/archive", {});
  assert.deepEqual(await draft.json(), { ok: true, id: "dr" });
  assert.equal(x.count("static_rebuild_queue"), 0);
  const pub = await x.request("POST", "/terms/pub/archive", {});
  assert.deepEqual(await pub.json(), { ok: true, id: "pub", pendingPublicReflection: true });
  assert.equal(x.sqlite.prepare("SELECT reason FROM static_rebuild_queue").get().reason, "admin_terms_archive");
  assert.equal(x.sqlite.prepare("SELECT status FROM terms_versions WHERE id='pub'").get().status, "archived");
  assert.equal(x.audits().at(-1).reason, "規約版のアーカイブ");
  assert.equal((await x.request("POST", "/terms/none/archive", {})).status, 404);
});

test("MIG-0642 T01 SA-049: editable fields normalize, short-circuit, and audit long_audit", async () => {
  const x = setup();
  const noop = await x.request("PUT", "/permissions/editable-fields", { default_editable_fields: [], upcoming_editable_fields: [] });
  assert.equal((await noop.json()).message, "一般作品権限に変更はありません。");
  assert.equal(x.count("audit_logs"), 0);
  const r = await x.request("PUT", "/permissions/editable-fields", { default_editable_fields: ["title", "title", "bogus"], upcoming_editable_fields: ["title"] });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.message, "一般作品権限を保存しました。");
  const row = x.sqlite.prepare("SELECT default_editable_fields d, upcoming_editable_fields u FROM system_settings").get();
  assert.deepEqual({ d: body.settings.default_editable_fields, u: body.settings.upcoming_editable_fields }, { d: row.d, u: row.u });
  const [audit] = x.audits();
  assert.equal(audit.context, "admin_permissions");
  assert.equal(audit.retention_class, "long_audit");
  assert.equal(audit.reason, "一般作品権限を更新");
  assert.equal(x.count("static_rebuild_queue"), 0);
  assert.equal((await x.request("PUT", "/permissions/editable-fields", { default_editable_fields: "title" })).status, 400);
});

test("MIG-0642 T01 SA-045: retry puts a failed row back to pending with a strict audit", async () => {
  const x = setup();
  x.seedNotification({ id: "n1", status: "dead_letter" });
  x.seedNotification({ id: "n2", status: "sent" });
  const r = await x.request("POST", "/notifications/n1/retry", {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, message: "通知を配信待ちに戻しました。" });
  const row = x.sqlite.prepare("SELECT * FROM notification_outbox WHERE id='n1'").get();
  assert.equal(row.status, "pending");
  assert.equal(row.attempt_count, 0);
  assert.equal(row.last_error, null);
  assert.ok(row.next_attempt_at > 0);
  const [audit] = x.audits();
  assert.equal(audit.context, "admin_notification_retry");
  assert.equal(audit.reason, "手動リトライ");
  assert.equal(audit.retention_class, "normal");
  const bad = await x.request("POST", "/notifications/n2/retry", {});
  assert.equal(bad.status, 409);
  assert.equal((await bad.json()).message, "status=sentはリトライ対象外です。");
  assert.equal((await x.request("POST", "/notifications/none/retry", {})).status, 404);
  assert.equal(x.audits().length, 1);
});

test("MIG-0642 T01 SA-046: cancel is idempotent for terminal rows and rejects in-flight rows", async () => {
  const x = setup();
  x.seedNotification({ id: "f", status: "failed" });
  x.seedNotification({ id: "s", status: "sent" });
  x.seedNotification({ id: "p", status: "processing" });
  const done = await x.request("POST", "/notifications/f/cancel", { reason: "不要" });
  assert.equal(done.status, 200);
  const row = x.sqlite.prepare("SELECT * FROM notification_outbox WHERE id='f'").get();
  assert.equal(row.status, "cancelled");
  assert.equal(row.last_error, "不要");
  assert.equal(x.audits()[0].reason, "不要");
  assert.equal(x.audits()[0].context, "admin_notification_cancel");
  const sent = await x.request("POST", "/notifications/s/cancel");
  assert.deepEqual(await sent.json(), { ok: true, message: "既にsentです。" });
  const inflight = await x.request("POST", "/notifications/p/cancel", {});
  assert.equal(inflight.status, 409);
  assert.equal(x.sqlite.prepare("SELECT status FROM notification_outbox WHERE id='p'").get().status, "processing");
  assert.equal(x.audits().length, 1);
  assert.equal((await x.request("POST", "/notifications/f/cancel", { reason: "x".repeat(501) })).status, 400);
});

test("MIG-0642 T01 SA-047: force-resend inserts a fresh forced row + CREATE audit", async () => {
  const x = setup();
  x.seedNotification({ id: "n1", status: "sent", dedupe: "k1", payload: '{"content":"hello"}' });
  const r = await x.request("POST", "/notifications/n1/force-resend", {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, message: "通知を再送キューに追加しました。" });
  const created = x.sqlite.prepare("SELECT * FROM notification_outbox WHERE id <> 'n1'").get();
  assert.equal(created.status, "pending");
  assert.equal(created.attempt_count, 0);
  assert.match(created.dedupe_key, /^k1:force:[0-9a-f-]{36}$/);
  assert.equal(created.payload_json, '{"content":"hello"}');
  assert.equal(created.recipient_user_id, "admin-1");
  const [audit] = x.audits();
  assert.equal(audit.operation, "CREATE");
  assert.equal(audit.context, "admin_notification_force_resend");
  assert.equal(audit.reason, "通知n1を強制再送");
  assert.equal(audit.target_id, created.id);
  // a DM whose recipient no longer exists cannot be rebuilt
  x.seedNotification({ id: "n2", recipient: "gone", status: "sent" });
  const none = await x.request("POST", "/notifications/n2/force-resend", {});
  assert.equal(none.status, 409);
  assert.equal((await none.json()).message, "宛先の通知設定がOFF、または再送通知を構築できません。");
  // notifications-OFF recipients are still resent (force)
  x.seedNotification({ id: "n3", recipient: "u-off", status: "sent" });
  assert.equal((await x.request("POST", "/notifications/n3/force-resend", {})).status, 200);
  x.seedNotification({ id: "n4", status: "sent", payload: "{broken" });
  assert.equal((await x.request("POST", "/notifications/n4/force-resend", {})).status, 400);
  assert.equal((await x.request("POST", "/notifications/none/force-resend", {})).status, 404);
});

test("MIG-0642 T01 SA-047: non-object payloads and invalid payloads are rejected before the recipient check, with no write", async () => {
  const x = setup();
  const count = () => x.sqlite.prepare("SELECT count(*) AS n FROM notification_outbox").get().n;
  let i = 0;
  for (const payload of ["[]", "5", '"str"', "null"]) {
    const id = `np${i++}`;
    x.seedNotification({ id, status: "sent", payload });
    const n = count();
    const r = await x.request("POST", `/notifications/${id}/force-resend`, {});
    assert.equal(r.status, 400, payload);
    assert.equal((await r.json()).message, "通知 payload が不正です: payload はオブジェクトである必要があります", payload);
    assert.equal(count(), n);
  }
  assert.equal(x.audits().length, 0);
  // CURRENT validates the payload before resolving the recipient
  x.seedNotification({ id: "nq", recipient: "gone", status: "sent", payload: '{"content":5}' });
  const r = await x.request("POST", "/notifications/nq/force-resend", {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /^通知 payload が不正です/);
});

test("MIG-0642 T01 SA-048: retry-failed handles oldest 10 of 11 and reports the count", async () => {
  const x = setup();
  for (let i = 0; i < 11; i++) x.seedNotification({ id: `f${String(i).padStart(2, "0")}`, status: i % 2 ? "failed" : "dead_letter", created_at: 100 + i });
  x.seedNotification({ id: "ok", status: "pending", created_at: 1 });
  const r = await x.request("POST", "/notifications/retry-failed", {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, message: "10件を配信待ちに戻しました。", retried: 10 });
  assert.equal(x.sqlite.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE status IN ('failed','dead_letter')").get().n, 1);
  assert.equal(x.sqlite.prepare("SELECT status FROM notification_outbox WHERE id='f10'").get().status, "dead_letter");
  assert.equal(x.audits().length, 10);
  assert.equal(x.stats.batches, 1);
  const rest = await (await x.request("POST", "/notifications/retry-failed", {})).json();
  assert.equal(rest.retried, 1);
  const none = await (await x.request("POST", "/notifications/retry-failed", {})).json();
  assert.deepEqual(none, { ok: true, message: "失敗通知はありません。", retried: 0 });
});

test("MIG-0642 T03: a concurrent writer after the preflight read yields a conflict and no write", async () => {
  for (const [method, path, body] of [
    ["PATCH", "/terms/t1", { version_label: "mine", body_markdown: "b" }],
    ["POST", "/terms/t1/archive", {}],
    ["POST", "/terms/t1/publish", {}],
  ]) {
    let raced = false;
    const x = setup({ beforeRead: (s, sqlite) => {
      if (!raced && s.includes("FROM terms_versions")) { raced = true; sqlite.prepare("UPDATE terms_versions SET body_markdown='theirs' WHERE id='t1'").run(); }
    } });
    x.seedTerms({ id: "t1" });
    const r = await x.request(method, path, body);
    assert.equal(r.status, 409, path);
    assert.equal((await r.json()).message, "更新が競合したか、監査記録に失敗しました。再読み込みしてお試しください。");
    assert.equal(x.count("audit_logs"), 0, path);
    assert.equal(x.count("static_rebuild_queue"), 0, path);
    assert.equal(x.sqlite.prepare("SELECT status FROM terms_versions").get().status, "draft");
  }
  for (const [path, body] of [["/notifications/n1/retry", {}], ["/notifications/n1/cancel", {}], ["/notifications/retry-failed", {}]]) {
    let raced = false;
    const x = setup({ beforeRead: (s, sqlite) => {
      if (!raced && s.includes("FROM notification_outbox")) { raced = true; sqlite.prepare("UPDATE notification_outbox SET last_error='other' WHERE id='n1'").run(); }
    } });
    x.seedNotification({ id: "n1", status: "failed" });
    const r = await x.request("POST", path, body);
    assert.equal(r.status, 409, path);
    assert.equal((await r.json()).message, "通知更新が競合したか監査記録に失敗しました。");
    assert.equal(x.count("audit_logs"), 0);
    assert.equal(x.sqlite.prepare("SELECT status FROM notification_outbox").get().status, "failed");
  }
  // editable fields: CURRENT reports a non-AuditMutationError CAS miss as the generic save failure.
  let raced = false;
  const x = setup({ beforeRead: (s, sqlite) => {
    if (!raced && s.includes("default_editable_fields")) { raced = true; sqlite.prepare("UPDATE system_settings SET default_editable_fields='description'").run(); }
  } });
  const r = await x.request("PUT", "/permissions/editable-fields", { default_editable_fields: ["title"], upcoming_editable_fields: [] });
  assert.ok([409, 500].includes(r.status));
  assert.equal((await r.json()).ok, false);
  assert.equal(x.count("audit_logs"), 0);
});

test("MIG-0642 T04: wake count is 0 (DOCUMENTED DIFFERENCE: CURRENT wakes after retry / force-resend / retry-failed / publish / archive)", async () => {
  const x = setup();
  x.seedTerms({ id: "t1" });
  x.seedTerms({ id: "old", status: "published", published_at: 5 });
  x.seedNotification({ id: "n1", status: "failed" });
  x.seedNotification({ id: "n2", status: "sent" });
  for (const [method, path, body] of [
    ["POST", "/notifications/n1/retry", {}],
    ["POST", "/notifications/n2/force-resend", {}],
    ["POST", "/notifications/retry-failed", {}],
    ["POST", "/terms/t1/publish", {}],
    ["POST", "/terms/old/archive", {}],
  ]) {
    const r = await x.request(method, path, body);
    assert.equal(r.status, 200, path);
  }
  assert.equal(x.sends.length, 0, "no Queue wake from the Hono Worker");
  assert.ok(x.count("static_rebuild_queue") >= 1, "rows are still committed for the Cron to drain");
});

test("MIG-0642 fail closed: a throwing preflight D1 read returns 503 without leaking the provider error", async () => {
  const cases = [
    ["PATCH", "/terms/t1", { version_label: "v", body_markdown: "b" }, "FROM terms_versions"],
    ["POST", "/terms/t1/publish", {}, "FROM terms_versions"],
    ["POST", "/terms/t1/archive", {}, "FROM terms_versions"],
    ["POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS" }, "FROM terms_versions"],
    ["POST", "/notifications/n1/retry", {}, "FROM notification_outbox"],
    ["POST", "/notifications/retry-failed", {}, "FROM notification_outbox"],
    ["PUT", "/permissions/editable-fields", { default_editable_fields: ["title"] }, "default_editable_fields"],
  ];
  for (const [method, path, body, marker] of cases) {
    const x = setup({ beforeRead: (s) => { if (s.includes(marker) && !s.includes("operation_mode")) throw new Error("SECRET provider detail"); } });
    x.seedTerms({ id: "t1" });
    x.seedNotification({ id: "n1" });
    const r = await x.request(method, path, body);
    assert.equal(r.status, 503, path);
    const text = await r.text();
    assert.ok(!text.includes("SECRET"), path);
    assert.equal(x.count("audit_logs"), 0, path);
  }
});

test("MIG-0642 T06: every route stays within 3 D1 reads + 1 batch (SA-054 pinned at 3 reads)", async () => {
  const cases = [
    ["POST", "/terms", { version_label: "v1", body_markdown: "x" }, () => {}],
    ["PATCH", "/terms/t1", { version_label: "n", body_markdown: "b" }, (x) => x.seedTerms({ id: "t1" })],
    ["POST", "/terms/t1/publish", {}, (x) => x.seedTerms({ id: "t1" })],
    ["POST", "/terms/t1/archive", {}, (x) => x.seedTerms({ id: "t1", status: "published", published_at: 5 })],
    ["POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS" }, (x) => {
      x.seedTerms({ id: "t1", status: "published", severity: "major", published_at: 900 });
      x.sqlite.prepare("UPDATE \"user\" SET accepted_terms_version_id='t1' WHERE id='admin-1'").run();
      x.sqlite.prepare("INSERT INTO \"user\" (id,name,role,is_tos_accepted,is_banned,is_notification_enabled) VALUES ('need','n','user',1,0,1)").run();
    }],
    ["PUT", "/permissions/editable-fields", { default_editable_fields: ["title"], upcoming_editable_fields: [] }, () => {}],
    ["POST", "/notifications/n1/retry", {}, (x) => x.seedNotification({ id: "n1" })],
    ["POST", "/notifications/n1/cancel", {}, (x) => x.seedNotification({ id: "n1", status: "pending" })],
    ["POST", "/notifications/n1/force-resend", {}, (x) => x.seedNotification({ id: "n1", status: "sent" })],
    ["POST", "/notifications/retry-failed", {}, (x) => x.seedNotification({ id: "n1" })],
  ];
  for (const [method, path, body, seed] of cases) {
    const x = setup();
    seed(x);
    const r = await x.request(method, path, body);
    assert.equal(r.status, 200, path);
    assert.ok(x.stats.reads <= 3, `${path} reads=${x.stats.reads}`);
    assert.equal(x.stats.batches, 1, `${path} batches`);
  }
});

test("MIG-0642 SA-054: the single-read page lists the users that still need to re-accept", async () => {
  const x = setup();
  x.seedTerms({ id: "t1", status: "published", severity: "major", published_at: 900 });
  x.sqlite.prepare("UPDATE \"user\" SET accepted_terms_version_id='t1' WHERE id='admin-1'").run();
  x.sqlite.prepare("INSERT INTO \"user\" (id,name,role,is_tos_accepted,is_banned,is_notification_enabled) VALUES ('need','n','user',1,0,1)").run();
  const body = await (await x.request("POST", "/terms/t1/reaccept-broadcast", { confirm: "TERMS" })).json();
  assert.equal(body.cursor, "need");
  assert.equal(x.audits()[0].reason, "再同意案内（DMなし） batch cursor= targets=1");
});

test("MIG-0642 SA-047: a recipient id with surrounding whitespace resolves like CURRENT (trimmed)", async () => {
  const x = setup();
  x.seedNotification({ id: "n1", status: "sent", recipient: " admin-1 " });
  const r = await x.request("POST", "/notifications/n1/force-resend", {});
  assert.equal(r.status, 200);
  assert.equal(x.sqlite.prepare("SELECT recipient_user_id r FROM notification_outbox WHERE id <> 'n1'").get().r, "admin-1");
});
