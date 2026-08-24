import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSyntheticAccountMenuXName,
  resolveAccountMenuDisplayName,
} from "./accountMenuDisplay.ts";

test("degraded account summary keeps the account display name", () => {
  assert.equal(
    resolveAccountMenuDisplayName({
      accountName: "Account Name",
      activeEntry: { x_user_id: "creator_id", x_name: "Creator Name" },
      degraded: true,
    }),
    "Account Name",
  );
});

test("normalized @handle synthetic names fall back to the account display name", () => {
  const activeEntry = { x_user_id: "Creator_ID", x_name: "@@CREATOR_ID" };
  assert.equal(isSyntheticAccountMenuXName(activeEntry), true);
  assert.equal(
    resolveAccountMenuDisplayName({
      accountName: "Account Name",
      activeEntry,
    }),
    "Account Name",
  );
});

test("real X display names remain preferred outside degraded mode", () => {
  assert.equal(
    resolveAccountMenuDisplayName({
      accountName: "Account Name",
      activeEntry: { x_user_id: "creator_id", x_name: "Creator Name" },
    }),
    "Creator Name",
  );
  assert.equal(
    isSyntheticAccountMenuXName({
      x_user_id: "creator_id",
      x_name: "creator_id",
    }),
    false,
  );
});

test("blank account and X names use the existing guest fallback", () => {
  assert.equal(
    resolveAccountMenuDisplayName({
      accountName: "  ",
      activeEntry: { x_user_id: "creator_id", x_name: "  " },
    }),
    "guest",
  );
});
