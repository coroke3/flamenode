import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH,
  formatYoutubeDescriptionMembers,
  normalizeYoutubeDescriptionTemplate,
  renderYoutubeDescriptionTemplate,
} from "./youtubeDescriptionTemplate.ts";

test("renders known variables and normalizes line endings", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "{{event_title}}\r\n{{title}} / {{youtube_video_id}}",
    {
      event_title: "春の上映会",
      title: "First Light",
      youtube_video_id: "abc123",
    },
  );

  assert.equal(rendered.text, "春の上映会\nFirst Light / abc123");
  assert.deepEqual(rendered.unknownVariables, []);
  assert.deepEqual(rendered.usedVariables, [
    "event_title",
    "title",
    "youtube_video_id",
  ]);
});

test("unknown variables are removed and reported", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "title={{title}} typo={{titlle}} invalid={{bad-key}}",
    { title: "作品" },
  );

  assert.equal(rendered.text, "title=作品 typo= invalid=");
  assert.deepEqual(rendered.unknownVariables, ["bad-key", "titlle"]);
});

test("missing values become empty strings without throwing", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "{{creator_name}}|{{members}}|{{member_names}}|{{member_x_ids}}|{{member_roles}}|{{member_comments}}|{{part}}",
    {},
  );
  assert.equal(rendered.text, "||||||");
});

test("member values can be selected independently and empty fields stay blank", () => {
  const values = formatYoutubeDescriptionMembers([
    { name: "Alice", x_user_id: "@Alice_X", role: "作画", comment: "担当" },
    { name: "", x_user_id: "", role: "", comment: "" },
    { name: "Bob", x_user_id: "", role: "", comment: "" },
  ]);

  assert.deepEqual(values, {
    members: "Alice / Bob",
    member_names: "Alice / Bob",
    member_x_ids: "@alice_x",
    member_roles: "作画",
    member_comments: "担当",
  });
  assert.equal(
    renderYoutubeDescriptionTemplate(
      "{{members}}\n{{member_x_ids}}\n{{member_roles}}\n{{member_comments}}",
      values,
    ).text,
    "Alice / Bob\n@alice_x\n作画\n担当",
  );
  assert.deepEqual(formatYoutubeDescriptionMembers([]), {
    members: "",
    member_names: "",
    member_x_ids: "",
    member_roles: "",
    member_comments: "",
  });
});

test("normalization trims and rendering bounds oversized templates", () => {
  assert.equal(normalizeYoutubeDescriptionTemplate("  a\r\nb  "), "a\nb");
  assert.equal(normalizeYoutubeDescriptionTemplate("   "), null);
  assert.equal(
    renderYoutubeDescriptionTemplate(
      "x".repeat(MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH + 10),
      {},
    ).text.length,
    MAX_YOUTUBE_DESCRIPTION_TEMPLATE_LENGTH,
  );
});

const LOOP_MEMBERS = [
  {
    name: "Alice",
    x_user_id: "@Alice_X",
    role: "映像",
    comment: "モーション担当",
    chapters: [{ time: "1:23" }, { time: "12:5" }],
  },
  { name: "Bob", x_user_id: "", role: "", comment: "", chapters: [] },
];

test("members loop repeats per member in input order", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "{{#members}}{{member_index}}. {{member_name}} @{{member_x_id}}\n{{/members}}",
    {},
    { members: LOOP_MEMBERS },
  );
  assert.equal(rendered.text, "1. Alice @alice_x\n2. Bob @\n");
  assert.deepEqual(rendered.unknownVariables, []);
  assert.deepEqual(rendered.templateWarnings, []);
});

test("members loop disappears entirely with zero members", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "参加者:\n{{#members}}- {{member_name}}\n{{/members}}おわり",
    {},
    { members: [] },
  );
  assert.equal(rendered.text, "参加者:\nおわり");
  const noOption = renderYoutubeDescriptionTemplate(
    "{{#members}}x{{/members}}",
    {},
  );
  assert.equal(noOption.text, "");
});

test("members loop exposes chapter helpers and preserves display casing", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "{{#members}}{{member_chapter}}/{{member_chapters}}/{{member_role}}/{{member_comment}}\n{{/members}}",
    {},
    { members: LOOP_MEMBERS },
  );
  // member_chapter は最初のチャプター、member_chapters は ; 区切り、時刻は正規化される。
  assert.equal(
    rendered.text,
    "1:23/1:23;12:05/映像/モーション担当\n///\n",
  );
  const blankRole = renderYoutubeDescriptionTemplate(
    "{{#members}}[{{member_role}}][{{member_comment}}]{{/members}}",
    {},
    {
      members: [
        { name: "Bob", x_user_id: "BOB", role: "  ", comment: "" },
      ],
    },
  );
  assert.equal(blankRole.text, "[][]");
});

test("scalar {{members}} and loop {{#members}} coexist", () => {
  const values = formatYoutubeDescriptionMembers(LOOP_MEMBERS);
  const rendered = renderYoutubeDescriptionTemplate(
    "{{members}}\n{{#members}}* {{member_name}}\n{{/members}}",
    values,
    { members: LOOP_MEMBERS },
  );
  assert.equal(rendered.text, "Alice / Bob\n* Alice\n* Bob\n");
  assert.deepEqual(rendered.usedVariables, ["members"]);
});

test("unknown variables inside loop bodies are removed and reported", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "{{#members}}{{member_name}} {{titlle}}{{/members}}",
    {},
    { members: [{ name: "Alice" }] },
  );
  assert.equal(rendered.text, "Alice ");
  assert.deepEqual(rendered.unknownVariables, ["titlle"]);
});

test("unclosed members loop is dropped safely without leaking raw tokens", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "A\n{{#members}}{{member_name}}\nB {{title}}",
    { title: "T" },
    { members: [{ name: "Alice" }] },
  );
  assert.equal(rendered.text, "A\n\nB T");
  assert.ok(rendered.templateWarnings.length > 0);
  assert.ok(!rendered.text.includes("{{"));
});

test("nested members loops are rejected and the whole block removed", () => {
  const rendered = renderYoutubeDescriptionTemplate(
    "{{#members}}A{{#members}}B{{/members}}C{{/members}}D",
    {},
    { members: [{ name: "X" }] },
  );
  assert.equal(rendered.text, "D");
  assert.ok(
    rendered.templateWarnings.some((w) => w.includes("ネスト")),
  );
  assert.ok(!rendered.text.includes("{{"));
});

test("stray close tag is removed with a warning", () => {
  const rendered = renderYoutubeDescriptionTemplate("A\n{{/members}}\nB", {});
  assert.equal(rendered.text, "A\n\nB");
  assert.ok(rendered.templateWarnings.length > 0);
});
