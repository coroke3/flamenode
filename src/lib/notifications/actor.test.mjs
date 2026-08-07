import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const {
    formatActiveXLabel,
    formatOpsActorSection,
    overlayNotificationActorActiveX,
    resolveNotificationActor,
  } = await import("./actor.ts");

  function mockDb(row) {
    const chain = {
      from() {
        return chain;
      },
      leftJoin() {
        return chain;
      },
      where() {
        return chain;
      },
      async get() {
        return row;
      },
    };
    return {
      select() {
        return chain;
      },
    };
  }

  test("resolveNotificationActor は users LEFT JOIN x_users の1行を返す", async () => {
    const actor = await resolveNotificationActor(
      mockDb({
        userId: "user-1",
        discordId: "discord-1",
        discordName: "Discord Name",
        activeXId: "x-id-1",
        activeXName: "X Display",
      }),
      "user-1",
    );
    assert.deepEqual(actor, {
      userId: "user-1",
      discordId: "discord-1",
      discordName: "Discord Name",
      activeXId: "x-id-1",
      activeXName: "X Display",
    });
  });

  test("resolveNotificationActor: ユーザー不在は null", async () => {
    const actor = await resolveNotificationActor(mockDb(undefined), "missing");
    assert.equal(actor, null);
  });

  test("formatOpsActorSection は未設定フォールバックを含む", () => {
    const section = formatOpsActorSection({
      userId: "user-1",
      discordId: null,
      discordName: null,
      activeXId: null,
      activeXName: null,
    });
    assert.equal(section.heading, "■ 操作者");
    assert.match(section.lines.join("\n"), /Active X: 未設定/);
    assert.match(section.lines.join("\n"), /Discord: 未設定/);
    assert.match(section.lines.join("\n"), /user_id: user-1/);
  });

  test("formatActiveXLabel: id のみは X名義未取得", () => {
    assert.match(
      formatActiveXLabel({ activeXId: "creator_x", activeXName: null }),
      /X名義未取得 \(@\u200b?creator_x\)/,
    );
  });

  test("formatActiveXLabel: 名前と id", () => {
    assert.equal(
      formatActiveXLabel({ activeXId: "creator_x", activeXName: "Creator" }),
      "Creator (@\u200bcreator_x)",
    );
  });

  test("overlayNotificationActorActiveX: 既存 Active X は維持", () => {
    const actor = {
      userId: "user-1",
      discordId: null,
      discordName: null,
      activeXId: "existing_x",
      activeXName: "Existing",
    };
    const result = overlayNotificationActorActiveX(actor, {
      activeXId: "new_x",
      activeXName: "@new_x",
    });
    assert.equal(result, actor);
  });

  test("overlayNotificationActorActiveX: 未設定時のみ上書き", () => {
    const actor = {
      userId: "user-1",
      discordId: "discord-1",
      discordName: "Discord",
      activeXId: null,
      activeXName: null,
    };
    const result = overlayNotificationActorActiveX(actor, {
      activeXId: "new_x",
      activeXName: "@new_x",
    });
    assert.deepEqual(result, {
      userId: "user-1",
      discordId: "discord-1",
      discordName: "Discord",
      activeXId: "new_x",
      activeXName: "@new_x",
    });
  });

  test("formatOpsActorSection: id のみ Active X", () => {
    const section = formatOpsActorSection({
      userId: "user-1",
      discordId: "discord-1",
      discordName: "Discord",
      activeXId: "creator_x",
      activeXName: null,
    });
    assert.match(section.lines.join("\n"), /Active X: X名義未取得 \(@\u200b?creator_x\)/);
    assert.match(section.lines.join("\n"), /Discord: Discord \(discord-1\)/);
  });

  test("formatOpsActorSection: actor null は取得失敗メッセージ", () => {
    const section = formatOpsActorSection(null);
    assert.match(section.lines.join("\n"), /操作者情報を取得できませんでした/);
  });
}
