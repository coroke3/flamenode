import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("../../../scripts/ts-path-alias-loader.mjs", import.meta.url);

const {
  firstMissingRequiredVideoField,
  formatRequiredVideoFieldSummary,
  missingRequiredVideoFieldMessage,
  parseRequiredVideoFields,
  serializeRequiredVideoFields,
  serializeRequiredVideoFieldsFromForm,
  unionRequiredVideoFields,
} = await import("./requiredVideoFields.ts");

test("必須指定は allow-list だけを正本順で残す", () => {
  assert.deepEqual(parseRequiredVideoFields('["youtube_url","music","youtube_url","title"]'), [
    "music",
    "youtube_url",
  ]);
  assert.equal(
    serializeRequiredVideoFields(["youtube_url", "music"]),
    JSON.stringify(["music", "youtube_url"]),
  );
  assert.equal(serializeRequiredVideoFields([]), null);
  assert.deepEqual(parseRequiredVideoFields("not-json"), []);
});

test("複数イベントの必須指定は和集合になる", () => {
  assert.deepEqual(
    unionRequiredVideoFields(['["youtube_url"]', '["music","credit"]', null]),
    ["music", "credit", "youtube_url"],
  );
});

test("フォームは present フラグがあるときだけ上書きする", () => {
  const omitted = new FormData();
  assert.equal(serializeRequiredVideoFieldsFromForm(omitted), undefined);

  const empty = new FormData();
  empty.set("required_video_fields_present", "1");
  assert.equal(serializeRequiredVideoFieldsFromForm(empty), null);

  const selected = new FormData();
  selected.set("required_video_fields_present", "1");
  selected.append("required_video_fields", "youtube_url");
  selected.append("required_video_fields", "music");
  selected.append("required_video_fields", "title");
  assert.equal(
    serializeRequiredVideoFieldsFromForm(selected),
    JSON.stringify(["music", "youtube_url"]),
  );

  const hiddenJson = new FormData();
  hiddenJson.set("required_video_fields_present", "1");
  hiddenJson.set(
    "required_video_fields_json",
    JSON.stringify(["youtube_url", "music"]),
  );
  assert.equal(
    serializeRequiredVideoFieldsFromForm(hiddenJson),
    JSON.stringify(["music", "youtube_url"]),
  );
});

test("未入力の必須項目だけを欠けとして返す", () => {
  const values = {
    music: "song",
    youtube_url: "",
    icon_mode: "keep",
    icon_url: null,
    other_social_links: "[]",
  };
  assert.equal(
    firstMissingRequiredVideoField(["music", "youtube_url"], values),
    "youtube_url",
  );
  assert.equal(
    firstMissingRequiredVideoField(["icon_url"], values),
    null,
  );
  assert.equal(
    firstMissingRequiredVideoField(["other_social_links"], values),
    "other_social_links",
  );
  assert.equal(
    firstMissingRequiredVideoField(["youtube_url"], values, new Set(["music"])),
    null,
  );
});

test("必須メッセージと要約は日本語ラベルを使う", () => {
  assert.equal(
    missingRequiredVideoFieldMessage("youtube_url"),
    "「YouTube URL」は必須です。",
  );
  assert.equal(formatRequiredVideoFieldSummary(null), "表示名とタイトルのみ");
  assert.equal(
    formatRequiredVideoFieldSummary('["music","youtube_url"]'),
    "使用楽曲、YouTube URL",
  );
});
