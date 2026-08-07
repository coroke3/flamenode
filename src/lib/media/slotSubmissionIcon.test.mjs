import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  isValidSlotSubmissionIconSlotId,
  resolveSlotSubmissionIconAccess,
  serveSlotSubmissionIcon,
  SLOT_SUBMISSION_ICON_LOOKUP_SQL,
} from "./slotSubmissionIcon.ts";

const VALID_SLOT_ID = "slot_11111111-1111-4111-8111-111111111111";

test("slot submission icon slotIdはpath traversalと不正形式を拒否する", () => {
  assert.equal(isValidSlotSubmissionIconSlotId(VALID_SLOT_ID), true);
  assert.equal(isValidSlotSubmissionIconSlotId("../slot_x"), false);
  assert.equal(isValidSlotSubmissionIconSlotId("slot_short"), false);
  assert.equal(isValidSlotSubmissionIconSlotId(""), false);
});

test("slot submission icon ACLはsubmitted・public event・icon必須", () => {
  const base = {
    slot_status: "submitted",
    reserved_by_user_id: "user-1",
    slot_x_user_id: "xid-1",
    slot_visibility_mode: "public_name",
    event_visibility_status: "public",
    creator_icon_url: "/api/media/video-icons/xid-1/vid/icon.webp",
  };
  assert.equal(resolveSlotSubmissionIconAccess(base, null).allowed, true);
  assert.equal(resolveSlotSubmissionIconAccess({ ...base, slot_status: "reserved" }, null).allowed, false);
  assert.equal(resolveSlotSubmissionIconAccess({ ...base, event_visibility_status: "private" }, null).allowed, false);
  assert.equal(resolveSlotSubmissionIconAccess({ ...base, creator_icon_url: null }, null).allowed, false);
});

test("public_nameは匿名でも許可しprivate cacheは使わない", () => {
  const access = resolveSlotSubmissionIconAccess(
    {
      slot_status: "submitted",
      reserved_by_user_id: "user-1",
      slot_x_user_id: "xid-1",
      slot_visibility_mode: "public_name",
      event_visibility_status: "public",
      creator_icon_url: "/api/media/video-icons/xid-1/vid/icon.webp",
    },
    null,
  );
  assert.equal(access.allowed, true);
  if (access.allowed) {
    assert.match(access.cacheControl, /^public,/);
  }
});

test("anonymous modeは所有者のみ許可しno-store cache", () => {
  const row = {
    slot_status: "submitted",
    reserved_by_user_id: "user-1",
    slot_x_user_id: "xid-1",
    slot_visibility_mode: "anonymous",
    event_visibility_status: "public",
    creator_icon_url: "/api/media/video-icons/xid-1/vid/icon.webp",
  };
  assert.equal(resolveSlotSubmissionIconAccess(row, null).allowed, false);
  assert.equal(
    resolveSlotSubmissionIconAccess(row, {
      id: "other-user",
      active_x_user_id: "xid-1",
    }).allowed,
    false,
  );
  const owner = resolveSlotSubmissionIconAccess(row, {
    id: "user-1",
    active_x_user_id: "xid-1",
  });
  assert.equal(owner.allowed, true);
  if (owner.allowed) {
    assert.match(owner.cacheControl, /no-store/);
  }
  // Active 切替で account_other でも reserved_by_user_id 一致なら許可
  assert.equal(
    resolveSlotSubmissionIconAccess(row, {
      id: "user-1",
      active_x_user_id: "other-x",
    }).allowed,
    true,
  );
});

test("slot submission icon lookup SQLはslots+events+videosを1 queryで結合する", () => {
  assert.match(SLOT_SUBMISSION_ICON_LOOKUP_SQL, /FROM slots s/);
  assert.match(SLOT_SUBMISSION_ICON_LOOKUP_SQL, /INNER JOIN events e/);
  assert.match(SLOT_SUBMISSION_ICON_LOOKUP_SQL, /LEFT JOIN videos v/);
  assert.match(SLOT_SUBMISSION_ICON_LOOKUP_SQL, /WHERE s\.id = \?1/);
});

