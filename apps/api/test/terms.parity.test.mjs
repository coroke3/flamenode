import assert from "node:assert/strict";
import test from "node:test";
import {
  AcceptLatestTermsBodySchema,
  AcceptLatestTermsResponseSchema,
  OnboardingTermsAcceptResponseSchema,
  OnboardingCompleteResponseSchema,
} from "@flamenode/contracts";

// MIG-0641 U01a: transport schema tests. No Hono D1 writes yet.
test("MIG-0641 U01a: SA-075 input accepts optional next string", () => {
  assert.deepEqual(AcceptLatestTermsBodySchema.parse({}), {});
  assert.deepEqual(AcceptLatestTermsBodySchema.parse({ next: "/dashboard" }), { next: "/dashboard" });
  assert.equal(AcceptLatestTermsBodySchema.safeParse({ next: 123 }).success, false);
});
test("MIG-0641 U01a: SA-075 result explicitly includes a navigation target", () => {
  assert.deepEqual(AcceptLatestTermsResponseSchema.parse({ ok: true, next: "/entry" }), { ok: true, next: "/entry" });
  assert.equal(AcceptLatestTermsResponseSchema.safeParse({ ok: true }).success, false);
});
test("MIG-0641 U01a: SA-076 CURRENT accepted or message/retryable union", () => {
  assert.deepEqual(OnboardingTermsAcceptResponseSchema.parse({ ok: true, alreadyAccepted: true }), { ok: true, alreadyAccepted: true });
  assert.deepEqual(OnboardingTermsAcceptResponseSchema.parse({ ok: false, message: "保存に失敗しました。", retryable: true }), { ok: false, message: "保存に失敗しました。", retryable: true });
  assert.equal(OnboardingTermsAcceptResponseSchema.safeParse({ ok: false }).success, false);
});
test("MIG-0641 U01a: complete marker only carries status and optional message", () => {
  assert.deepEqual(OnboardingCompleteResponseSchema.parse({ ok: true }), { ok: true });
  assert.equal(OnboardingCompleteResponseSchema.safeParse({ ok: "yes" }).success, false);
});

test("MIG-0641 U01b: SA-075 redirect sanitizer exactly matches CURRENT on safe, external and invalid next", async () => {
  const { sanitizeNextPath } = await import("../../../src/lib/utils/next.ts");
  const { sanitizeTermsNextPath } = await import("../src/routes/personal/termsNext.ts");
  const samples = [
    undefined, null, "", "  ", "/", "/dashboard", "/entry/slotted?slot=abc",
    " /dashboard?tab=a ", "//evil.example/steal", "https://evil.example",
    "javascript:alert(1)", "entry", "/\\evil.example", "/x://bad",
    "/ok\nbad", "/ok\u007f", "/" + "a".repeat(511), "/" + "a".repeat(512),
    "/path#fragment", "/%2Fexternal", "/?next=https://evil.example",
  ];
  for (const value of samples) {
    assert.equal(sanitizeTermsNextPath(value), sanitizeNextPath(value),
      JSON.stringify(value));
  }
  assert.equal(sanitizeTermsNextPath("//evil.example"), "/dashboard");
  assert.equal(sanitizeTermsNextPath("/entry/slotted?slot=x"), "/entry/slotted?slot=x");
});

test("MIG-0641 U01c: SA-076 transport maps CURRENT accepted, retry and unavailable outcomes", async () => {
  const { projectOnboardingTerms } = await import("../src/routes/personal/termsDecision.ts");
  const cases = [
    [{ kind: "accepted", termsVersionId: "v" }, { ok: true, alreadyAccepted: false }],
    [{ kind: "already_accepted", termsVersionId: "v" }, { ok: true, alreadyAccepted: true }],
    [{ kind: "database_unavailable", retryable: true }, {
      ok: false, message: "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。", retryable: true,
    }],
    [{ kind: "concurrent_update", retryable: true }, {
      ok: false, message: "保存を完了できませんでした。再読み込み後にもう一度お試しください。同意済みの可能性があります。", retryable: true,
    }],
    [{ kind: "terms_unavailable" }, { ok: false, message: "利用規約を取得できませんでした。" }],
    [{ kind: "user_missing" }, { ok: false, message: "利用規約への同意を完了できませんでした。" }],
    [{ kind: "commit_failed" }, {
      ok: false, message: "同意の保存に失敗しました。時間をおいて再試行してください。", retryable: true,
    }],
  ];
  for (const [input, expected] of cases) {
    const value = projectOnboardingTerms(input);
    assert.deepEqual(value, expected);
    assert.deepEqual(OnboardingTermsAcceptResponseSchema.parse(value), expected);
  }
});

