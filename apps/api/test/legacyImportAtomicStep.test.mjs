import assert from "node:assert/strict";
import { test } from "node:test";
import { commitLegacyImportOneStep } from "../src/routes/admin/legacyImportAtomicStep.ts";

test("RH-002 U02b: one D1 step, then one R2 advance; returns committed progress", async () => {
  const calls = [];
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => {
      calls.push("D1");
      return { progress: { stage: "events", index: 1 }, complete: false };
    },
    advanceClaim: async (progress) => {
      calls.push("R2:" + progress.index);
      return 1700001000;
    },
    releaseClaim: async () => { calls.push("release"); },
  });
  assert.deepEqual(calls, ["D1", "R2:1"]);
  assert.deepEqual(outcome, {
    kind: "advanced",
    step: { progress: { stage: "events", index: 1 }, complete: false },
    expiresAt: 1700001000,
  });
});

test("RH-002 U02b: R2 CAS failure after D1 commit never repeats D1 and retains next progress", async () => {
  const calls = [];
  const cause = new Error("CAS conflict");
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => {
      calls.push("D1");
      return { progress: { stage: "videos", index: 2 }, complete: false };
    },
    advanceClaim: async () => { calls.push("R2"); throw cause; },
    releaseClaim: async () => { calls.push("release"); },
  });
  assert.deepEqual(calls, ["D1", "R2", "release"]);
  assert.equal(outcome.kind, "committed_progress_pending");
  assert.equal(outcome.cause, cause);
  assert.deepEqual(outcome.step.progress, { stage: "videos", index: 2 });
});

test("RH-002 U02b: failed release after committed D1 does not erase pending-progress outcome", async () => {
  let writes = 0;
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => { writes++; return { progress: 4, complete: true }; },
    advanceClaim: async () => { throw new Error("R2 failed"); },
    releaseClaim: async () => { throw new Error("release failed"); },
  });
  assert.equal(writes, 1);
  assert.equal(outcome.kind, "committed_progress_pending");
  assert.equal(outcome.step.progress, 4);
  assert.equal(outcome.step.complete, true);
});

test("RH-002 U02b: D1 failure is not reported as committed; release best effort", async () => {
  const calls = [];
  const dbFailure = new Error("D1 rolled back");
  await assert.rejects(commitLegacyImportOneStep({
    applyStep: async () => { calls.push("D1"); throw dbFailure; },
    advanceClaim: async () => { calls.push("R2"); return 1; },
    releaseClaim: async () => { calls.push("release"); },
  }), (error) => error === dbFailure);
  assert.deepEqual(calls, ["D1", "release"]);

  await assert.rejects(commitLegacyImportOneStep({
    applyStep: async () => { throw dbFailure; },
    advanceClaim: async () => 1,
    releaseClaim: async () => { throw new Error("R2 release unavailable"); },
  }), (error) => error === dbFailure);
});

