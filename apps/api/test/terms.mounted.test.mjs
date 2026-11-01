// MIG-0641 T01-T06: MOUNTED route evidence. The real app (`app.ts` -> personalRoutes) with a real session
// cookie, the real CostGuard middleware (feature personal_terms_accept), real mutateWithAudit atomic batch
// and the migrated SQLite schema. Nothing about the terms path is stubbed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../src/app.ts";
import { cookie, createSqlite } from "./support/personalHarness.mjs";
import { atomicD1, SITE } from "./support/chapterSeed.mjs";
import { seed } from "./support/personalSeed.mjs";

function world() {
  const sqlite = createSqlite();
  seed(sqlite);
  sqlite.prepare("UPDATE system_settings SET operation_mode = 'normal' WHERE id = 'default'").run();
  return { sqlite, d1: atomicD1(sqlite) };
}

const post = (w, path, token, { body = {}, origin = SITE } = {}) =>
  app.request(
    `/api/personal${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { Origin: origin } : {}), ...(token ? cookie(token) : {}) },
      body: JSON.stringify(body),
    },
    { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE },
  );

const counts = (w) => ({
  consents: w.sqlite.prepare("SELECT COUNT(*) n FROM user_tos_consents").get().n,
  audits: w.sqlite.prepare("SELECT COUNT(*) n FROM audit_logs").get().n,
});
const userRow = (w, id) => w.sqlite.prepare('SELECT * FROM "user" WHERE id = ?').get(id);

test("MIG-0641 T01: double submit by a ToS-pending user writes one consent and one audit set", async () => {
  const w = world();
  const before = counts(w);
  const first = await post(w, "/terms/accept", "tok-carol");
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, next: "/dashboard" });
  const afterFirst = counts(w);
  assert.equal(afterFirst.consents, before.consents + 1);
  assert.equal(afterFirst.audits, before.audits + 2, "consent insert + user update are audited");
  const second = await post(w, "/terms/accept", "tok-carol");
  assert.equal(second.status, 200);
  assert.deepEqual(counts(w), afterFirst, "second submit is an idempotent no-op (no consent, no audit)");
  assert.equal(second.headers.get("Cache-Control"), "private, no-store");
});

test("MIG-0641 T02: SA-075 external next is sanitized, internal next is kept", async () => {
  for (const [next, expected] of [["//evil.example/x", "/dashboard"], ["https://evil.example", "/dashboard"], ["/entry?a=1", "/entry?a=1"]]) {
    const w = world();
    const res = await post(w, "/terms/accept", "tok-carol", { body: { next } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, next: expected });
  }
});

test("MIG-0641 T03: ToS-pending user can accept (SA-076) and complete onboarding; existing read routes unaffected", async () => {
  const w = world();
  const res = await post(w, "/onboarding/terms", "tok-carol");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, alreadyAccepted: false });
  assert.equal(userRow(w, "u_carol").is_tos_accepted, 1);
  const complete = await post(w, "/onboarding/complete", "tok-carol");
  assert.equal(complete.status, 200);
  assert.deepEqual(await complete.json(), { ok: true });
  const read = await app.request("/api/personal/session", { headers: cookie("tok-carol") }, { DB: w.d1, NEXT_PUBLIC_SITE_URL: SITE });
  assert.equal(read.status, 200, "GET /api/personal/session still served by the read router");
  const anonRead = await app.request("/api/personal/session", {}, { DB: w.d1 });
  assert.equal(anonRead.status, 401);
});

test("MIG-0641 T04: anonymous, banned, cross-origin and CostGuard-denied requests make 0 writes", async () => {
  for (const path of ["/terms/accept", "/onboarding/terms", "/onboarding/complete"]) {
    const w = world();
    const before = counts(w);
    const completedBefore = w.sqlite.prepare('SELECT COUNT(*) n FROM "user" WHERE onboarding_completed_at IS NOT NULL').get().n;
    const anonymous = await post(w, path, null);
    assert.equal(anonymous.status, 401, `${path} anonymous`);
    const banned = await post(w, path, "tok-banned");
    assert.equal(banned.status, 403, `${path} banned`);
    const readsBefore = w.d1.stats.reads;
    const cross = await post(w, path, "tok-carol", { origin: "https://evil.example" });
    assert.equal(cross.status, 403, `${path} cross-origin`);
    assert.equal(w.d1.stats.reads, readsBefore, "cross-origin is rejected before any D1 read (Origin precedes session)");
    const noOrigin = await post(w, path, "tok-carol", { origin: null });
    assert.notEqual(noOrigin.status, 200, `${path} missing Origin`);
    w.sqlite.prepare("UPDATE system_settings SET disabled_features_json = ? WHERE id = 'default'").run(JSON.stringify(["personal_terms_accept"]));
    const denied = await post(w, path, "tok-carol");
    assert.equal(denied.status, 503, `${path} CostGuard denied`);
    w.sqlite.prepare("UPDATE system_settings SET disabled_features_json = NULL, operation_mode = 'maintenance' WHERE id = 'default'").run();
    assert.equal((await post(w, path, "tok-carol")).status, 503, `${path} maintenance`);
    assert.deepEqual(counts(w), before);
    assert.equal(
      w.sqlite.prepare('SELECT COUNT(*) n FROM "user" WHERE onboarding_completed_at IS NOT NULL').get().n,
      completedBefore,
    );
    assert.equal(userRow(w, "u_carol").is_tos_accepted, 0);
    assert.equal(w.d1.stats.batches, 0);
  }
});

test("MIG-0641 T05: acceptance updates the CURRENT user/consent fields with strict audit in one atomic batch", async () => {
  const w = world();
  const res = await post(w, "/terms/accept", "tok-carol", { body: { next: "/rules" } });
  assert.equal(res.status, 200);
  assert.equal(w.d1.stats.batches, 1, "one D1 batch");
  const user = userRow(w, "u_carol");
  assert.equal(user.is_tos_accepted, 1);
  assert.equal(user.accepted_terms_version_id, "T2", "latest published major terms");
  assert.equal(user.terms_reaccept_required, 0);
  const consents = w.sqlite.prepare("SELECT * FROM user_tos_consents WHERE user_id = 'u_carol'").all();
  assert.equal(consents.length, 1);
  assert.equal(consents[0].terms_version_id, "T2");
  const audits = w.sqlite.prepare("SELECT table_name FROM audit_logs ORDER BY rowid").all();
  assert.deepEqual(audits.map((a) => a.table_name).sort(), ["user", "user_tos_consents"]);
  // A re-accept by an already-current user (alice) is a pure no-op: no batch, no rows.
  const w2 = world();
  const noop = await post(w2, "/terms/accept", "tok-alice");
  assert.equal(noop.status, 200);
  assert.equal(w2.d1.stats.batches, 0);
  assert.deepEqual(counts(w2), counts(world()));
});

test("MIG-0641 T06: onboarding complete writes only with a server-derived pending/approved X and never overwrites", async () => {
  const w = world();
  const none = await post(w, "/onboarding/complete", "tok-carol", { body: { xIdentityStatus: "approved" } });
  assert.equal(none.status, 200);
  assert.equal(userRow(w, "u_carol").onboarding_completed_at, null, "client-supplied status is ignored; no X -> no write");
  const approved = await post(w, "/onboarding/complete", "tok-ivy");
  assert.equal(approved.status, 200);
  const stamped = userRow(w, "u_ivy").onboarding_completed_at;
  assert.notEqual(stamped, null);
  await post(w, "/onboarding/complete", "tok-ivy");
  assert.equal(userRow(w, "u_ivy").onboarding_completed_at, stamped, "second call does not overwrite");
  const rejected = await post(w, "/onboarding/complete", "tok-dave");
  assert.equal(rejected.status, 200);
  assert.equal(userRow(w, "u_dave").onboarding_completed_at, null, "rejected X -> no write");
});