test("MIG-0641 U01c: SA-075 failure redirects are JSON targets and external next is sanitized", async () => {
  const { projectLatestTerms } = await import("../src/routes/personal/termsDecision.ts");
  const cases = [
    [{ kind: "accepted", termsVersionId: "v" }, "/entry/foo", { ok: true, next: "/entry/foo" }],
    [{ kind: "already_accepted", termsVersionId: "v" }, "//evil.example", { ok: true, next: "/dashboard" }],
    [{ kind: "not_authenticated" }, "https://evil.example", { ok: false, next: "/entry?next=%2Fdashboard" }],
    [{ kind: "user_missing" }, "/entry", { ok: false, next: "/entry?next=%2Fentry" }],
    [{ kind: "database_unavailable", retryable: true }, "/dashboard", { ok: false, next: "/rules?next=%2Fdashboard&error=database_unavailable" }],
    [{ kind: "concurrent_update", retryable: true }, "/entry", { ok: false, next: "/rules?next=%2Fentry&error=concurrent_update" }],
    [{ kind: "terms_unavailable" }, "/entry", { ok: false, next: "/rules?next=%2Fentry&error=terms_unavailable" }],
    [{ kind: "commit_failed" }, "/entry", { ok: false, next: "/rules?next=%2Fentry&error=terms_commit_failed" }],
  ];
  for (const [result, next, expected] of cases) {
    const value = projectLatestTerms(result, next);
    assert.deepEqual(value, expected);
    assert.deepEqual(AcceptLatestTermsResponseSchema.parse(value), expected);
  }
});

test("MIG-0641 U01c: CURRENT onboarding-complete condition accepts pending/approved ONLY", async () => {
  const { canMarkOnboardingComplete } = await import("../src/routes/personal/termsDecision.ts");
  for (const [status, expected] of [
    ["none", false], ["pending", true], ["approved", true], ["rejected", false],
  ]) assert.equal(canMarkOnboardingComplete(status), expected, status);
});

test("MIG-0641 U01d: latest accepted terms is a no-write no-audit plan", async () => {
  const { planTermsConsent } = await import("../src/routes/personal/termsConsentPlan.ts");
  const userBefore = {
    id: "u1", is_tos_accepted: 1, accepted_terms_version_id: "v1",
    terms_reaccept_required: 0, role: "user",
  };
  assert.deepEqual(planTermsConsent({
    userBefore, termsVersionId: "v1", existingConsentId: null,
    generatedConsentId: "tos_unused", now: 123,
  }), { kind: "already_accepted" });
});

