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
