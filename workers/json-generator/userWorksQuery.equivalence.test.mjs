import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PVSF_SUMMARY_EVENT_ID,
  assertQueryEquivalence,
  createEquivalenceDb,
  insertEvent,
  insertMember,
  insertVideo,
  insertVideoEvent,
  legacyRebuildCollabWorks,
  legacyRebuildOwnWorks,
  optimizedRebuildCollabWorks,
  optimizedRebuildOwnWorks,
} from "./queryEquivalenceFixtures.mjs";

test("rebuildUser own works: 0件は total=0", () => {
  const db = createEquivalenceDb();
  const legacy = legacyRebuildOwnWorks(db, "user-a");
  const optimized = optimizedRebuildOwnWorks(db, "user-a");
  assertQueryEquivalence(optimized, legacy, "own-empty");
  assert.equal(legacy.total, 0);
  db.close();
});

test("rebuildUser own works: 1件・複数件・PVSF除外・非公開除外", () => {
  const db = createEquivalenceDb();
  insertEvent(db, { id: "evt-public" });
  insertEvent(db, { id: PVSF_SUMMARY_EVENT_ID });
  insertVideo(db, {
    id: "own-1",
    creator_x_user_id: "UserA",
    scheduled_time: 100,
    created_at: 10,
  });
  insertVideo(db, {
    id: "own-2",
    creator_x_user_id: "UserA",
    scheduled_time: 100,
    created_at: 20,
  });
  insertVideo(db, {
    id: "own-private",
    creator_x_user_id: "UserA",
    visibility_status: "private",
    scheduled_time: 90,
  });
  insertVideo(db, {
    id: "own-pvsf-primary",
    creator_x_user_id: "UserA",
    primary_event_id: PVSF_SUMMARY_EVENT_ID,
    scheduled_time: 80,
  });
  insertVideo(db, {
    id: "own-pvsf-link",
    creator_x_user_id: "UserA",
    scheduled_time: 70,
  });
  insertVideoEvent(db, "own-pvsf-link", PVSF_SUMMARY_EVENT_ID);
  insertVideo(db, {
    id: "other-user",
    creator_x_user_id: "user-b",
    scheduled_time: 200,
  });

  const legacy = legacyRebuildOwnWorks(db, "UserA");
  const optimized = optimizedRebuildOwnWorks(db, "UserA");
  assertQueryEquivalence(optimized, legacy, "own-mixed");
  assert.equal(legacy.items.length, 2);
  assert.deepEqual(
    legacy.items.map((row) => row.id),
    ["own-2", "own-1"],
  );
  db.close();
});

test("rebuildUser own works: creator_x_user_id は大文字小文字を区別する", () => {
  const db = createEquivalenceDb();
  insertVideo(db, {
    id: "lower",
    creator_x_user_id: "usera",
    scheduled_time: 10,
  });
  insertVideo(db, {
    id: "upper",
    creator_x_user_id: "UserA",
    scheduled_time: 20,
  });

  const legacyLower = legacyRebuildOwnWorks(db, "usera");
  const optimizedLower = optimizedRebuildOwnWorks(db, "usera");
  assertQueryEquivalence(optimizedLower, legacyLower, "own-case-lower");
  assert.equal(legacyLower.total, 1);
  assert.equal(legacyLower.items[0].id, "lower");

  const legacyUpper = legacyRebuildOwnWorks(db, "UserA");
  const optimizedUpper = optimizedRebuildOwnWorks(db, "UserA");
  assertQueryEquivalence(optimizedUpper, legacyUpper, "own-case-upper");
  assert.equal(legacyUpper.total, 1);
  assert.equal(legacyUpper.items[0].id, "upper");
  db.close();
});

test("rebuildUser collab: 0件・メンバー一致・自分作品除外・非公開メンバー除外", () => {
  const db = createEquivalenceDb();
  insertVideo(db, {
    id: "collab-1",
    creator_x_user_id: "owner-1",
    scheduled_time: 50,
    created_at: 1,
  });
  insertMember(db, { id: "m1", video_id: "collab-1", x_user_id: "MemberA" });
  insertVideo(db, {
    id: "own-as-creator",
    creator_x_user_id: "MemberA",
    scheduled_time: 60,
  });
  insertMember(db, {
    id: "m2",
    video_id: "own-as-creator",
    x_user_id: "membera",
  });
  insertVideo(db, {
    id: "private-member",
    creator_x_user_id: "owner-2",
    scheduled_time: 40,
  });
  insertMember(db, {
    id: "m3",
    video_id: "private-member",
    x_user_id: "MemberA",
    is_public_member: 0,
  });

  const legacy = legacyRebuildCollabWorks(db, "MemberA");
  const optimized = optimizedRebuildCollabWorks(db, "MemberA");
  assertQueryEquivalence(optimized, legacy, "collab-mixed");
  assert.equal(legacy.total, 1);
  assert.equal(legacy.items[0].id, "collab-1");
  db.close();
});

test("rebuildUser collab: x_user_id の大文字小文字は LOWER 比較、空白は trim しない", () => {
  const db = createEquivalenceDb();
  insertVideo(db, {
    id: "collab-case",
    creator_x_user_id: "owner",
    scheduled_time: 30,
  });
  insertMember(db, {
    id: "m-case",
    video_id: "collab-case",
    x_user_id: "MEMBERA",
  });
  insertVideo(db, {
    id: "collab-ws",
    creator_x_user_id: " owner ",
    scheduled_time: 20,
  });
  insertMember(db, {
    id: "m-ws",
    video_id: "collab-ws",
    x_user_id: " MemberA ",
  });

  const legacy = legacyRebuildCollabWorks(db, "membera");
  const optimized = optimizedRebuildCollabWorks(db, "membera");
  assertQueryEquivalence(optimized, legacy, "collab-case-whitespace");
  assert.equal(legacy.total, 1);
  assert.equal(legacy.items[0].id, "collab-case");
  db.close();
});

test("rebuildUser collab: scheduled_time 同値は created_at DESC", () => {
  const db = createEquivalenceDb();
  for (const [id, created_at] of [
    ["c-old", 1],
    ["c-new", 3],
    ["c-mid", 2],
  ]) {
    insertVideo(db, {
      id,
      creator_x_user_id: "owner",
      scheduled_time: 100,
      created_at,
    });
    insertMember(db, { id: `m-${id}`, video_id: id, x_user_id: "guest" });
  }

  const legacy = legacyRebuildCollabWorks(db, "guest");
  const optimized = optimizedRebuildCollabWorks(db, "guest");
  assertQueryEquivalence(optimized, legacy, "collab-tie-break");
  assert.deepEqual(
    legacy.items.map((row) => row.id),
    ["c-new", "c-mid", "c-old"],
  );
  db.close();
});
