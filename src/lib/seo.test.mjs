import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { test } from "node:test";

register("../../scripts/ts-path-alias-loader.mjs", import.meta.url);

const { MOJIBAKE_TOKENS } = await import("./utils/mojibake.ts");
const {
  absoluteUrl,
  BRAND_ICON_PATH,
  BRAND_SOCIAL_IMAGE,
  buildPageMetadata,
  buildSiteJsonLd,
  compactText,
  getSiteUrl,
  serializeJsonLd,
  SITE_DESCRIPTION,
} = await import("./seo.ts");

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

test.after(() => {
  if (ORIGINAL_SITE_URL === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
  }
});

test("absoluteUrl resolves paths against configured site origin", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.com";
  assert.equal(absoluteUrl("/list"), "https://flamenode.example.com/list");
  assert.equal(getSiteUrl().origin, "https://flamenode.example.com");
});

test("buildPageMetadata sets canonical alternate", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.com";
  const meta = buildPageMetadata({
    title: "作品一覧",
    path: "/list",
  });
  assert.equal(meta.alternates?.canonical, "https://flamenode.example.com/list");
});

test("buildPageMetadata sets robots when noIndex is true", () => {
  const meta = buildPageMetadata({
    title: "非公開",
    path: "/secret",
    noIndex: true,
  });
  assert.equal(meta.robots?.index, false);
  assert.equal(meta.robots?.follow, false);
  assert.equal(meta.robots?.googleBot?.index, false);
  assert.equal(meta.robots?.googleBot?.follow, false);
});

test("buildPageMetadata defaults openGraph type to website", () => {
  const meta = buildPageMetadata({
    title: "ホーム",
    path: "/",
  });
  assert.equal(meta.openGraph?.type, "website");
  assert.deepEqual(meta.title, { absolute: "ホーム" });
});

test("buildPageMetadata uses the branded 1200x630 card by default", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.com";
  const meta = buildPageMetadata({ title: "FlameNode", path: "/" });
  const image = meta.openGraph?.images?.[0];

  assert.equal(image?.url, `https://flamenode.example.com${BRAND_SOCIAL_IMAGE.path}`);
  assert.equal(image?.width, 1200);
  assert.equal(image?.height, 630);
  assert.equal(image?.type, "image/png");
  assert.equal(meta.twitter?.images?.[0]?.url, image?.url);
});

test("site JSON-LD connects the website and crawlable square brand logo", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://flamenode.example.com";
  const data = buildSiteJsonLd();
  const graph = data["@graph"];

  assert.ok(Array.isArray(graph));
  const organization = graph.find((item) => item["@type"] === "Organization");
  const website = graph.find((item) => item["@type"] === "WebSite");
  assert.equal(organization.logo.url, `https://flamenode.example.com${BRAND_ICON_PATH}`);
  assert.equal(organization.logo.width, 512);
  assert.equal(organization.logo.height, 512);
  assert.equal(website.publisher["@id"], organization["@id"]);
});

test("serializeJsonLd escapes markup-significant less-than characters", () => {
  assert.equal(serializeJsonLd({ value: "</script>" }), '{"value":"\\u003c/script>"}');
});

test("buildPageMetadata accepts custom openGraph type", () => {
  const videoMeta = buildPageMetadata({
    title: "作品",
    path: "/abc123",
    ogType: "video.other",
  });
  assert.equal(videoMeta.openGraph?.type, "video.other");

  const profileMeta = buildPageMetadata({
    title: "クリエイター",
    path: "/user/example",
    ogType: "profile",
  });
  assert.equal(profileMeta.openGraph?.type, "profile");
});

test("compactText trims, collapses whitespace, and truncates", () => {
  assert.equal(compactText("  hello   world  "), "hello world");
  assert.equal(compactText(""), SITE_DESCRIPTION);
  assert.equal(compactText(null), SITE_DESCRIPTION);
  const long = "あ".repeat(200);
  const compacted = compactText(long, 20);
  assert.ok(compacted.endsWith("..."));
  assert.equal(compacted.length, 20);
});

test("compactText falls back when input looks like mojibake", () => {
  const mojibake = `説明${MOJIBAKE_TOKENS[0]}テキスト`;
  assert.equal(compactText(mojibake), SITE_DESCRIPTION);
});

test("buildPageMetadata title falls back when env title looks like mojibake", () => {
  const mojibakeTitle = `タイトル${MOJIBAKE_TOKENS[0]}`;
  const meta = buildPageMetadata({
    title: mojibakeTitle,
    path: "/list",
  });
  assert.equal(meta.title, "作品一覧");
});

test("sitemap builds from static R2 indexes without D1", async () => {
  const source = await readFile(
    new URL("../../app/sitemap.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildStaticSitemapEntries/);
  assert.doesNotMatch(source, /withDatabase/);
  assert.doesNotMatch(source, /portfolio/);
});
