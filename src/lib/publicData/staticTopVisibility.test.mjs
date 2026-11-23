import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStaticTop } from "./staticTopCore.ts";

const video = (id, visibility = {}) => ({
  id,
  title: `Video ${id}`,
  display_name: "Creator",
  creator_x_user_id: "creator_x",
  youtube_video_id: "abcdefghijk",
  ...visibility,
});

test("top recommended, latest and nostalgic lists discard explicit nonpublic markers", () => {
  for (const field of ["recommended", "latest", "nostalgic"]) {
    const result = normalizeStaticTop({
      [field]: [
        video("private", { status: "private" }),
        video("public", { status: "public" }),
        video("conflict", { status: "public", visibility_status: "private" }),
        video("reverse-conflict", { status: "private", visibility_status: "public" }),
        video("draft", { visibility_status: "draft" }),
        video("legacy"),
        video("visible-alias", { visibility_status: "public" }),
      ],
    });
    assert.ok(result, field);
    assert.deepEqual(result[field].map((item) => item.id), [
      "public", "legacy", "visible-alias",
    ], field);
    assert.ok(result[field].every((item) => item.status === "public"), field);
    assert.equal(result[field][0].creator_x_user_id, "creator_x");
    assert.equal(result[field][0].youtube_video_id, "abcdefghijk");
  }
});

test("top accepts historical public-only snapshots with missing or null markers", () => {
  const result = normalizeStaticTop({
    items: [
      video("missing"),
      video("nulls", { status: null, visibility_status: null }),
      video("public-status", { status: "public" }),
      video("public-alias", { visibility_status: "public" }),
      video("mixed-null", { status: null, visibility_status: "public" }),
    ],
  });
  assert.ok(result);
  assert.deepEqual(
    result.recommended.map((item) => item.id),
    ["missing", "nulls", "public-status", "public-alias", "mixed-null"],
  );
  assert.deepEqual(result.latest.map((item) => item.id), result.recommended.map((item) => item.id));
});

test("top rejects malformed visibility and treats all-revoked pools as empty", () => {
  const bad = [
    video("malformed", { status: 0 }),
    video("boolean", { status: false, visibility_status: "public" }),
    video("whitespace", { visibility_status: " public " }),
    video("scheduled", { status: "scheduled" }),
  ];
  assert.equal(normalizeStaticTop({ recommended: bad }), null);
  assert.equal(normalizeStaticTop({ items: bad }), null);
});

test("top retains the existing 16-card source cap, ordering and legacy item fallback", () => {
  const rows = Array.from({ length: 20 }, (_, n) => video(`v${n}`));
  const result = normalizeStaticTop({ items: rows, nostalgic: rows });
  assert.ok(result);
  for (const field of ["recommended", "latest", "nostalgic"]) {
    assert.deepEqual(
      result[field].map((item) => item.id),
      rows.slice(0, 16).map((item) => item.id),
    );
  }
});
