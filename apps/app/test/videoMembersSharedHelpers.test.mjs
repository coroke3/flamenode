// MIG-0730 U01a — the active Personal member form/parser must consume shared UI helpers
// while their original external behavior remains stable.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseVideoMemberText, serializeVideoMemberTsv } from "../.test-dist/apps/app/src/lib/memberInput.js";
import { detectDelimiter, parseDelimited, scoreSimpleMemberSuggestion } from "@flamenode/ui";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("MIG-0730 U01a: real Personal member importer and field use shared helpers, not local runtime copies", async () => {
  const [parser, field, barrel] = await Promise.all([
    read("../src/lib/memberInput.ts"),
    read("../src/components/forms/VideoMembersField.tsx"),
    read("../../../packages/ui/src/index.ts"),
  ]);
  assert.match(parser, /\} from "@flamenode\/ui";/);
  assert.doesNotMatch(parser, /from "\.\/delimited\.js"/);
  assert.match(field, /import \{ scoreSimpleMemberSuggestion, writeTextToClipboard \} from "@flamenode\/ui";/);
  assert.doesNotMatch(field, /from "\.\.\/\.\.\/lib\/(?:memberSuggestionRank|clipboard)\.js"/);
  for (const file of ["delimited", "memberSuggestionRank", "clipboard"]) {
    assert.ok(barrel.includes(`./forms/videoMembers/${file}.js`));
  }
});

test("MIG-0730 U01a: Personal TSV export and import still round-trip quoted content, escaped quotes and X IDs", () => {
  const members = [{
    name: "Alice, A.", x_user_id: "@ALICE", role: "director",
    comment: 'multi\nline "quote"', chapters: [], can_edit: 0,
  }];
  const tsv = serializeVideoMemberTsv(members);
  assert.equal(detectDelimiter(tsv), "\t");
  assert.deepEqual(parseDelimited(tsv, "\t"), [
    ["Alice, A.", "alice", "", "director", 'multi\nline "quote"', "OFF"],
  ]);
  const parsed = parseVideoMemberText(tsv);
  assert.equal(parsed.members.length, 1);
  assert.equal(parsed.members[0].x_user_id, "alice");
  assert.equal(parsed.members[0].name, "Alice, A.");
  assert.equal(parsed.members[0].comment, 'multi\nline "quote"');
  assert.equal(parsed.members[0].can_edit, 0);
});

test("MIG-0730 U01a: member ranker keeps canonical X exact match ahead of partial names", () => {
  const exact = scoreSimpleMemberSuggestion("alice", { name: "Alice", x_user_id: "alice" });
  const partial = scoreSimpleMemberSuggestion("alice", { name: "Alice Creator", x_user_id: "alice_creator" });
  assert.ok(exact > partial, `exact ${exact} should outrank partial ${partial}`);
});
