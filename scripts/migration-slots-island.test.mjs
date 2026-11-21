// MIG-0514 U02: HTTP request contract, not an integration substitute for MIG-0657 / browser parity.
import assert from "node:assert/strict";
import test from "node:test";
import {
  reserveSlot, releaseSlot, extendSlot, mergeSlotGroup,
} from "../apps/site/src/lib/slotReservation.ts";

function server(status, body) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetcher, calls };
}

function assertPost(call, expectedUrl, body) {
  assert.equal(call.url, expectedUrl);
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.credentials, "same-origin");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.headers.Accept, "application/json");
  if (body === undefined) {
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers["Content-Type"], undefined);
  } else {
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(call.init.body), body);
  }
}

test("U02 reserve sends the CURRENT form keys without slot_id in the JSON body", async () => {
  const srv = server(200, { ok: true, slotId: "s1", slotCount: 2, groupSize: 2, pendingPublicReflection: true });
  const result = await reserveSlot("autumn", "s1", { display_name: "制作者", consecutive_count: 2 }, srv.fetcher);
  assert.equal(result.pendingPublicReflection, true);
  assertPost(srv.calls[0], "/api/events/autumn/slots/s1/reserve", {
    display_name: "制作者", consecutive_count: 2,
  });
  assert.equal(srv.calls.length, 1);
});

test("U02 operator override is present only when explicitly supplied", async () => {
  const srv = server(200, { ok: true });
  await reserveSlot("my/event", "slot?#", {
    display_name: "運営", consecutive_count: 1, operator_override: false,
  }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/my%2Fevent/slots/slot%3F%23/reserve", {
    display_name: "運営", consecutive_count: 1, operator_override: false,
  });
  await reserveSlot("my/event", "slot?#", {
    display_name: "運営", consecutive_count: 1, operator_override: true,
  }, srv.fetcher);
  assert.equal(JSON.parse(srv.calls[1].init.body).operator_override, true);
});

test("U02 release POST has no JSON body", async () => {
  const srv = server(200, { ok: true });
  assert.deepEqual(await releaseSlot("e", "s", srv.fetcher), { ok: true });
  assertPost(srv.calls[0], "/api/events/e/slots/s/release", undefined);
});

test("U02 extend direction uses the slot id in the URL, not a group id", async () => {
  const srv = server(200, { ok: true });
  await extendSlot("e", "s", { direction: "forward" }, srv.fetcher);
  await extendSlot("e", "s", { direction: "backward" }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/e/slots/s/extend", { direction: "forward" });
  assertPost(srv.calls[1], "/api/events/e/slots/s/extend", { direction: "backward" });
});

test("U02 merge sends gap_slot_id and display_name only", async () => {
  const srv = server(200, { ok: true });
  await mergeSlotGroup("e", { gap_slot_id: "gap-slot", display_name: "制作者" }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/e/slot-groups/merge", {
    gap_slot_id: "gap-slot", display_name: "制作者",
  });
});

test("U02 409 race loser and 403 guard denial preserve error payload for CURRENT UI", async () => {
  const raced = server(409, { ok: false, message: "先に確保されました" });
  assert.deepEqual(await reserveSlot("e", "s", {
    display_name: "a", consecutive_count: 1,
  }, raced.fetcher), { ok: false, message: "先に確保されました" });
  const guarded = server(403, { ok: false, reason: "tos_required", message: "同意が必要です" });
  assert.deepEqual(await releaseSlot("e", "s", guarded.fetcher), {
    ok: false, reason: "tos_required", message: "同意が必要です",
  });
});

test("U02 malformed JSON, missing boolean ok and inconsistent HTTP status fail closed", async () => {
  const input = { display_name: "a", consecutive_count: 1 };
  for (const invalid of [null, [], {}, { ok: "true" }, { ok: 1 }]) {
    await assert.rejects(reserveSlot("e", "s", input, server(200, invalid).fetcher), TypeError);
  }
  await assert.rejects(releaseSlot("e", "s", server(503, { ok: true }).fetcher), TypeError);
  const throwingFetcher = async () => { throw new SyntaxError("not JSON"); };
  await assert.rejects(extendSlot("e", "s", { direction: "forward" }, throwingFetcher), SyntaxError);
});

