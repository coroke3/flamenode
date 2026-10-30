import assert from "node:assert/strict";
import test from "node:test";
import { createManageStaffWriteClient } from "../.test-dist/apps/ops/src/api/manageStaffWrite.js";

const upsert = {
  x_user_id: "alice", display_name: "Alice", permission_preset: "manager",
  permission_keys: "", is_public: "1", public_role_label: "運営",
  reason: "権限設定", confirm_text: "",
};
const csv = {
  lineNumber: 2, display_name: "Alice", x_user_id: "alice",
  permission_preset: "manager", permission_keys: [], is_public_staff: "1",
  public_role_label: "運営", action: "create", errors: [], warnings: [],
};
const transfer = {
  from_staff_id: "from", to_staff_id: "to", reason: "代表変更",
  confirm_text: "TRANSFER ev 1", self_confirm_text: "",
};
const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
function harness(status = 200, body = { ok: true, message: "保存しました。" }) {
  const calls = [];
  const client = createManageStaffWriteClient(async (path, init) => {
    calls.push({ path, init });
    return json(status, body);
  });
  return { client, calls };
}
function assertWrite(call, method, path, body) {
  assert.equal(call.path, path);
  assert.equal(call.init.method, method);
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.headers.accept, "application/json");
  assert.equal(call.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(call.init.body), body);
}

test("MIG-0723 U02: all five provisionally specified write routes retain CURRENT request fields", async () => {
  const { client, calls } = harness();
  const created = await client.create("ev 1", upsert);
  const updated = await client.update("ev 1", "staff/a", upsert);
  const removed = await client.remove("ev 1", "staff/a", "担当変更", "");
  const imported = await client.importCsv("ev 1", "スタッフCSV反映", [csv]);
  const transferred = await client.transferOwnership("ev 1", transfer);
  for (const result of [created, updated, removed, imported, transferred]) {
    assert.equal(result.status, "ok");
    assert.equal(result.data.ok, true);
  }
  assert.equal(calls.length, 5);
  assertWrite(calls[0], "POST", "/api/manage/events/ev%201/staff", upsert);
  assertWrite(calls[1], "PUT", "/api/manage/events/ev%201/staff/staff%2Fa", upsert);
  assertWrite(calls[2], "DELETE", "/api/manage/events/ev%201/staff/staff%2Fa", {
    reason: "担当変更", confirm_text: "",
  });
  assertWrite(calls[3], "POST", "/api/manage/events/ev%201/staff/csv", {
    reason: "スタッフCSV反映", rows: [csv],
  });
  assertWrite(calls[4], "POST", "/api/manage/events/ev%201/owner-transfer", transfer);
});

test("MIG-0723 U02: empty IDs, invalid path segments, reasons and CSV preview errors never fetch", async () => {
  const { client, calls } = harness();
  const invalid = [
    client.create("", upsert),
    client.create("..", upsert),
    client.create("bad\0id", upsert),
    client.create("ev1", { ...upsert, reason: " " }),
    client.update("ev1", ".", upsert),
    client.remove("ev1", "", "reason", ""),
    client.remove("ev1", "m1", " ", ""),
    client.importCsv("ev1", "reason", [{ ...csv, errors: ["invalid role"] }]),
    client.importCsv("ev1", "", [csv]),
    client.transferOwnership("ev1", { ...transfer, confirm_text: " " }),
    client.transferOwnership("ev1", { ...transfer, from_staff_id: ".." }),
  ];
  for (const result of await Promise.all(invalid)) {
    assert.deepEqual(result, { status: "unavailable" });
  }
  assert.equal(calls.length, 0);
});

test("MIG-0723 U02: reject unauthorized/server failures and preserve CURRENT 409 error text", async () => {
  const anonymous = harness(401, { error: "Unauthorized" });
  assert.deepEqual(await anonymous.client.create("ev1", upsert), { status: "anonymous" });
  const outage = harness(503, { error: "unavailable" });
  assert.deepEqual(await outage.client.remove("ev1", "m1", "reason", ""),
    { status: "unavailable" });
  const ownerConflict = harness(409, { ok: false, message: "最後の代表者は削除・降格できません。" });
  const error = await ownerConflict.client.remove("ev1", "owner-1", "reason", "REMOVE SELF ev1");
  assert.equal(error.status, "ok");
  assert.equal(error.data.ok, false);
  assert.equal(error.data.message, "最後の代表者は削除・降格できません。");
  assert.equal(ownerConflict.calls.length, 1);
});

test("MIG-0723 U02: untrusted malformed or rejected responses fail closed", async () => {
  const invalid = createManageStaffWriteClient(async () => json(200, { message: "not a result" }));
  assert.deepEqual(await invalid.create("ev1", upsert), { status: "unavailable" });
  const network = createManageStaffWriteClient(async () => { throw new Error("offline"); });
  assert.deepEqual(await network.remove("ev1", "m1", "reason", ""),
    { status: "unavailable" });
});
