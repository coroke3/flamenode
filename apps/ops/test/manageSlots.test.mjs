import assert from "node:assert/strict";
import test from "node:test";
import { listSlots, normalizeSlotFilter } from "../.test-dist/apps/ops/src/api/manageSlots.js";

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const slot = (index, overrides = {}) => ({
  id: "slot-" + index, event_id: "ev1", slot_label: "Slot " + index,
  start_time: 1700000000 + index, sort_order: index, status: "available",
  display_name: null, x_user_id: null, reserved_x_id_snapshot: null,
  reserved_by_user_id: null, discord_display_name: null, discord_id: null,
  reservation_group_id: null, video_id: null, updated_at: 1700000000, version: 1,
  ...overrides,
});
const page = (offset, rows, overrides = {}) => ({
  event: { id: "ev1", title: "Festival", accent_color: null,
    slot_part_gap_minutes: 15, parts: ["A", "B"] },
  isAdmin: false, statusFilter: "all", offset, pageSize: 100,
  pendingCount: 3, total: 520, counts: { available: 520 },
  slots: rows,
  ...overrides,
});
function makePagedFetch(n, options = {}) {
  const requests = [];
  const fetchFn = async (path, init) => {
    requests.push({ path, init });
    const url = new URL(path, "https://flamenode.test");
    const offset = Number(url.searchParams.get("offset"));
    if (options.respond) return options.respond({ offset, url, init, request: requests.length });
    return json(200, page(offset, Array.from(
      { length: Math.max(0, Math.min(100, n - offset)) }, (_, i) => slot(offset + i),
    ), { statusFilter: url.searchParams.get("status"), total: n, counts: { available: n } }));
  };
  return { fetchFn, requests };
}

test("MIG-0722 U01 T01: 450 rows via exactly 5 bounded reads, first counts, identity and credentials", async () => {
  const { fetchFn, requests } = makePagedFetch(450);
  const controller = new AbortController();
  const result = await listSlots("ev1", "all", fetchFn, controller.signal);
  assert.equal(result.status, "ok");
  assert.equal(result.data.slots.length, 450);
  assert.equal(result.data.slots[449].id, "slot-449");
  assert.equal(result.data.total, 450);
  assert.deepEqual(result.data.counts, { available: 450 });
  assert.equal(result.data.pendingCount, 3);
  assert.equal(result.data.offset, 0);
  assert.equal(result.data.atLimit, false);
  assert.deepEqual(requests.map(r => r.path), [0, 100, 200, 300, 400].map(offset =>
    "/api/manage/events/ev1/slots?status=all&offset=" + offset));
  for (const { init } of requests) {
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.accept, "application/json");
    assert.equal(init.signal, controller.signal);
  }
});

test("MIG-0722 U01: exactly 500 rows never requests an unsupported offset 500", async () => {
  const { fetchFn, requests } = makePagedFetch(501);
  const result = await listSlots("ev1", "all", fetchFn);
  assert.equal(result.status, "ok");
  assert.equal(result.data.slots.length, 500);
  assert.equal(result.data.atLimit, true);
  assert.equal(requests.length, 5);
  assert.ok(requests.every(({ path }) => !path.includes("offset=500")));
});

test("MIG-0722 U01 T05: normalize invalid status to all, filter and encode event id", async () => {
  for (const [raw, expected] of [
    [null, "all"], ["", "all"], ["bad", "all"], ["constructor", "all"],
    ["available", "available"], ["reserved", "reserved"], ["submitted", "submitted"],
  ]) assert.equal(normalizeSlotFilter(raw), expected);
  const calls = [];
  const result = await listSlots("ev 1", "bad", async (path) => {
    calls.push(path);
    return json(200, page(0, [], { event: {
      id: "ev 1", title: "Festival", accent_color: null, slot_part_gap_minutes: 15, parts: [],
    }, total: 0, counts: {} }));
  });
  assert.equal(result.status, "ok");
  assert.deepEqual(calls, ["/api/manage/events/ev%201/slots?status=all&offset=0"]);
  for (const invalidId of ["", ".", "..", "/", "ev\\bad"]) {
    let called = false;
    assert.deepEqual(await listSlots(invalidId, "all", async () => {
      called = true;
      return json(200, page(0, []));
    }), { status: "unavailable" });
    assert.equal(called, false, invalidId);
  }
});