test("U01 RH-014 invalid privilege flags and malformed JSON fail closed", async () => {
  const { parseSlotViewerOverlay, unavailableSlotViewerOverlay, fetchSlotViewerOverlay } =
    await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const valid = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: "x", viewerXIdNotice: null,
    slots: [{ id: "s", display_name: "名前", is_owned_by_viewer: true,
      viewer_relation: "active", group_key: "private-1" }],
  };
  assert.equal(parseSlotViewerOverlay(valid)?.canReserveSlot, true);
  for (const invalid of [null, [], {}, { ...valid, loggedIn: "true" },
    { ...valid, canReserveSlot: 1 }, { ...valid, slots: "wrong" }]) {
    assert.equal(parseSlotViewerOverlay(invalid), null);
  }
  const invalid = server(200, { ...valid, loggedIn: "true" });
  assert.deepEqual(await fetchSlotViewerOverlay("event", undefined, invalid.fetcher), unavailableSlotViewerOverlay());
  assert.equal(invalid.calls[0].url, "/api/events/event/slots/viewer-overlay");
  assert.equal(invalid.calls[0].init.cache, "no-store");
  assert.equal(invalid.calls[0].init.credentials, "same-origin");
  assert.equal(invalid.calls[0].init.headers.Accept, "application/json");
});

test("U01 contradictory RH-014 slot actor relation never grants ownership", async () => {
  const { parseSlotViewerOverlay } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const base = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: "active-x", viewerXIdNotice: null,
  };
  for (const relation of ["none", "account_other"]) {
    const result = parseSlotViewerOverlay({ ...base, slots: [
      { id: "s1", viewer_relation: relation, is_owned_by_viewer: true,
        group_key: "invalid-ownership" },
      { id: "s2", viewer_relation: "active", is_owned_by_viewer: true },
    ] });
    assert.ok(result, "valid sibling rows keep their UI rights");
    assert.deepEqual(result.slots.map(s => s.id), ["s2"],
      `RH-014 ${relation} cannot authorize an owned badge`);
  }
  for (const relation of ["active", "unassigned"]) {
    const result = parseSlotViewerOverlay({ ...base, slots: [
      { id: "s1", viewer_relation: relation, is_owned_by_viewer: true },
    ] });
    assert.equal(result?.slots[0]?.is_owned_by_viewer, true,
      `CURRENT valid ${relation} owner remains supported`);
  }
  const differentAccount = parseSlotViewerOverlay({ ...base, slots: [
    { id: "s1", viewer_relation: "account_other", is_owned_by_viewer: false },
  ] });
  assert.equal(differentAccount?.slots[0]?.is_owned_by_viewer, false,
    "account_other remains visible as a non-owned relation");
});

test("U01 duplicate RH-014 slot IDs cannot elevate ownership regardless of response order", async () => {
  const { parseSlotViewerOverlay, mergeViewerSlotOverlay } =
    await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const flags = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: "active-x", viewerXIdNotice: null,
  };
  const denied = { id: "s1", display_name: "foreign-private", viewer_relation: "account_other",
    is_owned_by_viewer: false, x_user_id: null };
  const owned = { id: "s1", display_name: "private-owner", viewer_relation: "active",
    is_owned_by_viewer: true, x_user_id: "active-x" };
  const sibling = { id: "s2", viewer_relation: "active", is_owned_by_viewer: true };
  for (const duplicates of [[denied, owned], [owned, denied], [owned, owned]]) {
    const overlay = parseSlotViewerOverlay({ ...flags, slots: [duplicates[0], sibling, duplicates[1]] });
    assert.ok(overlay);
    assert.deepEqual(overlay.slots.map((row) => row.id), ["s2"],
      "every row for an ambiguous slot ID is discarded; independent slots remain");
    const merged = mergeViewerSlotOverlay([
      { id: "s1", display_name: "public-name" }, { id: "s2", display_name: "public-two" },
    ], overlay, true);
    assert.equal(merged[0].is_owned_by_viewer, false,
      "duplicate RH-014 data cannot paint a false owned badge");
    assert.equal(merged[0].display_name, "public-name",
      "duplicate RH-014 data cannot override the public name");
    assert.equal(merged[0].x_user_id, null);
    assert.equal(merged[1].is_owned_by_viewer, true, "an unrelated valid owner still works");
  }
});

