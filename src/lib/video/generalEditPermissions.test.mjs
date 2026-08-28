import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERAL_EDITABLE_FIELD_KEYS,
  disabledFieldKeysFromGeneralFields,
  normalizeGeneralEditableFields,
  parseGeneralEditableFields,
  parseGeneralEditablePolicyV2,
  resolveGeneralEditableFieldsFromPolicy,
  resolveGeneralEditableScope,
  sectionAllowedByGeneralFields,
  serializeGeneralEditableFields,
} from "./generalEditPermissionsCore.ts";

test("normal owner field registry exposes the YouTube URL policy key", () => {
  assert.equal(GENERAL_EDITABLE_FIELD_KEYS.includes("youtube_url"), true);
  assert.equal(
    sectionAllowedByGeneralFields("video.youtube_id", new Set(["youtube_url"])),
    true,
  );
  assert.equal(
    sectionAllowedByGeneralFields("video.youtube_id", new Set(["title"])),
    false,
  );
});

test("v2 policy resolves allow/deny/inherit against the global set", () => {
  const policy = JSON.stringify({
    version: 2,
    fallback: "deny",
    allow: ["youtube_url"],
    deny: ["title"],
    inherit: ["music"],
  });
  const parsed = parseGeneralEditablePolicyV2(policy);
  assert.ok(parsed);
  const resolved = resolveGeneralEditableFieldsFromPolicy({
    allowUserVideoEdits: 1,
    policyJson: policy,
    globalFields: new Set(["title", "music", "chapters"]),
  });
  assert.deepEqual(Array.from(resolved), ["youtube_url", "music"]);
});

test("v2 policy rejects malformed, unknown versions, and overlapping keys", () => {
  assert.equal(parseGeneralEditablePolicyV2("not-json"), null);
  assert.equal(parseGeneralEditablePolicyV2(JSON.stringify({ version: 1 })), null);
  assert.equal(
    parseGeneralEditablePolicyV2(JSON.stringify({
      version: 2,
      fallback: "inherit",
      allow: ["title"],
      deny: ["title"],
      inherit: [],
    })),
    null,
  );
  assert.equal(
    parseGeneralEditablePolicyV2(JSON.stringify({
      version: 2,
      fallback: "inherit",
      allow: ["title", 1],
      deny: [],
      inherit: [],
    })),
    null,
  );
  assert.equal(
    resolveGeneralEditableFieldsFromPolicy({
      allowUserVideoEdits: 1,
      policyJson: JSON.stringify({ version: 9, fallback: "inherit", allow: [], deny: [], inherit: [] }),
      globalFields: new Set(["title"]),
    }).size,
    0,
  );
});

test("legacy CSV event overrides remain exact and do not broaden on v2 rollout", () => {
  const resolved = resolveGeneralEditableFieldsFromPolicy({
    allowUserVideoEdits: 1,
    policyJson: "title,music",
    globalFields: new Set(["title", "music", "youtube_url"]),
  });
  assert.deepEqual(Array.from(resolved), ["title", "music"]);
});

test("event override off inherits global, while v2 deny overrides global", () => {
  const denyYoutube = JSON.stringify({
    version: 2,
    fallback: "inherit",
    allow: [],
    deny: ["youtube_url"],
    inherit: [],
  });
  const globalFields = new Set(["title", "youtube_url"]);
  assert.equal(
    resolveGeneralEditableFieldsFromPolicy({
      allowUserVideoEdits: 0,
      policyJson: denyYoutube,
      globalFields,
    }).has("youtube_url"),
    true,
  );
  assert.equal(
    resolveGeneralEditableFieldsFromPolicy({
      allowUserVideoEdits: 1,
      policyJson: denyYoutube,
      globalFields,
    }).has("youtube_url"),
    false,
  );
  assert.equal(
    resolveGeneralEditableFieldsFromPolicy({
      allowUserVideoEdits: 1,
      policyJson: '["title"]',
      globalFields,
    }).has("youtube_url"),
    false,
  );
});

test("normalizeGeneralEditableFields: fixed order and unknown drop", () => {
  const normalized = normalizeGeneralEditableFields([
    "chapters",
    "unknown",
    "title",
    "title",
    "music",
  ]);
  assert.deepEqual(normalized, ["title", "music", "chapters"]);
});

