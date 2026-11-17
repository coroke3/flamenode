import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { saveAdminVideoMembers } from "../.test-dist/apps/ops/src/api/adminVideoMemberSave.js";

function form({ videoId = "video-1", collab = true, members = [{ name: "Alice" }] } = {}) {
  const data = new FormData();
  data.set("video_id", videoId);
  data.append("is_collab", "false");
  if (collab) data.append("is_collab", "true");
  data.set("members_json", JSON.stringify(members));
  return data;
}
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

test("MIG-0730 U02g: path-authoritative SA-085 PUT; literal checkbox order, no body video_id", async () => {
  const calls = [];
  const result = await saveAdminVideoMembers("video-1", form(), async (path, init) => {
    calls.push({ path, init });
    return reply({ ok: true, videoId: "video-1", message: "保存しました", pendingPublicReflection: true });
  });
  assert.deepEqual(result, { ok: true, message: "保存しました", pendingPublicReflection: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/videos/video-1/members");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, {
    accept: "application/json", "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    is_collab: ["false", "true"], members_json: JSON.stringify([{ name: "Alice" }]),
  });
});

test("MIG-0730 U02g: collab OFF sends exactly false and an empty member array", async () => {
  let calls = 0;
  const result = await saveAdminVideoMembers("v 1", form({
    videoId: "v 1", collab: false, members: [],
  }), async (path, init) => {
    calls++;
    assert.equal(path, "/api/videos/v%201/members");
    assert.deepEqual(JSON.parse(init.body), { is_collab: ["false"], members_json: "[]" });
    return reply({ ok: true, videoId: "v 1" });
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 1);
});

test("MIG-0730 U02g: 100 member limit and 101-member fail-closed before HTTP", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return reply({ ok: true, videoId: "video-1" }); };
  const members = Array.from({ length: 100 }, (_, i) => ({ name: "member " + i }));
  assert.equal((await saveAdminVideoMembers("video-1", form({ members }), fetchFn)).ok, true);
  assert.equal((await saveAdminVideoMembers("video-1", form({ members: [...members, {}] }), fetchFn)).ok, false);
  assert.equal(calls, 1);
});

test("MIG-0730 U02g: forged video IDs, invalid FormData and private member fail closed", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return reply({ ok: true }); };
  const cases = [
    ["different", form()],
    ["../v1", form({ videoId: "../v1" })],
    ["v\\x00", form({ videoId: "v\\x00" })],
    ["v/1", form({ videoId: "v/1" })],
    ["\\uD800", form({ videoId: "\\uD800" })],
    ["video-1", form({ members: [{ is_public_member: 0 }] })],
  ];
  for (const [id, data] of cases) {
    assert.equal((await saveAdminVideoMembers(id, data, fetchFn)).ok, false);
  }
  const wrong = form();
  wrong.append("video_id", "other");
  assert.equal((await saveAdminVideoMembers("video-1", wrong, fetchFn)).ok, false);
  const missing = form();
  missing.delete("members_json");
  assert.equal((await saveAdminVideoMembers("video-1", missing, fetchFn)).ok, false);
  const malformed = form();
  malformed.set("members_json", "{");
  assert.equal((await saveAdminVideoMembers("video-1", malformed, fetchFn)).ok, false);
  const file = form();
  file.set("members_json", new Blob(["[]"]), "payload.json");
  assert.equal((await saveAdminVideoMembers("video-1", file, fetchFn)).ok, false);
  assert.equal(calls, 0);
});

