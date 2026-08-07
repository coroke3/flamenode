import assert from "node:assert/strict";
import { test } from "node:test";
import { runTestWithTsx } from "../../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";

  const {
    buildChannelXIdApprovedNotification,
    buildChannelXIdCancelledNotification,
    buildChannelXIdRejectedNotification,
    buildChannelXIdRequestNotification,
    buildXIdApproveThreadName,
    buildXIdCancelThreadName,
    buildXIdRejectThreadName,
    buildXIdRequestThreadName,
  } = await import("./xidChannel.ts");

  const requester = {
    userId: "user-1",
    discordId: "discord-1",
    discordName: "Discord Name",
    activeXId: null,
    activeXName: null,
  };

  const operator = {
    userId: "ops-1",
    discordId: "ops-discord",
    discordName: "Ops User",
    activeXId: "ops_x",
    activeXName: "Ops X",
  };

  test("thread name builders は X ID と表示名を含む", () => {
    assert.equal(
      buildXIdRequestThreadName("creator_x", requester),
      "[X ID申請] @creator_x / Discord Name",
    );
    assert.equal(
      buildXIdCancelThreadName("creator_x", requester),
      "[X ID取消] @creator_x / Discord Name",
    );
    assert.equal(
      buildXIdRejectThreadName("creator_x", requester),
      "[X ID却下] @creator_x / Discord Name",
    );
    assert.equal(
      buildXIdApproveThreadName("creator_x", requester),
      "[X ID承認] @creator_x / Discord Name",
    );
  });

  test("thread name builders は activeXId を優先する", () => {
    const linkedRequester = {
      ...requester,
      activeXId: "linked_x",
      activeXName: null,
    };
    assert.equal(
      buildXIdApproveThreadName("creator_x", linkedRequester),
      "[X ID承認] @creator_x / @linked_x",
    );
  });

  test("buildChannelXIdRequestNotification は申請者・申請内容セクションを含む", () => {
    const payload = buildChannelXIdRequestNotification({
      requestId: "xreq-1",
      requestType: "new_link",
      requestedXId: "creator_x",
      requestedXName: "Creator Display",
      requester,
      requestedAt: 1_700_000_000,
    });
    assert.match(payload.content, /■ 申請内容/);
    assert.match(payload.content, /■ 申請者/);
    assert.match(payload.content, /Discord: Discord Name/);
    assert.match(payload.content, /X 表示名: Creator Display/);
    assert.match(payload.content, /■ 対応/);
  });

  test("buildChannelXIdRejectedNotification は申請者と処理者を分離する", () => {
    const payload = buildChannelXIdRejectedNotification({
      requestId: "xreq-1",
      requestType: "existing_link",
      requestedXId: "creator_x",
      requester,
      operator,
      reason: "重複申請",
      rejectedAt: 1_700_000_100,
    });
    assert.match(payload.content, /■ 申請者[\s\S]*Discord: Discord Name \(discord-1\)/);
    assert.match(payload.content, /■ 処理者[\s\S]*Active X: Ops X \(@\u200bops_x\)/);
    assert.match(payload.content, /■ 結果[\s\S]*却下/);
    assert.match(payload.content, /重複申請/);
  });

  test("buildChannelXIdCancelledNotification は取消者セクションを含む", () => {
    const payload = buildChannelXIdCancelledNotification({
      requestId: "xreq-1",
      requestType: "alias",
      requestedXId: "alias_x",
      requester,
      cancelledAt: 1_700_000_200,
    });
    assert.match(payload.content, /■ 取消者/);
    assert.match(payload.content, /Discord: Discord Name/);
  });

  test("buildChannelXIdApprovedNotification は処理内容と承認結果を含む", () => {
    const payload = buildChannelXIdApprovedNotification({
      requestId: "xreq-1",
      requestType: "new_link",
      requestedXId: "creator_x",
      requester,
      operator,
      approvedAt: 1_700_000_300,
    });
    assert.match(payload.content, /■ 申請者/);
    assert.match(payload.content, /■ 処理者/);
    assert.match(payload.content, /■ 処理内容/);
    assert.match(payload.content, /結果: 承認/);
  });
}
