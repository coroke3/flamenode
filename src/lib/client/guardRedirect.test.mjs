import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getGuardRedirectPath,
  redirectForGuardReason,
  shouldShowGuardErrorOnly,
} from "./guardRedirect.ts";

test("getGuardRedirectPath redirects unauthenticated to entry with next", () => {
  assert.equal(
    getGuardRedirectPath("unauthenticated", "/entry/unslotted"),
    "/entry?next=%2Fentry%2Funslotted",
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
      getGuardRedirectPath(reason, "/entry/slotted?slot=s1"),
      "/dashboard/settings?next=%2Fentry%2Fslotted%3Fslot%3Ds1",
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
    assert.equal(getGuardRedirectPath(reason, "/entry"), null);
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
    "/entry",
  );
  assert.equal(ok, true);
  assert.deepEqual(pushed, ["/dashboard/settings?next=%2Fentry"]);
});
