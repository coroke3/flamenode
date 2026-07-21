import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { test } from "node:test";

register("../../scripts/ts-path-alias-loader.mjs", import.meta.url);

const { MOJIBAKE_TOKENS } = await import("./utils/mojibake.ts");
const {
  absoluteUrl,
  buildPageMetadata,
  compactText,
  getSiteUrl,
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

test("sitemap creator query filters listable X users only", async () => {
  const source = await readFile(
    new URL("../../app/sitemap.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /publicListableXApprovalWhere/);
  assert.doesNotMatch(source, /portfolio/);
});
