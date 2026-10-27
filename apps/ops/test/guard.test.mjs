import test from "node:test";
import assert from "node:assert/strict";
import { createOpsApi, parseAccountSummary } from "../.test-dist/apps/ops/src/api/account.js";
import { AUTH_UNAVAILABLE, decideOpsAccess, decideNavigation } from "../.test-dist/apps/ops/src/routes/guard.js";

const summary = (over = {}) => ({
  loggedIn: true, role: "user", canAccessAdmin: false, canAccessManage: true, ...over,
});
const decide = (surface, raw) => decideOpsAccess(surface, parseAccountSummary(raw));

test("MIG-0707 T02: no session, 503/unavailable and malformed response never render Ops", () => {
  for (const surface of ["manage", "admin"]) {
    assert.equal(decide(surface, { loggedIn: false }), "/entry");
    assert.equal(decide(surface, { loggedIn: false, unavailable: true }), AUTH_UNAVAILABLE);
    for (const raw of [null, {}, [], { loggedIn: true }, summary({ role: "owner" }),
      summary({ canAccessManage: "yes" }),
      summary({ degradedReason: "management_access_unavailable" }),
      { loggedIn: false, unavailable: "invalid" }]) {
      assert.equal(decide(surface, raw), AUTH_UNAVAILABLE);
    }
  }
});
test("MIG-0707 T02: CURRENT normal Manage/Admin permission gate parity", () => {
  assert.equal(decide("manage", summary()), "allow");
  assert.equal(decide("manage", summary({ role: "admin", canAccessManage: false, canAccessAdmin: true })), "allow");
  assert.equal(decide("manage", summary({ canAccessManage: false })), "/dashboard");
  assert.equal(decide("admin", summary({ role: "moderator", canAccessAdmin: true })), "/dashboard");
  assert.equal(decide("admin", summary({ role: "admin", canAccessAdmin: true })), "allow");
});
test("MIG-0707 D-17-14: management outage and legacy degraded fail closed", () => {
  for (const surface of ["manage", "admin"]) {
    for (const role of ["admin", "user"]) {
      assert.equal(decide(surface, summary({ role, degraded: true,
        degradedReason: "management_access_unavailable" })), AUTH_UNAVAILABLE);
      assert.equal(decide(surface, summary({ role, degraded: true })), AUTH_UNAVAILABLE);
      assert.equal(decide(surface, summary({ role, degraded: true,
        degradedReason: "unexpected_future_reason" })), AUTH_UNAVAILABLE);
    }
  }
});
test("MIG-0707 D-17-14: pending enrichment failure only defers non-admin Manage to navigation", () => {
  const pending = { degraded: true, degradedReason: "pending_requests_unavailable" };
  assert.equal(decide("manage", summary({ ...pending, canAccessManage: false })), "check-navigation");
  assert.equal(decide("manage", summary({ ...pending, role: "admin", canAccessManage: false })), "allow");
  assert.equal(decide("admin", summary({ ...pending, role: "admin" })), "allow");
  assert.equal(decide("admin", summary(pending)), "/dashboard");
  assert.equal(decideNavigation("allow"), "allow");
  assert.equal(decideNavigation("deny"), "/dashboard");
  assert.equal(decideNavigation("anonymous"), "/entry");
  assert.equal(decideNavigation("unavailable"), AUTH_UNAVAILABLE);
});
test("MIG-0707 U02: read-only RH-001 request, cookie scope and status mapping", async () => {
  const calls = [];
  const api = createOpsApi(async (path, init) => {
    calls.push([path, init]);
    return new Response(JSON.stringify(summary()), { status: 200 });
  });
  assert.equal((await api.getSummary()).status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/account/summary");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].credentials, "same-origin");
  for (const code of [401, 403, 500, 503]) {
    const failed = createOpsApi(async () => new Response("{}", { status: code }));
    assert.deepEqual(await failed.getSummary(), { status: "unavailable" });
  }
  assert.deepEqual(await createOpsApi(async () => { throw new Error("offline"); }).getSummary(),
    { status: "unavailable" });
});
test("MIG-0707 U02: navigation verifies access/403 reason, never trusts other errors", async () => {
  const withResponse = (status, body) => createOpsApi(async () =>
    new Response(JSON.stringify(body), { status })).checkManageNavigation();
  assert.equal(await withResponse(200, { access: { canAccessManage: true } }), "allow");
  assert.equal(await withResponse(200, { access: { canAccessAdmin: true } }), "allow");
  assert.equal(await withResponse(200, { access: { canAccessManage: false } }), "unavailable");
  assert.equal(await withResponse(403, { reason: "manage_access_required" }), "deny");
  assert.equal(await withResponse(403, { error: "Forbidden" }), "unavailable");
  assert.equal(await withResponse(401, {}), "anonymous");
  assert.equal(await withResponse(503, {}), "unavailable");
  assert.equal(await withResponse(200, []), "unavailable");
});