test("U01 raw invalid RH-014 duplicate ID is fenced before invalid-row filtering", async () => {
  const { parseSlotViewerOverlay, mergeViewerSlotOverlay } =
    await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const flags = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: "x", viewerXIdNotice: null,
  };
  const owned = { id: "s1", display_name: "private-owner",
    viewer_relation: "active", is_owned_by_viewer: true, x_user_id: "x" };
  const goodSibling = { id: "s2", viewer_relation: "active", is_owned_by_viewer: true };
  const invalidDuplicates = [
    { id: "s1", viewer_relation: "account_other", is_owned_by_viewer: true },
    { id: "s1", viewer_relation: "invalid-relation", is_owned_by_viewer: true },
    { id: "s1", viewer_relation: "active", is_owned_by_viewer: "true" },
    { id: "s1" },
  ];
  for (const bad of invalidDuplicates) {
    for (const slots of [[owned, bad, goodSibling], [bad, goodSibling, owned]]) {
      const overlay = parseSlotViewerOverlay({ ...flags, slots });
      assert.ok(overlay);
      assert.deepEqual(overlay.slots.map(slot => slot.id), ["s2"],
        "a malformed same-ID row must invalidate every apparently valid private owner");
      const merged = mergeViewerSlotOverlay(
        [{ id: "s1", display_name: "public" }, { id: "s2", display_name: "public-two" }],
        overlay, true,
      );
      assert.equal(merged[0].is_owned_by_viewer, false);
      assert.equal(merged[0].display_name, "public");
      assert.equal(merged[0].x_user_id, null);
      assert.equal(merged[1].is_owned_by_viewer, true);
    }
  }
  const independentMalformed = parseSlotViewerOverlay({
    ...flags, slots: [owned, { id: "bad", viewer_relation: "garbage" }, goodSibling],
  });
  assert.deepEqual(independentMalformed?.slots.map(slot => slot.id), ["s1", "s2"],
    "an invalid row for an unrelated ID must not revoke valid owners");
});

test("U01 viewer overlay RH-014 503/404/network error never grants ownership", async () => {
  const { fetchSlotViewerOverlay } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  for (const status of [404, 503]) {
    const srv = server(status, { loggedIn: true, canReserveSlot: true });
    const result = await fetchSlotViewerOverlay("e", undefined, srv.fetcher);
    assert.equal(result.authUnavailable, true);
    assert.equal(result.canReserveSlot, false);
    assert.deepEqual(result.slots, []);
  }
  const result = await fetchSlotViewerOverlay("e", undefined, async () => { throw new Error("network"); });
  assert.equal(result.authUnavailable, true);
});

test("U01 timeout/abort fail closed without a stale viewer", async () => {
  const { fetchSlotViewerOverlay } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const slow = (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const timed = await fetchSlotViewerOverlay("e", undefined, slow, 10);
  assert.equal(timed.authUnavailable, true);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await fetchSlotViewerOverlay("e", controller.signal, async () => {
    throw new Error("should not fetch on an already-aborted signal");
  });
  assert.equal(cancelled.authUnavailable, true);
});

test("U01 abort wins even when a fetch implementation ignores AbortSignal", async () => {
  const { fetchSlotViewerOverlay } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const privileged = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: true, viewerXId: "old", viewerXIdNotice: null,
    slots: [{ id: "s", viewer_relation: "active", is_owned_by_viewer: true }],
  };
  // Promise resolves after timeout without observing the signal: fail closed.
  const lateResponse = async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { ok: true, json: async () => privileged };
  };
  const late = await fetchSlotViewerOverlay("e", undefined, lateResponse, 2);
  assert.equal(late.authUnavailable, true);
  assert.equal(late.canReserveSlot, false);
  assert.deepEqual(late.slots, []);

  // Also reject when only the body parsing completes after the deadline.
  const slowJson = async () => ({ ok: true, json: async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return privileged;
  } });
  const body = await fetchSlotViewerOverlay("e", undefined, slowJson, 2);
  assert.equal(body.authUnavailable, true);
  assert.equal(body.operatorOverrideAllowed, false);

  // Caller cancellation with a fetch that ignores its signal is also safe.
  const controller = new AbortController();
  const pending = fetchSlotViewerOverlay("e", controller.signal, lateResponse, 100);
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.canReserveSlot, false);
});

