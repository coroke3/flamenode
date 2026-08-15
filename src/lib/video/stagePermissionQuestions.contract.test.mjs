import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./stagePermissionQuestions.ts", import.meta.url), "utf8");

test("stage permission settings read chunks event IDs below D1 bind limit", () => {
  assert.match(source, /D1_STAGE_EVENT_ID_CHUNK_SIZE = 80/);
  assert.match(
    source,
    /for \(const chunk of chunkIds\(ids, D1_STAGE_EVENT_ID_CHUNK_SIZE\)\)/,
  );
  assert.match(source, /inArray\(eventCustomQuestions\.event_id, chunk\)/);
});
