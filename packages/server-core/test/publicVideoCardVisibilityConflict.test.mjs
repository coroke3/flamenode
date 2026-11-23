import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizePublicVideoCard,
  normalizePublicVideoCardList,
} from "../src/publicData/videoCardCore.ts";
import {
  normalizeRecommendCore,
  normalizeStaticRecommend,
} from "../src/publicData/staticRecommendCore.ts";

const row = { id: "v1", title: "Public card", display_name: "Creator" };

test("a public status never overrides a private or draft visibility_status", () => {
  for (const revoked of ["private", "draft", "scheduled", "unlisted", "", 0, false]) {
    assert.equal(
      normalizePublicVideoCard({ ...row, status: "public", visibility_status: revoked }),
      null,
      `status=public must not override visibility_status=${String(revoked)}`,
    );
  }
  assert.equal(
    normalizePublicVideoCard({ ...row, status: "private", visibility_status: "public" }),
    null,
    "a private status must not be overridden by visibility_status",
  );
});

test("legacy single-field and null-alias public rows stay listable", () => {
  for (const allowed of [
    { status: "public" },
    { visibility_status: "public" },
    { status: null, visibility_status: "public" },
    { status: "public", visibility_status: null },
    { status: "public", visibility_status: "public" },
  ]) {
    const projected = normalizePublicVideoCard({ ...row, ...allowed });
    assert.ok(projected, JSON.stringify(allowed));
    assert.equal(projected.status, "public");
    assert.equal(projected.title, row.title);
  }
  assert.equal(normalizePublicVideoCard(row), null, "absent markers are not public");
  assert.equal(normalizePublicVideoCard({ ...row, status: null, visibility_status: null }), null);
});

test("public video lists remove conflicting rows before downstream projections", () => {
  const list = [
    { ...row, id: "status-only", status: "public" },
    { ...row, id: "revoked-visibility", status: "public", visibility_status: "private" },
    { ...row, id: "revoked-status", status: "private", visibility_status: "public" },
    { ...row, id: "visibility-only", visibility_status: "public" },
    { ...row, id: "both-public", status: "public", visibility_status: "public" },
  ];
  assert.deepEqual(
    normalizePublicVideoCardList(list).map((video) => video.id),
    ["status-only", "visibility-only", "both-public"],
  );
});

test("recommendation snapshots inherit the shared strict visibility fence", () => {
  const candidates = [
    { ...row, id: "visible", status: "public" },
    { ...row, id: "revoked", status: "public", visibility_status: "private" },
  ];
  const legacy = normalizeStaticRecommend({
    generated_at: 1700000000,
    recommended: candidates,
    latest: [],
    underrated: [],
  });
  assert.ok(legacy);
  assert.deepEqual(legacy.recommended.map((video) => video.id), ["visible"]);

  const migrated = normalizeRecommendCore({
    schema_version: 1,
    generated_at: 1700000000,
    recommended: candidates,
    latest: [],
    underrated: [],
  });
  assert.ok(migrated);
  assert.deepEqual(migrated.recommended.map((video) => video.id), ["visible"]);
});