test("MIG-0641 U01d: new consent produces exact CURRENT CAS, DML counts and strict audit order", async () => {
  const { planTermsConsent } = await import("../src/routes/personal/termsConsentPlan.ts");
  const original = {
    id: "u1", is_tos_accepted: null, accepted_terms_version_id: null,
    terms_reaccept_required: null, role: "user", onboarded: "keep me",
  };
  const result = planTermsConsent({
    userBefore: original, termsVersionId: "fallback-current",
    existingConsentId: null, generatedConsentId: "tos_42", now: 1700000000,
  });
  assert.equal(result.kind, "mutate");
  assert.deepEqual(result.casExpected, {
    id: "u1", is_tos_accepted: 0, accepted_terms_version_id: null,
    terms_reaccept_required: 0,
  });
  assert.deepEqual(result.insertConsent, {
    id: "tos_42", user_id: "u1", terms_version_id: "fallback-current",
    consented_at: 1700000000, consent_context: "entry",
  });
  assert.deepEqual(result.expectedMutationChanges, [1, 1]);
  assert.deepEqual(result.userAfter, {
    ...original, is_tos_accepted: 1,
    accepted_terms_version_id: "fallback-current", terms_reaccept_required: 0,
  });
  assert.deepEqual(result.audits.map(x => [x.table_name, x.operation, x.reason]), [
    ["user_tos_consents", "CREATE", "規約 fallback-current への同意"],
    ["user", "UPDATE", "規約 fallback-current への同意状態更新"],
  ]);
  assert.ok(result.audits.every(x => x.strict && x.retention_class === "long_audit" && x.context === "terms_accept"));
  assert.deepEqual(original, {
    id: "u1", is_tos_accepted: null, accepted_terms_version_id: null,
    terms_reaccept_required: null, role: "user", onboarded: "keep me",
  }, "planning must not mutate the source snapshot");
});

test("MIG-0641 U01d: existing consent repairs user only with a single CAS UPDATE and audit", async () => {
  const { planTermsConsent } = await import("../src/routes/personal/termsConsentPlan.ts");
  const result = planTermsConsent({
    userBefore: { id: "u1", is_tos_accepted: 1, accepted_terms_version_id: "old",
      terms_reaccept_required: 1, name: "unchanged" },
    termsVersionId: "new",
    existingConsentId: "tos_existing", generatedConsentId: "tos_unused", now: 10,
  });
  assert.equal(result.kind, "mutate");
  assert.equal(result.insertConsent, null);
  assert.deepEqual(result.expectedMutationChanges, [1]);
  assert.equal(result.audits.length, 1);
  assert.equal(result.audits[0].table_name, "user");
  assert.equal(result.audits[0].reason, "規約 new への同意状態修復");
  assert.deepEqual(result.casExpected, {
    id: "u1", accepted_terms_version_id: "old", is_tos_accepted: 1,
    terms_reaccept_required: 1,
  });
  assert.deepEqual(result.userAfter, {
    id: "u1", is_tos_accepted: 1,
    accepted_terms_version_id: "new", terms_reaccept_required: 0, name: "unchanged",
  });
});

test("MIG-0641 U03a: absent/rejected X state runs zero D1 statements", async () => {
  const { markOnboardingComplete } = await import("../src/routes/personal/termsCompletion.ts");
  let calls = 0;
  const db = { prepare: () => { calls += 1; throw Error("must not query"); } };
  assert.equal(await markOnboardingComplete(db, "u1", "none", 11), false);
  assert.equal(await markOnboardingComplete(db, "u1", "rejected", 11), false);
  assert.equal(calls, 0);
});

test("MIG-0641 U03a: pending and approved update only null completion, never overwrite", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { markOnboardingComplete } = await import("../src/routes/personal/termsCompletion.ts");
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "onboarding_completed_at" INTEGER NULL)');
    sqlite.prepare('INSERT INTO "user" ("id") VALUES (?)').run("u1");
    sqlite.prepare('INSERT INTO "user" ("id") VALUES (?)').run("u2");
    const statements = [];
    const fakeD1 = {
      prepare(query) {
        statements.push(query);
        const stmt = sqlite.prepare(query);
        return { bind: (...args) => ({ run: async () => stmt.run(...args) }) };
      },
    };
    assert.equal(await markOnboardingComplete(fakeD1, "u1", "pending", 100), true);
    assert.equal(await markOnboardingComplete(fakeD1, "u1", "approved", 200), true);
    assert.equal(await markOnboardingComplete(fakeD1, "u2", "approved", 300), true);
    assert.equal(await markOnboardingComplete(fakeD1, "missing-user", "approved", 400), true);
    const get = (id) => sqlite.prepare('SELECT "onboarding_completed_at" AS t FROM "user" WHERE "id" = ?').get(id)?.t;
    assert.equal(get("u1"), 100, "same user marker can only be set once");
    assert.equal(get("u2"), 300);
    assert.equal(get("missing-user"), undefined);
    assert.equal(statements.length, 4);
    assert.ok(statements.every(s => s.includes('WHERE "id" = ? AND "onboarding_completed_at" IS NULL')));
  } finally {
    sqlite.close();
  }
});

