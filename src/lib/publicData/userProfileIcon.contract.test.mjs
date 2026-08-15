import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [profilePage, portfolioPage] = await Promise.all([
  readFile(new URL("../../../app/(public)/user/[id]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../../app/(public)/user/[id]/portfolio/page.tsx", import.meta.url), "utf8"),
]);

test("user profile own icon prefers profile snapshot over eventual shared icon map", () => {
  for (const source of [profilePage, portfolioPage]) {
    assert.match(source, /normalizePublicIconUrl\(user(?:\?\.icon_url|\.icon_url)\)\s*\?\?/);
    assert.match(source, /resolveProjectedIcon\(\{[\s\S]*legacyIconUrl: null/);
  }
});
