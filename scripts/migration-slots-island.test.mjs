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
  assert.equal(result.status, 200);
  assert.equal(result.result.pendingPublicReflection, true);
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
  assert.deepEqual(await releaseSlot("e", "s", srv.fetcher), { status: 200, result: { ok: true } });
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
    }, srv.fetcher), { status: 403, result: denied }, "client cannot turn a denial into success");
    assertPost(srv.calls[0], "/api/events/my%2Fevent/slots/slot%3F%23/extend", {
      direction: "backward", ...flag,
    });
    assert.deepEqual(await mergeSlotGroup("my/event", {
      gap_slot_id: "gap-slot", display_name: "運営", ...flag,
    }, srv.fetcher), { status: 403, result: denied });
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
  }, raced.fetcher), { status: 409, result: { ok: false, message: "先に確保されました" } });
  const guarded = server(403, { ok: false, reason: "tos_required", message: "同意が必要です" });
  assert.deepEqual(await releaseSlot("e", "s", guarded.fetcher), {
    status: 403, result: { ok: false, reason: "tos_required", message: "同意が必要です" },
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
      assert.deepEqual(result, { status, result: payload }, `${id} HTTP ${status}: preserve exact DTO and actual transport status`);
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
  // Non-409 denials retain CURRENT behavior, even if their body claims conflict.
  const denials = [
    [200, { ok: false, status: 409, reason: "conflict", message: "先に確保されました" }],
    [403, { ok: false, status: 409, httpStatus: 409, message: "先に確保されました" }],
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

test("U03j T02 actual HTTP 409 requests read-only refresh with guard precedence and no retry", async () => {
  for (const [index, [id, mutate]] of slotMutationCalls.entries()) {
    const presentation = settlementPresentations[index];
    for (const payload of [
      { ok: false, message: "先に確保されました" },
      { ok: false, status: 200, httpStatus: 403, message: "" },
      { ok: false, reason: "conflict", pendingPublicReflection: true },
    ]) {
      let requests = 0;
      const outcome = await runSlotMutation(presentation,
        () => mutate(async () => { requests++; return Response.json(payload, { status: 409 }); }),
        () => settlementPath);
      assert.deepEqual(outcome, {
        ...describeSlotMutationResult(presentation, payload), refresh: true,
      }, id);
      assert.equal(requests, 1, id + ": one POST only");
    }
    let requests = 0;
    const guarded = await runSlotMutation(presentation,
      () => mutate(async () => {
        requests++;
        return Response.json({ ok: false, reason: "tos_required", message: "同意が必要です" }, { status: 409 });
      }), () => settlementPath);
    assert.deepEqual(guarded, {
      kind: "redirect", path: "/onboarding?next=" + encodeURIComponent(settlementPath), refresh: false,
    }, id);
    assert.equal(requests, 1);
    for (const respond of [
      () => Response.json({ ok: true }, { status: 409 }),
      () => Response.json({ ok: "false" }, { status: 409 }),
      () => new Response("invalid JSON", { status: 409 }),
    ]) {
      let requests = 0;
      const outcome = await runSlotMutation(presentation,
        () => mutate(async () => { requests++; return respond(); }),
        () => { throw new Error("invalid response must not consult navigation"); });
      assert.deepEqual(outcome, {
        kind: "communication-error",
        message: "通信エラーが発生しました。状態を再取得してもう一度お試しください。",
        refresh: true,
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


test("U03i RH-014 overlay and mutation receipts cannot revive on pending A-B-A or persisted pageshow", async () => {
  const React = (await import("react")).default;
  const { JSDOM } = await import("jsdom");
  const { useEventSlotsViewer } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const { ACTIVE_X_CHANGED_EVENT } = await import("../src/lib/client/activeXSwitchEvents.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://flamenode.net/event/e/slots" });
  const domKeys = ["window", "document", "navigator", "HTMLElement", "Node"];
  const previousDom = new Map(domKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of domKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  const { createRoot } = await import("react-dom/client");
  const previousFetch = globalThis.fetch;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const makeOverlay = label => ({
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: false,
    operatorOverrideAllowed: false, viewerXId: null, viewerXIdNotice: label,
    slots: [{ id: "s", viewer_relation: "unassigned", is_owned_by_viewer: true,
      display_name: label, group_key: "private-" + label }],
  });
  const requests = [];
  globalThis.fetch = async (url, init) => new Promise(resolve => {
    requests.push({ url, init, resolve });
  });
  const original = [{ id: "s", display_name: "public" }];
  const alternate = [{ id: "s", display_name: "public" }];
  let baseSlots = original, eventId = "a", snapshot;
  const frames = [];
  const Harness = () => {
    snapshot = useEventSlotsViewer(eventId, baseSlots, true);
    const view = snapshot;
    React.useLayoutEffect(() => {
      frames.push({ eventId, baseSlots, notice: view.overlay.viewerXIdNotice,
        rawSlots: view.overlay.slots.length, name: view.slots[0].display_name,
        owned: view.slots[0].is_owned_by_viewer, group: view.slots[0].group_key,
        take: view.canTakeSlot, manage: view.canManageOwnSlots,
        receipt: view.captureMutationReceipt() !== null, loading: view.loading });
    });
    return React.createElement("div", null, view.overlay.viewerXIdNotice, view.slots[0].display_name);
  };
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = () => React.act(async () => root.render(React.createElement(Harness)));
  const settle = (request, label) => React.act(async () => {
    request.resolve({ ok: true, json: async () => makeOverlay(label) });
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  const assertHidden = start => {
    assert.ok(frames.length > start);
    for (const frame of frames.slice(start)) {
      assert.equal(frame.notice, null);
      assert.equal(frame.rawSlots, 0);
      assert.equal(frame.name, "public");
      assert.equal(frame.owned, false);
      assert.equal(frame.group, null);
      assert.equal(frame.take, false);
      assert.equal(frame.manage, false);
      assert.equal(frame.receipt, false);
      assert.equal(frame.loading, true);
    }
    assert.equal(snapshot.captureMutationReceipt(), null);
  };
  const pageShow = persisted => {
    const event = new dom.window.Event("pageshow");
    Object.defineProperty(event, "persisted", { value: persisted });
    dom.window.dispatchEvent(event);
  };
  try {
    await render();
    assert.equal(requests.length, 1);
    await settle(requests[0], "old-a");
    const first = snapshot.captureMutationReceipt();
    assert.equal(first(), true);
    assert.equal(snapshot.overlay.viewerXIdNotice, "old-a");
    // A and B share the very same array; return while B is still pending.
    let start = frames.length;
    eventId = "b";
    await render();
    assertHidden(start);
    assert.equal(first(), false);
    const obsolete = requests[1];
    start = frames.length;
    eventId = "a";
    await render();
    assertHidden(start);
    assert.equal(obsolete.init.signal.aborted, true);
    assert.equal(requests.length, 3);
    assert.equal(requests[2].url, "/api/events/a/slots/viewer-overlay");
    await settle(obsolete, "late-b");
    assertHidden(start);
    await settle(requests[2], "fresh-a");
    assert.equal(snapshot.overlay.viewerXIdNotice, "fresh-a");
    assert.equal(snapshot.slots[0].display_name, "fresh-a");
    const second = snapshot.captureMutationReceipt();
    assert.equal(second(), true);
    assert.equal(first(), false);

    // The same event with a public-array A-B-A transition also retires raw data.
    start = frames.length;
    baseSlots = alternate;
    await render();
    assertHidden(start);
    start = frames.length;
    baseSlots = original;
    await render();
    assertHidden(start);
    assert.equal(requests.length, 5);
    assert.equal(requests[3].init.signal.aborted, true);
    await settle(requests[3], "late-array");
    assertHidden(start);
    await settle(requests[4], "fresh-array");
    const third = snapshot.captureMutationReceipt();
    assert.equal(third(), true);
    assert.equal(second(), false);

    // Ordinary pageshow is a control; a real persisted signal retires the
    // null-X viewer receipt synchronously even without a prop change.
    await React.act(async () => pageShow(false));
    assert.equal(requests.length, 5);
    assert.equal(third(), true);
    assert.equal(snapshot.overlay.viewerXIdNotice, "fresh-array");
    start = frames.length;
    await React.act(async () => {
      pageShow(true);
      assert.equal(third(), false);
    });
    assertHidden(start);
    assert.equal(requests.length, 6);
    await settle(requests[5], "new-owner");
    assert.equal(snapshot.overlay.viewerXIdNotice, "new-owner");
    const fourth = snapshot.captureMutationReceipt();
    assert.equal(fourth(), true);
    start = frames.length;
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
      assert.equal(fourth(), false);
    });
    assertHidden(start);
    assert.equal(requests.length, 7);
    await settle(requests[6], "new-active");
    assert.equal(snapshot.overlay.viewerXIdNotice, "new-active");
    const last = snapshot.captureMutationReceipt();
    assert.equal(last(), true);
    await React.act(async () => root.render(null));
    assert.equal(last(), false);
    pageShow(true);
    assert.equal(requests.length, 7);
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

test("U03k host serializes mutations and reconciles only a committed current viewer", async () => {
  const React = (await import("react")).default;
  const { JSDOM } = await import("jsdom");
  const { EventSlotsViewerIsland } = await import("../apps/site/src/components/EventSlotsViewerIsland.ts");
  const { ACTIVE_X_CHANGED_EVENT } = await import("../src/lib/client/activeXSwitchEvents.ts");
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://flamenode.net/event/e/slots",
  });
  const domKeys = ["window", "document", "navigator", "HTMLElement", "Node"];
  const previousDom = new Map(domKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of domKeys) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  }
  const { createRoot } = await import("react-dom/client");
  const previousFetch = globalThis.fetch;
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const requests = [];
  globalThis.fetch = async (_url, init) => new Promise(resolve => requests.push({ resolve, init }));
  const makeOverlay = id => ({
    loggedIn: true, authUnavailable: false, isBanned: false,
    needsTermsAcceptance: false, canReserveSlot: true, canPost: true,
    operatorOverrideAllowed: false, viewerXId: id, viewerXIdNotice: null,
    slots: [{ id: "s", viewer_relation: "active", is_owned_by_viewer: true, x_user_id: id }],
  });
  const baseSlots = [{ id: "s" }];
  let snapshot;
  let runMutation;
  let publicReads = 0;
  let publicReadResult = true;
  let holdPublicRead = false;
  const pendingPublicReads = [];
  let mutationCalls = 0;
  const outcomes = [];
  const navigations = [];
  const refreshPublic = async () => {
    publicReads += 1;
    if (holdPublicRead) return new Promise(resolve => pendingPublicReads.push(resolve));
    return publicReadResult;
  };
  const onNavigate = path => navigations.push(path);
  const onOutcome = (outcome, isCurrent) => outcomes.push({
    kind: outcome.kind, message: outcome.message, current: isCurrent(),
  });
  const Harness = () => React.createElement(EventSlotsViewerIsland, {
    eventId: "e", baseSlots, accepting: true, eventStatus: "open",
    refreshPublic, onNavigate,
  }, viewer => {
    snapshot = viewer;
    runMutation = viewer.runMutation;
    return React.createElement("div", null, viewer.loading ? "loading" : "ready");
  });
  const root = createRoot(dom.window.document.getElementById("root"));
  const render = () => React.act(async () => {
    root.render(React.createElement(Harness));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  const settleOverlay = (index, id) => React.act(async () => {
    requests[index].resolve({ ok: true, json: async () => makeOverlay(id) });
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  const presentation = { operation: "reserve", requestedCount: 1, canPost: true };

  try {
    await render();
    assert.equal(requests.length, 1);
    await settleOverlay(0, "x1");
    assert.equal(snapshot.canManageOwnSlots, true);
    const firstReceipt = snapshot.captureMutationReceipt();
    assert.equal(firstReceipt(), true);

    let resolveFirst;
    let firstResult;
    let duplicate;
    await React.act(async () => {
      const firstPromise = runMutation(presentation, () => {
        mutationCalls += 1;
        return new Promise(resolve => { resolveFirst = resolve; });
      }, onOutcome);
      duplicate = await runMutation(presentation, async () => {
        mutationCalls += 1;
        return { status: 200, result: { ok: true, slotId: "s" } };
      }, onOutcome);
      assert.equal(duplicate.kind, "busy");
      assert.equal(mutationCalls, 1, "single-flight must not issue a second POST");
      resolveFirst({ status: 200, result: { ok: true, slotId: "s" } });
      firstResult = await firstPromise;
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(firstResult.kind, "settled");
    assert.equal(firstResult.outcome.kind, "success");
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].current, true, "current result callback runs under its receipt");
    assert.equal(firstReceipt(), false, "the post-mutation refresh retires the old receipt");
    assert.equal(publicReads, 1, "success performs one RH-020 read");
    assert.equal(requests.length, 2, "success is followed by one RH-014 read");
    await settleOverlay(1, "x1");

    let resolveStale;
    let stalePromise;
    let staleResult;
    await React.act(async () => {
      stalePromise = runMutation(presentation, () => {
        mutationCalls += 1;
        return new Promise(resolve => { resolveStale = resolve; });
      }, onOutcome);
    });
    const oldReceipt = snapshot.captureMutationReceipt();
    assert.equal(oldReceipt(), true);
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    assert.equal(oldReceipt(), false);
    assert.equal(requests.length, 3);
    await React.act(async () => {
      resolveStale({ status: 200, result: { ok: true, slotId: "s" } });
      staleResult = await stalePromise;
    });
    assert.equal(staleResult.kind, "stale");
    assert.equal(publicReads, 1, "no successor read starts before a current receipt commits");
    assert.equal(outcomes.length, 1, "stale success cannot update successor UI");

    await settleOverlay(2, "x2");
    assert.equal(publicReads, 2, "the new committed viewer performs a fresh RH-020 read");
    assert.equal(requests.length, 4, "the current host follows with one RH-014 read");
    await settleOverlay(3, "x2");

    let resolveStaleGuard;
    let staleGuardPromise;
    let staleGuardResult;
    await React.act(async () => {
      staleGuardPromise = runMutation(presentation, () => {
        mutationCalls += 1;
        return new Promise(resolve => { resolveStaleGuard = resolve; });
      }, onOutcome);
    });
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    assert.equal(requests.length, 5);
    await React.act(async () => {
      resolveStaleGuard({ status: 403, result: { ok: false, reason: "tos_required", message: "terms" } });
      staleGuardResult = await staleGuardPromise;
    });
    assert.equal(staleGuardResult.kind, "stale");
    assert.equal(navigations.length, 0, "a stale guard cannot navigate the successor");
    assert.equal(publicReads, 2, "a stale guard does not refresh either read");
    await settleOverlay(4, "x3");

    let redirectResult;
    await React.act(async () => {
      redirectResult = await runMutation(presentation, async () => {
        mutationCalls += 1;
        return { status: 403, result: { ok: false, reason: "tos_required", message: "terms" } };
      }, onOutcome);
    });
    assert.equal(redirectResult.kind, "settled");
    assert.equal(redirectResult.outcome.kind, "redirect");
    assert.deepEqual(navigations, ["/onboarding?next=%2Fevent%2Fe%2Fslots"]);
    assert.equal(publicReads, 2, "a current guard redirects without mutation refresh");

    publicReadResult = false;
    let conflictResult;
    await React.act(async () => {
      conflictResult = await runMutation(presentation, async () => {
        mutationCalls += 1;
        return { status: 409, result: { ok: false, reason: "slot_conflict", message: "conflict" } };
      }, onOutcome);
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(conflictResult.kind, "settled");
    assert.equal(conflictResult.outcome.kind, "failure");
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[1].kind, "failure");
    assert.equal(publicReads, 3, "typed 409 performs one RH-020 read");
    assert.equal(requests.length, 6, "typed 409 is followed by one RH-014 read even when RH-020 fails");
    assert.equal(mutationCalls, 5, "no mutation path retries its POST");
    await settleOverlay(5, "x3");

    // A stale mutation settles under x4, whose public reconciliation is held.
    // x5 commits before that read settles. The reconciliation must wake again
    // even though the x5 commit's effect already observed pending=false.
    let resolveLate;
    let latePromise;
    let lateResult;
    await React.act(async () => {
      latePromise = runMutation(presentation, () => {
        mutationCalls += 1;
        return new Promise(resolve => { resolveLate = resolve; });
      }, onOutcome);
    });
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    assert.equal(requests.length, 7);
    await settleOverlay(6, "x4");
    holdPublicRead = true;
    await React.act(async () => {
      resolveLate({ status: 200, result: { ok: true, slotId: "s" } });
    });
    assert.equal(publicReads, 4);
    assert.equal(pendingPublicReads.length, 1);
    await React.act(async () => {
      dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
    });
    assert.equal(requests.length, 8);
    await settleOverlay(7, "x5");
    assert.equal(publicReads, 4, "no overlapping stale reconciliation");
    await React.act(async () => {
      pendingPublicReads[0](true);
      lateResult = await latePromise;
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(lateResult.kind, "stale");
    assert.equal(publicReads, 5, "already-committed successor must not lose the read wakeup");
    assert.equal(pendingPublicReads.length, 2);
    assert.equal(requests.length, 8, "obsolete public completion cannot refresh x5 private state");

    // The original mutation has returned, but its deferred reconciliation
    // still owns the successor read. A new POST must not overtake that read.
    let duringReconcile;
    await React.act(async () => {
      duringReconcile = await runMutation(presentation, async () => {
        mutationCalls += 1;
        return { status: 200, result: { ok: true, slotId: "s" } };
      }, onOutcome);
    });
    assert.equal(duringReconcile.kind, "busy");
    assert.equal(mutationCalls, 6, "no POST while successor reconciliation is pending");
    assert.equal(publicReads, 5, "no competing RH-020 read while reconciliation is pending");
    assert.equal(requests.length, 8, "no competing RH-014 read while reconciliation is pending");

    await React.act(async () => {
      pendingPublicReads[1](true);
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    assert.equal(requests.length, 9);
    await settleOverlay(8, "x5");
    assert.equal(outcomes.length, 2, "stale outcome is not delivered to successor");
    assert.equal(navigations.length, 1);
    assert.equal(mutationCalls, 6, "reconciliation never retries the POST");

    // A current result callback can retire the receipt synchronously.
    // Its requested read-only refresh is still owed by the new host receipt.
    holdPublicRead = false;
    publicReadResult = true;
    let callbackResult;
    await React.act(async () => {
      callbackResult = await runMutation(presentation, async () => {
        mutationCalls += 1;
        return { status: 200, result: { ok: true, slotId: "s" } };
      }, (outcome, isCurrent) => {
        assert.equal(outcome.kind, "success");
        assert.equal(isCurrent(), true);
        dom.window.dispatchEvent(new dom.window.Event(ACTIVE_X_CHANGED_EVENT));
        assert.equal(isCurrent(), false);
      });
    });
    assert.equal(callbackResult.kind, "settled");
    assert.equal(publicReads, 5, "do not read under the retired receipt");
    assert.equal(requests.length, 10);
    await settleOverlay(9, "x6");
    assert.equal(publicReads, 6);
    assert.equal(requests.length, 11, "current successor gets a fresh private read");
    await settleOverlay(10, "x6");
    assert.equal(mutationCalls, 7);
  } finally {
    await React.act(async () => root.unmount());
    globalThis.fetch = previousFetch;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    for (const [key, descriptor] of previousDom) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});
