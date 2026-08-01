import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../../../scripts/ts-path-alias-loader.mjs", import.meta.url);

const { parseVideoForm } = await import("./videoFormSchema.ts");

const base = {
  display_name: "test",
  title: "title",
  youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

test("parseVideoForm defaults icon_mode to existing", () => {
  const result = parseVideoForm(base);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.icon_mode, "existing");
});

test("parseVideoForm accepts icon_mode keep", () => {
  const result = parseVideoForm({ ...base, icon_mode: "keep" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.icon_mode, "keep");
});

test("parseVideoForm rejects invalid icon_mode", () => {
  const result = parseVideoForm({ ...base, icon_mode: "invalid" });
  assert.equal(result.ok, false);
});
