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
}
