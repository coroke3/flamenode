import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [loader, route, panel] = await Promise.all([
  readFile(new URL("./slotViewerOverlay.ts", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../../../app/api/events/[id]/slots/viewer-overlay/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../../../app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("slot viewer overlayは公開event確認をAuth/slot全件readより先に行う", () => {
  const publicEventGuard = loader.indexOf('eq(eventsTable.visibility_status, "public")');
  const authRead = loader.indexOf("getCurrentUser()");
  const slotRead = loader.indexOf(".from(slotsTable)");
  assert.ok(publicEventGuard >= 0);
  assert.ok(authRead > publicEventGuard);
  assert.ok(slotRead > authRead);
});

test("匿名viewerはslot全件read前にempty overlayへ早期returnできる", () => {
  const anonymousReturn = loader.indexOf(
    "if (!viewer) return emptySlotViewerOverlay(false);",
  );
  const slotRead = loader.indexOf(".from(slotsTable)");
  assert.ok(anonymousReturn >= 0 && slotRead > anonymousReturn);
});

test("BAN viewerはslot全件read前にfail-closedできる", () => {
  const bannedReturn = loader.indexOf("if (viewer.is_banned === 1)");
  const slotRead = loader.indexOf(".from(slotsTable)");
  assert.ok(bannedReturn >= 0 && slotRead > bannedReturn);
  assert.match(loader, /isBanned: true/);
});

test("slot viewer routeはnot-foundとruntime unavailableを分離する", () => {
  assert.match(route, /event_not_found/);
  assert.match(route, /status: 404/);
  assert.match(route, /viewer_overlay_unavailable/);
  assert.match(route, /status: 503/);
  assert.match(route, /"Retry-After": "3"/);
  assert.match(
    route,
    /"Cache-Control": "private, no-store, no-cache, must-revalidate"/,
  );
});

test("base slot/Active X変更時は旧viewer ownershipを即時無効化する", () => {
  assert.match(panel, /const baseSlotsChanged =/);
  assert.match(panel, /baseSlotsChanged \? EMPTY_OVERLAY : overlay/);
  assert.match(panel, /setOverlay\(EMPTY_OVERLAY\)/);
  assert.match(panel, /ACTIVE_X_CHANGED_EVENT/);
});
