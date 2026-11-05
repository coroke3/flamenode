import assert from "node:assert/strict";
import test from "node:test";
import { profileHeaderSocialLinks } from "../.test-dist/apps/app/src/lib/socialLinks.js";

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
