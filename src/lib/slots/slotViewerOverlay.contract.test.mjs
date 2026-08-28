import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [loader, route] = await Promise.all([
  readFile(new URL("./slotViewerOverlay.ts", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../../../app/api/events/[id]/slots/viewer-overlay/route.ts",
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
