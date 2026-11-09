import assert from "node:assert/strict";
import test from "node:test";
import {
  parseXIdProfileInput, parseDeleteLinkedXInput, parseSetXIdIconInput,
} from "../src/routes/xid/profileInput.ts";

test("SA-102: route and FormData X identities must refer to the same canonical X", () => {
  const ok = parseXIdProfileInput("x_one", {
    x_user_id: " @X_ONE ", x_name: "  Creator ", profile_text: "  About  ",
    portfolio_contact: "  contact ", youtube_channel_url: " https://www.youtube.com/@x_one ",
    other_social_links: " [] ",
  });
  assert.deepEqual(ok, { ok: true, value: {
    xUserId: "x_one", xName: "Creator", profileText: "About",
    portfolioContact: "  contact ", youtubeChannelRaw: "https://www.youtube.com/@x_one",
    otherSocialLinksRaw: "[]",
  } });
  assert.equal(parseXIdProfileInput("x_one", { x_user_id: "x_two" }).ok, false);
  assert.equal(parseXIdProfileInput("x_one", { x_user_id: 33 }).ok, false);
  for (const invalidPath of ["@x_one", "X_ONE", "x-one", "a/b", "%2F", "", "../x_one", "x".repeat(21)]) {
    assert.equal(parseXIdProfileInput(invalidPath, { x_user_id: invalidPath }).ok, false, invalidPath);
  }
});

test("SA-102: normalizes CURRENT profile string limits without cutting surrogate pairs at normal boundaries", () => {
  const parsed = parseXIdProfileInput("creator", {
    x_user_id: "creator", x_name: "A".repeat(82), profile_text: "P".repeat(2002),
    portfolio_contact: "C".repeat(1202),
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.xName.length, 80);
  assert.equal(parsed.value.profileText.length, 2000);
  assert.equal(parsed.value.portfolioContact.length, 1200);
  assert.equal(parsed.value.youtubeChannelRaw, "");
  assert.equal(parsed.value.otherSocialLinksRaw, "");
});

test("SA-103: exact normalized DELETE confirmation and matching path are mandatory", () => {
  assert.deepEqual(parseDeleteLinkedXInput("x_one", {
    x_user_id: "@X_ONE", confirm: " DELETE x_one ",
  }), { ok: true, value: "x_one" });
  for (const confirm of ["DELETE X_ONE", "DELETE x_two", "DELETE x_one now", "", 10]) {
    assert.equal(parseDeleteLinkedXInput("x_one", { x_user_id: "x_one", confirm }).ok, false);
  }
  assert.equal(parseDeleteLinkedXInput("x_one", { x_user_id: "x_two", confirm: "DELETE x_one" }).ok, false);
});

test("SA-104: reject blank icon inputs, but do not trust arbitrary icon candidates", () => {
  const valid = parseSetXIdIconInput("x_one", {
    x_user_id: "@X_ONE", icon_url: " /api/media/xicons/x_one/abc.png ",
  });
  assert.deepEqual(valid, { ok: true, value: {
    xUserId: "x_one", iconUrl: "/api/media/xicons/x_one/abc.png",
  } });
  assert.equal(parseSetXIdIconInput("x_one", { x_user_id: "x_two", icon_url: "x" }).ok, false);
  assert.equal(parseSetXIdIconInput("x_one", { x_user_id: "x_one", icon_url: "  " }).ok, false);
  assert.equal(parseSetXIdIconInput("x_one", { x_user_id: "x_one", icon_url: null }).ok, false);
  // Parsed strings are not permission grants; the route is still unmounted.
  assert.equal(parseSetXIdIconInput("x_one", { x_user_id: "x_one", icon_url: "https://evil.example/icon.png" }).ok, true);
});