test("MIG-0730 U02g: 401/403/409/503, lost response and forged 200 are unverified; no retry", async () => {
  for (const status of [401, 403, 409, 503]) {
    let calls = 0;
    const result = await saveAdminVideoMembers("video-1", form(), async () => {
      calls++;
      return reply({ ok: false, message: "secret" }, status);
    });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /secret/);
    assert.equal(calls, 1);
  }
  for (const body of [
    null, [], { ok: "true" }, { ok: false },
    { ok: true }, { ok: true, videoId: null }, { ok: true, videoId: "" },
    { ok: true, videoId: "another" },
    { ok: true, videoId: "video-1", pendingPublicReflection: "yes" },
    { ok: true, videoId: "video-1", message: 123 },
  ]) {
    const result = await saveAdminVideoMembers("video-1", form(), async () => reply(body));
    assert.equal(result.ok, false);
  }
  let calls = 0;
  const ambiguous = await saveAdminVideoMembers("video-1", form(), async () => {
    calls++;
    throw new Error("network disappeared after server commit");
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(calls, 1);
});

test("MIG-0730 U02g: client remains unmounted and has no direct D1 or auth bypass", async () => {
  const root = new URL("../src/", import.meta.url);
  for (const source of [
    "App.tsx",
    "routes/admin/AdminVideoMembersEditorPreview.tsx",
    "routes/admin/AdminVideoMembersForm.tsx",
  ]) {
    const text = await readFile(new URL(source, root), "utf8");
    assert.doesNotMatch(text, /adminVideoMemberSave/);
  }
  const candidate = await readFile(new URL("../src/api/adminVideoMemberSave.ts", import.meta.url), "utf8");
  assert.doesNotMatch(candidate, /from "next|from "hono|from "drizzle|\.prepare\(|\.batch\(/);
});

test("MIG-0730 U02j: forged checkbox order, duplicates and stale collaboration-OFF rows never send a PUT", async () => {
  const cases = [];
  const missing = form(); missing.delete("is_collab"); cases.push(missing);
  const onlyTrue = form(); onlyTrue.delete("is_collab"); onlyTrue.append("is_collab", "true"); cases.push(onlyTrue);
  const inverted = form(); inverted.delete("is_collab"); inverted.append("is_collab", "true"); inverted.append("is_collab", "false"); cases.push(inverted);
  const extraTrue = form(); extraTrue.append("is_collab", "true"); cases.push(extraTrue);
  const duplicateFalse = form({ collab: false, members: [] }); duplicateFalse.append("is_collab", "false"); cases.push(duplicateFalse);
  const legacyOn = form(); legacyOn.set("is_collab", "on"); cases.push(legacyOn);
  const staleOff = form({ collab: false, members: [{ name: "STALE" }] }); cases.push(staleOff);
  const repeatedJson = form(); repeatedJson.append("members_json", "[]"); cases.push(repeatedJson);

  let calls = 0;
  const fetchFn = async () => { calls++; return reply({ ok: true }); };
  for (const [i, data] of cases.entries()) {
    const result = await saveAdminVideoMembers("video-1", data, fetchFn);
    assert.equal(result.ok, false, "invalid FormData case " + i);
  }
  assert.equal(calls, 0, "forged checkbox, conflicting members and duplicate fields must fail before HTTP");
});

test("MIG-0730 U02j: valid ON with zero participants keeps exact two-value transport contract", async () => {
  const data = form({ collab: true, members: [] });
  let calls = 0;
  const result = await saveAdminVideoMembers("video-1", data, async (_path, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body), {
      is_collab: ["false", "true"], members_json: "[]",
    });
    return reply({ ok: true, videoId: "video-1" });
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("MIG-0730 U02v: success must include path-matching videoId; ambiguous 200 cannot refresh", async () => {
  let requests = 0;
  for (const body of [
    { ok: true },
    { ok: true, videoId: null },
    { ok: true, videoId: "other-video" },
    { ok: true, videoId: 123 },
  ]) {
    const result = await saveAdminVideoMembers("video-1", form(), async () => {
      requests++;
      return reply(body);
    });
    assert.deepEqual(result, {
      ok: false,
      message: "保存結果を確認できませんでした。最新状態を再取得してください。",
    });
  }
  assert.equal(requests, 4, "never automatically replay an ambiguous write");
  const verified = await saveAdminVideoMembers("video-1", form(), async () => {
    requests++;
    return reply({ ok: true, videoId: "video-1", pendingPublicReflection: false });
  });
  assert.deepEqual(verified, { ok: true, pendingPublicReflection: false });
  assert.equal(requests, 5);
});

test("MIG-0730 U02ak: public member PUT rejects can_edit intent before HTTP", async () => {
  let requests = 0;
  const fetchFn = async () => {
    requests++;
    return reply({ ok: true, videoId: "video-1" });
  };
  for (const flag of [1, 0, true, false, null, "on"]) {
    const forged = form({ members: [{ name: "Alice", can_edit: flag }] });
    const result = await saveAdminVideoMembers("video-1", forged, fetchFn);
    assert.equal(result.ok, false, "can_edit=" + String(flag) + " must never enter SA-085 transport");
    assert.match(result.message, /入力を確認/);
  }
  assert.equal(requests, 0, "forged privilege flags must fail before sending HTTP");

  const allowed = form({ members: [{
    name: "Alice", x_user_id: "alice", role: "", comment: "",
    chapters: [], is_public_member: 1,
  }] });
  assert.equal((await saveAdminVideoMembers("video-1", allowed, fetchFn)).ok, true,
    "ordinary public member fields remain supported");
  assert.equal(requests, 1);
});

test("MIG-0730 U02au: SA-085 candidate honors exact 256 KiB UTF-8 JSON envelope", async () => {
  const limit = 256 * 1024;
  const wrapperBytes = new TextEncoder().encode(JSON.stringify({
    is_collab: ["false", "true"],
    members_json: JSON.stringify([{ name: "" }]),
  })).byteLength;
  const exact = form({ members: [{ name: "x".repeat(limit - wrapperBytes) }] });
  const oversized = form({ members: [{ name: "x".repeat(limit - wrapperBytes + 1) }] });
  let sends = 0;
  const fetchFn = async (_path, init) => {
    sends++;
    assert.equal(new TextEncoder().encode(init.body).byteLength, limit);
    return reply({ ok: true, videoId: "video-1" });
  };
  assert.equal((await saveAdminVideoMembers("video-1", exact, fetchFn)).ok, true,
    "an exact-limit transport envelope can be sent (not a CURRENT field-length acceptance certificate)");
  assert.equal((await saveAdminVideoMembers("video-1", oversized, fetchFn)).ok, false,
    "one extra wire byte must fail before HTTP");
  assert.equal(sends, 1);
});

test("MIG-0730 U02au: multi-byte and oversized raw members fail before HTTP", async () => {
  let sends = 0;
  const fetchFn = async () => {
    sends++;
    return reply({ ok: true, videoId: "video-1" });
  };
  const multibyte = form({ members: [{ name: "あ".repeat(90_000) }] });
  const raw = multibyte.get("members_json");
  assert.ok(raw.length < 256 * 1024, "UTF-16 code units alone undercount UTF-8");
  assert.ok(new TextEncoder().encode(JSON.stringify({
    is_collab: ["false", "true"], members_json: raw,
  })).byteLength > 256 * 1024);
  assert.equal((await saveAdminVideoMembers("video-1", multibyte, fetchFn)).ok, false);

  const huge = form();
  huge.set("members_json", "[" + " ".repeat(300_000) + "]");
  assert.equal((await saveAdminVideoMembers("video-1", huge, fetchFn)).ok, false);
  assert.equal(sends, 0, "oversized local input cannot reach the write endpoint");
});

test("MIG-0730 U02av: schema-permitted 100 × 30 chapter upper-bound exceeds provisional Hono cap", async () => {
  // Corresponds to MIG-0650 adminMemberSubmission.ts CURRENT limits:
  // 100 public members, 30 chapters each, 80-character names/roles,
  // 500-character comments, 120-character chapter labels, 1000-character notes.
  // Even ASCII-only *legal-length* data exceeds the unmounted 256 KiB server
  // body policy. This is a release parity STOP, not a reason to mount/bypass it.
  const members = Array.from({ length: 100 }, (_, i) => ({
    name: "M".repeat(80),
    x_user_id: "user_" + i,
    role: "R".repeat(80),
    comment: "C".repeat(500),
    chapters: Array.from({ length: 30 }, () => ({
      time: "00:00",
      label: "L".repeat(120),
      note: "N".repeat(1000),
    })),
  }));
  const payload = form({ members });
  const membersJson = payload.get("members_json");
  const wire = JSON.stringify({
    is_collab: ["false", "true"], members_json: membersJson,
  });
  const bytes = new TextEncoder().encode(wire).byteLength;
  assert.equal(members.length, 100);
  assert.equal(members[0].chapters.length, 30);
  assert.ok(bytes > 3_000_000, "legal-length payload substantially exceeds 256 KiB");
  assert.ok(bytes < 8 * 1024 * 1024, "not an arbitrary unbounded input");
  let requests = 0;
  const result = await saveAdminVideoMembers("video-1", payload, async () => {
    requests++;
    return reply({ ok: true, videoId: "video-1" });
  });
  assert.equal(result.ok, false, "a policy mismatch must fail closed rather than risk a 413");
  assert.equal(requests, 0);
});
