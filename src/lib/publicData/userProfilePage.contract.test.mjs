import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(
  new URL("../../../app/(public)/user/[id]/page.tsx", import.meta.url),
  "utf8",
);
const portfolioPage = await readFile(
  new URL(
    "../../../app/(public)/user/[id]/portfolio/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("user profile page records public request metrics on static path", () => {
  assert.doesNotMatch(page, /runWithPublicRequestMetrics/);
  assert.match(page, /logPublicRequestMetrics/);
  assert.match(page, /loadStaticUserWorksPage/);
  assert.match(page, /loadStaticUserCollabsPage/);
});

test("user profile returns notFound when paged static JSON is missing", () => {
  assert.match(page, /missingPagedSection/);
  assert.match(page, /beyondStaticPages/);
  assert.match(page, /STATIC_USER_MAX_PAGES/);
});

test("user profile metadata avoids full D1 when static is unavailable", () => {
  assert.match(page, /loadStaticUserProfile/);
  assert.doesNotMatch(page, /withDatabase/);
});

test("portfolio projects shared X icons into metadata, profile, and work cards", () => {
  assert.match(portfolioPage, /loadPublicXIconMapOptional/);
  assert.match(portfolioPage, /publicXIconEntriesToMap/);
  assert.match(portfolioPage, /const metadataIcon = resolveProjectedIcon/);
  assert.match(portfolioPage, /image: cachedGoogleImageUrl\(metadataIcon\)/);
  assert.match(portfolioPage, /const userIcon = cachedGoogleImageUrl\([\s\S]*?xUserId: user\.id/);
  assert.match(portfolioPage, /const works = projectVideoCardIcons/);
  assert.match(portfolioPage, /xUserId: video\.creator_x_user_id/);
  assert.match(portfolioPage, /legacyIconUrl: video\.icon_url/);
  assert.doesNotMatch(portfolioPage, /withDatabase|fetch\(/);
});
