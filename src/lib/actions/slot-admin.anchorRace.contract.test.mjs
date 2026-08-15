import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = async (relative) =>
  readFile(new URL(relative, import.meta.url), "utf8");

test("admin release requires the requested anchor to remain in its group", async () => {
  const source = await read("./slot-admin.ts");
  const releaseBlock = source.slice(
    source.indexOf("export async function releaseSlot"),
    source.indexOf("export async function deleteSlot"),
  );
  assert.match(
    releaseBlock,
    /!rows\.some\(\(candidate\) => candidate\.id === row\.id\)/,
  );
});

test("force release applies the same anchor membership guard", async () => {
  const source = await read("./slot-admin-danger.ts");
  const releaseBlock = source.slice(
    source.indexOf("export async function forceReleaseSubmittedSlot"),
    source.indexOf("const videoId = row.video_id"),
  );
  assert.match(
    releaseBlock,
    /!targetRows\.some\(\(candidate\) => candidate\.id === row\.id\)/,
  );
});
