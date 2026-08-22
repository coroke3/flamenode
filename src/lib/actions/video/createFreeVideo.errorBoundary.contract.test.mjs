import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./createFreeVideo.ts", import.meta.url), "utf8");

test("free-video preflight failures stay inside the action result contract", () => {
  assert.match(source, /CREATE_FREE_VIDEO_UNEXPECTED_ERROR_MESSAGE/);
  assert.match(
    source,
    /try \{[\s\S]*?checkYoutubeVideoDuplicate\([\s\S]*?catch \(error\)/,
  );
  assert.match(
    source,
    /try \{[\s\S]*?validateCustomAnswersForEvents\([\s\S]*?catch \(error\)/,
  );
  assert.match(
    source,
    /try \{[\s\S]*?resolveVideoCreatorIcon\([\s\S]*?catch \(error\)/,
  );
});

test("free-video datetime validation precedes creator icon upload", () => {
  const schedule = source.indexOf("parseJstDatetimeLocalStrict");
  const icon = source.indexOf("resolveVideoCreatorIcon");
  assert.ok(schedule >= 0);
  assert.ok(icon > schedule);
});
