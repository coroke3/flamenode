import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../../../scripts/ts-path-alias-loader.mjs", import.meta.url);

const { parseVideoForm } = await import("./videoFormSchema.ts");

const base = {
  display_name: "test",
  title: "title",
};

test("parseVideoForm requires youtube_url by default", () => {
  const result = parseVideoForm({ ...base, youtube_url: "" });
  assert.equal(result.ok, false);
});

test("parseVideoForm accepts empty youtube_url when youtubeRequired is false", () => {
  const result = parseVideoForm({ ...base, youtube_url: "" }, { youtubeRequired: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.youtube_url, "");
});

test("parseVideoForm accepts missing youtube_url when youtubeRequired is false", () => {
  const result = parseVideoForm({ ...base }, { youtubeRequired: false });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.youtube_url, "");
});

test("parseVideoForm rejects invalid youtube_url when youtubeRequired is false", () => {
  const result = parseVideoForm({ ...base, youtube_url: "not-a-url" }, { youtubeRequired: false });
  assert.equal(result.ok, false);
});

test("parseVideoForm accepts valid youtube_url when youtubeRequired is false", () => {
  const result = parseVideoForm(
    { ...base, youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { youtubeRequired: false },
  );
  assert.equal(result.ok, true);
});

test("parseVideoForm accepts valid youtube_url by default", () => {
  const result = parseVideoForm({
    ...base,
    youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.equal(result.ok, true);
});