test("MIG-0641 U03a: failed completion update is non-fatal and never leaks D1 errors", async () => {
  const { markOnboardingComplete } = await import("../src/routes/personal/termsCompletion.ts");
  const db = { prepare: () => ({ bind: () => ({ run: async () => { throw Error("private binding!"); } }) }) };
  assert.equal(await markOnboardingComplete(db, "u1", "pending", 123), false);
});

test("MIG-0641 U01e: compiled consent SQL is parametrized and CAS matches CURRENT columns", async () => {
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const { planTermsConsent } = await import("../src/routes/personal/termsConsentPlan.ts");
  const { buildTermsMutationSql } = await import("../src/routes/personal/termsAtomic.ts");
  const dialect = new SQLiteSyncDialect();
  const plan = planTermsConsent({
    userBefore: { id: "u1", accepted_terms_version_id: "old",
      is_tos_accepted: 0, terms_reaccept_required: 1 },
    termsVersionId: "new'; DROP TABLE user; --",
    existingConsentId: null, generatedConsentId: "tos_id", now: 123,
  });
  assert.equal(plan.kind, "mutate");
  const queries = buildTermsMutationSql(plan).map((stmt) => dialect.sqlToQuery(stmt));
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /INSERT INTO "user_tos_consents"/);
  assert.match(queries[1].sql, /UPDATE "user"/);
  assert.match(queries[1].sql, /"is_tos_accepted" = \?/);
  assert.match(queries[1].sql, /"terms_reaccept_required" = \?/);
  assert.match(queries[1].sql, /"accepted_terms_version_id" = \?/);
  assert.ok(queries[0].params.includes("new'; DROP TABLE user; --"));
  assert.ok(queries[1].params.includes("new'; DROP TABLE user; --"));
  assert.doesNotMatch(queries.map((q) => q.sql).join("\n"), /DROP TABLE/);
  assert.deepEqual(plan.expectedMutationChanges, [1, 1]);
});

test("MIG-0641 U01e: real SQLite consent CAS rejects concurrent update and preserves prior snapshot", async () => {
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const { DatabaseSync } = await import("node:sqlite");
  const { planTermsConsent } = await import("../src/routes/personal/termsConsentPlan.ts");
  const { buildTermsMutationSql } = await import("../src/routes/personal/termsAtomic.ts");
  const dialect = new SQLiteSyncDialect();
  const db = new DatabaseSync(":memory:");
  try {
    db.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "is_tos_accepted" INTEGER, "accepted_terms_version_id" TEXT, "terms_reaccept_required" INTEGER)');
    db.exec('CREATE TABLE "user_tos_consents" ("id" TEXT PRIMARY KEY, "user_id" TEXT, "terms_version_id" TEXT, "consented_at" INTEGER, "consent_context" TEXT)');
    db.prepare('INSERT INTO "user" VALUES (?, ?, ?, ?)').run("u1", 0, "old", 0);
    const build = (version, consent) => planTermsConsent({
      userBefore: { id: "u1", is_tos_accepted: 0, accepted_terms_version_id: "old", terms_reaccept_required: 0 },
      termsVersionId: version, existingConsentId: null, generatedConsentId: consent, now: 123,
    });
    const execute = (plan, stale = false) => {
      const queries = buildTermsMutationSql(plan).map(x => dialect.sqlToQuery(x));
      db.exec("BEGIN");
      try {
        for (const q of queries) {
          const result = db.prepare(q.sql).run(...q.params);
          if (result.changes !== 1) throw new Error("CAS conflict");
        }
        db.exec("COMMIT");
        return true;
      } catch {
        db.exec("ROLLBACK");
        return false;
      }
    };
    assert.equal(execute(build("v1", "c1")), true);
    assert.equal(db.prepare('SELECT accepted_terms_version_id FROM "user" WHERE id = ?').get("u1").accepted_terms_version_id, "v1");
    assert.equal(execute(build("v2", "c2")), false);
    assert.equal(db.prepare('SELECT count(*) AS n FROM user_tos_consents').get().n, 1,
      "failed CAS rolls back the preceding insert");
    assert.equal(db.prepare('SELECT terms_version_id FROM user_tos_consents').get().terms_version_id, "v1");
    assert.equal(db.prepare('SELECT accepted_terms_version_id FROM "user"').get().accepted_terms_version_id, "v1");
  } finally {
    db.close();
  }
});

