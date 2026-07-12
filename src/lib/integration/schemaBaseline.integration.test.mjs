import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExactNames,
  validateDbSchema,
} from "../../../scripts/check-db-schema.mjs";

test("active migrations apply cleanly and match schema.ts manifests", () => {
  const result = validateDbSchema(process.cwd());
  assert.deepEqual(result.migrations, [
    "0000_flame_node_baseline.sql",
    "0001_spreadsheet_import_runs.sql",
  ]);
  assert.ok(result.tableCount > 40);
  assert.ok(result.indexCount > 70);
  assert.ok(result.foreignKeyCount > 20);
  assert.ok(result.checkCount > 20);
});

test("manifest comparison reports both missing and extra objects", () => {
  assert.throws(
    () => assertExactNames("table manifest", ["events", "videos"], ["events", "unknown"]),
    /missing=\[videos\].*extra=\[unknown\]/,
  );
  assert.doesNotThrow(() =>
    assertExactNames("index manifest", ["events_idx"], ["events_idx"]),
  );
});
