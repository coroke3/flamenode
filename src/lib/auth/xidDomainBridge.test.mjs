// MIG-0306: the legacy X identity / write-guard modules must stay thin
// re-export bridges of @flamenode/domain (one source of truth).
import assert from "node:assert/strict";
import test from "node:test";
import * as domainXid from "@flamenode/domain/xid";
import * as domainAdmin from "@flamenode/domain/admin";
import * as legacyXid from "../utils/xid.ts";
import * as legacyEntries from "../xid/entries.ts";
import * as legacySnapshot from "./activeXSnapshotCore.ts";
import * as legacyRequest from "./xIdentityRequestCore.ts";
import * as legacyResolution from "./xIdentityResolutionCore.ts";
import * as legacyWriteGuard from "./writeGuardCore.ts";
import * as legacyMergeSafety from "../xid/mergeSafety.ts";

function assertBridge(legacy, domain, label, { except = [] } = {}) {
  const names = Object.keys(legacy).filter((name) => !except.includes(name));
  assert.ok(names.length > 0, `${label} exports nothing`);
  for (const name of names) {
    assert.ok(name in domain, `${label}.${name} is not provided by the domain package`);
    assert.equal(legacy[name], domain[name], `${label}.${name} is a copy, not a re-export`);
  }
}

test("X identity legacy modules re-export @flamenode/domain/xid", () => {
  assertBridge(legacyXid, domainXid, "utils/xid");
  assertBridge(legacyEntries, domainXid, "xid/entries");
  assertBridge(legacySnapshot, domainXid, "activeXSnapshotCore");
  assertBridge(legacyRequest, domainXid, "xIdentityRequestCore");
  assertBridge(legacyResolution, domainXid, "xIdentityResolutionCore");
  // xIdMergeStateMatchesSql is the D1 CAS adapter and intentionally stays local.
  assertBridge(legacyMergeSafety, domainXid, "xid/mergeSafety", {
    except: ["xIdMergeStateMatchesSql"],
  });
});

test("writeGuardCore re-exports @flamenode/domain/admin", () => {
  // evaluateCostGuardCore is kept as an explicit delegating declaration.
  assertBridge(legacyWriteGuard, domainAdmin, "writeGuardCore", {
    except: ["evaluateCostGuardCore"],
  });
  const input = {
    feature: "edit_video",
    operationMode: "normal",
    disabledFeaturesJson: '["edit_video"]',
    exceptionUntil: null,
    exceptionFeaturesJson: null,
    now: 0,
  };
  assert.deepEqual(
    legacyWriteGuard.evaluateCostGuardCore(input),
    domainAdmin.evaluateCostGuardCore(input),
  );
});
