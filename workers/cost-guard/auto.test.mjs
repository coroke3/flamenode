import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAutoCostGuard } from "./auto.ts";

function makeEnv({ settings = null, snapshot = null } = {}) {
  const calls = [];
  const state = {
    settings: settings ? { ...settings } : null,
    snapshot: snapshot ? { ...snapshot } : null,
    auditRows: [],
    calls,
  };

  return {
    state,
    env: {
      DB: {
        prepare(sql) {
          const statement = {
            values: [],
            bind(...values) {
              this.values = values;
              return this;
            },
            async first() {
              if (sql.includes("FROM system_settings")) {
                return state.settings;
              }
              if (sql.includes("FROM cost_usage_snapshots")) {
                return state.snapshot;
              }
              return null;
            },
            async run() {
              calls.push({ sql, values: this.values });
              if (sql.includes("INSERT INTO system_settings")) {
                const [mode, reason, userId, updatedAt] = this.values;
                state.settings = {
                  ...(state.settings ?? { id: "default" }),
                  operation_mode: mode,
                  cost_guard_reason: reason,
                  cost_guard_updated_by_user_id: userId,
                  cost_guard_updated_at: updatedAt,
                };
              }
              if (sql.includes("UPDATE cost_usage_snapshots") && state.snapshot) {
                state.snapshot.guard_mode_after_check = this.values[0];
              }
              if (sql.includes("INSERT INTO audit_logs")) {
                state.auditRows.push(this.values);
              }
              return { meta: { changes: 1 } };
            },
          };
          return statement;
        },
      },
    },
  };
}

test("applyAutoCostGuard: disabled settings do not change mode", async () => {
  const { env, state } = makeEnv({
    settings: { operation_mode: "normal", auto_cost_guard_enabled: 0 },
    snapshot: { id: "snap1", workers_requests_today: 100_000 },
  });

  const result = await applyAutoCostGuard(env, 1_700_000_000);

  assert.equal(result.applied, false);
  assert.equal(result.reason, "disabled");
  assert.equal(state.settings.operation_mode, "normal");
  assert.equal(state.calls.length, 0);
});

test("applyAutoCostGuard: escalates to the recommended stricter mode", async () => {
  const { env, state } = makeEnv({
    settings: { operation_mode: "normal", auto_cost_guard_enabled: 1 },
    snapshot: { id: "snap1", d1_rows_written_today: 95_000 },
  });

  const result = await applyAutoCostGuard(env, 1_700_000_000);

  assert.equal(result.applied, true);
  assert.equal(result.recommendedMode, "read_only");
  assert.equal(state.settings.operation_mode, "read_only");
  assert.equal(state.snapshot.guard_mode_after_check, "read_only");
  assert.equal(state.auditRows.length, 1);
});

test("applyAutoCostGuard: does not automatically downgrade", async () => {
  const { env, state } = makeEnv({
    settings: { operation_mode: "static_only", auto_cost_guard_enabled: 1 },
    snapshot: { id: "snap1", d1_rows_written_today: 80_000 },
  });

  const result = await applyAutoCostGuard(env, 1_700_000_000);

  assert.equal(result.applied, false);
  assert.equal(result.reason, "not_more_restrictive");
  assert.equal(result.recommendedMode, "economy");
  assert.equal(state.settings.operation_mode, "static_only");
  assert.equal(state.snapshot.guard_mode_after_check, "static_only");
});

test("applyAutoCostGuard: upserts system_settings when missing", async () => {
  const { env, state } = makeEnv({
    snapshot: { id: "snap1", workers_requests_today: 100_000 },
  });

  const result = await applyAutoCostGuard(env, 1_700_000_000);

  assert.equal(result.applied, true);
  assert.equal(result.currentMode, "normal");
  assert.equal(result.recommendedMode, "maintenance");
  assert.equal(state.settings.operation_mode, "maintenance");
});
