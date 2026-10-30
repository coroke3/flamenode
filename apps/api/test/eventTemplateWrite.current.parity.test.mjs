// MIG-0655 T01/T02 differential parity: the REAL CURRENT Server Actions
// (src/lib/actions/event-template-admin.ts saveEventAsTemplate /
// listEventTemplatesForAdmin) and the Hono routes POST/GET /api/admin/event-templates
// (full app stack, session cookie, same Origin) on identically seeded SQLite
// databases built from every migration (foreign keys ON like D1).
//
// CURRENT's snapshot builder is the PRE-MOVE implementation
// (test/support/legacyEventTemplateSettings.ts, a verbatim copy of main's
// src/lib/admin/eventTemplateSettings.ts that imports the live src/lib helpers),
// so this is not a self-comparison of the domain code. Stubbed CURRENT edges:
// requireAdminWrite (admin -> ok + drizzle db over that side's database,
// otherwise the CURRENT deny), Next revalidatePath / unstable_rethrow.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createSqlite, insert, runUnderRootTsx } from "./support/personalHarness.mjs";
import { NOW, seed } from "./support/manageSeed.mjs";

if (runUnderRootTsx(import.meta.url)) {
  const LEGACY = new URL("./support/legacyEventTemplateSettings.ts", import.meta.url).href;
  const STUBS = {
    "server-only": "export {}",
    "next/cache": "export function revalidatePath(p) { globalThis.__mig0655Tpl?.revalidated.push(p); }",
    "next/navigation": "export function unstable_rethrow() {}",
    "@/lib/auth/writeGuard": `
      export async function requireAdminWrite(feature) {
        const s = globalThis.__mig0655Tpl;
        if (!s) throw new Error("requireAdminWrite outside CURRENT parity case");
        s.features.push(feature);
        if (!s.user || s.user.role !== "admin") return { ok: false, message: "管理者権限が必要です。" };
        return { ok: true, db: s.db, user: s.user, activeXId: null, approvedXIds: [], hasPendingXRequest: false };
      }
    `,
  };
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
        return { url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}`, shortCircuit: true };
      }
      if (specifier === "@/lib/admin/eventTemplateSettings") return { url: LEGACY, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const actions = await import("../../../src/lib/actions/event-template-admin.ts");
  const legacy = await import(LEGACY);
  const domain = await import("@flamenode/domain/eventTemplates");
  const { app } = await import("../src/app.ts");

  const SITE = "https://app.flamenode.example";

  function freeze() {
    let n = 0;
    const originalNow = Date.now;
    const originalUuid = globalThis.crypto.randomUUID;
    Date.now = () => NOW * 1000;
    globalThis.crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    return () => {
      Date.now = originalNow;
      globalThis.crypto.randomUUID = originalUuid;
    };
  }

  let questionN = 0;
  function question(sqlite, eventId, key, o = {}) {
    questionN += 1;
    insert(sqlite, "event_custom_questions", {
      id: `q${questionN}`, event_id: eventId, question_key: key, label: o.label ?? `Label ${key}`,
      description: o.description ?? null, type: o.type ?? "text", required: o.required ?? 0,
      options_json: o.options ?? null, placeholder: o.placeholder ?? null, max_length: o.max ?? null,
      sort_order: o.sort ?? 0, is_active: o.active ?? 1, visibility: o.visibility ?? "review",
      created_at: NOW, updated_at: NOW,
    });
  }

  function database(extra) {
    questionN = 0;
    const sqlite = createSqlite();
    seed(sqlite);
    sqlite.exec(`UPDATE "user" SET is_tos_accepted = 1`);
    sqlite.exec(`UPDATE system_settings SET operation_mode = 'normal', disabled_features_json = NULL WHERE id = 'default'`);
    sqlite.exec(`UPDATE events SET explanation = 'Line1\nLine2', youtube_description_template = '{title}\n' || '${"x".repeat(50)}',
      required_video_fields_json = '["title","music","bogus"]', review_settings = '{"mode":"manual"}',
      editable_fields = '["title"]', repeat_rules = 'not json', event_type = 'collabo', slot_type = 'count',
      max_slots_per_video = 3, max_slot_reservation_groups_per_xid = 2, slot_interval_minutes = 20 WHERE id = 'evA'`);
    sqlite.exec("DELETE FROM event_custom_questions WHERE event_id = 'evA'");
    question(sqlite, "evA", "q_b", { type: "select", options: '["A"," B ","",3]', sort: 2, visibility: "public", required: 1 });
    question(sqlite, "evA", "q_a", { type: "radio", options: "not json", sort: 2, visibility: "private" });
    question(sqlite, "evA", "Q Bad Key!", { type: "checkbox", options: '{"x":1}', sort: 1, max: 0 });
    question(sqlite, "evA", "stage_permission", { label: "Stage", description: "desc", placeholder: "ph", required: 1, sort: 5 });
    question(sqlite, "evA", "stage_permission_extra", { label: "Extra", active: 0, sort: 3 });
    question(sqlite, "evA", "stage_permission_tie", { label: "Tie", sort: 3 });
    // Inserted after "_tie" but sorts before it by key: probes the sort_order tie order.
    question(sqlite, "evA", "stage_permission_aaa", { label: "Aaa", sort: 3 });
    question(sqlite, "evA", "q_inactive", { type: "textarea", active: 0, sort: 9, max: 500, placeholder: "p" });
    extra?.(sqlite);
    sqlite.exec("PRAGMA foreign_keys = ON");
    return sqlite;
  }

  function d1(sqlite) {
    const stats = { reads: 0, batches: 0 };
    const make = (text, params) => ({
      _sql: text,
      _params: params,
      bind: (...values) => make(text, values),
      first: async () => { stats.reads += 1; return sqlite.prepare(text).get(...params) ?? null; },
      all: async () => { stats.reads += 1; return { results: sqlite.prepare(text).all(...params), success: true, meta: {} }; },
      run: async () => ({ results: sqlite.prepare(text).all(...params), success: true, meta: {} }),
      raw: async () => {
        stats.reads += 1;
        const prepared = sqlite.prepare(text);
        prepared.setReturnArrays(true);
        try { return prepared.all(...params).map((row) => [...row]); } finally { prepared.setReturnArrays(false); }
      },
    });
    return {
      stats,
      prepare: (text) => make(text, []),
      batch: async (statements) => {
        stats.batches += 1;
        sqlite.exec("BEGIN");
        try {
          const results = statements.map((s) => ({ results: sqlite.prepare(s._sql).all(...s._params), success: true, meta: {} }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    };
  }

  function execute(sqlite, text, params, method) {
    const statement = sqlite.prepare(text);
    if (method === "run") { statement.run(...params); return []; }
    statement.setReturnArrays(true);
    if (method === "get") return statement.get(...params);
    return statement.all(...params);
  }
  const drizzleOver = (sqlite) =>
    drizzle(
      async (text, params, method) => ({ rows: execute(sqlite, text, params, method) }),
      async (queries) => {
        sqlite.exec("BEGIN");
        try {
          const results = queries.map(({ sql: text, params, method }) => ({ rows: execute(sqlite, text, params, method) }));
          sqlite.exec("COMMIT");
          return results;
        } catch (error) {
          sqlite.exec("ROLLBACK");
          throw error;
        }
      },
    );

  async function runCurrent(sqlite, name, call) {
    const user = name ? sqlite.prepare(`SELECT id, role FROM "user" WHERE id = ?`).get(`u_${name}`) : null;
    const state = { db: drizzleOver(sqlite), user: user ? { ...user } : null, features: [], revalidated: [] };
    globalThis.__mig0655Tpl = state;
    const restore = freeze();
    try {
      return { result: JSON.parse(JSON.stringify(await call())), ...state };
    } finally {
      restore();
      delete globalThis.__mig0655Tpl;
    }
  }

  async function runHono(sqlite, name, method, body) {
    const db = d1(sqlite);
    const restore = freeze();
    try {
      const headers = { ...(name ? cookie(`tok-${name}`) : {}), Origin: SITE };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await app.request(
        "/api/admin/event-templates",
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        { DB: db, AUTH_SECRET: "test-secret", NEXT_PUBLIC_SITE_URL: SITE },
      );
      const text = await res.text();
      return { status: res.status, cache: res.headers.get("cache-control"), body: text ? JSON.parse(text) : null, stats: db.stats };
    } finally {
      restore();
    }
  }

  const form = (fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
    return f;
  };
  const templates = (sqlite) => sqlite.prepare("SELECT * FROM event_templates ORDER BY id").all().map((r) => ({ ...r }));
  const audits = (sqlite) =>
    sqlite.prepare("SELECT * FROM audit_logs WHERE table_name = 'event_templates' ORDER BY id").all().map((r) => {
      const out = { ...r };
      for (const k of Object.keys(out)) if (k.endsWith("_json") && typeof out[k] === "string") out[k] = JSON.parse(out[k]);
      return out;
    });

  const SAVE_CASES = [
    ["evA with mixed/invalid questions, stage permissions and ties", "evA", { name: "  Tpl A  ", description: "D" }],
    ["evB without questions, no description", "evB", { name: "Tpl B" }],
    ["evNull (null schedule)", "evNull", { name: "Tpl N", description: "" }],
    ["unknown event", "noSuchEvent", { name: "X" }],
    ["empty name", "evA", { name: "" }],
    ["name too long", "evA", { name: "n".repeat(500) }],
  ];

  for (const [label, eventId, fields] of SAVE_CASES) {
    test(`SA-035 CURRENT vs Hono: ${label}`, async () => {
      const curDb = database();
      const honoDb = database();
      const cur = await runCurrent(curDb, "admin", () => actions.saveEventAsTemplate(form({ event_id: eventId, ...fields })));
      const hono = await runHono(honoDb, "admin", "POST", { event_id: eventId, ...fields });
      assert.deepStrictEqual(hono.body, cur.result, `${label}: body (Hono ${hono.status})`);
      assert.deepStrictEqual(templates(honoDb), templates(curDb), `${label}: event_templates`);
      assert.deepStrictEqual(audits(honoDb), audits(curDb), `${label}: audit_logs`);
      assert.equal(hono.cache, "private, no-store");
      assert.deepStrictEqual(cur.features, ["admin_event_templates"]);
      assert.equal(hono.status, cur.result.ok ? 200 : cur.result.message === "イベントが見つかりません。" ? 404 : 400);
      if (cur.result.ok) {
        // Byte-identical settings_json from the pre-move CURRENT builder.
        assert.equal(templates(honoDb)[0].settings_json, templates(curDb)[0].settings_json);
        assert.equal(hono.stats.batches, 1);
      }
    });
  }

  test("T01 save -> list: same rows and order as CURRENT (updated_at DESC)", async () => {
    const extra = (s) => {
      insert(s, "event_templates", { id: "etmpl_old", name: "Old", description: null, source_event_id: "evB", settings_json: "{}", created_by_user_id: "u_admin", created_at: NOW - 50, updated_at: NOW - 50 });
      insert(s, "event_templates", { id: "etmpl_orphan", name: "Orphan", description: "o", source_event_id: null, settings_json: "{}", created_by_user_id: "u_admin", created_at: NOW - 10, updated_at: NOW - 10 });
    };
    const curDb = database(extra);
    const honoDb = database(extra);
    await runCurrent(curDb, "admin", () => actions.saveEventAsTemplate(form({ event_id: "evA", name: "New" })));
    await runHono(honoDb, "admin", "POST", { event_id: "evA", name: "New" });
    const cur = await runCurrent(curDb, "admin", () => actions.listEventTemplatesForAdmin());
    const hono = await runHono(honoDb, "admin", "GET");
    assert.equal(hono.status, 200);
    assert.equal(cur.result.length, 3);
    assert.deepStrictEqual(hono.body, cur.result);
  });

  test("T02 non-admin / anonymous list: [] like CURRENT, private no-store", async () => {
    for (const name of ["owner", "plain", null]) {
      const curDb = database();
      const honoDb = database();
      const cur = await runCurrent(curDb, name, () => actions.listEventTemplatesForAdmin());
      const hono = await runHono(honoDb, name, "GET");
      assert.deepStrictEqual(cur.result, []);
      assert.equal(hono.status, 200, String(name));
      assert.deepStrictEqual(hono.body, cur.result);
      assert.equal(hono.cache, "private, no-store");
    }
  });

  test("SA-035 non-admin save: denied on both sides, nothing written (Hono 403 via the admin write guard)", async () => {
    const curDb = database();
    const honoDb = database();
    const cur = await runCurrent(curDb, "owner", () => actions.saveEventAsTemplate(form({ event_id: "evA", name: "X" })));
    const hono = await runHono(honoDb, "owner", "POST", { event_id: "evA", name: "X" });
    assert.equal(cur.result.ok, false);
    assert.equal(hono.status, 403);
    assert.deepStrictEqual(templates(honoDb), templates(curDb));
    assert.deepStrictEqual(audits(honoDb), []);
  });

  test("DOCUMENTED DIFFERENCE MIG-0655-DD5: >100 custom questions: CURRENT snapshots all, Hono 409 without writes (ZERO_1102 S2)", async () => {
    const many = (sqlite) => {
      for (let i = 0; i < 101; i += 1) question(sqlite, "evB", `k${String(i).padStart(3, "0")}`, { sort: i });
    };
    const curDb = database(many);
    const honoDb = database(many);
    const cur = await runCurrent(curDb, "admin", () => actions.saveEventAsTemplate(form({ event_id: "evB", name: "Many" })));
    const hono = await runHono(honoDb, "admin", "POST", { event_id: "evB", name: "Many" });
    assert.equal(cur.result.ok, true);
    assert.equal(JSON.parse(templates(curDb)[0].settings_json).custom_question_definitions.length > 100, true);
    assert.equal(hono.status, 409);
    assert.deepStrictEqual(hono.body, { ok: false, message: "処理に失敗しました。再読み込みして、もう一度お試しください。" });
    assert.deepStrictEqual(templates(honoDb), []);
    assert.deepStrictEqual(audits(honoDb), []);
  });

  test("snapshot drift guard: domain builder equals the pre-move CURRENT builder", () => {
    const sqlite = database();
    for (const id of ["evA", "evB", "evNull", "evPoint"]) {
      const event = sqlite.prepare("SELECT * FROM events WHERE id = ?").get(id);
      const questions = sqlite.prepare(`SELECT question_key, label, description, type, required, options_json, placeholder,
        max_length, sort_order, is_active, visibility FROM event_custom_questions WHERE event_id = ? ORDER BY sort_order, question_key`).all(id).map((q) => ({ ...q }));
      for (const form of [null, '{"stage_permissions":[]}', "not json"]) {
        const a = legacy.snapshotFromEvent({ ...event }, questions, form);
        const b = domain.snapshotFromEvent({ ...event }, questions, form);
        assert.deepStrictEqual(b, a, `${id} form=${form}`);
        assert.deepStrictEqual(domain.parseEventTemplateSnapshot(JSON.stringify(b)), legacy.parseEventTemplateSnapshot(JSON.stringify(a)));
        assert.deepStrictEqual(domain.snapshotToFormInitial(b), legacy.snapshotToFormInitial(a));
      }
    }
    for (const raw of ["", "null", "[]", "{}", '{"version":1}', "not json", '{"questions":[{"question_key":"A B","type":"bogus"}]}']) {
      assert.deepStrictEqual(domain.parseEventTemplateSnapshot(raw), legacy.parseEventTemplateSnapshot(raw), raw);
    }
  });
}