test("RH-002 U02b/U02c: committed D1/R2 CAS error preserves HTTP recovery envelope", async () => {
  const { legacyImportCommittedProgressPending } = await import("../src/routes/admin/legacyImportErrors.ts");
  const calls = [];
  const outcome = await commitLegacyImportOneStep({
    applyStep: async () => {
      calls.push("committed");
      return { progress: { stage: "events", index: 2 }, complete: false };
    },
    advanceClaim: async () => {
      calls.push("cas-failed");
      throw new Error("R2 unavailable");
    },
    releaseClaim: async () => { calls.push("release"); },
  });
  assert.deepEqual(calls, ["committed", "cas-failed", "release"]);
  assert.equal(outcome.kind, "committed_progress_pending");
  const response = legacyImportCommittedProgressPending({
    retryable: true,
    planHash: "hash",
    attempt: 4,
    progress: { stage: outcome.step.progress.stage, index: outcome.step.progress.index, completed: 2, total: 8 },
    result: { complete: outcome.step.complete, createdEvents: 2 },
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.committed, true);
  assert.equal(response.body.kind, "committed_progress_pending");
  assert.equal(response.body.requires_repreview, false);
  assert.equal(response.body.retryable, true);
  assert.deepEqual(response.body.progress, { stage: "events", index: 2, completed: 2, total: 8 });
});


test("MIG-0645 U02i: SQLite/D1 batch rolls back x_users, rebuild queue and audit on marker failure", async () => {
  const { createAdminD1 } = await import("./helpers/sqliteD1.mjs");
  const { db, sqlite, stats } = createAdminD1();
  try {
    const count = (table) =>
      sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n;
    const statement = (sql, ...params) => db.prepare(sql).bind(...params);
    // Force a duplicate audit marker as the *last* statement in the batch:
    // the X-user row, rebuild request and entity audit have already executed.
    sqlite.prepare(
      "INSERT INTO audit_logs (id, table_name, target_id, context) VALUES ('marker-conflict', 'preexisting', 'other', 'test')",
    ).run();
    const mutation = (markerId) => [
      statement(
        "INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, 'imported')",
        "legacy_x_1", "Legacy X",
      ),
      statement(
        "INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status) VALUES (?, 'users_index', 'global', 'legacy_import_x_users', 'low', 'pending')",
        "rebuild-x-1",
      ),
      statement(
        "INSERT INTO audit_logs (id, table_name, target_id, context) VALUES (?, 'x_users_import_batch', 'legacy:legacy_x_1', 'legacy_import')",
        "x-entity-audit",
      ),
      statement(
        "INSERT INTO audit_logs (id, table_name, target_id, context) VALUES (?, 'legacy_import_steps', 'step:x_users:0', 'legacy_import:step')",
        markerId,
      ),
    ];
    await assert.rejects(db.batch(mutation("marker-conflict")));
    assert.equal(count("x_users"), 0, "a failed marker must roll back inserted X users");
    assert.equal(count("static_rebuild_queue"), 0, "a failed marker must roll back the rebuild request");
    assert.equal(count("audit_logs"), 1, "the X-user entity audit must also roll back");
    assert.equal(
      sqlite.prepare("SELECT table_name FROM audit_logs WHERE id = 'marker-conflict'").get().table_name,
      "preexisting",
      "a failed batch cannot disturb the preexisting audit row",
    );
    await db.batch(mutation("marker-success"));
    assert.equal(count("x_users"), 1);
    assert.equal(count("static_rebuild_queue"), 1);
    assert.equal(count("audit_logs"), 3, "entity and replay-marker audits committed together");
    assert.equal(
      sqlite.prepare("SELECT context FROM audit_logs WHERE id = 'marker-success'").get().context,
      "legacy_import:step",
    );
    assert.equal(stats.batches, 2, "one failed batch plus one recovery batch");
  } finally {
    sqlite.close();
  }
});

test("MIG-0645 U02j: real mutateWithAudit batch rolls back X-user marker injection", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const { sql } = await import("drizzle-orm");
  const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
  const { createAdminD1, seedBase } = await import("./helpers/sqliteD1.mjs");
  const { db: d1, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    const db = drizzle(d1);
    const count = (name) => sqlite.prepare('SELECT COUNT(*) AS n FROM "' + name + '"').get().n;
    sqlite.exec(`CREATE TRIGGER fail_legacy_import_marker
      BEFORE INSERT ON audit_logs
      WHEN NEW.table_name = 'legacy_import_steps'
      BEGIN SELECT RAISE(ABORT, 'injected marker insert failure'); END`);
    const input = {
      mutationStatements: [
        db.run(sql.raw("INSERT INTO x_users (id, x_name, approval_status) VALUES ('legacy_x_2', 'Legacy X 2', 'imported')")),
        db.run(sql.raw("INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status) VALUES ('rebuild-x-2', 'users_index', 'global', 'legacy_import_x_users', 'low', 'pending')")),
      ],
      expectedMutationChanges: [1, 1],
      audits: [
        { table_name: "x_users_import_batch", target_id: "legacy:legacy_x_2", operation: "CREATE",
          before: null, after: { ids: ["legacy_x_2"] }, actor_user_id: "admin-1",
          context: "legacy_import", retention_class: "long_audit", restore_strategy: "none" },
        { table_name: "legacy_import_steps", target_id: "step:x_users:0", operation: "SYSTEM",
          before: null, after: { stage: "x_users", created: 1 }, actor_user_id: "admin-1",
          context: "legacy_import:step", retention_class: "long_audit", restore_strategy: "none" },
      ],
    };
    await assert.rejects(mutateWithAudit(db, input), /injected marker insert failure/);
    assert.equal(stats.batches, 1, "marker failure reached the audited D1 batch");
    assert.equal(count("x_users"), 0);
    assert.equal(count("static_rebuild_queue"), 0);
    assert.equal(count("audit_logs"), 0);
    sqlite.exec("DROP TRIGGER fail_legacy_import_marker");
    await mutateWithAudit(db, input);
    assert.equal(stats.batches, 2);
    assert.equal(count("x_users"), 1);
    assert.equal(count("static_rebuild_queue"), 1);
    assert.equal(count("audit_logs"), 2);
    assert.deepEqual(sqlite.prepare("SELECT table_name FROM audit_logs ORDER BY table_name").all().map(x => x.table_name),
      ["legacy_import_steps", "x_users_import_batch"]);
  } finally {
    sqlite.close();
  }
});


