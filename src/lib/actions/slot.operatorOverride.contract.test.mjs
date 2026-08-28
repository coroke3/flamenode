import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const actionSource = await readFile(new URL("./slot.ts", import.meta.url), "utf8");
const pageSource = await readFile(
  new URL("../../../app/(public)/event/[id]/slots/page.tsx", import.meta.url),
  "utf8",
);
const gridSource = await readFile(
  new URL("../../components/event/SlotGrid.tsx", import.meta.url),
  "utf8",
);
const overlaySource = await readFile(
  new URL("../slots/slotViewerOverlay.ts", import.meta.url),
  "utf8",
);

function actionBlock(name) {
  const start = actionSource.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, name);
  const next = actionSource.indexOf("\nexport async function ", start + 1);
  return next < 0 ? actionSource.slice(start) : actionSource.slice(start, next);
}

test("運営例外は event.slots を Server Action 内で再認証する", () => {
  assert.match(actionSource, /assertCanEditEvent/);
  assert.match(actionSource, /canUseSlotOperatorOverride/);
  for (const name of ["reserveSlot", "extendOwnSlotGroup", "mergeOwnSlotGroups"]) {
    const block = actionBlock(name);
    assert.match(block, /formFlag\(formData, "operator_override"\)/, name);
    assert.match(block, /operatorOverride\s*\?\s*MAX_SLOTS_PER_VIDEO/, name);
  }
});

test("運営例外の公開UIは権限投影と受付期間を両方確認する", () => {
  assert.match(pageSource, /EventSlotsViewerPanel/);
  assert.match(overlaySource, /getManageAuthorizationSnapshot/);
  assert.match(
    overlaySource,
    /viewer\.role === "admin"\s*\|\|\s*onboarding\.xIdentityStatus === "approved"/,
  );
  assert.match(overlaySource, /canEditEventFromSnapshot\(authorization, eventId, "event\.slots"\)/);
  assert.match(overlaySource, /canUseSlotOperatorOverride\(eventRow, now\)/);
  assert.match(overlaySource, /operatorOverrideAllowed/);
});

test("例外予約は絶対上限を超えず、操作警告を表示する", () => {
  assert.match(gridSource, /MAX_SLOTS_PER_VIDEO/);
  assert.match(gridSource, /operator_override/);
  assert.match(gridSource, /role="alert"/);
  assert.match(gridSource, /operatorOverrideAllowed/);
});
