import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHeroEventSlotStatsSql } from "./heroEventSlotStatsSql.ts";

test("buildHeroEventSlotStatsSqlは空配列でnull", () => {
  assert.equal(buildHeroEventSlotStatsSql([]), null);
});

test("buildHeroEventSlotStatsSqlは指定event_idだけIN句に含める", () => {
  const sql = buildHeroEventSlotStatsSql(["hero-1", "hero-2"]);
  assert.ok(sql);
  assert.match(sql, /WHERE s\.event_id IN \(\?,\?\)/);
  assert.match(sql, /GROUP BY s\.event_id/);
  assert.doesNotMatch(sql, /GROUP BY s\.event_id[\s\S]*WHERE/);
});