test("MIG-0645 U02k: committed D1 audit marker replays after R2 CAS failure without another batch", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const { sql } = await import("drizzle-orm");
  const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
  const { createAdminD1, seedBase } = await import("./helpers/sqliteD1.mjs");
  const { db: d1, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    const db = drizzle(d1);
    const target = "step:test:x_users:0";
    let d1Calls = 0;
    let releases = 0;
    let r2Attempts = 0;
    let r2Progress = { stage: "x_users", index: 0 };
    const applyStep = async () => {
      d1Calls++;
      // Stand-in for the CURRENT recoveredStepMarker identity and payload
      // validation: it must read the *durable* D1 audit, never JS memory.
      const receipt = sqlite.prepare(
        "SELECT after_json FROM audit_logs WHERE table_name = 'legacy_import_steps' AND target_id = ?",
      ).get(target);
      if (receipt) {
        const marker = JSON.parse(receipt.after_json);
        assert.deepEqual(marker, { next_stage: "softwares", next_index: 0 });
        return { progress: { stage: marker.next_stage, index: marker.next_index }, complete: false };
      }
      await mutateWithAudit(db, {
        mutationStatements: [
          db.run(sql.raw("INSERT INTO x_users (id, x_name, approval_status) VALUES ('legacy_x_3', 'Legacy X 3', 'imported')")),
          db.run(sql.raw("INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status) VALUES ('rebuild-x-3', 'users_index', 'global', 'legacy_import_x_users', 'low', 'pending')")),
        ],
        expectedMutationChanges: [1, 1],
        audits: [
          { table_name: "x_users_import_batch", target_id: "legacy:legacy_x_3", operation: "CREATE",
            before: null, after: { ids: ["legacy_x_3"] }, actor_user_id: "admin-1",
            context: "legacy_import", retention_class: "long_audit", restore_strategy: "none" },
          { table_name: "legacy_import_steps", target_id: target, operation: "SYSTEM",
            before: null, after: { next_stage: "softwares", next_index: 0 }, actor_user_id: "admin-1",
            context: "legacy_import:step", retention_class: "long_audit", restore_strategy: "none" },
        ],
      });
      return { progress: { stage: "softwares", index: 0 }, complete: false };
    };
    const attempt = () => commitLegacyImportOneStep({
      applyStep,
      advanceClaim: async (progress) => {
        r2Attempts++;
        if (r2Attempts === 1) throw new Error("injected R2 CAS conflict");
        r2Progress = progress;
        return 1700001000;
      },
      releaseClaim: async () => { releases++; },
    });
    const first = await attempt();
    assert.equal(first.kind, "committed_progress_pending");
    assert.equal(first.step.progress.stage, "softwares");
    assert.deepEqual(r2Progress, { stage: "x_users", index: 0 }, "first CAS leaves R2 behind");
    assert.equal(releases, 1);
    assert.equal(stats.batches, 1, "D1 was already committed once");
    const second = await attempt();
    assert.equal(second.kind, "advanced");
    assert.equal(second.step.progress.stage, "softwares");
    assert.deepEqual(r2Progress, { stage: "softwares", index: 0 });
    assert.equal(stats.batches, 1, "audit-marker replay must not reapply D1");
    assert.equal(d1Calls, 2, "D1 adapter is called again for the same progress");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 2);
  } finally {
    sqlite.close();
  }
});