test("MIG-0641 U01e: repair branch uses one CAS UPDATE and no duplicate consent insertion", async () => {
  const { SQLiteSyncDialect } = await import("drizzle-orm/sqlite-core");
  const { planTermsConsent } = await import("../src/routes/personal/termsConsentPlan.ts");
  const { buildTermsMutationSql } = await import("../src/routes/personal/termsAtomic.ts");
  const plan = planTermsConsent({
    userBefore: { id: "u1", accepted_terms_version_id: "old", is_tos_accepted: 1, terms_reaccept_required: 1 },
    termsVersionId: "v1", existingConsentId: "existing", generatedConsentId: "unused", now: 20,
  });
  assert.equal(plan.kind, "mutate");
  const queries = buildTermsMutationSql(plan).map(x => new SQLiteSyncDialect().sqlToQuery(x));
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /UPDATE "user"/);
  assert.deepEqual(plan.expectedMutationChanges, [1]);
  assert.deepEqual(plan.audits.map(a => a.table_name), ["user"]);
});

test("MIG-0641 U01f: snapshot performs ONE bounded D1 statement with published-order and exact consent", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { loadTermsSnapshot, TERMS_SNAPSHOT_SQL } = await import("../src/routes/personal/termsSnapshot.ts");
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "name" TEXT, "emailVerified" INTEGER, "is_tos_accepted" INTEGER, "accepted_terms_version_id" TEXT, "terms_reaccept_required" INTEGER)');
    sqlite.exec('CREATE TABLE "terms_versions" ("id" TEXT PRIMARY KEY, "status" TEXT, "published_at" INTEGER, "updated_at" INTEGER)');
    sqlite.exec('CREATE TABLE "user_tos_consents" ("id" TEXT PRIMARY KEY, "user_id" TEXT, "terms_version_id" TEXT)');
    sqlite.prepare('INSERT INTO "user" VALUES (?, ?, ?, ?, ?, ?)').run("u1", "Name", 1760000000000, 0, null, 0);
    for(const [id,status,pub,updated] of [
      ["old", "published", 100, 100], ["new-a", "published", 200, 100],
      ["new-b", "published", 200, 200], ["draft", "draft", 900, 900],
    ]) sqlite.prepare('INSERT INTO "terms_versions" VALUES (?, ?, ?, ?)').run(id, status, pub, updated);
    sqlite.prepare('INSERT INTO "user_tos_consents" VALUES (?, ?, ?)').run("consent", "u1", "new-b");
    let count = 0;
    const d1 = { prepare(query) {
      count += 1;
      assert.equal(query, TERMS_SNAPSHOT_SQL);
      return { bind: (...values) => ({ first: async () => sqlite.prepare(query).get(...values) ?? null }) };
    } };
    const result = await loadTermsSnapshot(d1, "u1");
    assert.equal(count, 1);
    assert.equal(result.termsVersionId, "new-b");
    assert.equal(result.existingConsentId, "consent");
    assert.equal(result.userBefore.id, "u1");
    assert.equal(result.userBefore.name, "Name");
    assert.equal(result.userBefore.emailVerified.getTime(), 1760000000000);
    assert.equal(Object.hasOwn(result.userBefore, "__terms_version_id"), false);
    assert.equal(await loadTermsSnapshot(d1, "missing"), null);
    assert.equal(count, 2, "one statement for each lookup, no follow-up read");
  } finally { sqlite.close(); }
});

