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

test("MIG-0730 U02g: 401/403/409/503, lost response and forged 200 are never success; no retry", async () => {
  for (const status of [401, 403, 409, 503]) {
    let calls = 0;
    const result = await saveAdminVideoMembers("video-1", form(), async () => {
      calls++;
      return reply({ ok: false, message: "secret" }, status);
    });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /secret/);
    assert.equal(result.reason, status === 401 ? "unauthenticated" : undefined);
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

test("MIG-0730 U02bx: standalone SA-085 candidate rejects unexpected FormData keys before HTTP", async () => {
  let sends = 0;
  const fetchFn = async () => {
    sends++;
    return reply({ ok: true, videoId: "video-1" });
  };
  for (const collab of [true, false]) {
    const forged = form({ collab, members: collab ? [{ name: "Alice" }] : [] });
    forged.append("can_edit", "true");
    const response = await saveAdminVideoMembers("video-1", forged, fetchFn);
    assert.deepEqual(response, { ok: false, message: "参加者設定の入力を確認してください。" });
    assert.equal(sends, 0, "unexpected privilege field cannot trigger a PUT");
  }
  const unknown = form();
  unknown.append("legacy_extra", "untrusted");
  assert.equal((await saveAdminVideoMembers("video-1", unknown, fetchFn)).ok, false);
  assert.equal(sends, 0, "even an unrecognized non-privilege field must be rejected");

  assert.equal((await saveAdminVideoMembers("video-1", form(), fetchFn)).ok, true);
  assert.equal((await saveAdminVideoMembers("video-1", form({ collab: false, members: [] }), fetchFn)).ok, true);
  assert.equal(sends, 2, "canonical ON/OFF forms still reach the HTTP port");
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

test("MIG-0730 U02aw: legal 100-member / three-chapter payload obeys exact 256 KiB wire boundary", async () => {
  const limit = 256 * 1024;
  // Use valid CURRENT field-length limits instead of an impossible 262 KiB
  // member name: 100 members, three chapters each, 80/500/120/1000 caps.
  const members = Array.from({ length: 100 }, (_, i) => ({
    name: "Alice" + i,
    x_user_id: "user_" + i,
    role: "",
    comment: "",
    chapters: Array.from({ length: 3 }, () => ({
      time: "00:00", label: "", note: "x".repeat(792),
    })),
  }));
  const encode = rows => JSON.stringify({
    is_collab: ["false", "true"], members_json: JSON.stringify(rows),
  });
  const baseBytes = new TextEncoder().encode(encode(members)).byteLength;
  assert.ok(baseBytes <= limit && limit - baseBytes < 208,
    "the legal baseline must be within one short chapter note of the limit");
  const lastNote = members[99].chapters[2];
  lastNote.note += "x".repeat(limit - baseBytes);
  assert.ok(lastNote.note.length <= 1000, "the exact-limit note remains legal");

  const exact = form({ members });
  assert.equal(new TextEncoder().encode(encode(members)).byteLength, limit);
  let sends = 0;
  const fetchFn = async (_path, init) => {
    sends++;
    assert.equal(new TextEncoder().encode(init.body).byteLength, limit);
    return reply({ ok: true, videoId: "video-1" });
  };
  assert.equal((await saveAdminVideoMembers("video-1", exact, fetchFn)).ok, true,
    "legal CURRENT fields at the exact wire limit remain eligible to send");
  lastNote.note += "x";
  const over = await saveAdminVideoMembers("video-1", form({ members }), fetchFn);
  assert.equal(over.ok, false,
    "one extra wire byte is rejected despite otherwise legal field lengths");
  assert.match(over.message, /暫定256KiB制限/,
    "a legitimate oversized draft needs an actionable reason, not generic invalid JSON");
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
  assert.match(result.message, /現行の管理画面で保存してください/);
  assert.equal(requests, 0);
});

test("MIG-0730 U02ax: malformed and forged input retains a separate generic error", async () => {
  let sends = 0;
  const fetchFn = async () => { sends++; return reply({ ok: true, videoId: "video-1" }); };
  const malformed = form();
  malformed.set("members_json", "not json");
  const invalid = await saveAdminVideoMembers("video-1", malformed, fetchFn);
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /入力を確認してください/);
  assert.doesNotMatch(invalid.message, /256KiB|現行の管理画面/);
  const forged = form({ members: [{ name: "Alice", can_edit: true }] });
  const privilege = await saveAdminVideoMembers("video-1", forged, fetchFn);
  assert.equal(privilege.ok, false);
  assert.match(privilege.message, /入力を確認してください/);
  assert.doesNotMatch(privilege.message, /256KiB|現行の管理画面/);

  // Beyond the raw bound, do not parse/replay/truncate sensitive member rows.
  const tooLarge = form();
  tooLarge.set("members_json", "[" + " ".repeat(300_000) + "]");
  const overflow = await saveAdminVideoMembers("video-1", tooLarge, fetchFn);
  assert.equal(overflow.ok, false);
  assert.match(overflow.message, /暫定256KiB制限/);
  assert.match(overflow.message, /現行の管理画面で保存してください/);
  assert.equal(sends, 0);
});

test("MIG-0730 U02bl: same-video SA-085 direct client is single-flight even without a Preview", async () => {
  for (const outcome of ["success", "lost_response"]) {
    const videoId = "video-u02bl-" + outcome;
    const calls = [];
    let resolveFirst, rejectFirst;
    const waiting = new Promise((resolve, reject) => {
      resolveFirst = resolve; rejectFirst = reject;
    });
    const send = (path, init) => {
      calls.push({ path, init });
      return path.includes(videoId)
        ? waiting
        : Promise.resolve(reply({ ok: true, videoId: "different-video" }));
    };
    const first = saveAdminVideoMembers(videoId, form({ videoId }), send);
    assert.equal(calls.length, 1);
    const duplicate = await saveAdminVideoMembers(
      videoId, form({ videoId, members: [{ name: "Bob" }] }), send,
    );
    assert.deepEqual(duplicate, {
      ok: false,
      message: "この作品の参加者保存は処理中です。完了後に最新状態を確認してください。",
    });
    assert.equal(calls.length, 1, "same-video duplicate must not reach the PUT port");

    const other = await saveAdminVideoMembers(
      "different-video", form({ videoId: "different-video" }), send,
    );
    assert.deepEqual(other, { ok: true }, "a separate video is not blocked");
    assert.equal(calls.length, 2);

    if (outcome === "success") {
      resolveFirst(reply({ ok: true, videoId }));
    } else {
      rejectFirst(new Error("network response lost after server may have committed"));
    }
    const firstResult = await first;
    assert.equal(firstResult.ok, outcome === "success");
    assert.equal(calls.length, 2, "ambiguous PUT never retries itself");
    const explicitRetry = await saveAdminVideoMembers(
      videoId, form({ videoId }), async path => {
        calls.push({ path });
        return reply({ ok: true, videoId });
      },
    );
    assert.deepEqual(explicitRetry, { ok: true },
      "a new explicit action is allowed only after the original attempt settles");
    assert.equal(calls.length, 3);
  }
});

test("MIG-0730 U02cn: hostile FormData accessors and iterators reject before SA-085 HTTP", async () => {
  // The standalone, UNMOUNTED port is callable with injected FormData.
  // Its validation may throw before the fetch try/catch was reached.
  const throwingGetter = form();
  Object.defineProperty(throwingGetter, "getAll", {
    get() { throw new Error("PRIVATE_GETALL_ACCESSOR"); },
  });
  const throwingGetAll = form();
  throwingGetAll.getAll = () => { throw new Error("PRIVATE_GETALL_CALL"); };
  const throwingForEach = form();
  throwingForEach.forEach = () => { throw new Error("PRIVATE_FOREACH"); };
  const revoked = Proxy.revocable(form(), {});
  revoked.revoke();

  let requests = 0;
  const fetchFn = async () => {
    requests++;
    return reply({ ok: true, videoId: "video-1" });
  };
  for (const data of [throwingGetter, throwingGetAll, throwingForEach, revoked.proxy]) {
    const result = await saveAdminVideoMembers("video-1", data, fetchFn);
    assert.deepEqual(result, {
      ok: false, message: "参加者設定の入力を確認してください。",
    });
  }
  assert.equal(requests, 0, "hostile inputs may not reach PUT or disclose exception detail");
  assert.equal((await saveAdminVideoMembers("video-1", form(), fetchFn)).ok, true,
    "ordinary canonical FormData is unaffected");
  assert.equal(requests, 1);
});
 
test("MIG-0730 U02cx: SA-085 injected HTTP receipt cannot change failed validation into success", async () => {
  const reads = { ok: 0, videoId: 0, message: 0, pending: 0 };
  const receipt = {};
  Object.defineProperties(receipt, {
    ok: { get() { reads.ok++; return reads.ok === 1 ? false : true; } },
    videoId: { get() { reads.videoId++; return reads.videoId === 1 ? "video-1" : "other"; } },
    message: { get() { reads.message++; return reads.message === 1 ? "verified" : "PRIVATE_TOKEN"; } },
    pendingPublicReflection: { get() { reads.pending++; return reads.pending === 1 ? false : true; } },
  });
  let calls = 0;
  const got = await saveAdminVideoMembers("video-1", form(), async () => {
    calls++;
    return { status: 200, json: async () => receipt };
  });
  assert.deepEqual(got, { ok: false, message: "保存結果を確認できませんでした。最新状態を再取得してください。" });
  assert.deepEqual(reads, { ok: 1, videoId: 1, message: 1, pending: 1 });
  assert.equal(calls, 1, "an ambiguous server write must never be retried");
  assert.doesNotMatch(got.message, /PRIVATE_TOKEN/);
});

test("MIG-0730 U02cx: SA-085 receipt display cannot change after validation", async () => {
  const reads = { message: 0, pending: 0 };
  const receipt = { ok: true, videoId: "video-1" };
  Object.defineProperties(receipt, {
    message: { get() { reads.message++; return reads.message === 1 ? "saved" : "PRIVATE_LATER"; } },
    pendingPublicReflection: { get() { reads.pending++; return reads.pending === 1 ? false : true; } },
  });
  const got = await saveAdminVideoMembers("video-1", form(), async () => ({
    status: 200, json: async () => receipt,
  }));
  assert.deepEqual(got, { ok: true, message: "saved", pendingPublicReflection: false });
  assert.deepEqual(reads, { message: 1, pending: 1 });
  const revoked = Proxy.revocable({ ok: true, videoId: "video-1" }, {});
  revoked.revoke();
  assert.equal((await saveAdminVideoMembers("video-1", form(), async () => ({
    status: 200, json: async () => revoked.proxy,
  }))).ok, false, "revoked provider reply is ambiguous, never confirmed");
});

test("MIG-0730 U02dl: SA-085 binds every source FormData index exactly once", async () => {
  const expectedMember = '[{"name":"Alice"}]';
  const forgedMember = '[{"name":"SECRET","can_edit":true}]';
  const reads = { id: 0, falseFlag: 0, trueFlag: 0, member: 0 };
  const dynamic = form();
  dynamic.getAll = key => {
    if (key === "video_id") return Object.defineProperty(["video-1"], 0, {
      get() { reads.id++; return reads.id === 1 ? "video-1" : "different-video"; },
    });
    if (key === "is_collab") {
      const flags = ["false", "true"];
      Object.defineProperties(flags, {
        0: { get() { reads.falseFlag++; return reads.falseFlag === 1 ? "false" : "true"; } },
        1: { get() { reads.trueFlag++; return reads.trueFlag === 1 ? "true" : "false"; } },
      });
      return flags;
    }
    if (key === "members_json") return Object.defineProperty([expectedMember], 0, {
      get() { reads.member++; return reads.member === 1 ? expectedMember : forgedMember; },
    });
    return [];
  };
  let requests = 0;
  const result = await saveAdminVideoMembers("video-1", dynamic, async (_, init) => {
    requests++;
    assert.deepEqual(JSON.parse(init.body), {
      is_collab: ["false", "true"], members_json: expectedMember,
    }, "only the validated video/checkbox/member primitives can reach SA-085");
    return reply({ ok: true, videoId: "video-1" });
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(requests, 1);
  assert.deepEqual(reads, { id: 1, falseFlag: 1, trueFlag: 1, member: 1 });
});

test("MIG-0730 U02dl: non-array getAll collections are rejected before HTTP", async () => {
  const forged = form();
  forged.getAll = key => ({
    length: key === "is_collab" ? 2 : 1,
    0: key === "is_collab" ? "false" : key === "video_id" ? "video-1" : "[]",
    1: "true",
  });
  let requests = 0;
  const result = await saveAdminVideoMembers("video-1", forged, async () => {
    requests++;
    return reply({ ok: true, videoId: "video-1" });
  });
  assert.deepEqual(result, { ok: false, message: "参加者設定の入力を確認してください。" });
  assert.equal(requests, 0);
});

test("MIG-0730 U02dl: UTF-8 wire overflow is rejected before invoking JSON.parse", async () => {
  // The raw text is within the temporary 256Ki UTF-16 bound, but the
  // multibyte wire envelope is oversized. Make the JSON intentionally
  // syntactically invalid to distinguish transport rejection from parsing.
  const raw = '["' + "あ".repeat(90_000);
  assert.ok(raw.length < 256 * 1024);
  assert.ok(new TextEncoder().encode(JSON.stringify({
    is_collab: ["false", "true"], members_json: raw,
  })).byteLength > 256 * 1024);
  const data = form();
  data.set("members_json", raw);
  let requests = 0;
  const result = await saveAdminVideoMembers("video-1", data, async () => {
    requests++;
    return reply({ ok: true, videoId: "video-1" });
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /暫定256KiB制限/,
    "oversized wire payload is classified before the JSON parser");
  assert.equal(requests, 0);
});

test("MIG-0730 U02dt: D-17-3 HTTP 401 takes precedence over every body without reading it", async () => {
  const responses = [
    reply({ ok: false, reason: "unauthenticated", message: "PRIVATE" }, 401),
    reply({ ok: true, videoId: "video-1", pendingPublicReflection: true }, 401),
    new Response("invalid JSON", { status: 401 }),
    new Response(null, { status: 401 }),
    { status: 401, json() { throw Error("BODY MUST NOT BE READ"); } },
  ];
  for (const response of responses) {
    let calls = 0;
    let reads = 0;
    const result = await saveAdminVideoMembers("video-1", form(), async () => {
      calls++;
      return {
        status: response.status,
        json() { reads++; return response.json(); },
      };
    });
    assert.deepEqual(result, {
      ok: false, reason: "unauthenticated", message: "再ログインが必要です。",
    });
    assert.equal(reads, 0, "401 cannot be downgraded by a malformed or hanging body");
    assert.equal(calls, 1, "401 must never auto-replay");
  }
  // A later explicit call is still possible after the old latch settles.
  assert.deepEqual(await saveAdminVideoMembers("video-1", form(), async () =>
    reply({ ok: true, videoId: "video-1" })), { ok: true });
});

test("MIG-0730 U02dt: a non-401 body cannot forge the anonymous transport classification", async () => {
  for (const status of [200, 403, 409, 503]) {
    let calls = 0;
    const result = await saveAdminVideoMembers("video-1", form(), async () => {
      calls++;
      return reply({ ok: false, reason: "unauthenticated", message: "PRIVATE" }, status);
    });
    assert.deepEqual(result, {
      ok: false, message: "保存結果を確認できませんでした。最新状態を再取得してください。",
    });
    assert.equal(calls, 1);
  }
  const success = await saveAdminVideoMembers("video-1", form(), async () =>
    reply({ ok: true, videoId: "video-1", reason: "unauthenticated" }));
  assert.deepEqual(success, { ok: true }, "untrusted extra success fields are not forwarded");
});
