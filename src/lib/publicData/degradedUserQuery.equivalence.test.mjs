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
  legacyDegradedCollabWorks,
  legacyDegradedOwnWorks,
  optimizedDegradedCollabWorks,
  optimizedDegradedOwnWorks,
} from "../../../workers/json-generator/queryEquivalenceFixtures.mjs";

test("degraded user works: 0件は total=0", () => {
  const db = createEquivalenceDb();
  const legacy = legacyDegradedOwnWorks(db, "usera");
  const optimized = optimizedDegradedOwnWorks(db, "usera");
  assertQueryEquivalence(optimized, legacy, "degraded-own-empty");
  assert.equal(legacy.total, 0);
  db.close();
});

test("degraded user works: 1件・複数件・PVSF除外・非公開除外", () => {
  const db = createEquivalenceDb();
  insertEvent(db, { id: PVSF_SUMMARY_EVENT_ID });
  insertVideo(db, {
    id: "w1",
    creator_x_user_id: "UserA",
    creator_display_name: " Alpha ",
    scheduled_time: 100,
    created_at: 2,
  });
  insertVideo(db, {
    id: "w2",
    creator_x_user_id: "usera",
    scheduled_time: 100,
    created_at: 1,
  });
  insertVideo(db, {
    id: "w-private",
    creator_x_user_id: "usera",
    visibility_status: "private",
  });
  insertVideo(db, {
    id: "w-pvsf",
    creator_x_user_id: "usera",
    primary_event_id: PVSF_SUMMARY_EVENT_ID,
  });
  insertVideo(db, {
    id: "w-pvsf-link",
    creator_x_user_id: "usera",
  });
  insertVideoEvent(db, "w-pvsf-link", PVSF_SUMMARY_EVENT_ID);

  const legacy = legacyDegradedOwnWorks(db, "usera");
  const optimized = optimizedDegradedOwnWorks(db, "usera");
  assertQueryEquivalence(optimized, legacy, "degraded-own-mixed");
  assert.equal(legacy.total, 2);
  assert.equal(legacy.items[0].display_name, "Alpha");
  db.close();
});

test("degraded user collab: メンバー一致・creator 除外・非公開メンバー除外", () => {
  const db = createEquivalenceDb();
  insertVideo(db, {
    id: "c1",
    creator_x_user_id: "owner",
    scheduled_time: 40,
  });
  insertMember(db, { id: "cm1", video_id: "c1", x_user_id: "Guest" });
  insertVideo(db, {
    id: "self",
    creator_x_user_id: "guest",
    scheduled_time: 50,
  });
  insertMember(db, {
    id: "cm2",
    video_id: "self",
    x_user_id: "GUEST",
  });
  insertVideo(db, {
    id: "hidden",
    creator_x_user_id: "owner-2",
    scheduled_time: 30,
  });
  insertMember(db, {
    id: "cm3",
    video_id: "hidden",
    x_user_id: "guest",
    is_public_member: 0,
  });

  const legacy = legacyDegradedCollabWorks(db, "guest");
  const optimized = optimizedDegradedCollabWorks(db, "guest");
  assertQueryEquivalence(optimized, legacy, "degraded-collab-mixed");
  assert.equal(legacy.total, 1);
  assert.equal(legacy.items[0].id, "c1");
  db.close();
});

test("degraded user collab: x_user_id 空白は従来どおり LOWER 比較", () => {
  const db = createEquivalenceDb();
  insertVideo(db, {
    id: "ws",
    creator_x_user_id: "someone",
    scheduled_time: 10,
  });
  insertMember(db, {
    id: "cm-ws",
    video_id: "ws",
    x_user_id: " Guest ",
  });

  const legacy = legacyDegradedCollabWorks(db, "guest");
  const optimized = optimizedDegradedCollabWorks(db, "guest");
  assertQueryEquivalence(optimized, legacy, "degraded-collab-whitespace");
  db.close();
});

test("degraded user: scheduled_time 同値は created_at DESC", () => {
  const db = createEquivalenceDb();
  insertVideo(db, {
    id: "d-old",
    creator_x_user_id: "usera",
    scheduled_time: 77,
    created_at: 1,
  });
  insertVideo(db, {
    id: "d-new",
    creator_x_user_id: "USERA",
    scheduled_time: 77,
    created_at: 9,
  });

  const legacy = legacyDegradedOwnWorks(db, "usera");
  const optimized = optimizedDegradedOwnWorks(db, "usera");
  assertQueryEquivalence(optimized, legacy, "degraded-own-tie");
  assert.deepEqual(
    legacy.items.map((row) => row.id),
    ["d-new", "d-old"],
  );
  db.close();
});
