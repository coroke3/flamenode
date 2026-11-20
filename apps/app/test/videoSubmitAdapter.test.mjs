// MIG-0714 U02a: actual CURRENT VideoForm action mode to injected SPA FormData parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mapVideoSubmitMode,
  submitVideoForm,
} from "../.test-dist/apps/app/src/components/forms/videoSubmitAdapter.js";

test("U02a: CURRENT free/slot/edit maps exactly to injected free/slot/update", () => {
  assert.deepEqual(
    ["free", "slot", "edit"].map((mode) => mapVideoSubmitMode(mode)),
    ["free", "slot", "update"],
  );
  const legacy = readFileSync(new URL("../../../src/components/forms/VideoForm.tsx", import.meta.url), "utf8");
  assert.match(legacy, /mode === "slot"\s*\? submitSlotVideo/);
  assert.match(legacy, /mode === "edit"\s*\? updateVideo/);
  assert.match(legacy, /:\s*createFreeVideo;/);
});

test("U02a: preserves FormData identity, repeated entries, ordering and File data", async () => {
  const data = new FormData();
  data.append("youtube_url", "https://youtu.be/dQw4w9WgXcQ");
  data.append("event_ids", "event-A");
  data.append("event_ids", "event-B");
  data.append("members", "member-A");
  data.append("members", "member-B");
  data.append("custom_answers", "answer-A");
  data.append("custom_answers", "answer-B");
  const file = new File(["binary-icon"], "icon.png", { type: "image/png" });
  data.append("icon_file", file);
  let calls = 0;
  const sent = [...data.entries()];
  const response = { ok: true, message: "投稿完了", videoId: "v-1" };
  for (const mode of ["free", "slot", "edit"]) {
    const returned = await submitVideoForm(mode, data, async (actualMode, actualData) => {
      calls++;
      assert.equal(actualMode, mapVideoSubmitMode(mode));
      assert.strictEqual(actualData, data, "must not rebuild FormData and drop repeated fields");
      assert.deepEqual([...actualData.entries()], sent);
      assert.strictEqual(actualData.get("icon_file"), file);
      return response;
    });
    assert.strictEqual(returned, response);
  }
  assert.equal(calls, 3);
  assert.deepEqual(data.getAll("event_ids"), ["event-A", "event-B"]);
  assert.deepEqual(data.getAll("members"), ["member-A", "member-B"]);
  assert.deepEqual([...data.entries()], sent);
});

test("U02a: denies malformed runtime mode before invoking the submit adapter", async () => {
  const data = new FormData();
  let invoked = false;
  assert.throws(() => submitVideoForm("bad-mode", data, async () => {
    invoked = true;
    return { ok: true };
  }), { name: "TypeError", message: "Unsupported video submission mode" });
  assert.equal(invoked, false);
});

test("U02a: rejected API response remains unchanged, without extra browser redirect", async () => {
  const data = new FormData();
  data.append("title", "test");
  const rejected = { ok: false, reason: "tos_required", message: "規約に同意してください" };
  const result = await submitVideoForm("edit", data, async (mode, fd) => {
    assert.equal(mode, "update");
    assert.equal(fd.get("title"), "test");
    return rejected;
  });
  assert.strictEqual(result, rejected);
  // Guard redirects and draft changes remain in the future VideoForm caller.
});

test("U02a: adapter promise rejection propagates, rather than reporting false success", async () => {
  const data = new FormData();
  await assert.rejects(
    submitVideoForm("slot", data, async () => { throw new Error("synthetic D1 unavailable"); }),
    /synthetic D1 unavailable/,
  );
});

test("U02a: submission adapter contains no network, Next Server Action or direct storage fallback", () => {
  const source = readFileSync(new URL("../src/components/forms/videoSubmitAdapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']next(?:\/|["'])/);
  assert.doesNotMatch(source, /@\/lib\/actions|createFreeVideo|submitSlotVideo|updateVideo/);
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|indexedDB|navigator\./);
});
