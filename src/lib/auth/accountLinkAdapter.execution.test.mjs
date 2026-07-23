import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_AUTH_ADAPTER_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", fileURLToPath(import.meta.url)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_AUTH_ADAPTER_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  const {
    accountRowWithoutTokens,
    linkDiscordAccountAtomically,
  } = await import("./accountLinkAdapter.ts");

  const account = {
    userId: "user-1",
    type: "oauth",
    provider: "discord",
    providerAccountId: "discord-1",
    access_token: "access-secret",
    refresh_token: "refresh-secret",
    id_token: "id-secret",
    expires_at: 123,
    token_type: "Bearer",
    scope: "identify email",
    session_state: "state",
  };

  function fakeDb({ userRow, existingAccount = null, discordOwner = null }) {
    const state = { inserts: [], updates: [] };
    let selectIndex = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              selectIndex += 1;
              // 1: user by id, 2: account by provider, 3: discord owner
              if (selectIndex === 1) return userRow ? [userRow] : [];
              if (selectIndex === 2) return existingAccount ? [existingAccount] : [];
              if (selectIndex === 3) {
                if (discordOwner) return [discordOwner];
                if (userRow?.discord_id === account.providerAccountId) {
                  return [{ id: userRow.id }];
                }
                return [];
              }
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (values) => {
          const statement = { kind: "insert", values };
          state.inserts.push(statement);
          return {
            ...statement,
            onConflictDoNothing: () => statement,
          };
        },
      }),
      update: () => ({
        set: (values) => ({
          where: (condition) => {
            const statement = { kind: "update", values, condition };
            state.updates.push(statement);
            return statement;
          },
        }),
      }),
    };
    return { db, state };
  }

  function mockWelcomeNotificationBuilder() {
    return async (_db, input) => ({
      statement: {
        kind: "notification",
        values: {
          type: input.type,
          recipient_user_id: input.recipientUserId,
          dedupe_key: input.dedupeKey,
          payload_json: JSON.stringify(input.payload),
        },
      },
    });
  }

  test("保存accountからaccess/refresh/id tokenを除外する", () => {
    const row = accountRowWithoutTokens(account);
    assert.equal(row.access_token, null);
    assert.equal(row.refresh_token, null);
    assert.equal(row.id_token, null);
    assert.equal(JSON.stringify(row).includes("access-secret"), false);
    assert.equal(JSON.stringify(row).includes("refresh-secret"), false);
    assert.equal(row.scope, "identify email");
  });

  test("account insert・user CAS更新・auditを単一atomic planへ渡す", async () => {
    const beforeUser = {
      id: "user-1",
      name: "User",
      email: null,
      emailVerified: null,
      image: null,
      discord_id: null,
      role: "user",
      can_create_events: 0,
      is_tos_accepted: 0,
      accepted_terms_version_id: null,
      terms_reaccept_required: 0,
      is_banned: 0,
      is_notification_enabled: 1,
      active_x_user_id: null,
      onboarding_completed_at: null,
      last_guild_check: null,
      created_at: 1,
    };
    const { db } = fakeDb({ userRow: beforeUser });
    let captured;

    await linkDiscordAccountAtomically(
      db,
      account,
      async (receivedDb, input) => {
        assert.equal(receivedDb, db);
        captured = input;
        return ["audit-1"];
      },
      mockWelcomeNotificationBuilder(),
    );

    assert.equal(captured.mutationStatements.length, 3);
    assert.deepEqual(captured.expectedMutationChanges, [null, 1, null]);
    assert.equal(captured.mutationStatements[0].values.access_token, null);
    assert.equal(captured.mutationStatements[0].values.refresh_token, null);
    assert.deepEqual(captured.mutationStatements[1].values, {
      discord_id: "discord-1",
    });
    assert.equal(captured.mutationStatements[2].values.type, "welcome_account");
    assert.equal(
      captured.mutationStatements[2].values.dedupe_key,
      "welcome_account:user-1",
    );
    assert.match(
      JSON.parse(captured.mutationStatements[2].values.payload_json).content,
      /\/onboarding/,
    );
    assert.equal(captured.audits.length, 2);
    assert.equal(captured.audits[0].table_name, "account");
    assert.equal(captured.audits[1].before.discord_id, null);
    assert.equal(captured.audits[1].after.discord_id, "discord-1");
  });

  test("既に整合済みの再linkはno-op", async () => {
    const beforeUser = {
      id: "user-1",
      name: "User",
      discord_id: "discord-1",
      created_at: 1,
    };
    const { db } = fakeDb({
      userRow: beforeUser,
      existingAccount: {
        userId: "user-1",
        provider: "discord",
        providerAccountId: "discord-1",
      },
    });
    let called = false;
    await linkDiscordAccountAtomically(db, account, async () => {
      called = true;
      return [];
    });
    assert.equal(called, false);
  });

  test("既に discord_id がある再linkでは welcome 通知を入れない", async () => {
    const beforeUser = {
      id: "user-1",
      name: "User",
      email: null,
      emailVerified: null,
      image: null,
      discord_id: "discord-existing",
      role: "user",
      can_create_events: 0,
      is_tos_accepted: 0,
      accepted_terms_version_id: null,
      terms_reaccept_required: 0,
      is_banned: 0,
      is_notification_enabled: 1,
      active_x_user_id: null,
      onboarding_completed_at: null,
      last_guild_check: null,
      created_at: 1,
    };
    const { db } = fakeDb({ userRow: beforeUser });
    let captured;

    await linkDiscordAccountAtomically(db, account, async (receivedDb, input) => {
      captured = input;
      return ["audit-1"];
    });

    assert.equal(captured.mutationStatements.length, 2);
    assert.deepEqual(captured.expectedMutationChanges, [null, 1]);
    assert.equal(
      captured.mutationStatements.some((s) => s.values?.type === "welcome_account"),
      false,
    );
  });

  test("atomic plan失敗を成功扱いせず、user欠落時はplanを作らない", async () => {
    const beforeUser = {
      id: "user-1",
      discord_id: null,
      created_at: 1,
    };
    const { db } = fakeDb({ userRow: beforeUser });
    await assert.rejects(
      linkDiscordAccountAtomically(
        db,
        account,
        async () => {
          throw new Error("simulated batch rollback");
        },
        mockWelcomeNotificationBuilder(),
      ),
      /simulated batch rollback/,
    );

    const missing = fakeDb({ userRow: null });
    let called = false;
    await assert.rejects(
      linkDiscordAccountAtomically(missing.db, account, async () => {
        called = true;
        return [];
      }),
      /AUTH_LINK_USER_NOT_FOUND/,
    );
    assert.equal(called, false);
  });
}