test("U01 viewer patches retain public base and lose write ownership on auth degradation", async () => {
  const { parseSlotViewerOverlay, mergeViewerSlotOverlay } =
    await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const overlay = parseSlotViewerOverlay({
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: "active", viewerXIdNotice: null,
    slots: [
      { id: "a", display_name: "me", reserved_x_id: "private-reserved",
        profile_x_user_id: "private-profile", submitted_icon_url: "https://private.invalid/icon",
        group_key: "own-group", x_user_id: "active",
        is_owned_by_viewer: true, viewer_relation: "active" },
      { id: "NOT_IN_PUBLIC_BASE", is_owned_by_viewer: true, viewer_relation: "active" },
      { id: "b", viewer_relation: "bad", is_owned_by_viewer: true },
    ],
  });
  assert.ok(overlay);
  assert.equal(overlay.slots.length, 2, "invalid slot patch filtered");
  const base = [{ id: "a", display_name: "public", group_key: "public-group" }, { id: "b" }];
  const merged = mergeViewerSlotOverlay(base, overlay, true);
  assert.equal(merged.length, 2, "no private-only rows are added");
  assert.equal(merged[0].display_name, "me");
  assert.equal(merged[0].group_key, "public-group", "CURRENT public_name group is authoritative");
  assert.equal(merged[0].is_owned_by_viewer, true);
  assert.equal(merged[1].is_owned_by_viewer, false);
  const locked = mergeViewerSlotOverlay(base, overlay, false);
  assert.equal(locked[0].is_owned_by_viewer, false);
  assert.equal(locked[0].display_name, "public", "only public base name remains");
  assert.equal(locked[0].group_key, "public-group", "no private opaque group");
  assert.equal(locked[0].viewer_relation, "none");
  for (const key of ["reserved_x_id", "profile_x_user_id", "submitted_icon_url", "x_user_id"]) {
    assert.equal(locked[0][key] ?? null, null, `denied viewer must not expose ${key}`);
  }
  assert.equal(merged[0].x_user_id, "active", "permitted viewer still receives scoped data");
  assert.equal(merged[0].profile_x_user_id, "private-profile");
});

test("U01 Active X changed event invalidates old identity before refetch resolves", async () => {
  const React = (await import("react")).default;
  const { JSDOM } = await import("jsdom");
  const { useEventSlotsViewer } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const { ACTIVE_X_CHANGED_EVENT } = await import("../src/lib/client/activeXSwitchEvents.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://flamenode.net/event/e/slots" });
  const domKeys = ["window", "document", "navigator", "HTMLElement", "Node"];
  const previousDom = new Map(domKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of domKeys) {
    Object.defineProperty(globalThis, key, {
      configurable: true, writable: true, value: dom.window[key],
    });
  }
  const { createRoot } = await import("react-dom/client");
  const previousFetch = globalThis.fetch;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const makeOverlay = (id) => ({
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: id, viewerXIdNotice: null,
    slots: [{ id: "s", viewer_relation: "active", is_owned_by_viewer: true, x_user_id: id }],
  });
  const requests = [];
  globalThis.fetch = async (_url, init) => new Promise((resolve) => {
    requests.push({ resolve, signal: init.signal });
  });
  const baseSlots = [{ id: "s" }];
  let snapshot;
  const Harness = () => {
    snapshot = useEventSlotsViewer("e", baseSlots, true);
    return React.createElement("div");
  };
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    assert.equal(requests.length, 1);
    await React.act(async () => {
      requests[0].resolve({ ok: true, json: async () => makeOverlay("old") });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(snapshot.canTakeSlot, true);
    assert.equal(snapshot.slots[0].is_owned_by_viewer, true);
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    assert.equal(requests.length, 2);
    assert.equal(snapshot.loading, true);
    assert.equal(snapshot.canTakeSlot, false);
    assert.equal(snapshot.slots[0].is_owned_by_viewer, false);
    await React.act(async () => {
      requests[1].resolve({ ok: true, json: async () => makeOverlay("new") });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(snapshot.overlay.viewerXId, "new");
    assert.equal(snapshot.slots[0].x_user_id, "new");
    // When an older request ignores AbortSignal, its late response must not
    // restore the previous viewer's ownership after a subsequent X switch.
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    assert.equal(requests.length, 4);
    await React.act(async () => {
      requests[3].resolve({ ok: true, json: async () => makeOverlay("latest") });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(snapshot.overlay.viewerXId, "latest");
    await React.act(async () => {
      requests[2].resolve({ ok: true, json: async () => makeOverlay("stale") });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(snapshot.overlay.viewerXId, "latest", "stale response must not restore ownership");
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previousDom) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    globalThis.fetch = previousFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    dom.window.close();
  }
});

test("U01 SSR / JS-disabled public page contains only a safe notice, never reservation controls", async () => {
  const React = (await import("react")).default;
  const { renderToString } = await import("react-dom/server");
  const { EventSlotsViewerIsland } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const html = renderToString(React.createElement(EventSlotsViewerIsland, {
    eventId: "e",
    baseSlots: [{ id: "s" }],
    accepting: false,
    eventStatus: "ended",
    children: (viewer) => React.createElement("span", null,
      viewer.canTakeSlot ? "reserve" : "display-only"),
  }));
  assert.match(html, /終了済みのため新規確保はできません/);
  assert.match(html, /display-only/);
  assert.doesNotMatch(html, /<button|reserve|viewerXId/i);
});
