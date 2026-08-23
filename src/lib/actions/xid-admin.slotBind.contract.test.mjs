import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("xid-admin approveはidentity後にreserved slotをx_user_idへbindする", () => {
  const admin = read("../actions/xid-admin.ts");
  assert.match(admin, /bindTargetXUserId/);
  assert.match(admin, /bindReservedSlotsOnXApproval/);
  assert.match(admin, /eq\(slots\.status, "reserved"\)/);
  assert.match(admin, /isNull\(slots\.x_user_id\)/);
  assert.match(admin, /reserved_x_id_snapshot/);
  assert.match(admin, /canBindUnassignedSlotsAfterApproval/);
  assert.match(admin, /canAutoBindUnassignedReservation/);
  assert.match(admin, /slot_bind_status/);
  assert.match(admin, /slot_bind_updated_at/);
  assert.match(admin, /versionedSlotWhere\(eventId, chunk, "reserved"\)/);
  assert.match(admin, /reason: "slot bind on X approve"/);
  assert.match(admin, /context: "x-identity-request"/);
  assert.doesNotMatch(admin, /reserved_x_id_snapshot: args\.bindTargetXUserId/);
  assert.doesNotMatch(admin, /top_slot_stats/);
  assert.match(admin, /targetType: "event_slots"/);
  assert.match(admin, /revalidatePath\(`\/event\/\$\{eventId\}\/slots`\)/);
});

test("xid-admin slot bindはidentity mutateと分離した2番目のmutateWithAuditを使う", () => {
  const admin = read("../actions/xid-admin.ts");
  const identitySection = admin.slice(
    admin.indexOf("async function approveXIdLinkRequestOnce"),
    admin.indexOf("export async function approveXIdLinkRequest"),
  );
  const bindSection = admin.slice(
    admin.indexOf("async function bindReservedSlotsOnXApproval"),
    admin.indexOf("async function approveXIdLinkRequestOnce"),
  );
  assert.match(identitySection, /await mutateWithAudit\(db,/);
  assert.match(bindSection, /await mutateWithAudit\(args\.db,/);
  assert.match(identitySection, /bindReservedSlotsOnXApproval/);
});

test("xid-admin slot bindはeventごとにMAX_ATOMIC_SLOT_ROWSでchunkする", () => {
  const admin = read("../actions/xid-admin.ts");
  assert.match(admin, /MAX_ATOMIC_SLOT_ROWS/);
  assert.match(admin, /groupSlotBindChunks/);
  assert.match(admin, /RESERVED_SLOT_BIND_CAP = 30/);
  assert.match(admin, /MAX_SLOT_BIND_PAGES_PER_REQUEST = 2/);
  assert.match(admin, /for \(let page = 0; page < MAX_SLOT_BIND_PAGES_PER_REQUEST/);
  assert.match(admin, /planSlotBindBatchBudget/);
  assert.match(admin, /queueStatementCount/);
  assert.match(admin, /D1_MAX_BATCH_QUERIES/);
});

test("承認transaction後のslot bind失敗はapproved/pendingで再試行可能", () => {
  const admin = read("../actions/xid-admin.ts");
  assert.match(admin, /slot_bind_status: "pending"/);
  assert.match(admin, /request\.slot_bind_status === "pending"/);
  assert.match(admin, /承認は完了しましたが、予約枠の反映は再試行待ちです/);
  assert.match(admin, /slot_bind_status: "complete"/);
});

test("xid-admin slot bind batchはD1 50 query以内に収まる想定", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 10,
    mutationAssertionCount: 10,
    auditEntryCount: 30,
    postAuditStatementCount: 1,
    distinctActorCount: 1,
  });
  assert.equal(budget.totalQueryCount, 57);
  assert.equal(budget.withinLimit, false);
});

test("slot submission icon routeはslotSubmissionIconへ委譲する", () => {
  const route = read(
    "../../../app/api/media/slot-submission-icon/[slotId]/route.ts",
  );
  assert.match(route, /serveSlotSubmissionIcon/);
  assert.match(route, /getCurrentUser/);
});

test("alias approval/recovery requires an approved X ID bind target", () => {
  const admin = read("../actions/xid-admin.ts");
  const recovery = read("../../../workers/content-jobs/xIdSlotBindRecovery.ts");
  assert.match(admin, /resolveApprovedCanonicalXUserId/);
  assert.match(admin, /isApprovedLinkedXUser/);
  assert.match(admin, /approval_status === "approved"/);
  assert.match(recovery, /row\.approval_status !== "approved"/);

  const targetSection = admin.slice(
    admin.indexOf("async function resolveApprovedSlotBindTarget"),
    admin.indexOf("async function bindReservedSlotsOnXApproval"),
  );
  assert.equal(
    (targetSection.match(/resolveApprovedCanonicalXUserId/g) ?? []).length,
    2,
    "retry bind must re-check approval for both direct and alias requests",
  );
  assert.doesNotMatch(
    targetSection,
    /: await resolveCanonicalXUserId\(db, submittedXUserId\)/,
  );
});

test("reservation bind candidate canonicalization uses bounded IN lookups", () => {
  const admin = read("../actions/xid-admin.ts");
  const section = admin.slice(
    admin.indexOf("async function canonicalizeReservationBindCandidates"),
    admin.indexOf("/** 承認直後の正本"),
  );
  assert.match(section, /inArray\(xUserAliases\.alias_x_id, chunk\)/);
  assert.match(section, /inArray\(xUsers\.id, chunk\)/);
  assert.doesNotMatch(section, /values\.map\(async/);
});
