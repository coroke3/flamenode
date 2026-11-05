import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatSocialLinkLabel,
  parseSocialLinks,
  profileHeaderSocialLinks,
  serializeSocialLinks,
  socialLinkIconName,
  SOCIAL_LINK_TYPE_OPTIONS,
  validateSocialLinksJson,
} from "./socialLinks.ts";

test("SOCIAL_LINK_TYPE_OPTIONS includes extended profile link types", () => {
  for (const type of ["Portfolio", "Tumblr", "Discord", "Email"]) {
    assert.equal(SOCIAL_LINK_TYPE_OPTIONS.includes(type), true);
  }
});

test("parseSocialLinks normalizes Tumblr spelling and accepts Discord URLs", () => {
  const links = parseSocialLinks(
    JSON.stringify([
      { type: "Tumbler", url: "https://example.tumblr.com" },
      { type: "Discord", url: "https://discord.gg/flamenode" },
    ]),
  );

  assert.deepEqual(links, [
    { type: "Tumblr", url: "https://example.tumblr.com/" },
    { type: "Discord", url: "https://discord.gg/flamenode" },
  ]);
});

test("serializeSocialLinks stores bare email as mailto for Email links", () => {
  const stored = serializeSocialLinks([
    { type: "Email", url: "contact@example.com" },
  ]);

  assert.equal(stored, JSON.stringify([{ type: "Email", url: "mailto:contact@example.com" }]));
});

test("validateSocialLinksJson rejects non-url Discord handles", () => {
  const result = validateSocialLinksJson(
    JSON.stringify([{ type: "Discord", url: "flamenode" }]),
  );
  const mailtoResult = validateSocialLinksJson(
    JSON.stringify([{ type: "Discord", url: "mailto:contact@example.com" }]),
  );

  assert.equal(result.ok, false);
  assert.equal(mailtoResult.ok, false);
});

test("social link display helpers use dedicated icons where available", () => {
  assert.equal(socialLinkIconName("Discord"), "discord");
  assert.equal(socialLinkIconName("Email"), "mail");
  assert.equal(socialLinkIconName("Tumblr"), "external");
  assert.equal(formatSocialLinkLabel("Email", "mailto:contact@example.com"), "contact@example.com");
  assert.equal(formatSocialLinkLabel("Portfolio", "https://example.com/work"), "example.com/work");
});

test("profileHeaderSocialLinks removes only the primary X profile link", () => {
  const links = profileHeaderSocialLinks(
    [
      { type: "X", url: "https://x.com/flamenode" },
      { type: "X", url: "https://twitter.com/flamenode" },
      { type: "X", url: "https://x.com/other" },
      { type: "Portfolio", url: "https://example.com" },
    ],
    "flamenode",
  );

  assert.deepEqual(links, [
    { type: "X", url: "https://x.com/other" },
    { type: "Portfolio", url: "https://example.com" },
  ]);
});

test("profileHeaderSocialLinks removes percent-encoded primary X handles on both X hosts", () => {
  const links = [
    { type: "X", url: "https://x.com/%66lamenode?lang=ja" },
    { type: "X", url: "https://twitter.com/%46LAMENODE/" },
    { type: "X", url: "https://x.com/flamenode" },
    { type: "X", url: "https://x.com/other" },
    { type: "Portfolio", url: "https://x.com/%66lamenode" },
  ];
  assert.deepEqual(profileHeaderSocialLinks(links, "@FlameNode"), links.slice(3));
});

test("profileHeaderSocialLinks keeps unrelated paths, malformed escapes and spoofed hosts", () => {
  const links = [
    { type: "X", url: "https://x.com/%66lamenode%2Fother" },
    { type: "X", url: "https://x.com/%ZZ" },
    { type: "X", url: "https://x.com/%2566lamenode" },
    { type: "X", url: "https://x.com.evil.example/flamenode" },
  ];
  assert.deepEqual(profileHeaderSocialLinks(links, "flamenode"), links);
  assert.deepEqual(profileHeaderSocialLinks(links, ""), links);
});
