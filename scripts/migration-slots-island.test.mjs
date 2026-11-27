// MIG-0514 U02: HTTP request contract, not an integration substitute for MIG-0657 / browser parity.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  reserveSlot, releaseSlot, extendSlot, mergeSlotGroup, describeSlotMutationResult, runSlotMutation,
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
  assert.equal(call.init.redirect, "error");
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

test("U02 merge sends gap_slot_id and display_name only when override is omitted", async () => {
  const srv = server(200, { ok: true });
  await mergeSlotGroup("e", { gap_slot_id: "gap-slot", display_name: "制作者" }, srv.fetcher);
  assertPost(srv.calls[0], "/api/events/e/slot-groups/merge", {
    gap_slot_id: "gap-slot", display_name: "制作者",
  });
});

test("U03c SA-067/068 forward only an explicitly supplied operator override", async () => {
  const denied = { ok: false, reason: "forbidden", message: "運営権限が必要です。" };
  for (const override of [undefined, false, true]) {
    const flag = override === undefined ? {} : { operator_override: override };
    const srv = server(403, denied);
    assert.deepEqual(await extendSlot("my/event", "slot?#", {
      direction: "backward", ...flag,
    }, srv.fetcher), denied, "client cannot turn a denial into success");
    assertPost(srv.calls[0], "/api/events/my%2Fevent/slots/slot%3F%23/extend", {
      direction: "backward", ...flag,
    });
    assert.deepEqual(await mergeSlotGroup("my/event", {
      gap_slot_id: "gap-slot", display_name: "運営", ...flag,
    }, srv.fetcher), denied);
    assertPost(srv.calls[1], "/api/events/my%2Fevent/slot-groups/merge", {
      gap_slot_id: "gap-slot", display_name: "運営", ...flag,
    });
    assert.equal(srv.calls.length, 2, "one request per operation; no automatic retry");
  }
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

const slotMutationCalls = [
  ["SA-065", fetcher => reserveSlot("e", "s", { display_name: "制作者", consecutive_count: 2 }, fetcher)],
  ["SA-066", fetcher => releaseSlot("e", "s", fetcher)],
  ["SA-067", fetcher => extendSlot("e", "s", { direction: "forward" }, fetcher)],
  ["SA-068", fetcher => mergeSlotGroup("e", { gap_slot_id: "s", display_name: "制作者" }, fetcher)],
];

test("U03d SA-065..068 preserve complete success and guard/race DTOs through real Response JSON", async () => {
  const success = { ok: true, slotId: "s", slotCount: 2, groupSize: 2, pendingPublicReflection: true };
  const cases = [
    [200, success],
    [200, { ...success, pendingPublicReflection: false }],
    [401, { ok: false, reason: "unauthenticated", message: "ログインが必要です。" }],
    [403, { ok: false, reason: "tos_required", message: "利用規約への同意が必要です。" }],
    [409, { ok: false, message: "先に確保されました" }],
  ];
  for (const [id, mutate] of slotMutationCalls) {
    for (const [status, payload] of cases) {
      let requests = 0;
      const result = await mutate(async () => {
        requests++;
        return Response.json(payload, { status });
      });
      assert.deepEqual(result, payload, `${id} HTTP ${status}: preserve exact DTO`);
      assert.equal(requests, 1, `${id}: never retry a mutation`);
    }
  }
});

test("U03d SA-065..068 reject undecodable or contradictory HTTP results without retry", async () => {
  const cases = [
    [() => new Response("<html>unavailable</html>", { status: 503 }), SyntaxError],
    [() => new Response(null, { status: 204 }), SyntaxError],
    [() => Response.json({ ok: "true" }), TypeError],
    [() => Response.json({ ok: true, slotId: "s", slotCount: 1, groupSize: 1 }, { status: 503 }), TypeError],
    [() => { throw new TypeError("network failure"); }, TypeError],
  ];
  for (const [id, mutate] of slotMutationCalls) {
    for (const [respond, error] of cases) {
      let requests = 0;
      await assert.rejects(mutate(async () => {
        requests++;
        return respond();
      }), error, id);
      assert.equal(requests, 1, `${id}: ambiguous commit outcome must not auto-retry`);
    }
  }
});

// A real loopback server is necessary: a fake fetch sees only one invocation
// even when Fetch internally follows a redirect and sends another request.
for (const [id, mutate] of slotMutationCalls) {
  test(`U03e ${id} rejects unexpected HTTP redirects without a second request`, { timeout: 10000 }, async () => {
    let status = 307;
    const requests = [];
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume the POST body */ }
      requests.push({ method: req.method, url: req.url });
      if (req.url === "/unexpected") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, slotId: "s", slotCount: 2, groupSize: 2 }));
      } else {
        res.writeHead(status, { Location: "/unexpected" });
        res.end();
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const redirect of [307, 308, 303, 301, 302]) {
        status = redirect;
        requests.length = 0;
        const result = await mutate((path, init) => fetch(new URL(path, origin), init))
          .then(value => ({ value }), error => ({ error }));
        assert.equal(requests.length, 1, `${id} HTTP ${status}: no second request`);
        assert.equal(requests[0].method, "POST");
        assert.notEqual(requests[0].url, "/unexpected");
        assert.ok(result.error instanceof TypeError, `${id} HTTP ${status}: reject redirect`);
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
}

