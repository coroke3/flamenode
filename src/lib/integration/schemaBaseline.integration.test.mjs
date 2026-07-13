import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExactNames,
  assertIndexDefinition,
  assertTableColumns,
  validateDbSchema,
} from "../../../scripts/check-db-schema.mjs";

test("active migrations apply cleanly and match schema.ts manifests", () => {
  const result = validateDbSchema(process.cwd());
  assert.deepEqual(result.migrations, [
    "0000_flame_node_baseline.sql",
    "0001_spreadsheet_import_runs.sql",
    "0002_terms_reaccept_manual_cost_guard.sql",
    "0003_large_collaboration_support.sql",
    "0038_runtime_efficiency_resilience.sql",
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

test("column manifest detects type, nullability, PK and missing columns", () => {
  const expected = [{
    name: "id",
    type: "TEXT",
    notNull: 1,
    pk: 1,
    default: { comparable: true, value: null },
  }];
  const actual = [{ name: "id", type: "TEXT", notnull: 1, pk: 1, dflt_value: null }];
  assert.doesNotThrow(() => assertTableColumns("sample", expected, actual));
  assert.throws(
    () => assertTableColumns("sample", expected, [{ ...actual[0], type: "INTEGER" }]),
    /type不一致/,
  );
  assert.throws(
    () => assertTableColumns("sample", expected, [{ ...actual[0], notnull: 0 }]),
    /notNull不一致/,
  );
  assert.throws(
    () => assertTableColumns("sample", expected, [{ ...actual[0], pk: 0 }]),
    /pk順不一致/,
  );
  assert.throws(() => assertTableColumns("sample", expected, []), /missing=\[id\]/);
  assert.throws(
    () =>
      assertTableColumns(
        "sample",
        [{ ...expected[0], default: { comparable: true, value: "string:active" } }],
        actual,
      ),
    /default不一致/,
  );
});

test("index manifest detects unique flag and column order", () => {
  const expected = {
    name: "sample_idx",
    unique: 1,
    columns: ["event_id", "created_at"],
  };
  assert.doesNotThrow(() =>
    assertIndexDefinition(expected, { unique: 1, columns: ["event_id", "created_at"] }),
  );
  assert.throws(
    () => assertIndexDefinition(expected, { unique: 0, columns: expected.columns }),
    /unique不一致/,
  );
  assert.throws(
    () => assertIndexDefinition(expected, { unique: 1, columns: ["created_at", "event_id"] }),
    /index列不一致/,
  );
});
