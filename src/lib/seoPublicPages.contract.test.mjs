import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [videoPage, userPage, eventPage, adminLayout, manageLayout, robots, ctaCss] =
  await Promise.all([
    readFile(new URL("../../app/(public)/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../app/(public)/user/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../app/(public)/event/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../app/(admin)/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/(manage)/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/robots.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../components/layout/HomeClosingCta.module.css", import.meta.url),
      "utf8",
    ),
  ]);

test("公開詳細ページは内容に対応するSEO画像を使う", () => {
  assert.match(
    videoPage,
    /image: metadataYoutubeId[\s\S]*?youtubeThumbUrl\(metadataYoutubeId, "maxresdefault"\)/,
  );
  assert.match(videoPage, /ogType: "video\.other"/);
  assert.match(userPage, /const metadataIcon[\s\S]{0,500}resolveProjectedIcon\(\{/);
  assert.match(userPage, /image: cachedGoogleImageUrl\(metadataIcon\)/);
  assert.match(userPage, /"@type": "Person"/);
  assert.match(eventPage, /event\.img_url \?\? event\.icon_url/);
});

test("管理・運営ページはmetadataとrobots.txtの両方で検索対象外にする", () => {
  for (const layout of [adminLayout, manageLayout]) {
    assert.match(layout, /robots: \{ index: false, follow: false \}/);
  }
  assert.match(robots, /"\/admin\/"/);
  assert.match(robots, /"\/manage\/"/);
});

test("Upload your frameはFlameNodeブランドフォントを使う", () => {
  assert.match(ctaCss, /\.brandMessage\s*\{[\s\S]*?font-family: var\(--font-brand\)/);
});
