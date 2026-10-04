import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const files = {
  home: await readFile(
    new URL("../../../app/(public)/page.tsx", import.meta.url),
    "utf8",
  ),
  video: await readFile(
    new URL("../../../app/(public)/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  user: await readFile(
    new URL("../../../app/(public)/user/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  userPortfolio: await readFile(
    new URL("../../../app/(public)/user/[id]/portfolio/page.tsx", import.meta.url),
    "utf8",
  ),
  userIndex: await readFile(
    new URL("../../../app/(public)/user/page.tsx", import.meta.url),
    "utf8",
  ),
  list: await readFile(
    new URL("../../../app/(public)/list/page.tsx", import.meta.url),
    "utf8",
  ),
  recommend: await readFile(
    new URL("../../../app/(public)/recommend/page.tsx", import.meta.url),
    "utf8",
  ),
  trending: await readFile(
    new URL("../../../app/(public)/trending/page.tsx", import.meta.url),
    "utf8",
  ),
  events: await readFile(
    new URL("../../../app/(public)/event/page.tsx", import.meta.url),
    "utf8",
  ),
  eventDetail: await readFile(
    new URL("../../../app/(public)/event/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  eventSlots: await readFile(
    new URL("../../../app/(public)/event/[id]/slots/page.tsx", import.meta.url),
    "utf8",
  ),
  eventRelease: await readFile(
    new URL("../../../app/(public)/event/[id]/release/page.tsx", import.meta.url),
    "utf8",
  ),
};

// The user profile body is shared by the ISR route and its paged twin.
const userView = await readFile(
  new URL("../../../app/(public)/user/[id]/UserProfilePage.tsx", import.meta.url),
  "utf8",
);
const userPaged = await readFile(
  new URL("../../../app/(public)/user/[id]/paged/page.tsx", import.meta.url),
  "utf8",
);
const nextConfig = await readFile(
  new URL("../../../next.config.mjs", import.meta.url),
  "utf8",
);

// ISR regenerations PUT to the R2 incremental cache (Class A). Hourly-cadence
// pages use longer windows; reservation-facing slots stay at 30s.
const EXPECTED_REVALIDATE = {
  home: 120,
  recommend: 300,
  trending: 300,
  eventDetail: 60,
  eventRelease: 60,
};

test("公開 GET は force-dynamic せず ISR にする（ページ別の再検証間隔）", () => {
  for (const [label, source] of Object.entries(files)) {
    const seconds = EXPECTED_REVALIDATE[label] ?? 30;
    assert.match(source, new RegExp(`export const revalidate = ${seconds};`), label);
    assert.doesNotMatch(
      source,
      /export const dynamic = "force-dynamic"/,
      label,
    );
  }
});

// `revalidate` alone does not cache a dynamic segment: without
// generateStaticParams Next.js renders it on every request (build table "ƒ"),
// which exceeds the Workers Free 10ms CPU limit.
test("ISR対象の動的ページは generateStaticParams で on-demand ISR にする", () => {
  for (const label of ["video", "user", "userPortfolio", "eventDetail", "eventSlots", "eventRelease"]) {
    assert.match(
      files[label],
      /export function generateStaticParams\(\): \{ id: string \}\[\] \{\s*return \[\];\s*\}/,
      label,
    );
  }
});

test("ユーザー公開ページは1ページあたりの SSR カード数を8に抑える", () => {
  assert.match(userView, /const WORKS_PAGE_SIZE = 8/);
  assert.match(userView, /const COLLAB_PAGE_SIZE = 8/);
  assert.match(userView, /artifactPageForDisplay/);
  assert.match(userView, /sliceDisplayItems/);
  assert.match(userView, /STATIC_USER_WORKS_PAGE_SIZE \/ WORKS_PAGE_SIZE/);
});

test("おすすめ・イベント詳細の SSR カードも8件に抑える", () => {
  assert.match(files.recommend, /const RAIL_DISPLAY_LIMIT = 8/);
  assert.match(files.recommend, /hot\.slice\(0, RAIL_DISPLAY_LIMIT\)/);
  assert.match(files.eventDetail, /const EVENT_VIDEO_DISPLAY_LIMIT = 8/);
  assert.match(
    files.eventDetail,
    /detail\.publicVideos\s*\.slice\(0, EVENT_VIDEO_DISPLAY_LIMIT\)/,
  );
});

test("動画詳細は関連12件だけ SSR し、関連作者の icon map を読まない", () => {
  assert.match(files.video, /firstCount=\{12\}/);
  assert.doesNotMatch(files.video, /relatedIconCandidates/);
  assert.doesNotMatch(files.video, /slice\(firstCount, 30\)/);
});

test("ユーザー公開ページは icon manifest を読まず snapshot アイコンで描画する", () => {
  assert.doesNotMatch(userView, /loadPublicXIconMapOptional/);
  assert.match(files.home, /const TOP_SHELF_DISPLAY_LIMIT = 8/);
});

test("ユーザーページは query 付きだけ動的な paged route へ rewrite し、素のURLはISRにする", () => {
  // The ISR route must not read the query; the twin route does.
  assert.doesNotMatch(files.user, /searchParams/);
  assert.match(files.user, /return UserProfilePage\(\{ params \}\);/);
  assert.match(userPaged, /return UserProfilePage\(props\);/);
  assert.doesNotMatch(userPaged, /generateStaticParams|export const revalidate/);
  assert.match(nextConfig, /\["worksPage", "collabPage"\]\.map\(\(key\) => \(\{/);
  assert.match(nextConfig, /source: "\/user\/:id",[\s\S]*?has: \[\{ type: "query", key, value: "\.\+" \}\],\s*destination: "\/user\/:id\/paged",/);
  // Page 1 links go to the bare (cached) URL.
  assert.equal(userView.match(/if \(p <= 1\) return basePath;/g)?.length, 2);
});