test("MIG-0641 U01f: snapshot fallback and no-consent return, without publishing drafts", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { loadTermsSnapshot } = await import("../src/routes/personal/termsSnapshot.ts");
  const sqlite = new DatabaseSync(":memory:");
  try {
    sqlite.exec('CREATE TABLE "user" ("id" TEXT PRIMARY KEY, "emailVerified" INTEGER)');
    sqlite.exec('CREATE TABLE "terms_versions" ("id" TEXT PRIMARY KEY, "status" TEXT, "published_at" INTEGER, "updated_at" INTEGER)');
    sqlite.exec('CREATE TABLE "user_tos_consents" ("id" TEXT PRIMARY KEY, "user_id" TEXT, "terms_version_id" TEXT)');
    sqlite.prepare('INSERT INTO "user" VALUES (?, ?)').run("u1", null);
    sqlite.prepare('INSERT INTO "terms_versions" VALUES (?, ?, ?, ?)').run("not-published", "draft", 999, 999);
    const d1 = { prepare: q => ({ bind: (...values) => ({ first: async () => sqlite.prepare(q).get(...values) ?? null }) }) };
    assert.deepEqual(await loadTermsSnapshot(d1, "u1"), {
      userBefore: { id: "u1", emailVerified: null },
      termsVersionId: "fallback-current", existingConsentId: null,
    });
  } finally { sqlite.close(); }
});

test("MIG-0641 U01g: orchestrated fresh consent creates one plan and returns accepted", async () => {
  const { commitLatestTermsForUser } = await import("../src/routes/personal/termsCommit.ts");
  let reads = 0, commits = 0, ids = 0, clock = 0;
  const read = () => ({ userBefore: {
    id: "u1", accepted_terms_version_id: null,
    is_tos_accepted: 0, terms_reaccept_required: 0,
  }, termsVersionId: "v1", existingConsentId: null });
  const port = {
    load: async (id) => { reads += 1; assert.equal(id, "u1"); return read(); },
    commit: async plan => {
      commits += 1;
      assert.equal(plan.kind, "mutate");
      assert.deepEqual(plan.expectedMutationChanges, [1, 1]);
      assert.equal(plan.insertConsent.id, "tos_generated");
      assert.equal(plan.insertConsent.consented_at, 123);
      assert.deepEqual(plan.audits.map(x => x.table_name), ["user_tos_consents", "user"]);
      return "accepted";
    },
    generateConsentId: () => { ids += 1; return "tos_generated"; },
    now: () => { clock += 1; return 123; },
  };
  assert.deepEqual(await commitLatestTermsForUser(port, "u1"), { kind: "accepted", termsVersionId: "v1" });
  assert.deepEqual({reads,commits,ids,clock}, {reads:1,commits:1,ids:1,clock:1});
});

test("MIG-0641 U01g: already-accepted short-circuits without ids, time, commits or audit", async () => {
  const { commitLatestTermsForUser } = await import("../src/routes/personal/termsCommit.ts");
  const unexpected = () => { throw new Error("side effect must not happen"); };
  const port = {
    load: async () => ({ userBefore: {
      id: "u1", accepted_terms_version_id: "v1", is_tos_accepted: 1, terms_reaccept_required: 0,
    }, termsVersionId: "v1", existingConsentId: "already" }),
    commit: unexpected, generateConsentId: unexpected, now: unexpected,
  };
  assert.deepEqual(await commitLatestTermsForUser(port, "u1"), { kind: "already_accepted", termsVersionId: "v1" });
  assert.deepEqual(await commitLatestTermsForUser(port, null), { kind: "not_authenticated" });
});