test("MIG-0645 U02m: failed audited D1 step releases claim and does not advance R2", async () => {
  const { drizzle } = await import("drizzle-orm/d1");
  const { sql } = await import("drizzle-orm");
  const { mutateWithAudit } = await import("@flamenode/server-core/audit/mutate");
  const { createAdminD1, seedBase } = await import("./helpers/sqliteD1.mjs");
  const { db: d1, sqlite, stats } = createAdminD1();
  try {
    seedBase(sqlite);
    const db = drizzle(d1);
    const initial = { stage: "x_users", index: 0 };
    let r2Progress = initial;
    let advances = 0;
    let releases = 0;
    sqlite.exec("CREATE TRIGGER fail_legacy_marker_u02m " +
      "BEFORE INSERT ON audit_logs " +
      "WHEN NEW.table_name = 'legacy_import_steps' " +
      "BEGIN SELECT RAISE(ABORT, 'injected D1 marker failure'); END");
    const attempt = () => commitLegacyImportOneStep({
      applyStep: async () => {
        await mutateWithAudit(db, {
          mutationStatements: [
            db.run(sql.raw("INSERT INTO x_users (id, x_name, approval_status) VALUES ('legacy_x_4', 'Legacy X 4', 'imported')")),
            db.run(sql.raw("INSERT INTO static_rebuild_queue (id, target_type, target_id, reason, priority, status) VALUES ('rebuild-x-4', 'users_index', 'global', 'legacy_import_x_users', 'low', 'pending')")),
          ],
          expectedMutationChanges: [1, 1],
          audits: [
            { table_name: "x_users_import_batch", target_id: "legacy:legacy_x_4", operation: "CREATE",
              before: null, after: { ids: ["legacy_x_4"] }, actor_user_id: "admin-1",
              context: "legacy_import", retention_class: "long_audit", restore_strategy: "none" },
            { table_name: "legacy_import_steps", target_id: "step:x_users:0", operation: "SYSTEM",
              before: null, after: { next_stage: "softwares", next_index: 0 }, actor_user_id: "admin-1",
              context: "legacy_import:step", retention_class: "long_audit", restore_strategy: "none" },
          ],
        });
        return { progress: { stage: "softwares", index: 0 }, complete: false };
      },
      advanceClaim: async (progress) => {
        advances++;
        r2Progress = progress;
        return 1700001000;
      },
      releaseClaim: async () => { releases++; },
    });
    await assert.rejects(attempt(), /injected D1 marker failure/);
    assert.equal(stats.batches, 1, "fault occurs inside the D1 audit batch");
    assert.equal(advances, 0, "R2 must not advance after rolled-back D1");
    assert.equal(releases, 1, "failed D1 must release R2 claim");
    assert.deepEqual(r2Progress, initial);
    for (const table of ["x_users", "static_rebuild_queue", "audit_logs"]) {
      assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, 0);
    }
    sqlite.exec("DROP TRIGGER fail_legacy_marker_u02m");
    const recovered = await attempt();
    assert.equal(recovered.kind, "advanced");
    assert.equal(stats.batches, 2);
    assert.equal(advances, 1);
    assert.equal(releases, 1);
    assert.deepEqual(r2Progress, { stage: "softwares", index: 0 });
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM x_users").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM static_rebuild_queue").get().n, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n, 2);
  } finally {
    sqlite.close();
  }
});
