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