test("MIG-0641 U01g: no user, invalid session snapshot, D1 error fail closed", async () => {
  const { commitLatestTermsForUser } = await import("../src/routes/personal/termsCommit.ts");
  const make = load => ({
    load, commit: () => { throw Error("no writes allowed"); },
    generateConsentId: () => "tos", now: () => 123,
  });
  assert.deepEqual(await commitLatestTermsForUser(make(async () => null), "u1"), { kind: "user_missing" });
  assert.deepEqual(await commitLatestTermsForUser(make(async () => ({
    userBefore: { id: "other", accepted_terms_version_id: null, is_tos_accepted: 0, terms_reaccept_required: 0 },
    termsVersionId: "v", existingConsentId: null,
  })), "u1"), { kind: "database_unavailable", retryable: true });
  assert.deepEqual(await commitLatestTermsForUser(make(async () => { throw Error("private query secret"); }), "u1"),
    { kind: "database_unavailable", retryable: true });
});

test("MIG-0641 U01g: audited CAS collision treats concurrent same-version acceptance as idempotent", async () => {
  const { AuditMutationError } = await import("@flamenode/server-core/audit/mutate");
  const { commitLatestTermsForUser } = await import("../src/routes/personal/termsCommit.ts");
  const original = { id: "u1", is_tos_accepted: 0, accepted_terms_version_id: "old", terms_reaccept_required: 0 };
  const accepted = { ...original, is_tos_accepted: 1, accepted_terms_version_id: "v1" };
  let reads=0, commits=0;
  const port = {
    load: async () => ({ userBefore: reads++ ? accepted : original, termsVersionId: "v1", existingConsentId: "c1" }),
    commit: async () => { commits++; throw new AuditMutationError("unique constraint with secrets"); },
    generateConsentId: () => "unused", now: () => 120,
  };
  assert.deepEqual(await commitLatestTermsForUser(port, "u1"), { kind: "already_accepted", termsVersionId: "v1" });
  assert.equal(reads, 2); assert.equal(commits, 1);
});

test("MIG-0641 U01g: stale CAS returns retryable conflict; unexpected mutation errors are redacted", async () => {
  const { AuditMutationError } = await import("@flamenode/server-core/audit/mutate");
  const { commitLatestTermsForUser } = await import("../src/routes/personal/termsCommit.ts");
  const before = { id: "u1", is_tos_accepted: 0, accepted_terms_version_id: "old", terms_reaccept_required: 0 };
  const mk = commit => ({
    load: async () => ({userBefore: before, termsVersionId: "v1", existingConsentId: null}),
    commit, generateConsentId: () => "c", now: () => 123,
  });
  assert.deepEqual(await commitLatestTermsForUser(mk(async () => { throw new AuditMutationError("internal info"); }), "u1"),
    { kind: "concurrent_update", retryable: true });
  assert.deepEqual(await commitLatestTermsForUser(mk(async () => { throw Error("sql with secret"); }), "u1"),
    { kind: "commit_failed" });
});

test("MIG-0641 U01h: isolated route factory refuses to construct without an explicit CostGuard", async () => {
  const { createIsolatedTermsWriteRoutes } = await import("../src/routes/personal/termsRoutes.ts");
  assert.throws(() => createIsolatedTermsWriteRoutes({}), /CostGuard middleware is required/);
});

