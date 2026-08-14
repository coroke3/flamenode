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