test("MIG-0722 U01: 401/403/404/503/malformed response and transport error fail closed", async () => {
  for (const [code, expected] of [
    [401, "anonymous"], [403, "forbidden"], [404, "notFound"], [501, "unsupported"], [503, "unavailable"],
  ]) {
    const { fetchFn } = makePagedFetch(0, { respond: () => json(code, code === 403 ? {} : { error: "Denied" }) });
    const result = await listSlots("ev1", "all", fetchFn);
    assert.equal(result.status, expected);
    assert.equal("data" in result, false);
  }
  for (const body of [null, {}, [], page(0, [slot(1, { version: "not a number" })])]) {
    const { fetchFn } = makePagedFetch(0, { respond: () => json(200, body) });
    assert.deepEqual(await listSlots("ev1", "all", fetchFn), { status: "unavailable" });
  }
  assert.deepEqual(await listSlots("ev1", "all", async () => { throw Error("offline"); }),
    { status: "unavailable" });
});

test("MIG-0722 U01: never surface partial slots on failed third request or late abort", async () => {
  for (const status of [401, 404, 503]) {
    const { fetchFn, requests } = makePagedFetch(270, {
      respond: ({ offset }) => offset === 200
        ? json(status, { error: "Denied" })
        : json(200, page(offset, Array.from({ length: 100 }, (_, i) => slot(offset + i)))),
    });
    const result = await listSlots("ev1", "all", fetchFn);
    assert.equal(result.status, status === 401 ? "anonymous" : status === 404 ? "notFound" : "unavailable");
    assert.equal("data" in result, false);
    assert.equal(requests.length, 3);
  }
  const controller = new AbortController();
  const { fetchFn, requests } = makePagedFetch(170, {
    respond: ({ offset }) => {
      if (offset === 100) controller.abort();
      return json(200, page(offset, Array.from({ length: 100 }, (_, i) => slot(offset + i))));
    },
  });
  assert.deepEqual(await listSlots("ev1", "all", fetchFn, controller.signal),
    { status: "unavailable" });
  assert.equal(requests.length, 2);
});

test("MIG-0722 U01: cross-event, changed snapshot, invalid offset and duplicate IDs cannot be mixed", async () => {
  const normal = offset => Array.from({ length: 100 }, (_, i) => slot(offset + i));
  const badSecondPages = [
    page(100, normal(100), { event: { id: "other", title: "Festival", accent_color: null, slot_part_gap_minutes: 15, parts: ["A", "B"] } }),
    page(0, normal(100)),
    page(100, normal(100), { pageSize: 101 }),
    page(100, normal(100), { total: 521 }),
    page(100, normal(100), { counts: { available: 519 } }),
    page(100, normal(100), { slots: [slot(0), ...normal(100).slice(1)] }),
    page(100, normal(100), { slots: [slot(100, { event_id: "other" }), ...normal(100).slice(1)] }),
    page(100, normal(100), { statusFilter: "reserved" }),
  ];
  for (const second of badSecondPages) {
    const { fetchFn, requests } = makePagedFetch(200, {
      respond: ({ offset }) => json(200, offset === 0 ? page(0, normal(0)) : second),
    });
    assert.deepEqual(await listSlots("ev1", "all", fetchFn), { status: "unavailable" });
    assert.equal(requests.length, 2);
  }
});


test("MIG-0722 U01: malformed UTF-16 and NUL event IDs reject before any fetch", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    throw Error("invalid event ID must not reach the network");
  };
  for (const eventId of ["\uD800", "\uDC00", "bad\uD800tail", "bad\uDC00tail", "bad\0tail"]) {
    assert.deepEqual(await listSlots(eventId, "all", fetchFn),
      { status: "unavailable" }, JSON.stringify(eventId));
  }
  assert.equal(calls, 0);

  // Valid surrogate pairs are still encoded and accepted, unlike isolated
  // surrogates. The response must still match the originally requested ID.
  const unicodeId = "event-\uD83D\uDE80";
  let seenPath = "";
  const result = await listSlots(unicodeId, "all", async path => {
    seenPath = path;
    return json(200, page(0, [], {
      event: { id: unicodeId, title: "Festival", accent_color: null,
        slot_part_gap_minutes: 15, parts: [] },
      total: 0, counts: {},
    }));
  });
  assert.equal(result.status, "ok");
  assert.equal(seenPath, "/api/manage/events/event-%F0%9F%9A%80/slots?status=all&offset=0");
});


test("MIG-0722 U01: short page inconsistent with first snapshot is unavailable", async () => {
  const { fetchFn, requests } = makePagedFetch(450, {
    respond: ({ offset }) => json(200, page(offset, Array.from(
      { length: Math.max(0, Math.min(100, 450 - offset)) },
      (_, index) => slot(offset + index),
    ))), // All pages promise 520 available slots but return only 450.
  });
  assert.deepEqual(await listSlots("ev1", "all", fetchFn), { status: "unavailable" });
  assert.equal(requests.length, 5, "the incomplete final page must be rejected");
  for (const expected of [1, 2]) {
    const { fetchFn } = makePagedFetch(expected, {
      respond: () => json(200, page(0, [], {
        total: expected, counts: { available: expected },
      })),
    });
    assert.deepEqual(await listSlots("ev1", "all", fetchFn), { status: "unavailable" });
  }
});

