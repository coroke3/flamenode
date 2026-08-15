import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./submitSlotVideo.ts", import.meta.url), "utf8");

test("slot submission rejects mixed reservation snapshots", () => {
  assert.match(
    source,
    /groupSnapshotXId = groupRows\[0\]\?\.reserved_x_id_snapshot \?\? null/,
  );
  assert.match(
    source,
    /groupRows\.some\([\s\S]*?reserved_x_id_snapshot !== groupSnapshotXId/,
  );
});
