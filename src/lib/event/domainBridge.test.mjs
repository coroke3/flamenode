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

test("eventEditPermissions.ts retains its server boundary and re-exports the shared DB adapter", async () => {
  const { readFile } = await import("node:fs/promises");
  const bridgeUrl = new URL("./eventEditPermissions.ts", import.meta.url);
  const [bridge, source] = await Promise.all([
    readFile(bridgeUrl, "utf8"),
    readFile(new URL("../../../packages/server-core/src/event/editPermissions.ts", import.meta.url), "utf8"),
  ]);
  // Admin short-circuits before the staff DB read; staff go through the domain policy.
  assert.match(
    source,
    /if \(user\.role === "admin"\) \{\s*return adminEventEditPermissions\(\);\s*\}\s*const permissions = await getCollaboratorPermissions/,
  );
  assert.match(source, /return delegatedEventEditPermissions\(permissions\);/);
  assert.match(bridge, /import "server-only";/);
  assert.match(bridge, /export \{ hasAnyEventEditPermission \} from "@flamenode\/domain\/event";/);
  assert.doesNotMatch(source, /expandPermissionAliases/);
  assert.doesNotMatch(source, /server-only/);

  // The same platform-marker stub as CURRENT ownership execution tests, scoped
  // to this bridge. The real shared adapter and domain policies stay loaded.
  const { registerHooks } = await import("node:module");
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only" && context.parentURL === bridgeUrl.href) {
        return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const legacy = await import(bridgeUrl.href);
    const shared = await import("@flamenode/server-core/event/editPermissions");
    assert.deepEqual(Object.keys(legacy).sort(), ["hasAnyEventEditPermission", "resolveEventEditPermissions"]);
    assert.equal(legacy.resolveEventEditPermissions, shared.resolveEventEditPermissions);
    assert.equal(legacy.hasAnyEventEditPermission, domainEvent.hasAnyEventEditPermission);
  } finally {
    hooks.deregister();
  }
});

test("eventIdReuseCore.ts re-exports the domain event id reuse policy (U04)", async () => {
  const legacyIdReuse = await import("./eventIdReuseCore.ts");
  assertBridge(legacyIdReuse, domainEvent, "eventIdReuseCore");
  assert.deepEqual(Object.keys(legacyIdReuse).sort(), [
    "EVENT_ID_RENAME_CLEANUP_REASON",
    "EVENT_ID_RENAME_CLEANUP_TARGETS",
    "EVENT_ID_REUSE_DELAY_SECONDS",
    "eventIdRenameCleanupTargets",
    "hasCompletedEventIdRenameCleanup",
    "isEventIdReuseDelayElapsed",
  ]);
});
