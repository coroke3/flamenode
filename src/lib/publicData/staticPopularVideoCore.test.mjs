import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStaticPopularVideoPage } from "./staticPopularVideoCore.ts";

test("normalizeStaticPopularVideoPage paginates score-sorted items", () => {
  const payload = {
    generated_at: 100,
    total: 3,
    items: [
      {
        id: "v1",
        title: "One",
        creator_display_name: "A",
        creator_x_user_id: "a",
        primary_event_title: "Event A",
        status: "public",
      },
      { id: "v2", title: "Two", creator_display_name: "B" },
      { id: "v3", title: "Three", creator_display_name: "C" },
    ],
  };
  const page = normalizeStaticPopularVideoPage(payload, 2, 2);
  assert.equal(page?.videos.length, 1);
  assert.equal(page?.videos[0]?.id, "v3");
  assert.equal(page?.videos[0]?.primary_event_title, null);
  assert.equal(page?.total, 3);
});

test("total は items 件数を超えない", () => {
  const page = normalizeStaticPopularVideoPage(
    {
      generated_at: 100,
      total: 613,
      items: Array.from({ length: 120 }, (_, index) => ({
        id: `v${index}`,
        title: `作品${index}`,
        creator_display_name: "A",
      })),
    },
    6,
    24,
  );
  assert.ok(page);
  assert.equal(page.total, 120);
  assert.equal(page.videos.length, 0);
});
