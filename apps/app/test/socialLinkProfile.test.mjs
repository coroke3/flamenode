import assert from "node:assert/strict";
import test from "node:test";
import { profileHeaderSocialLinks, serializeSocialLinks, validateSocialLinksJson } from "../.test-dist/apps/app/src/lib/socialLinks.js";

test("MIG-0712: encoded primary X paths are removed on both supported hosts", () => {
  const links = [
    { type: "X", url: "https://x.com/%66lamenode?lang=ja" },
    { type: "X", url: "https://twitter.com/%46LAMENODE/" },
    { type: "X", url: "https://x.com/flamenode" },
    { type: "X", url: "https://x.com/other" },
    { type: "Portfolio", url: "https://x.com/%66lamenode" },
  ];
  assert.deepEqual(profileHeaderSocialLinks(links, "@FlameNode"), links.slice(3));
});

test("MIG-0712: malformed escapes, unrelated paths and spoofed hosts remain", () => {
  const links = [
    { type: "X", url: "https://x.com/%66lamenode%2Fother" },
    { type: "X", url: "https://x.com/%ZZ" },
    { type: "X", url: "https://x.com/%2566lamenode" },
    { type: "X", url: "https://x.com.evil.example/flamenode" },
  ];
  assert.deepEqual(profileHeaderSocialLinks(links, "flamenode"), links);
  assert.deepEqual(profileHeaderSocialLinks(links, ""), links);
});

test("social link type truncation does not split emoji surrogate pairs", () => {
  const prefix = "T".repeat(39);
  const type = prefix + "😀";
  const entry = { type, url: "https://example.com/" };
  const expected = [{ type: prefix, url: "https://example.com/" }];
  const serialized = serializeSocialLinks([entry]);
  assert.ok(serialized);
  assert.deepEqual(JSON.parse(serialized), expected);
  assert.doesNotMatch(serialized, /\\u[dD]83[dD]/, "must not persist an orphan high surrogate");

  const checked = validateSocialLinksJson(JSON.stringify([entry]));
  assert.equal(checked.ok, true);
  assert.deepEqual(JSON.parse(checked.value), expected);

  // A complete emoji at the boundary must remain intact.
  const exact = serializeSocialLinks([{ type: "T".repeat(38) + "😀", url: "https://example.com/" }]);
  assert.equal(JSON.parse(exact)[0].type, "T".repeat(38) + "😀");
});
