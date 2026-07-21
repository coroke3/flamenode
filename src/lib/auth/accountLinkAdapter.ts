import type { AdapterAccount } from "next-auth/adapters";
import { eq } from "drizzle-orm";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import {
  mutateWithAudit,
  type AtomicAuditMutationInput,
} from "@/lib/audit/mutate";
import type { DB } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema";

type AtomicMutator = (
  db: DB,
  input: AtomicAuditMutationInput,
) => Promise<readonly string[]>;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** OAuth bearer/refresh/id tokenは永続化せず、識別用metadataだけを保存する。 */
export function accountRowWithoutTokens(
  account: AdapterAccount,
): typeof accounts.$inferInsert {
  return {
    userId: account.userId,
    type: account.type,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    access_token: null,
    refresh_token: null,
    id_token: null,
    expires_at: optionalInteger(account.expires_at),
    token_type: optionalString(account.token_type),
    scope: optionalString(account.scope),
    session_state: optionalString(account.session_state),
  };
}

/**
 * Auth.js adapterのlinkAccount境界でaccount作成・Discord ID更新・監査を
 * 同じD1 batchへ入れる。events.linkAccountではaccount INSERT後になり遅すぎる。
 */
export async function linkDiscordAccountAtomically(
  db: DB,
  account: AdapterAccount,
  mutate: AtomicMutator = mutateWithAudit,
): Promise<void> {
  if (account.provider !== "discord" || !account.providerAccountId) {
    throw new Error("AUTH_UNSUPPORTED_ACCOUNT_PROVIDER");
  }

  const beforeUser = (
    await db
      .select()
      .from(users)
      .where(eq(users.id, account.userId))
      .limit(1)
  )[0];
  if (!beforeUser) throw new Error("AUTH_LINK_USER_NOT_FOUND");

  const accountRow = accountRowWithoutTokens(account);
  const afterUser = {
    ...beforeUser,
    discord_id: account.providerAccountId,
  };

  await mutate(db, {
    mutationStatements: [
      db.insert(accounts).values(accountRow),
      db
        .update(users)
        .set({ discord_id: account.providerAccountId })
        .where(expectedRowCondition({ expectedCurrent: beforeUser })),
    ],
    expectedMutationChanges: [1, 1],
    audits: [
      {
        table_name: "user",
        target_id: account.userId,
        operation: "UPDATE",
        before: { ...beforeUser },
        after: { ...afterUser },
        actor_user_id: account.userId,
        reason: "auth_link_discord",
        context: "auth",
        retention_class: "long_audit",
      },
    ],
  });
}
