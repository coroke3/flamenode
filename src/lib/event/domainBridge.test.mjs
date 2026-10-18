// MIG-0305: eventOwnershipCore.ts and utils/xid.ts must stay thin re-export
// bridges of @flamenode/domain (one source of truth for owner protection and
// the canonical X handle format).
import assert from "node:assert/strict";
import test from "node:test";
import * as domainEvent from "@flamenode/domain/event";
import * as domainXid from "@flamenode/domain/xid";
import * as legacyEventOwnership from "./eventOwnershipCore.ts";
import * as legacyXid from "../utils/xid.ts";

function assertBridge(legacy, domain, label) {
  const names = Object.keys(legacy);
  assert.ok(names.length > 0, `${label} exports nothing`);
  for (const name of names) {
    assert.ok(name in domain, `${label}.${name} is not provided by the domain package`);
    assert.equal(legacy[name], domain[name], `${label}.${name} is a copy, not a re-export`);
  }
}

test("eventOwnershipCore.ts re-exports the domain event ownership policy", () => {
  assertBridge(legacyEventOwnership, domainEvent, "eventOwnershipCore");
  assert.deepEqual(Object.keys(legacyEventOwnership).sort(), [
    "LAST_OWNER_ERROR",
    "assertEventWillRetainOwner",
    "assertOwnershipTransferInput",
    "assertSelfChangeConfirmation",
    "isActorTargetingSelf",
    "isEventOwner",
    "planXIdMergeEventStaffOwnerProtection",
    "validateEventStaffSubject",
    "validateEventStaffUniqueness",
  ]);
});

test("utils/xid.ts re-exports the domain X handle format", () => {
  assertBridge(legacyXid, domainXid, "utils/xid");
  // The domain event module must not define its own copy of isCanonicalXId.
  assert.equal("isCanonicalXId" in domainEvent, false);
});

test("eventEditPermissions.ts uses the domain section policy (U02)", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./eventEditPermissions.ts", import.meta.url), "utf8"),
  );
  // Admin short-circuits before the staff DB read; staff go through the domain policy.
  assert.match(
    source,
    /if \(user\.role === "admin"\) \{\s*return adminEventEditPermissions\(\);\s*\}\s*const permissions = await getCollaboratorPermissions/,
  );
  assert.match(source, /return delegatedEventEditPermissions\(permissions\);/);
  assert.match(source, /export \{ hasAnyEventEditPermission \} from "@flamenode\/domain\/event";/);
  assert.doesNotMatch(source, /expandPermissionAliases/);
});
