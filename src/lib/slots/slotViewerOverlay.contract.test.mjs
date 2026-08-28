import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [loader, route, panel, core] = await Promise.all([
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
  readFile(new URL("./slotViewerOverlayCore.ts", import.meta.url), "utf8"),
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

test("ログインviewerはprivate行と軽量canonical statusを分離して読む", () => {
  assert.match(loader, /const \[onboarding, slotRows, slotStates\] = await Promise\.all/);
  assert.match(
    loader,
    /eq\(slotsTable\.event_id, eventId\),\s*eq\(slotsTable\.reserved_by_user_id, viewer\.id\)/s,
  );
  assert.match(
    loader,
    /\.select\(\{ id: slotsTable\.id, status: slotsTable\.status \}\)\s*\.from\(slotsTable\)\s*\.where\(eq\(slotsTable\.event_id, eventId\)\)/s,
  );
  assert.match(loader, /slotStates,/);
  assert.match(core, /slotStates: SlotViewerOverlayState\[\]/);
});

test("viewer groupはDB idを出さずpublic baseがあるときはbaseを優先する", () => {
  assert.match(loader, /`viewer-group-\$\{groupKeys\.size \+ 1\}`/);
  assert.doesNotMatch(loader, /group_key:\s*slot\.reservation_group_id/);
  assert.match(panel, /group_key: currentSlot\.group_key \?\? patch\.group_key/);
});

test("R2反映待ちでもcanonical statusを重ねstale identityを持ち越さない", () => {
  assert.match(panel, /const stateById = new Map/);
  assert.match(panel, /const canonicalStatus = stateById\.get\(slot\.id\)/);
  assert.match(panel, /canonicalStatus !== slot\.status/);
  assert.match(panel, /status: canonicalStatus/);
  assert.match(panel, /display_name: null/);
  assert.match(panel, /reserved_x_id: null/);
  assert.match(panel, /submitted_icon_url: null/);
  assert.match(panel, /group_key: null/);
  assert.match(panel, /x_user_id: null/);
});

test("slot state payloadが壊れている場合はpartial状態を採用しない", () => {
  assert.match(panel, /!Array\.isArray\(row\.slotStates\)/);
  assert.match(panel, /const normalizedSlotStates = row\.slotStates\.map\(normalizeSlotState\)/);
  assert.match(panel, /normalizedSlotStates\.some\(\(state\) => state === null\)/);
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