test("MIG-0722 U01: filtered reads use matching status counts, not unfiltered total", async () => {
  const requests = [];
  const fetchFn = async (path) => {
    requests.push(path);
    const offset = Number(new URL(path, "https://flamenode.test").searchParams.get("offset"));
    return json(200, page(offset, Array.from(
      { length: Math.max(0, Math.min(100, 150 - offset)) },
      (_, index) => slot(offset + index, { status: "reserved" }),
    ), {
      statusFilter: "reserved", total: 220,
      counts: { available: 70, reserved: 150 },
    }));
  };
  const result = await listSlots("ev1", "reserved", fetchFn);
  assert.equal(result.status, "ok");
  assert.equal(result.data.slots.length, 150);
  assert.equal(result.data.total, 220);
  assert.equal(result.data.atLimit, false);
  assert.equal(requests.length, 2);

  const wrongCount = await listSlots("ev1", "reserved", async (path) => {
    const offset = Number(new URL(path, "https://flamenode.test").searchParams.get("offset"));
    return json(200, page(offset, Array.from(
      { length: Math.max(0, Math.min(100, 150 - offset)) },
      (_, index) => slot(offset + index, { status: "reserved" }),
    ), {
      statusFilter: "reserved", total: 220,
      counts: { available: 71, reserved: 149 },
    }));
  });
  assert.deepEqual(wrongCount, { status: "unavailable" });
});

test("MIG-0722 U01: at 500-row cap, reject counts smaller than delivered rows", async () => {
  const rows = offset => Array.from({ length: 100 }, (_, index) => slot(offset + index));
  const fetchFn = async path => {
    const offset = Number(new URL(path, "https://flamenode.test").searchParams.get("offset"));
    return json(200, page(offset, rows(offset), {
      total: 499, counts: { available: 499 },
    }));
  };
  assert.deepEqual(await listSlots("ev1", "all", fetchFn), { status: "unavailable" });
});

test("MIG-0722 U01: inconsistent or unsafe status counts cannot be displayed", async () => {
  const badCounts = [
    { available: 0 }, // total=1 but status sum=0
    { available: 1, reserved: 1 }, // status sum exceeds total
    { available: -1, reserved: 2 }, // negative count
    { available: 0.5, reserved: 0.5 }, // fractional counts
    { available: Number.MAX_SAFE_INTEGER + 1 }, // non-safe integer
  ];
  for (const counts of badCounts) {
    let calls = 0;
    const result = await listSlots("ev1", "all", async () => {
      calls++;
      return json(200, page(0, [slot(0)], { total: 1, counts }));
    });
    assert.deepEqual(result, { status: "unavailable" }, JSON.stringify(counts));
    assert.equal(calls, 1, "reject the inconsistent first snapshot");
  }
  const valid = await listSlots("ev1", "all", async () =>
    json(200, page(0, [slot(0)], { total: 1, counts: { available: 1, reserved: 0 } })));
  assert.equal(valid.status, "ok");
});

test("MIG-0722 U01: cancelled fetch cannot return successful final-page data", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await listSlots("ev1", "all", async () => {
    calls++;
    controller.abort();
    return json(200, page(0, [], { total: 0, counts: {} }));
  }, controller.signal);
  assert.deepEqual(result, { status: "unavailable" });
  assert.equal(calls, 1);
});