test("MIG-0641 U01h: bad origin/anonymous/banned/cost-denied never call terms mutation", async () => {
  const { Hono } = await import("hono");
  const { createIsolatedTermsWriteRoutes } = await import("../src/routes/personal/termsRoutes.ts");
  const SITE = "https://app.flamenode.example";
  const USER = { id: "u1", name: "U", email: null, image: null, role: "user", is_banned: 0, active_x_user_id: null };
  for (const scenario of ["bad-origin", "anonymous", "banned", "cost-denied"]) {
    let sessions = 0, gates = 0, commits = 0;
    const app = new Hono();
    app.route("/api/personal", createIsolatedTermsWriteRoutes({
      session: async (c, next) => {
        sessions += 1;
        const u = scenario === "anonymous" ? null : { ...USER, is_banned: scenario === "banned" ? 1 : 0 };
        c.set("user", u); c.set("sessionState", u ? "user" : "none");
        await next();
      },
      operationGuard: async (c, next) => {
        gates += 1;
        if (scenario === "cost-denied") return c.json({ ok: false, reason: "cost_guard_blocked" }, 503);
        await next();
      },
      commit: async () => { commits += 1; return {kind:"accepted",termsVersionId:"v1"}; },
    }));
    const response = await app.request("/api/personal/onboarding/terms", {
      method: "POST", headers: { Origin: scenario === "bad-origin" ? "https://evil.example" : SITE,
        "Content-Type": "application/json" }, body: "{}",
    }, { DB: { prepare: () => { throw Error("must not read"); } }, NEXT_PUBLIC_SITE_URL: SITE });
    assert.equal(response.status, scenario === "anonymous" ? 401 : scenario === "banned" || scenario === "bad-origin" ? 403 : 503, scenario);
    assert.equal(commits, 0);
    assert.equal(gates, scenario === "cost-denied" ? 1 : 0);
    assert.equal(sessions, scenario === "bad-origin" ? 0 : 1);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});

test("MIG-0641 U01h: ToS-unaccepted but authenticated user may accept once after mandatory guards", async () => {
  const { Hono } = await import("hono");
  const { createIsolatedTermsWriteRoutes } = await import("../src/routes/personal/termsRoutes.ts");
  const site="https://app.flamenode.example";
  const calls=[];
  const app = new Hono();
  app.route("/api/personal", createIsolatedTermsWriteRoutes({
    session: async (c,next) => { calls.push("session"); c.set("user", {id:"u1", is_banned:0, role:"user",
      name:null,email:null,image:null,active_x_user_id:null}); c.set("sessionState","user"); await next(); },
    operationGuard: async (_c,next) => { calls.push("cost"); await next(); },
    commit: async (_c,id) => { calls.push("commit:"+id); return {kind:"accepted",termsVersionId:"v1"}; },
  }));
  const db={ prepare: () => { throw Error("unexpected D1 read"); } };
  const res=await app.request("/api/personal/onboarding/terms", {
    method:"POST", headers:{Origin:site,"Content-Type":"application/json"},body:"{}",
  },{DB:db,NEXT_PUBLIC_SITE_URL:site});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(), {ok:true,alreadyAccepted:false});
  assert.deepEqual(calls, ["session","cost","commit:u1"]);
  assert.equal(res.headers.get("Cache-Control"),"private, no-store");
});

test("MIG-0641 U01h: SA-075 sanitized JSON next, CAS conflict, malformed and oversized bodies", async () => {
  const { Hono } = await import("hono");
  const { createIsolatedTermsWriteRoutes } = await import("../src/routes/personal/termsRoutes.ts");
  const site="https://app.flamenode.example";
  let writes=0;
  const app=new Hono();
  app.route("/api/personal",createIsolatedTermsWriteRoutes({
    session: async (c,next)=>{c.set("user",{id:"u1",is_banned:0});c.set("sessionState","user");await next();},
    operationGuard: async (_c,next)=>next(),
    commit: async ()=>{writes++;return {kind:"concurrent_update",retryable:true};},
  }));
  const request = (body)=>app.request("/api/personal/terms/accept",{
    method:"POST",headers:{Origin:site,"Content-Type":"application/json"},body
  },{DB:{prepare:()=>{throw Error("no read");}},NEXT_PUBLIC_SITE_URL:site});
  const err=await request(JSON.stringify({next:"//evil.example"}));
  assert.equal(err.status,409);
  assert.deepEqual(await err.json(),{ok:false,next:"/rules?next=%2Fdashboard&error=concurrent_update"});
  assert.equal(writes,1);
  assert.equal((await request('{"next":42}')).status,400);
  assert.equal((await request("{broken json")).status,400);
  assert.equal((await request("x".repeat(2049))).status,413);
  assert.equal(writes,1,"invalid requests must not invoke the consent commit");
});
