import assert from "node:assert/strict";
import { test } from "node:test";
import {
  patchSpreadsheetCell,
  insertSpreadsheetRow,
  deleteSpreadsheetRow,
} from "../.test-dist/apps/ops/src/api/adminSpreadsheetWrites.js";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pk = { id: "1", workspace: "event/2026" };
const patch = { table: "videos", primaryKey: pk, column: "title", value: "New title" };
const insert = { table: "videos", row: { id: "2", title: "Second", description: null } };
const remove = { table: "videos", primaryKey: pk };

test("MIG-0737 RH-004/005/006 preserve CURRENT methods, URL and JSON payloads", async () => {
  const calls = [];
  const fetchFn = async (path, init) => {
    calls.push({ path, init });
    return json(200, { ok: true, pendingPublicReflection: true });
  };
  for (const [fn, payload] of [
    [patchSpreadsheetCell, patch],
    [insertSpreadsheetRow, insert],
    [deleteSpreadsheetRow, remove],
  ]) {
    const result = await fn(fetchFn, payload);
    assert.deepEqual(result, { status: "ok", data: { ok: true, pendingPublicReflection: true } });
  }
  assert.deepEqual(calls.map(x => x.path), Array(3).fill("/api/admin/spreadsheet/data"));
  assert.deepEqual(calls.map(x => x.init.method), ["PATCH", "POST", "DELETE"]);
  assert.deepEqual(calls.map(x => JSON.parse(x.init.body)), [patch, insert, remove]);
  for (const { init } of calls) {
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.headers.accept, "application/json");
  }
});

test("MIG-0737 RH-004 null cell updates and empty string are distinct", async () => {
  const bodies = [];
  const fn = async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return json(200, { ok: true });
  };
  assert.equal((await patchSpreadsheetCell(fn, { ...patch, value: null })).status, "ok");
  assert.equal((await patchSpreadsheetCell(fn, { ...patch, value: "" })).status, "ok");
  assert.deepEqual(bodies.map(x => x.value), [null, ""]);
});

test("MIG-0737 RH-004 refuses invalid PK, PK column mutation, missing table/column and wrong value without fetch", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, { ok: true }); };
  for (const bad of [
    { ...patch, table: " " },
    { ...patch, primaryKey: {} },
    { ...patch, primaryKey: { id: "" } },
    { ...patch, primaryKey: { id: 42 } },
    { ...patch, primaryKey: null },
    { ...patch, column: "" },
    { ...patch, column: "id" },
    { ...patch, value: 42 },
    { ...patch, value: undefined },
  ]) {
    assert.deepEqual(await patchSpreadsheetCell(fn, bad), { status: "unavailable" });
  }
  assert.equal(calls, 0);
});

test("MIG-0737 RH-005 refuses blank/nonrecord and wrong-typed insert rows without fetch", async () => {
  let calls = 0;
  const fn = async () => { calls++; return json(200, { ok: true }); };
  for (const bad of [
    { ...insert, table: "" },
    { ...insert, row: {} },
    { ...insert, row: null },
    { ...insert, row: [] },
    { ...insert, row: { title: 5 } },
    { ...insert, row: { "": "hello" } },
  ]) {
    assert.deepEqual(await insertSpreadsheetRow(fn, bad), { status: "unavailable" });
  }
  assert.equal(calls, 0);
});

test("MIG-0737 RH-006 rejects missing composite PK and never retries DELETE", async () => {
  let calls = 0;
  const fn = async () => { calls++; throw Error("connection dropped"); };
  assert.deepEqual(await deleteSpreadsheetRow(fn, { table: "videos", primaryKey: { id: "" } }),
    { status: "unavailable" });
  assert.equal(calls, 0);
  assert.deepEqual(await deleteSpreadsheetRow(fn, remove), { status: "unavailable" });
  assert.equal(calls, 1);
});

test("MIG-0737 RH-004/005/006 distinguish feature-disabled from unknown-table and auth failures", async () => {
  const cases = [
    [401, { error: "unauthorized" }, "anonymous"],
    [403, { error: "admin_required" }, "forbidden"],
    [404, { error: "spreadsheet_disabled" }, "disabled"],
    [404, { error: "unknown_table" }, "notFound"],
    [404, "<html>404</html>", "notFound"],
    [409, { error: "optimistic_lock_failed" }, "unavailable"],
    [422, { error: "invalid_cell" }, "unavailable"],
    [501, { error: "not_implemented" }, "unsupported"],
    [503, { error: "db_unavailable" }, "unavailable"],
  ];
  for (const [status, body, expected] of cases) {
    const fn = async () => typeof body === "string" ? new Response(body, { status }) : json(status, body);
    for (const [method, payload] of [
      [patchSpreadsheetCell, patch],
      [insertSpreadsheetRow, insert],
      [deleteSpreadsheetRow, remove],
    ]) {
      const actual = await method(fn, payload);
      assert.equal(actual.status, expected, String(status));
    }
  }
});

test("MIG-0737 RH-004/005/006 fail closed on malformed success body and partial reflection type", async () => {
  for (const data of [
    {},
    { ok: "true" },
    { ok: false },
    { ok: true, pendingPublicReflection: "false" },
    { ok: true, pendingPublicReflection: 1 },
  ]) {
    for (const [method, payload] of [
      [patchSpreadsheetCell, patch],
      [insertSpreadsheetRow, insert],
      [deleteSpreadsheetRow, remove],
    ]) {
      assert.deepEqual(await method(async () => json(200, data), payload), { status: "unavailable" });
    }
  }
  assert.deepEqual(await patchSpreadsheetCell(async () => new Response("not json", { status: 200 }), patch),
    { status: "unavailable" });
});

test("MIG-0737 RH-004/005/006 abort before/during mutation returns unavailable and no retry", async () => {
  const ac = new AbortController();
  ac.abort();
  let called = 0;
  const fn = async () => { called++; return json(200, { ok: true }); };
  for (const [method, payload] of [
    [patchSpreadsheetCell, patch],
    [insertSpreadsheetRow, insert],
    [deleteSpreadsheetRow, remove],
  ]) {
    assert.deepEqual(await method(fn, payload, ac.signal), { status: "unavailable" });
  }
  assert.equal(called, 0);
  const after = new AbortController();
  const mutate = async (_, init) => {
    assert.equal(init.signal, after.signal);
    called++;
    after.abort();
    return json(200, { ok: true });
  };
  assert.deepEqual(await patchSpreadsheetCell(mutate, patch, after.signal), { status: "unavailable" });
  assert.equal(called, 1);
});
