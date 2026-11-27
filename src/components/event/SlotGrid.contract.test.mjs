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
  assert.match(slotGridSource, /unstable_rethrow\(error\)/);
  assert.doesNotMatch(slotGridSource, /isNextRedirectError/);
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

const viewerPanelSource = await readFile(
  new URL("../../../app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx", import.meta.url),
  "utf8",
);

test("CURRENT viewer overlay retires old GET immediately on Active X change", () => {
  assert.match(viewerPanelSource, /const overlayGeneration = React\.useRef\(0\)/);
  assert.match(viewerPanelSource, /const requestGeneration = overlayGeneration\.current/);
  assert.match(viewerPanelSource, /if \(!active \|\| !value \|\| requestGeneration !== overlayGeneration\.current\) return/);
  assert.match(viewerPanelSource, /const refresh = \(\) => \{\s*overlayGeneration\.current \+= 1/);
  assert.match(viewerPanelSource, /window\.addEventListener\(ACTIVE_X_CHANGED_EVENT, refresh\)/);
});