const mutationFeedbackCases = [
  [{ operation: "reserve", requestedCount: 5, canPost: true }, { slotCount: 2, groupSize: 3 }, "2枠連続で確保しました。"],
  [{ operation: "reserve", requestedCount: 5, canPost: false }, { groupSize: 3 }, "3枠連続で確保しました。"],
  [{ operation: "reserve", requestedCount: 5, canPost: false }, {}, "5枠連続で確保しました。"],
  [{ operation: "reserve", requestedCount: 5, canPost: true }, { slotCount: 1, groupSize: 3 }, "枠を確保しました。続けて作品情報を登録できます。"],
  [{ operation: "reserve", requestedCount: 1, canPost: false }, {}, "枠を確保しました。作品投稿には X ID の承認が必要です。"],
  [{ operation: "release" }, { slotCount: 3, groupSize: 3 }, "枠を解放しました。"],
  [{ operation: "extend", canPost: false }, { slotCount: 1, groupSize: 3 }, "連続3枠になりました。"],
  [{ operation: "extend", canPost: true }, { slotCount: 3, groupSize: 1 }, "枠を拡張しました。続けて作品情報を登録できます。"],
  [{ operation: "extend", canPost: false }, {}, "枠を拡張しました。作品投稿には X ID の承認が必要です。"],
  [{ operation: "merge", canPost: false }, { slotCount: 1, groupSize: 4 }, "4枠を1つの連続枠にまとめました。"],
  [{ operation: "merge", canPost: true }, { groupSize: 1 }, "枠を結合しました。続けて作品情報を登録できます。"],
  [{ operation: "merge", canPost: false }, {}, "枠を結合しました。作品投稿には X ID の承認が必要です。"],
];

test("U03f success feedback keeps CURRENT messages, count precedence and reflection state", () => {
  for (const [presentation, fields, message] of mutationFeedbackCases) {
    for (const flag of [undefined, false, true]) {
      const result = Object.freeze({ ok: true, ...fields, ...(flag === undefined ? {} : { pendingPublicReflection: flag }) });
      assert.deepEqual(describeSlotMutationResult(Object.freeze(presentation), result), {
        kind: "success", message, pendingPublicReflection: flag,
      });
    }
  }
});

test("U03f failure feedback keeps operation fallback, exact denial message and guard reason", () => {
  const cases = [
    [{ operation: "reserve", requestedCount: 2, canPost: true }, "枠の確保に失敗しました。"],
    [{ operation: "release" }, "枠の解放に失敗しました。"],
    [{ operation: "extend", canPost: false }, "枠の拡張に失敗しました。"],
    [{ operation: "merge", canPost: false }, "枠の結合に失敗しました。"],
  ];
  for (const [presentation, fallback] of cases) {
    for (const [fields, expectedMessage, expectedReason] of [
      [{}, fallback, undefined],
      [{ message: "先に確保されました" }, "先に確保されました", undefined],
      [{ message: "", reason: "tos_required" }, "", "tos_required"],
      [{ reason: "unauthenticated" }, fallback, "unauthenticated"],
      [{ message: "利用停止中", reason: "banned", pendingPublicReflection: true }, "利用停止中", "banned"],
    ]) {
      assert.deepEqual(describeSlotMutationResult(presentation, Object.freeze({ ok: false, ...fields })), {
        kind: "failure", message: expectedMessage, reason: expectedReason,
      });
    }
  }
});


