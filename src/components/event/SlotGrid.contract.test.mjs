import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const slotGridSource = await readFile(
  new URL("./SlotGrid.tsx", import.meta.url),
  "utf8",
);

test("SlotGrid catches rejected slot server actions", () => {
  assert.match(slotGridSource, /COMMUNICATION_ERROR_MESSAGE/);
  assert.match(slotGridSource, /通信エラーが発生しました/);
  assert.match(slotGridSource, /runSlotAction/);
  assert.match(slotGridSource, /NEXT_REDIRECT/);
  for (const actionName of [
    "reserveSlot",
    "releaseOwnSlot",
    "extendOwnSlotGroup",
    "mergeOwnSlotGroups",
  ]) {
    assert.match(
      slotGridSource,
      new RegExp(`runSlotAction\\(\\(\\) => ${actionName}\\(fd\\)`),
      `missing communication guard for ${actionName}`,
    );
  }
});
