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

test("slot viewer overlayは公開event確認をAuth/slot readより先に行う", () => {
  const publicEventGuard = loader.indexOf('eq(eventsTable.visibility_status, "public")');
  const authRead = loader.indexOf("getCurrentUser()");
  const slotRead = loader.indexOf(".from(slotsTable)");
  assert.ok(publicEventGuard >= 0);
  assert.ok(authRead > publicEventGuard);
  assert.ok(slotRead > authRead);
});

test("匿名viewerはslot read前にempty overlayへ早期returnできる", () => {
  const anonymousReturn = loader.indexOf(
    "if (!viewer) return emptySlotViewerOverlay(false);",
  );
  const slotRead = loader.indexOf(".from(slotsTable)");
  assert.ok(anonymousReturn >= 0 && slotRead > anonymousReturn);
});

test("BAN viewerはslot read前にfail-closedできる", () => {
  const bannedReturn = loader.indexOf("if (viewer.is_banned === 1)");
  const slotRead = loader.indexOf(".from(slotsTable)");
  assert.ok(bannedReturn >= 0 && slotRead > bannedReturn);
  assert.match(loader, /isBanned: true/);
});

test("ログインviewerのslot queryはそのauth userの予約行だけを読む", () => {
  const slotRead = loader.indexOf(".from(slotsTable)");
  const slotMap = loader.indexOf("const slots = slotRows.map", slotRead);
  assert.ok(slotRead >= 0 && slotMap > slotRead);
  const query = loader.slice(slotRead, slotMap);
  assert.match(query, /eq\(slotsTable\.event_id, eventId\)/);
  assert.match(query, /eq\(slotsTable\.reserved_by_user_id, viewer\.id\)/);
});

test("public_nameのgroup keyは公開base snapshotを正本にする", () => {
  assert.match(
    loader,
    /isOwnedByViewer && eventRow\.slot_visibility_mode !== "public_name"/,
  );
  assert.match(panel, /group_key: patch\.group_key \?\? slot\.group_key/);
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
  assert.match(panel, /type ViewerOverlayState/);
  assert.match(panel, /overlayState\.baseSlots === baseSlots/);
  assert.match(panel, /overlayIsCurrent \? overlayState\.value : EMPTY_OVERLAY/);
  assert.match(panel, /const requestBaseSlots = baseSlots/);
  assert.match(panel, /setOverlayState\(\{ value, baseSlots: requestBaseSlots \}\)/);
  assert.match(panel, /\[eventId, refreshNonce, baseSlots\]/);
  assert.match(panel, /setOverlayState\(\{ value: EMPTY_OVERLAY, baseSlots: null \}\)/);
  assert.match(panel, /ACTIVE_X_CHANGED_EVENT/);
});

test("slot viewer overlayの通信が止まっても確認中のまま固まらない", () => {
  assert.match(panel, /const SLOT_VIEWER_OVERLAY_TIMEOUT_MS = 5_000/);
  assert.match(panel, /const controller = new AbortController\(\)/);
  assert.match(panel, /controller\.abort\(\)/);
  assert.match(panel, /if \(!active\) return null/);
  assert.match(panel, /authUnavailable: true/);
  assert.match(panel, /window\.clearTimeout\(timeoutId\)/);
});

test("TOS/BAN/auth unavailableでは本人枠のwrite ownershipだけを無効化する", () => {
  assert.match(panel, /const canManageOwnSlots =/);
  assert.match(panel, /!viewerOverlay\.needsTermsAcceptance/);
  assert.match(panel, /!viewerOverlay\.isBanned/);
  assert.match(panel, /!viewerOverlay\.authUnavailable/);
  assert.match(panel, /is_owned_by_viewer: false/);
  assert.match(panel, /canManageOwnSlots\s*\? mergedSlots/);
});
