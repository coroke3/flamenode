import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSlotAtomicAuditPlan } from "@flamenode/domain/slots/atomicAuditPlan";
import { versionedSlotWhere } from "../src/slots/versionedPredicate.ts";

const source = await readFile(new URL("../src/slots/commitSlotMutationPlan.ts", import.meta.url), "utf8");

test("MIG-0657 U01i: shared core has no Next, Hono or environment globals", () => {
  assert.doesNotMatch(source, /from ["']next|@\/lib\/|getCloudflareContext|process\.env|new Hono|fetch\(/);
  assert.match(source, /loadWakeHost: QueueWakeHostLoader/);
});

test("MIG-0657 U01i: every CAS statement is immediately changes()-verified in same mutateWithAudit call", () => {
  assert.match(source, /mutationStatements:\s*\[[\s\S]*?\.\.\.mutationStatements,[\s\S]*?\.\.\.queue\.statements,[\s\S]*?\.\.\.extra,/);
  assert.match(source, /expectedMutationChanges:\s*\[[\s\S]*?\.\.\.expectedMutationChanges,[\s\S]*?\.\.\.queue\.expectedChanges,[\s\S]*?\.\.\.extra\.map\(\(\) => null\),/);
  assert.match(source, /versionedSlotWhere\(/);
  assert.match(source, /mutateWithAudit\(args\.db,[\s\S]*?args\.loadWakeHost\)/);
});

test("MIG-0657 U01i: audit provenance and strict restore policy cannot be omitted", () => {
  for (const part of ['table_name: "slots"','operation: "UPDATE"','actor_user_id: args.actorUserId',
    'context: "user-slot"','retention_class: "normal"','restore_strategy: "update_before"','strict: true']) {
    assert.ok(source.includes(part),part);
  }
});

test("MIG-0657 U01i: only committed notification outbox signals can wake and Queue wake is separate", () => {
  assert.match(source, /const wakeNotification = args\.notificationWakeSource/);
  assert.match(source, /notificationWakeSource:\s*wakeNotification/);
  assert.match(source, /staticRebuildWakeSource:\s*queue\.statements\.length > 0 \? "web" : undefined/);
  assert.doesNotMatch(source, /notificationWakeSource:\s*extra\.length/);
});

test("MIG-0657 U01i: duplicate slot IDs reject before any SQL or wake plan", () => {
  const r = {id:"s",event_id:"e",status:"available",version:1,updated_at:1,reserved_x_id_snapshot:null};
  assert.throws(() => buildSlotAtomicAuditPlan([
    {rows:[r],patch:{status:"reserved"},statusGuard:"available"},
    {rows:[r],patch:{status:"reserved"},statusGuard:"available"},
  ], 2), /同一枠を複数の更新に含めることはできません。/);
  assert.match(source, /const plan = buildSlotAtomicAuditPlan\(args\.mutations, now\)/);
  assert.ok(source.indexOf("const plan = buildSlotAtomicAuditPlan") < source.indexOf("const queue = await buildSlotChangeQueueBatch"));
});


test("MIG-0657 U01j: cross-event source rows fail before D1 and Queue access", async () => {
  const { commitSlotMutationPlanCore } = await import("../src/slots/commitSlotMutationPlan.ts");
  let touches = 0;
  const inaccessibleDb = new Proxy({}, { get() { touches++; throw new Error("unexpected D1 access"); } });
  const loadWakeHost = async () => { touches++; throw new Error("unexpected Queue access"); };
  const row = (id, event_id) => ({ id, event_id, version: 1, updated_at: 100, status: "available" });
  for (const rows of [
    [row("foreign", "another-event")],
    [row("valid", "evt"), row("foreign", "another-event")],
  ]) {
    await assert.rejects(
      commitSlotMutationPlanCore({
        db: inaccessibleDb, eventId: "evt", actorUserId: "actor", reason: "slot_user_reserve",
        mutations: [{ rows, patch: { status: "reserved" }, statusGuard: "available" }],
        loadWakeHost,
      }),
      /slot_mutation_cross_event/,
    );
    assert.equal(touches, 0, "invalid plan must not touch D1, audit or Queue");
  }
});

test("MIG-0657 U01j: immutable slot columns cannot be supplied in mutation patches", async () => {
  const { commitSlotMutationPlanCore } = await import("../src/slots/commitSlotMutationPlan.ts");
  let touches = 0;
  const inaccessibleDb = new Proxy({}, { get() { touches++; throw new Error("unexpected D1 access"); } });
  const row = { id: "slot", event_id: "evt", version: 1, updated_at: 100, status: "available" };
  for (const column of ["id", "event_id", "version", "updated_at"]) {
    await assert.rejects(
      commitSlotMutationPlanCore({
        db: inaccessibleDb, eventId: "evt", actorUserId: "actor", reason: "slot_user_reserve",
        mutations: [{ rows: [row], patch: { status: "reserved", [column]: undefined }, statusGuard: "available" }],
        loadWakeHost: async () => { throw new Error("unexpected Queue access"); },
      }),
      /slot_mutation_forbidden_identity_patch/,
      column,
    );
    assert.equal(touches, 0, column + " must fail before any D1 access");
  }
});

test("MIG-0657 U01j: ordinary same-event status patch reaches the D1 builder", async () => {
  const { commitSlotMutationPlanCore } = await import("../src/slots/commitSlotMutationPlan.ts");
  let calls = 0;
  const db = { update() { calls++; throw new Error("reached D1 update builder"); } };
  await assert.rejects(
    commitSlotMutationPlanCore({
      db, eventId: "evt", actorUserId: "actor", reason: "slot_user_reserve",
      mutations: [{
        rows: [{ id: "slot", event_id: "evt", version: 1, updated_at: 100, status: "available" }],
        patch: { status: "reserved", display_name: "name" },
        statusGuard: "available",
      }],
      loadWakeHost: async () => { throw new Error("unexpected Queue access"); },
    }),
    /reached D1 update builder/,
  );
  assert.equal(calls, 1, "ordinary CURRENT-style mutations are not rejected");
});