test("MIG-0722 U01: each delivered status stays within the first snapshot's counts", async () => {
  const available = n => Array(n).fill("available");
  const scenarios = [
    { label: "wrong bucket on a complete first page", counts: { reserved: 1 },
      statuses: ["available"], expected: "unavailable", calls: 1 },
    { label: "zero-count bucket", counts: { available: 0, submitted: 1 },
      statuses: ["available"], expected: "unavailable", calls: 1 },
    { label: "inherited property is not a declared count", counts: { available: 1 },
      statuses: ["constructor"], expected: "unavailable", calls: 1 },
    { label: "same total and counts across pages, but excess available",
      counts: { available: 100, reserved: 1 },
      statuses: available(101), expected: "unavailable", calls: 2 },
    { label: "excess in truncated fifth page despite valid total",
      counts: { available: 499, reserved: 2 },
      statuses: available(500), expected: "unavailable", calls: 5 },
    { label: "healthy full mixed-status snapshot",
      counts: { available: 100, reserved: 1, submitted: 1 },
      statuses: [...available(100), "reserved", "submitted"], expected: "ok", calls: 2 },
    { label: "healthy capped snapshot leaves one reserved row unseen",
      counts: { available: 499, reserved: 2 },
      statuses: [...available(499), "reserved"], expected: "ok", calls: 5 },
    { label: "healthy filtered read ignores other undelivered buckets",
      filter: "reserved", counts: { available: 15, reserved: 1 },
      statuses: ["reserved"], expected: "ok", calls: 1 },
    { label: "legacy unknown status explicitly counted",
      counts: { available: 1, legacy: 1 }, statuses: ["available", "legacy"],
      expected: "ok", calls: 1 },
    { label: "legacy unknown status missing its count",
      counts: { available: 2 }, statuses: ["available", "legacy"],
      expected: "unavailable", calls: 1 },
  ];
  for (const scenario of scenarios) {
    let calls = 0;
    const filter = scenario.filter ?? "all";
    const total = Object.values(scenario.counts).reduce((sum, count) => sum + count, 0);
    const result = await listSlots("ev1", filter, async path => {
      const offset = 100 * calls++;
      assert.equal(path, "/api/manage/events/ev1/slots?status=" + filter + "&offset=" + offset);
      return json(200, page(offset, scenario.statuses.slice(offset, offset + 100)
        .map((status, index) => slot(offset + index, { status })),
      { total, counts: scenario.counts, statusFilter: filter }));
    });
    assert.equal(calls, scenario.calls, scenario.label);
    assert.equal(result.status, scenario.expected, scenario.label);
    if (scenario.expected === "ok") {
      assert.deepEqual(result.data.slots.map(row => row.status), scenario.statuses, scenario.label);
      assert.deepEqual(result.data.counts, scenario.counts, scenario.label);
      assert.equal(result.data.atLimit, scenario.statuses.length === 500, scenario.label);
    } else {
      assert.deepEqual(result, { status: "unavailable" }, scenario.label);
    }
  }
});


test("MIG-0722 U01: reject reversed numeric slot ordering inside and across pages", async () => {
  const ascending = n => Array.from({ length: n }, (_, i) => slot(i));
  const scenarios = [
    { label: "descending start time inside page", rows: [slot(1), slot(0)], expected: "unavailable", calls: 1 },
    { label: "descending sort order for equal start", rows: [slot(0, { start_time: 10, sort_order: 2 }), slot(1, { start_time: 10, sort_order: 1 })], expected: "unavailable", calls: 1 },
    { label: "NULL start after numeric", rows: [slot(0), slot(1, { start_time: null })], expected: "unavailable", calls: 1 },
    { label: "NULL sort after numeric within equal start", rows: [slot(0, { start_time: 10 }), slot(1, { start_time: 10, sort_order: null })], expected: "unavailable", calls: 1 },
    { label: "cross-page time reversal with unique IDs and stable counts", rows: [...ascending(100), slot(100, { start_time: 1700000098 })], expected: "unavailable", calls: 2 },
    { label: "cross-page sort reversal at equal time", rows: [...ascending(100), slot(100, { start_time: 1700000099, sort_order: 98 })], expected: "unavailable", calls: 2 },
    { label: "fifth-page reversal within cap", rows: [...ascending(400), slot(400, { start_time: 1700000398 }), ...ascending(500).slice(401)], total: 501, expected: "unavailable", calls: 5 },
    { label: "NULL first, negative, zero and positive numeric values", rows: [slot(0, { start_time: null, sort_order: null }), slot(1, { start_time: null, sort_order: -2 }), slot(2, { start_time: -1, sort_order: 7 }), slot(3, { start_time: 0, sort_order: null }), slot(4, { start_time: 0, sort_order: 0 })], expected: "ok", calls: 1 },
    { label: "same numeric keys across pages are valid", rows: [...ascending(100), slot(100, { start_time: 1700000099, sort_order: 99 })], expected: "ok", calls: 2 },
    { label: "new start permits lower sort order", rows: [slot(0, { sort_order: 99 }), slot(1, { sort_order: 0 })], expected: "ok", calls: 1 },
    { label: "capped ascending receipt", rows: ascending(500), total: 501, expected: "ok", calls: 5 },
  ];
  for (const scenario of scenarios) {
    const total = scenario.total ?? scenario.rows.length;
    const { fetchFn, requests } = makePagedFetch(total, {
      respond: ({ offset }) => json(200, page(offset, scenario.rows.slice(offset, offset + 100), {
        total, counts: { available: total },
      })),
    });
    const result = await listSlots("ev1", "all", fetchFn);
    assert.equal(result.status, scenario.expected, scenario.label);
    assert.equal(requests.length, scenario.calls, scenario.label);
    if (scenario.expected === "ok") {
      assert.deepEqual(result.data.slots, scenario.rows, scenario.label);
      assert.equal(result.data.atLimit, scenario.rows.length === 500, scenario.label);
    } else {
      assert.deepEqual(result, { status: "unavailable" }, scenario.label);
    }
  }
});