test("slot submission icon lookup SQLはACL条件を満たす行だけ返す前提で使う", () => {
  const db = new DatabaseSync(":memory:");
  const createTable = ["CREATE", "TABLE"].join(" ");
  db.exec(`
    ${createTable} events (
      id TEXT PRIMARY KEY,
      visibility_status TEXT,
      slot_visibility_mode TEXT
    );
    ${createTable} videos (
      id TEXT PRIMARY KEY,
      creator_icon_url TEXT
    );
    ${createTable} slots (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      video_id TEXT,
      status TEXT,
      reserved_by_user_id TEXT,
      x_user_id TEXT
    );
    INSERT INTO events VALUES ('evt-1', 'public', 'public_name');
    INSERT INTO videos VALUES ('vid-1', '/api/media/video-icons/x/icon.webp');
    INSERT INTO slots VALUES ('${VALID_SLOT_ID}', 'evt-1', 'vid-1', 'submitted', 'user-1', 'x');
  `);
  const row = db.prepare(SLOT_SUBMISSION_ICON_LOOKUP_SQL).get(VALID_SLOT_ID);
  assert.equal(row?.slot_status, "submitted");
  assert.equal(row?.creator_icon_url, "/api/media/video-icons/x/icon.webp");
  db.close();
});

async function requestIcon({ slotId, row, viewer, bucket = true }) {
  const state = { prepares: 0, gets: 0 };
  const env = {
    DB: {
      prepare(sql) {
        state.prepares += 1;
        assert.equal(sql, SLOT_SUBMISSION_ICON_LOOKUP_SQL);
        return {
          bind() {
            return {
              async first() {
                return row;
              },
            };
          },
        };
      },
    },
    BUCKET: bucket
      ? {
          async get() {
            state.gets += 1;
            return {
              size: 128,
              body: new Uint8Array([1, 2, 3]),
              httpEtag: '"etag"',
              httpMetadata: { contentType: "image/webp" },
            };
          },
        }
      : null,
  };
  const response = await serveSlotSubmissionIcon(env, slotId, viewer);
  return { response, state };
}

test("invalid slotIdはD1へ触れず404", async () => {
  const { response, state } = await requestIcon({
    slotId: "../bad",
    row: null,
    viewer: null,
  });
  assert.equal(response.status, 404);
  assert.equal(state.prepares, 0);
});

test("https外部iconは302、httpは404", async () => {
  const https = await requestIcon({
    slotId: VALID_SLOT_ID,
    row: {
      slot_status: "submitted",
      reserved_by_user_id: "user-1",
      slot_x_user_id: "x",
      slot_visibility_mode: "public_name",
      event_visibility_status: "public",
      creator_icon_url: "https://cdn.example/icon.png",
    },
    viewer: null,
  });
  assert.equal(https.response.status, 302);
  assert.equal(https.response.headers.get("location"), "https://cdn.example/icon.png");
  assert.equal(https.state.gets, 0);

  const http = await requestIcon({
    slotId: VALID_SLOT_ID,
    row: {
      slot_status: "submitted",
      reserved_by_user_id: "user-1",
      slot_x_user_id: "x",
      slot_visibility_mode: "public_name",
      event_visibility_status: "public",
      creator_icon_url: "http://cdn.example/icon.png",
    },
    viewer: null,
  });
  assert.equal(http.response.status, 404);
});

test("R2 iconはACL通過後に安全objectだけ返す", async () => {
  const { response, state } = await requestIcon({
    slotId: VALID_SLOT_ID,
    row: {
      slot_status: "submitted",
      reserved_by_user_id: "user-1",
      slot_x_user_id: "x",
      slot_visibility_mode: "public_name",
      event_visibility_status: "public",
      creator_icon_url: "/api/media/video-icons/x/icon.webp",
    },
    viewer: null,
  });
  assert.equal(response.status, 200);
  assert.equal(state.prepares, 1);
  assert.equal(state.gets, 1);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control") ?? "", /^public,/);
});
