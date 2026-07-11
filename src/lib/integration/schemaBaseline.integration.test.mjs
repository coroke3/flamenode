import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const baseline = readFileSync(
  path.join(root, "migrations", "0000_flame_node_baseline.sql"),
  "utf8",
);

test("active baseline carries schema meta and owner constraints", () => {
  assert.match(baseline, /CREATE TABLE "flamenode_schema_meta"/);
  assert.match(baseline, /event_staff_event_preset_idx/);
  assert.match(baseline, /event_staff_event_user_uniq/);
  assert.match(baseline, /worker_leases/);
});
