import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { hasEditableEventByApprovedXIds } = await import("./editableEventIdsByXIds.ts");
  const { resolveStaffPermissionKeys } = await import("./permissions/permissionResolver.ts");

  function setup(rows) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE event_staff (
      id TEXT PRIMARY KEY, event_id TEXT, x_user_id TEXT,
      permission_preset TEXT, custom_permission_keys_json TEXT
    )`);
    const insert = sqlite.prepare("INSERT INTO event_staff VALUES (?, ?, ?, ?, ?)");
    rows.forEach((row, i) => insert.run(`s-${i}`, `e-${i}`, row.x, row.preset, row.json));
    const binds = [];
    const db = drizzle(async (sql, params) => {
      binds.push(params.length);
      const statement = sqlite.prepare(sql);
      return { rows: statement.all(...params).map((row) => Object.values(row)) };
    });
    return { sqlite, db, binds };
  }

  const customCases = [
    ["valid array", '["video.basics"]'],
    ["legacy alias", '["videos.title"]'],
    ["unknown keys only", '["nope"]'],
    ["empty array", "[]"],
    ["object with valid value", '{"a":"video.basics"}'],
    ["scalar string", '"video.basics"'],
    ["invalid json", "[video.basics"],
    ["non-text element", '[1, null, {"k":"video.basics"}]'],
    ["null", null],
  ];

  test("custom presetのSQL判定はJS resolverと一致する（配列以外のJSONは権限なし）", async () => {
    for (const [name, json] of customCases) {
      const { sqlite, db } = setup([{ x: "x-1", preset: "custom", json }]);
      const expected =
        resolveStaffPermissionKeys({ permission_preset: "custom", custom_permission_keys_json: json }).size > 0;
      assert.equal(await hasEditableEventByApprovedXIds(db, ["x-1"]), expected, name);
      sqlite.close();
    }
  });

  test("preset行と承認X外の行は従来どおり判定し、bind数は定数key数に依存しない", async () => {
    const { sqlite, db, binds } = setup([
      { x: "other", preset: "owner", json: null },
      { x: "x-1", preset: "custom", json: "[]" },
    ]);
    assert.equal(await hasEditableEventByApprovedXIds(db, ["x-1"]), false);
    sqlite.exec("UPDATE event_staff SET x_user_id = 'x-1' WHERE id = 's-0'");
    assert.equal(await hasEditableEventByApprovedXIds(db, ["x-1"]), true);
    // 80件のapproved X IDsでもD1の100 bind上限を超えない。
    const many = Array.from({ length: 80 }, (_, i) => `x-${i}`);
    assert.equal(await hasEditableEventByApprovedXIds(db, many), true);
    assert.ok(Math.max(...binds) < 100, `max binds ${Math.max(...binds)}`);
    sqlite.close();
  });
}
