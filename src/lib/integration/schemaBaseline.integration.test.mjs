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
    "0039_search_relation_indexes.sql",
    "0040_worker_free_tier_scale.sql",
    "0041_youtube_quota_budget.sql",
    "0042_event_youtube_playlist_sync.sql",
    "0043_db_canonical_migration.sql",
    "0044_simplify_visibility_statuses.sql",
    "0045_align_visibility_defaults.sql",
    "0046_video_creator_profile_snapshot.sql",
    "0047_backfill_youtube_metadata_pending.sql",
    "0048_cleanup_video_visibility_indexes.sql",
    "0049_public_visibility_fences.sql",
    "0050_x_identity_request_decisions.sql",
    "0051_slot_reservation_groups_expand.sql",
    "0052_video_interactions_auth_expand.sql",
    "0053_slot_reserved_x_id_snapshot.sql",
    "0054_media_reference_read_indexes.sql",
  ]);
  assert.equal(result.tableCount, 44);
  assert.equal(result.columnCount, 438);
  assert.ok(result.indexCount > 76);
  assert.ok(result.foreignKeyCount > 20);
  assert.ok(result.checkCount > 20);
});

test("manifest comparison reports both missing and extra objects", () => {
  assert.throws(
    () =>
      assertExactNames(
        "table manifest",
        ["events", "videos"],
        ["events", "unknown"],
      ),
    /missing=\[videos\].*extra=\[unknown\]/,
  );
  assert.doesNotThrow(() =>
    assertExactNames("index manifest", ["events_idx"], ["events_idx"]),
  );
});

test("column manifest detects type, nullability, PK and missing columns", () => {
  const expected = [
    {
      name: "id",
      type: "TEXT",
      notNull: 1,
      pk: 1,
      default: { comparable: true, value: null },
    },
  ];
  const actual = [
    { name: "id", type: "TEXT", notnull: 1, pk: 1, dflt_value: null },
  ];
  assert.doesNotThrow(() => assertTableColumns("sample", expected, actual));
  assert.throws(
    () =>
      assertTableColumns("sample", expected, [
        { ...actual[0], type: "INTEGER" },
      ]),
    /type不一致/,
  );
  assert.throws(
    () =>
      assertTableColumns("sample", expected, [
        { ...actual[0], notnull: 0 },
      ]),
    /notNull不一致/,
  );
  assert.throws(
    () => assertTableColumns("sample", expected, [{ ...actual[0], pk: 0 }]),
    /pk順不一致/,
  );
  assert.throws(
    () => assertTableColumns("sample", expected, []),
    /missing=\[id\]/,
  );
  assert.throws(
    () =>
      assertTableColumns(
        "sample",
        [
          {
            ...expected[0],
            default: { comparable: true, value: "string:active" },
          },
        ],
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
    assertIndexDefinition(expected, {
      unique: 1,
      columns: ["event_id", "created_at"],
    }),
  );
  assert.throws(
    () =>
      assertIndexDefinition(expected, {
        unique: 0,
        columns: expected.columns,
      }),
    /unique不一致/,
  );
  assert.throws(
    () =>
      assertIndexDefinition(expected, {
        unique: 1,
        columns: ["created_at", "event_id"],
      }),
    /index列不一致/,
  );
});
