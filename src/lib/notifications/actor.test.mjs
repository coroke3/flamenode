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

  const { formatOpsActorSection, resolveNotificationActor } = await import(
    "./actor.ts"
  );

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

  test("formatOpsActorSection: actor null は取得失敗メッセージ", () => {
    const section = formatOpsActorSection(null);
    assert.match(section.lines.join("\n"), /操作者情報を取得できませんでした/);
  });
}
