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

  test("collectMemberAggregationAffectedXUserIds unions previous and next member x IDs", () => {
    const affected = collectMemberAggregationAffectedXUserIds({
      previousCreatorXUserId: "creator",
      nextCreatorXUserId: "creator",
      previousMemberXUserIds: ["removed", "stays"],
      nextMembers: [{ x_user_id: "stays" }, { x_user_id: "added" }],
    });
    assert.deepEqual([...affected].sort(), ["added", "creator", "removed", "stays"]);
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
    assert.match(fnBody, /if \(isPublicVideo && plan\.rebuildFlags\.creatorAggregationChanged/);
    assert.match(fnBody, /collectMemberAggregationAffectedXUserIds/);
    assert.match(fnBody, /previousMemberXUserIds/);
    assert.match(fnBody, /if \(isPublicVideo && plan\.rebuildFlags\.identityChanged/);
    assert.match(fnBody, /if \(isPublicVideo && plan\.rebuildFlags\.randomPoolCardChanged/);
    assert.match(fnBody, /if \(plan\.rebuildFlags\.eventMembershipChanged\)/);
    assert.doesNotMatch(
      fnBody,
      /if \(plan\.rebuildFlags\.randomPoolCardChanged\)/,
    );
  });
}
