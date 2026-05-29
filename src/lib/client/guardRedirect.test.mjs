import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getGuardRedirectPath,
  redirectForGuardReason,
  shouldShowGuardErrorOnly,
} from "./guardRedirect.ts";

test("getGuardRedirectPath redirects unauthenticated to entry with next", () => {
  assert.equal(
    getGuardRedirectPath("unauthenticated", "/dashboard/post?mode=free"),
    "/entry?next=%2Fdashboard%2Fpost%3Fmode%3Dfree",
  );
});

test("getGuardRedirectPath redirects TOS reasons to rules", () => {
  assert.equal(getGuardRedirectPath("tos_required", "/post"), "/rules?next=%2Fpost");
  assert.equal(
    getGuardRedirectPath("tos_reaccept_required", "/post"),
    "/rules?next=%2Fpost",
  );
});

test("getGuardRedirectPath redirects Active X reasons to settings", () => {
  for (const reason of [
    "active_x_required",
    "active_x_rejected",
    "active_x_not_approved",
  ]) {
    assert.equal(
      getGuardRedirectPath(reason, "/dashboard/post/slotted?slot=s1"),
      "/dashboard/settings?next=%2Fdashboard%2Fpost%2Fslotted%3Fslot%3Ds1",
    );
  }
});

test("getGuardRedirectPath does not redirect terminal error reasons", () => {
  for (const reason of [
    "banned",
    "maintenance_mode",
    "cost_guard_blocked",
    "db_unavailable",
  ]) {
    assert.equal(getGuardRedirectPath(reason, "/dashboard/post"), null);
    assert.equal(shouldShowGuardErrorOnly(reason), true);
  }
});

test("getGuardRedirectPath sanitizes unsafe next paths", () => {
  assert.equal(
    getGuardRedirectPath("unauthenticated", "https://evil.example/path"),
    "/entry?next=%2F",
  );
  assert.equal(
    getGuardRedirectPath("unauthenticated", "//evil.example/path"),
    "/entry?next=%2F",
  );
});

test("redirectForGuardReason pushes when redirectable", () => {
  const pushed = [];
  const ok = redirectForGuardReason(
    { push: (path) => pushed.push(path) },
    "active_x_required",
    "/dashboard/post",
  );
  assert.equal(ok, true);
  assert.deepEqual(pushed, ["/dashboard/settings?next=%2Fdashboard%2Fpost"]);
});