const settlementPresentations = [
  { operation: "reserve", requestedCount: 2, canPost: true },
  { operation: "release" },
  { operation: "extend", canPost: true },
  { operation: "merge", canPost: false },
];
const settlementPath = "/event/e/slots?part=2";

test("U03g SA-065..068 successful settlement requests one read refresh and preserves receipt", async () => {
  for (const [index, [id, mutate]] of slotMutationCalls.entries()) {
    for (const flag of [undefined, false, true]) {
      const payload = { ok: true, slotId: "confirmed-slot", slotCount: 2, groupSize: 2,
        ...(flag === undefined ? {} : { pendingPublicReflection: flag }) };
      let requests = 0;
      const result = await runSlotMutation(settlementPresentations[index],
        () => mutate(async () => { requests++; return Response.json(payload); }),
        () => { throw new Error("success must not consult navigation"); });
      assert.deepEqual(result, {
        ...describeSlotMutationResult(settlementPresentations[index], payload),
        slotId: "confirmed-slot", refresh: true,
      }, id);
      assert.equal(requests, 1);
    }
  }
});

test("U03g SA-065..068 guard redirect precedes failure display and sanitizes next", async () => {
  const reasons = [
    ["unauthenticated", "entry", 401],
    ["tos_required", "onboarding", 403],
    ["tos_reaccept_required", "onboarding", 403],
    ["active_x_required", "onboarding", 403],
    ["active_x_rejected", "onboarding", 403],
    ["active_x_not_approved", "onboarding", 403],
  ];
  for (const [index, [id, mutate]] of slotMutationCalls.entries()) {
    for (const [reason, destination, status] of reasons) {
      for (const [currentPath, safePath] of [[settlementPath, settlementPath], ["//external.invalid", "/"]]) {
        let requests = 0;
        let pathReads = 0;
        const result = await runSlotMutation(settlementPresentations[index],
          () => mutate(async () => {
            requests++;
            return Response.json({ ok: false, reason, message: "guard error" }, { status });
          }), () => { pathReads++; return currentPath; });
        assert.deepEqual(result, {
          kind: "redirect", path: "/" + destination + "?next=" + encodeURIComponent(safePath), refresh: false,
        }, id + " " + reason);
        assert.equal(requests, 1);
        assert.equal(pathReads, 1);
      }
    }
  }
});

test("U03g ordinary denied settlement preserves CURRENT error and does not replay or refresh", async () => {
  // T02 asks for a 409 refresh; this characterizes CURRENT only, not T02 acceptance.
  const denials = [
    [409, { ok: false, message: "先に確保されました" }],
    [403, { ok: false, reason: "banned", message: "利用停止中" }],
    [503, { ok: false, reason: "db_unavailable" }],
    [429, { ok: false, reason: "cost_guard_blocked", message: "" }],
  ];
  for (const [index, [id, mutate]] of slotMutationCalls.entries()) {
    for (const [status, payload] of denials) {
      let requests = 0;
      const result = await runSlotMutation(settlementPresentations[index],
        () => mutate(async () => { requests++; return Response.json(payload, { status }); }),
        () => settlementPath);
      assert.deepEqual(result, {
        ...describeSlotMutationResult(settlementPresentations[index], payload), refresh: false,
      }, id);
      assert.equal(requests, 1);
    }
  }
});

