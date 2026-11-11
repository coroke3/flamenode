import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLegacyFiles } from "@flamenode/server-core/legacyImport/normalize";
import { parseLegacyImportText } from "@flamenode/server-core/legacyImport/parse";
import { legacyImportD1PreflightAdapter } from "../src/routes/admin/legacyImportD1PreflightAdapter.ts";
import { preflightLegacyImportPlan } from "@flamenode/server-core/legacyImport/preflight";

function plan(csv = "") {
  return normalizeLegacyFiles(
    csv ? [parseLegacyImportText("events.csv", csv)] : [],
    { eventVisibility: "private", videoVisibility: "private", now: 1700000000 },
  );
}

function readOnlyDb(rows = []) {
  const calls = [];
  return {
    calls,
    select: (...fields) => {
      calls.push(["select", fields.length]);
      return {
        from: () => ({
          where: async () => rows,
        }),
      };
    },
  };
}

test("RH-002 U02 shared D1 preflight: empty canonical plan returns empty snapshot without DB reads", async () => {
  const db = readOnlyDb();
  const adapter = legacyImportD1PreflightAdapter(db);
  assert.deepEqual(await adapter.preflight(plan(), "create_only"), {
    existingEventIds: [], existingVideoIds: [],
  });
  assert.deepEqual(db.calls, []);
});

test("RH-002 U02 shared D1 preflight: existing event blocks create_only (read-only)", async () => {
  const db = readOnlyDb([{ id: "event-a" }]);
  const incoming = plan("eventid,eventname\nevent-a,Event A\n");
  assert.equal(incoming.events[0].id, "event-a");
  const adapter = legacyImportD1PreflightAdapter(db);
  await assert.rejects(adapter.preflight(incoming, "create_only"),
    /イベント event-a は既に存在します/);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0][0], "select");
  assert.equal(typeof db.insert, "undefined");
});

test("RH-002 U02 shared D1 preflight: skip_existing returns sorted existing IDs", async () => {
  const db = readOnlyDb([{ id: "event-a" }]);
  const incoming = plan("eventid,eventname\nevent-a,Event A\n");
  // A canonical event must include an owner even when skip_existing is used.
  incoming.eventStaff.push({ event_id: "event-a", permission_preset: "owner" });
  const result = await preflightLegacyImportPlan(db, incoming, "skip_existing");
  assert.deepEqual(result, {
    existingEventIds: ["event-a"],
    existingVideoIds: [],
  });
  assert.equal(db.calls.length, 1);
});

test("RH-002 U02 shared D1 preflight: validation errors reject before any DB call", async () => {
  const db = readOnlyDb();
  const incoming = plan("id,title\nlegacy-1,Incomplete\n");
  assert.ok(incoming.errors.length > 0);
  await assert.rejects(legacyImportD1PreflightAdapter(db).preflight(incoming, "skip_existing"),
    /eventid/);
  assert.deepEqual(db.calls, []);
});

test("RH-002 U02 D1 preflight: CURRENT source retains the same SQL guards and imports", async () => {
  const { readFile } = await import("node:fs/promises");
  const current = await readFile(new URL("../../../src/lib/import/legacy/preflight.ts", import.meta.url), "utf8");
  const shared = await readFile(new URL("../../../packages/server-core/src/legacyImport/preflight.ts", import.meta.url), "utf8");
  for (const key of [
    "sameQuestionDefinition",
    "latestImportedCustomAnswerTargets",
    "existingEventIds",
    "existingVideoRows",
    "latestImportedCustomAnswerTargets",
    "MAX_EVENT_CUSTOM_QUESTIONS = 18",
  ]) {
    assert.ok(current.includes(key), "CURRENT missing " + key);
    assert.ok(shared.includes(key), "shared port missing " + key);
  }
  assert.doesNotMatch(shared, /server-only|@\/lib\//);
});
