// MIG-0306: legacy admin/user helper modules must stay thin re-export bridges
// of @flamenode/domain (one source of truth).
import assert from "node:assert/strict";
import test from "node:test";
import * as domainAdmin from "@flamenode/domain/admin";
import * as legacyModerationInput from "./moderationCaseInput.ts";
import * as legacyOperationModeTypes from "../operationMode/types.ts";
import * as legacyOperationModeResolve from "../operationMode/resolve.ts";
import * as legacyNotificationStatus from "../notifications/status.ts";

function assertBridge(legacy, domain, label) {
  const names = Object.keys(legacy);
  assert.ok(names.length > 0, `${label} exports nothing`);
  for (const name of names) {
    assert.ok(name in domain, `${label}.${name} is not provided by the domain package`);
    assert.equal(legacy[name], domain[name], `${label}.${name} is a copy, not a re-export`);
  }
}

test("admin moderation legacy modules re-export @flamenode/domain/admin", () => {
  assertBridge(legacyModerationInput, domainAdmin, "admin/moderationCaseInput");
  assertBridge(legacyOperationModeTypes, domainAdmin, "operationMode/types");
  assertBridge(legacyOperationModeResolve, domainAdmin, "operationMode/resolve");
  assertBridge(legacyNotificationStatus, domainAdmin, "notifications/status");
});