test("U03g ambiguous communication failures request read refresh, not a second mutation", async () => {
  const failures = [
    () => { throw new Error("private transport detail"); },
    () => new Response("private HTML body", { status: 503 }),
    () => new Response(null, { status: 204 }),
    () => Response.json({ ok: true }, { status: 503 }),
    () => Response.json({ ok: "true" }),
  ];
  for (const [index, [id, mutate]] of slotMutationCalls.entries()) {
    for (const respond of failures) {
      let requests = 0;
      const result = await runSlotMutation(settlementPresentations[index],
        () => mutate(async () => { requests++; return respond(); }),
        () => { throw new Error("communication failure must not consult navigation"); });
      assert.deepEqual(result, {
        kind: "communication-error",
        message: "通信エラーが発生しました。状態を再取得してもう一度お試しください。",
        refresh: true,
      }, id);
      assert.equal(requests, 1);
    }
  }
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
  // The inverse inconsistency matters too: a false owner flag paired with
  // an authorized relation must not copy private display/X/group data.
  for (const relation of ["active", "unassigned"]) {
    const result = parseSlotViewerOverlay({ ...base, slots: [
      { id: "s1", viewer_relation: relation, is_owned_by_viewer: false,
        display_name: "private-leak", x_user_id: "other-x", group_key: "private-group" },
      { id: "s2", viewer_relation: "active", is_owned_by_viewer: true },
    ] });
    assert.ok(result);
    assert.deepEqual(result.slots.map(slot => slot.id), ["s2"],
      `malformed ${relation}/false flag row must not merge its private identity`);
  }
  const differentAccount = parseSlotViewerOverlay({ ...base, slots: [
    { id: "s1", viewer_relation: "account_other", is_owned_by_viewer: false },
  ] });
  assert.equal(differentAccount?.slots[0]?.is_owned_by_viewer, false,
    "account_other remains visible as a non-owned relation");
});

