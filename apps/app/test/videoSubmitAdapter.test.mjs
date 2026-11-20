// MIG-0714 U02a: actual CURRENT VideoForm action mode to injected SPA FormData parity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mapVideoSubmitMode,
  submitVideoForm,
  videoMemberAdapterProps,
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

test("U02b: mandatory member adapters are exact callable references, including AbortSignal", async () => {
  const controller = new AbortController();
  const seen = [];
  const searchOutput = {
    items: [{ id: "x_A", x_name: "Alice", score: 0.8, matchedBy: "name" }],
    hasMore: true,
    nextOffset: 20,
    hint: null,
  };
  const ports = {
    submit: async () => ({ ok: true }),
    searchXUsers: async (q, offset, signal) => {
      seen.push({ q, offset, signal });
      return searchOutput;
    },
    applyPermissionBatch: async () => ({ ok: true }),
  };
  const member = videoMemberAdapterProps(ports);
  assert.deepEqual(Object.keys(member), ["searchXUsers", "applyPermissionBatch"]);
  assert.strictEqual(member.searchXUsers, ports.searchXUsers);
  assert.strictEqual(member.applyPermissionBatch, ports.applyPermissionBatch);
  assert.ok(!("submit" in member), "member component cannot invoke the VideoForm submit port");
  assert.strictEqual(await member.searchXUsers("@Alice", 20, controller.signal), searchOutput);
  assert.deepEqual(seen, [{ q: "@Alice", offset: 20, signal: controller.signal }]);
  controller.abort();
  assert.equal(seen[0].signal.aborted, true, "no AbortSignal replacement");
});

test("U02b: member permission batch forwards all intents and privilege mode unchanged", async () => {
  const input = {
    videoId: "v-17",
    edit_privilege_mode: "event",
    notify: true,
    intents: [
      { x_user_id: "x_A", display_name: "Alice", intent: "on" },
      { x_user_id: "x_B", display_name: "Bob", intent: "off" },
    ],
  };
  const denied = { ok: false, message: "forbidden" };
  let calls = 0;
  const ports = {
    submit: async () => ({ ok: true }),
    searchXUsers: async () => ({ items: [] }),
    applyPermissionBatch: async (actual) => {
      calls += 1;
      assert.strictEqual(actual, input, "do not clone or strip permission intents");
      return denied;
    },
  };
  const member = videoMemberAdapterProps(ports);
  const outcome = await member.applyPermissionBatch(input);
  assert.strictEqual(outcome, denied, "do not turn permission failure into success");
  assert.equal(calls, 1);
  assert.equal(input.intents[1].intent, "off");
});

test("U02b: member adapter exceptions are not swallowed by the port forwarder", async () => {
  const sentinel = new Error("synthetic backend failure");
  const ports = {
    submit: async () => ({ ok: true }),
    searchXUsers: async () => { throw sentinel; },
    applyPermissionBatch: async () => { throw sentinel; },
  };
  const member = videoMemberAdapterProps(ports);
  await assert.rejects(member.searchXUsers("x", 0, new AbortController().signal), (e) => e === sentinel);
  await assert.rejects(member.applyPermissionBatch({ videoId: "v1", notify: true, intents: [] }), (e) => e === sentinel);
});
