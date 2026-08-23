import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    collectMemberAggregationAffectedXUserIds,
    extractPreviousPublicMemberXUserIdsFromMembersPlan,
  } = await import("./memberAggregationFanOut.ts");

  const source = await readFile(new URL("./videoSavePlan.ts", import.meta.url), "utf8");

  test("initial YouTube attach exception reaches the update payload", () => {
    assert.match(source, /allowInitialYoutubeAttach\?: boolean/);
    assert.match(
      source,
      /allowInitialYoutubeAttach \|\|\s*\(privilegeMode !== "normal" && sections\.youtube\)/,
    );
  });

  test("collectMemberAggregationAffectedXUserIds returns only changed member x IDs", () => {
    const affected = collectMemberAggregationAffectedXUserIds({
      previousCreatorXUserId: "creator",
      nextCreatorXUserId: "creator",
      previousMemberXUserIds: ["removed", "stays"],
      nextMembers: [{ x_user_id: "stays" }, { x_user_id: "added" }],
    });
    assert.deepEqual([...affected].sort(), ["added", "removed"]);
  });

  test("same public member x ID set produces no member aggregation targets", () => {
    const affected = collectMemberAggregationAffectedXUserIds({
      previousCreatorXUserId: "creator",
      nextCreatorXUserId: "creator",
      previousMemberXUserIds: ["member-a", "member-b"],
      nextMembers: [{ x_user_id: "member-b" }, { x_user_id: "member-a" }],
    });
    assert.deepEqual([...affected], []);
  });

  test("creator X ID changes still target only the old and new creator", () => {
    const affected = collectMemberAggregationAffectedXUserIds({
      previousCreatorXUserId: "creator-old",
      nextCreatorXUserId: "creator-new",
      previousMemberXUserIds: ["member-a"],
      nextMembers: [{ x_user_id: "member-a" }],
    });
    assert.deepEqual([...affected].sort(), ["creator-new", "creator-old"]);
  });

  test("extractPreviousPublicMemberXUserIdsFromMembersPlan reads member audit snapshot", () => {
    const ids = extractPreviousPublicMemberXUserIdsFromMembersPlan({
      statements: [],
      expectedChanges: [],
      audits: [
        {
          table_name: "video_members_set",
          target_id: "video-1",
          operation: "MERGE",
          before: {
            id: "video-1",
            rows: [
              {
                id: "vm-1",
                video_id: "video-1",
                x_user_id: "member-a",
                name: "A",
                role: null,
                comment: null,
                order_index: 0,
                can_edit: 0,
                is_public_member: 1,
                edit_granted_by_auth_user_id: null,
                edit_granted_at: null,
                edit_updated_at: null,
              },
            ],
          },
          after: null,
          actor_user_id: "user-1",
          context: "video-save:members",
          retention_class: "restorable",
          restore_strategy: "custom_adapter",
          strict: true,
        },
      ],
    });
    assert.deepEqual(ids, ["member-a"]);
  });

  test("applyVideoUpdatePlan は non-public 編集で global fan-out を抑制する", () => {
    const fnStart = source.indexOf("export async function applyVideoUpdatePlan");
    const fnBody = source.slice(fnStart);

    assert.match(fnBody, /const isPublicVideo = plan\.target\.visibility_status === "public"/);
    assert.match(fnBody, /const creatorAggregationChanged = memberAggregationChanged/);
    assert.match(fnBody, /let memberProjectionChanged = false/);
    assert.match(fnBody, /memberProjectionChanged = hasMemberAudit/);
    assert.match(
      fnBody,
      /isPublicVideo && \(plan\.rebuildFlags\.eventProjectionChanged \|\| memberProjectionChanged\)/,
    );
    assert.match(fnBody, /if \(isPublicVideo && creatorAggregationChanged/);
    assert.match(fnBody, /collectMemberAggregationAffectedXUserIds/);
    assert.match(fnBody, /previousMemberXUserIds/);
    assert.match(fnBody, /if \(isPublicVideo && plan\.rebuildFlags\.identityChanged/);
    assert.match(fnBody, /const randomPoolCardChanged =/);
    assert.match(fnBody, /if \(isPublicVideo && randomPoolCardChanged/);
    assert.match(fnBody, /if \(plan\.rebuildFlags\.eventMembershipChanged\)/);
    assert.doesNotMatch(
      fnBody,
      /if \(plan\.rebuildFlags\.randomPoolCardChanged\)/,
    );
  });

  test("member X ID set fan-out keeps only user pages and users_index", () => {
    const fnStart = source.indexOf("export async function applyVideoUpdatePlan");
    const fnBody = source.slice(fnStart);
    const memberStart = fnBody.indexOf(
      "if (isPublicVideo && creatorAggregationChanged && plan.memberSubmission)",
    );
    const identityStart = fnBody.indexOf(
      "if (isPublicVideo && plan.rebuildFlags.identityChanged)",
      memberStart,
    );
    assert.ok(memberStart >= 0 && identityStart > memberStart);
    const memberBranch = fnBody.slice(memberStart, identityStart);
    assert.match(memberBranch, /targetType: "user"/);
    assert.match(memberBranch, /targetType: "users_index"/);
    assert.doesNotMatch(
      memberBranch,
      /targetType: "(?:search_index|event_base|random_video_pool|list_recent|list_popular|top_recommended|top_latest|top_nostalgic|top_stats|recommend_core)"/,
    );
  });

  test("event-link-only updates do not replace general custom answers", () => {
    const fnStart = source.indexOf("export async function applyVideoUpdatePlan");
    const fnBody = source.slice(fnStart);
    assert.match(
      fnBody,
      /const shouldReplaceStagePermission =\s*ownerAllows\("stage_permission", sections\.descriptions\) \|\|\s*\(plan\.stagePermissionDeleteEventIds\?\.length \?\? 0\) > 0/,
    );
    const stageStart = fnBody.indexOf("if (shouldReplaceStagePermission)");
    assert.ok(stageStart >= 0);
    const stageBranch = fnBody.slice(stageStart, fnBody.indexOf("const queueItems", stageStart));
    const generalStart = stageBranch.indexOf("buildReplaceGeneralCustomAnswersPlan");
    assert.ok(generalStart >= 0);
    assert.match(
      stageBranch.slice(Math.max(0, generalStart - 180), generalStart + 80),
      /if \(ownerAllows\("custom_answers", sections\.descriptions\)/,
    );
  });
}