test("U01 RH-014 relation must be an exact string enum before merging private fields", async () => {
  const { parseSlotViewerOverlay, mergeViewerSlotOverlay } =
    await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const flags = {
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: "active-x", viewerXIdNotice: null,
  };
  const sibling = { id: "s2", viewer_relation: "active", is_owned_by_viewer: true };
  const base = [{ id: "s1", display_name: "public-name", group_key: "public-group" },
    { id: "s2", display_name: "public-two" }];
  for (const invalid of [["active"], ["unassigned"], ["account_other"], ["none"],
    [["none"]], { toString: "none" }, true, 1, null, "ACTIVE", ""]) {
    for (const owned of [false, true]) {
      const bad = { id: "s1", viewer_relation: invalid, is_owned_by_viewer: owned,
        display_name: "private-name", reserved_x_id: "private-reserved",
        profile_x_user_id: "private-profile", submitted_icon_url: "https://private.invalid/icon",
        x_user_id: "private-x", group_key: "private-group" };
      const overlay = parseSlotViewerOverlay({ ...flags, slots: [bad, sibling] });
      assert.ok(overlay, "a malformed row must not discard valid siblings");
      assert.deepEqual(overlay.slots.map((slot) => slot.id), ["s2"]);
      const merged = mergeViewerSlotOverlay(base, overlay, true);
      assert.equal(merged[0].display_name, "public-name");
      assert.equal(merged[0].group_key, "public-group");
      assert.equal(merged[0].is_owned_by_viewer, false);
      assert.equal(merged[0].viewer_relation, "none");
      for (const key of ["reserved_x_id", "profile_x_user_id", "submitted_icon_url", "x_user_id"]) {
        assert.equal(merged[0][key], null);
      }
      assert.equal(merged[1].is_owned_by_viewer, true);
    }
  }
  for (const relation of ["active", "unassigned", "account_other", "none"]) {
    const owned = relation === "active" || relation === "unassigned";
    const overlay = parseSlotViewerOverlay({ ...flags, slots: [
      { id: "s1", viewer_relation: relation, is_owned_by_viewer: owned },
    ] });
    assert.equal(overlay?.slots[0]?.viewer_relation, relation);
    assert.equal(overlay?.slots[0]?.is_owned_by_viewer, owned);
  }
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

test("U01 RH-014 hard deadline settles even if fetch or JSON ignores AbortSignal forever", async () => {
  const { fetchSlotViewerOverlay } =
    await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  async function withTestDeadline(promise, message) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), 300);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  let networkSignal;
  const neverFetch = (_url, init) => {
    networkSignal = init.signal;
    return new Promise(() => {});
  };
  const timed = await withTestDeadline(
    fetchSlotViewerOverlay("e", undefined, neverFetch, 5),
    "RH-014 timeout failed to settle a fetch that ignored abort",
  );
  assert.equal(networkSignal.aborted, true);
  assert.equal(timed.authUnavailable, true);
  assert.equal(timed.canReserveSlot, false);
  assert.deepEqual(timed.slots, []);

  let bodySignal;
  const neverJson = async (_url, init) => {
    bodySignal = init.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  };
  const body = await withTestDeadline(
    fetchSlotViewerOverlay("e", undefined, neverJson, 5),
    "RH-014 timeout failed to settle a JSON parse that ignored abort",
  );
  assert.equal(bodySignal.aborted, true);
  assert.equal(body.authUnavailable, true);
  assert.equal(body.operatorOverrideAllowed, false);

  const external = new AbortController();
  const cancelledPromise = fetchSlotViewerOverlay("e", external.signal, neverFetch, 10_000);
  external.abort();
  const cancelled = await withTestDeadline(cancelledPromise,
    "parent RH-014 cancellation did not settle a hung fetch");
  assert.equal(cancelled.authUnavailable, true);
  assert.equal(cancelled.loggedIn, false);
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

test("U03h mutation receipts expire on Active X refresh, public snapshot, event and unmount", async () => {
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
  let baseSlots = [{ id: "s" }];
  let eventId = "e";
  let snapshot;
  const Harness = () => {
    snapshot = useEventSlotsViewer(eventId, baseSlots, true);
    return React.createElement("div");
  };
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = () => React.act(async () => root.render(React.createElement(Harness)));
  const settle = (index, overlay) => React.act(async () => {
    requests[index].resolve({ ok: true, json: async () => overlay });
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  try {
    await render();
    assert.equal(snapshot.captureMutationReceipt(), null, "pending cannot authorize a UI receipt");
    await settle(0, makeOverlay("same"));
    const oldCapture = snapshot.captureMutationReceipt;
    const first = oldCapture();
    assert.equal(typeof first, "function");
    assert.equal(first(), true);
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
      assert.equal(first(), false, "invalidate before React commits a refresh");
      assert.equal(oldCapture(), null, "a stale handler cannot capture the next receipt");
    });
    assert.equal(snapshot.captureMutationReceipt(), null);
    await settle(1, makeOverlay("same"));
    const second = snapshot.captureMutationReceipt();
    assert.equal(second(), true);
    assert.equal(first(), false, "same Active X string must not revive old receipt");
    assert.equal(oldCapture(), null);

    // A new public array can describe the same slot ID owned by a different viewer.
    baseSlots = [{ id: "s" }];
    await render();
    assert.equal(second(), false);
    assert.equal(snapshot.captureMutationReceipt(), null);
    await settle(2, makeOverlay("same"));
    const third = snapshot.captureMutationReceipt();
    assert.equal(third(), true);

    // An event can reuse both its slot IDs and the same Active X string.
    eventId = "other";
    await render();
    assert.equal(third(), false);
    await settle(3, makeOverlay("same"));
    const other = snapshot.captureMutationReceipt();
    assert.equal(other(), true);
    eventId = "e";
    await render();
    assert.equal(other(), false);
    await settle(4, makeOverlay("same"));
    const returned = snapshot.captureMutationReceipt();
    assert.equal(returned(), true);
    assert.equal(third(), false);

    // An explicit refresh fences synchronous old callbacks; a denied result
    // cannot provide a receipt even when it echoes a prior X ID.
    await React.act(async () => {
      snapshot.refresh();
      assert.equal(returned(), false);
    });
    await settle(5, { ...makeOverlay("same"), isBanned: true });
    assert.equal(snapshot.captureMutationReceipt(), null);
    await React.act(async () => snapshot.refresh());
    await settle(6, makeOverlay("same"));
    const final = snapshot.captureMutationReceipt();
    assert.equal(final(), true);
    // Render an empty tree to unmount the hook before the final root cleanup.
    await React.act(async () => root.render(null));
    assert.equal(final(), false);
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