test("serializeGeneralEditableFields: fixed order and empty", () => {
  assert.equal(serializeGeneralEditableFields(["chapters", "title"]), "title,chapters");
  assert.equal(serializeGeneralEditableFields([]), "");
});

test("parseGeneralEditableFields: null and empty", () => {
  assert.equal(parseGeneralEditableFields(null).size, 0);
  assert.equal(parseGeneralEditableFields("").size, 0);
  assert.equal(parseGeneralEditableFields(undefined).size, 0);
});

test("parseGeneralEditableFields: keeps known keys only", () => {
  const parsed = parseGeneralEditableFields("title,unknown,music");
  assert.deepEqual(Array.from(parsed), ["title", "music"]);
});

test("resolveGeneralEditableScope: public vs non-public", () => {
  assert.equal(resolveGeneralEditableScope({ visibility_status: "public" }), "default");
  assert.equal(resolveGeneralEditableScope({ visibility_status: "pending" }), "upcoming");
  assert.equal(resolveGeneralEditableScope({ visibility_status: "private" }), "upcoming");
});

test("sectionAllowedByGeneralFields: section mapping", () => {
  const titleOnly = new Set(["title"]);
  assert.equal(sectionAllowedByGeneralFields("video.basics", titleOnly), true);
  assert.equal(sectionAllowedByGeneralFields("videos.title", titleOnly), true);
  assert.equal(sectionAllowedByGeneralFields("video.identity", titleOnly), false);

  const identity = new Set(["display_name"]);
  assert.equal(sectionAllowedByGeneralFields("video.identity", identity), true);

  const credits = new Set(["music"]);
  assert.equal(sectionAllowedByGeneralFields("video.credits", credits), true);
  assert.equal(sectionAllowedByGeneralFields("videos.music_credit", credits), true);

  const descriptions = new Set(["intro_comment"]);
  assert.equal(sectionAllowedByGeneralFields("video.descriptions", descriptions), true);
  assert.equal(sectionAllowedByGeneralFields("videos.review_data", descriptions), true);

  const members = new Set(["members"]);
  assert.equal(sectionAllowedByGeneralFields("video.members", members), true);

  const chapters = new Set(["chapters"]);
  assert.equal(sectionAllowedByGeneralFields("video.member_chapters", chapters), true);

  const any = new Set(["title"]);
  assert.equal(sectionAllowedByGeneralFields("video.youtube_id", any), false);
  assert.equal(sectionAllowedByGeneralFields("video.primary_event", any), false);
  assert.equal(sectionAllowedByGeneralFields("video.status", any), false);
  assert.equal(sectionAllowedByGeneralFields("video.chapter_admin", any), false);
});

test("disabledFieldKeysFromGeneralFields: maps missing keys to UI paths", () => {
  const disabled = disabledFieldKeysFromGeneralFields(new Set(["title"]));
  assert.ok(disabled.includes("submitter.display_name"));
  assert.ok(disabled.includes("descriptions.intro_comment"));
  assert.ok(!disabled.includes("video.title"));
  assert.equal(disabled.length, GENERAL_EDITABLE_FIELD_KEYS.length - 1);
});

test("disabledFieldKeysFromGeneralFields: music key maps to video.music (covers music_reference_url UI)", () => {
  const disabled = disabledFieldKeysFromGeneralFields(new Set(["title"]));
  assert.ok(disabled.includes("video.music"));
});

test("field-level policy controls stage permission", () => {
  assert.ok(
    disabledFieldKeysFromGeneralFields(new Set(["stage_permission"])).every(
      (field) => field !== "descriptions.stage_permission",
    ),
  );
  assert.ok(
    disabledFieldKeysFromGeneralFields(new Set()).includes("descriptions.stage_permission"),
  );
});

test("sectionAllowedByGeneralFields: members without chapters", () => {
  const membersOnly = new Set(["members"]);
  assert.equal(sectionAllowedByGeneralFields("video.members", membersOnly), true);
  assert.equal(sectionAllowedByGeneralFields("video.member_chapters", membersOnly), false);
});

test("sectionAllowedByGeneralFields: empty fields deny all sections", () => {
  const empty = new Set();
  assert.equal(sectionAllowedByGeneralFields("video.basics", empty), false);
  assert.equal(sectionAllowedByGeneralFields("video.members", empty), false);
  assert.equal(sectionAllowedByGeneralFields("video.member_chapters", empty), false);
});
