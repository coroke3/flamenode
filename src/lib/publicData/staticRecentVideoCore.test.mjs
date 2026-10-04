import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { normalizeStaticRecentVideoPage } = await import("./staticRecentVideoCore.ts");

  test("static JSON旧形式で event title は null", () => {
    const page = normalizeStaticRecentVideoPage(
      {
        generated_at: 1,
        total: 1,
        items: [
          {
            id: "v1",
            title: "作品",
            primary_event_id: "ev1",
          },
        ],
      },
      1,
      24,
    );
    assert.ok(page);
    assert.equal(page.videos[0].primary_event_title, null);
  });

  test("作者名・アイコンは新形式（display_name/icon_url のみ）と旧形式（creator_*）の両方を読む", () => {
    const page = normalizeStaticRecentVideoPage(
      {
        generated_at: 1,
        total: 2,
        items: [
          { id: "v1", title: "新", display_name: "A", icon_url: "https://pbs.twimg.com/a.jpg" },
          { id: "v2", title: "旧", creator_display_name: "B", creator_icon_url: "https://pbs.twimg.com/b.jpg" },
        ],
      },
      1,
      24,
    );
    assert.ok(page);
    assert.deepEqual(
      page.videos.map((video) => [video.display_name, video.icon_url]),
      [
        ["A", "https://pbs.twimg.com/a.jpg"],
        ["B", "https://pbs.twimg.com/b.jpg"],
      ],
    );
  });

  test("total は items 件数を超えない", () => {
    const page = normalizeStaticRecentVideoPage(
      {
        generated_at: 1,
        total: 613,
        items: Array.from({ length: 120 }, (_, index) => ({
          id: `v${index}`,
          title: `作品${index}`,
        })),
      },
      6,
      24,
    );
    assert.ok(page);
    assert.equal(page.total, 120);
    assert.equal(page.videos.length, 0);
  });
}
