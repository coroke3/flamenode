import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERAL_EDITABLE_FIELD_KEYS,
  disabledFieldKeysFromGeneralFields,
  normalModeAlwaysDisabledFieldKeys,
  normalizeGeneralEditableFields,
  parseGeneralEditableFields,
  resolveGeneralEditableScope,
  sectionAllowedByGeneralFields,
  serializeGeneralEditableFields,
} from "./generalEditPermissionsCore.ts";

test("normal owner field registry never exposes YouTube ID editing", () => {
  assert.equal(GENERAL_EDITABLE_FIELD_KEYS.includes("youtube_url"), false);
  assert.equal(
    sectionAllowedByGeneralFields("video.youtube_id", new Set(["title"])),
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

test("normalModeAlwaysDisabledFieldKeys: field-level policy controls stage permission", () => {
  const keys = normalModeAlwaysDisabledFieldKeys();
  assert.deepEqual(keys, []);
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
