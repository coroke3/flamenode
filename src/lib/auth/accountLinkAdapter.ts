import type { AdapterAccount } from "next-auth/adapters";
import type { BatchItem } from "drizzle-orm/batch";
import { and, eq } from "drizzle-orm";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { runPostCommitBestEffort } from "@/lib/audit/postCommit";
import {
  mutateWithAudit,
  type AtomicAuditMutationInput,
} from "@/lib/audit/mutate";
import type { DB } from "@/lib/db/client";
import { accounts, users } from "@/lib/db/schema";
import type {
  EnqueueNotificationInput,
  NotificationOutboxStatement,
} from "@/lib/notifications/enqueue";
import {
  createTraceId,
  logFlowTrace,
} from "@/lib/observability/flowTrace";

type AtomicMutator = (
  db: DB,
  input: AtomicAuditMutationInput,
) => Promise<readonly string[]>;

type WelcomeNotificationBuilder = (
  db: DB,
  input: EnqueueNotificationInput,
) => Promise<NotificationOutboxStatement | null>;

async function defaultBuildWelcomeNotification(
  db: DB,
  input: EnqueueNotificationInput,
): Promise<NotificationOutboxStatement | null> {
  const { buildNotificationOutboxStatement } = await import(
    "@/lib/notifications/enqueue"
  );
  return buildNotificationOutboxStatement(db, input);
}

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
 * Auth.js adapterのlinkAccount境界でaccount作成・Discord ID更新・user監査を
 * 同じD1 batchへ入れる。再実行は冪等。通知は認証commit成功後にbest-effort。
 */
export async function linkDiscordAccountAtomically(
  db: DB,
  account: AdapterAccount,
  mutate: AtomicMutator = mutateWithAudit,
  buildWelcomeNotification: WelcomeNotificationBuilder = defaultBuildWelcomeNotification,
  siteOrigin?: string,
): Promise<void> {
  const traceId = createTraceId();
  logFlowTrace({
    flow: "discord_auth",
    phase: "account_link_started",
    trace_id: traceId,
    result: "started",
  });

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

  const existingAccount = (
    await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.provider, account.provider),
          eq(accounts.providerAccountId, account.providerAccountId),
        )!,
      )
      .limit(1)
  )[0];

  if (existingAccount && existingAccount.userId !== account.userId) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "account_link_committed",
      trace_id: traceId,
      result: "failed",
      error_code: "AUTH_DISCORD_ID_CONFLICT",
      committed: false,
    });
    throw new Error("AUTH_DISCORD_ID_CONFLICT");
  }

  const discordOwner = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discord_id, account.providerAccountId))
      .limit(1)
  )[0];
  if (discordOwner && discordOwner.id !== account.userId) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "account_link_committed",
      trace_id: traceId,
      result: "failed",
      error_code: "AUTH_DISCORD_ID_CONFLICT",
      committed: false,
    });
    throw new Error("AUTH_DISCORD_ID_CONFLICT");
  }

  const needsAccountInsert = !existingAccount;
  const needsDiscordId =
    !beforeUser.discord_id?.trim() ||
    beforeUser.discord_id !== account.providerAccountId;
  const isFirstDiscordLink = !beforeUser.discord_id?.trim();

  // 同じaccountが同じuserに既にあり、discord_idも整合 → 成功no-op
  if (!needsAccountInsert && !needsDiscordId) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "account_link_committed",
      trace_id: traceId,
      result: "succeeded",
      committed: true,
    });
    return;
  }

  const accountRow = accountRowWithoutTokens(account);
  const afterUser = {
    ...beforeUser,
    discord_id: account.providerAccountId,
  };

  const mutationStatements: BatchItem<"sqlite">[] = [];
  const expectedMutationChanges: Array<number | null> = [];

  if (needsAccountInsert) {
    // 二重callbackに備え、変更件数固定は避けて null（idempotent insert）
    mutationStatements.push(
      db.insert(accounts).values(accountRow).onConflictDoNothing(),
    );
    expectedMutationChanges.push(null);
  }

  if (needsDiscordId) {
    mutationStatements.push(
      db
        .update(users)
        .set({ discord_id: account.providerAccountId })
        .where(
          and(
            eq(users.id, account.userId),
            expectedRowCondition({
              expectedCurrent: {
                id: beforeUser.id,
                discord_id: beforeUser.discord_id,
              },
            }),
          )!,
        ),
    );
    expectedMutationChanges.push(1);
  }

  if (mutationStatements.length === 0) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "account_link_committed",
      trace_id: traceId,
      result: "succeeded",
      committed: true,
    });
    return;
  }

  const audits: Array<{
    table_name: string;
    target_id: string;
    operation: "CREATE" | "UPDATE";
    before?: Record<string, unknown>;
    after: Record<string, unknown>;
    actor_user_id: string;
    reason: string;
    context: string;
    retention_class: "long_audit";
  }> = [];
  if (needsDiscordId) {
    audits.push({
      table_name: "user",
      target_id: account.userId,
      operation: "UPDATE",
      before: { ...beforeUser },
      after: { ...afterUser },
      actor_user_id: account.userId,
      reason: "auth_link_discord",
      context: "auth",
      retention_class: "long_audit",
    });
  }

  if (audits.length > 0) {
    await mutate(db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
    });
  } else {
    for (const statement of mutationStatements) {
      await statement;
    }
  }

  logFlowTrace({
    flow: "discord_auth",
    phase: "account_link_committed",
    trace_id: traceId,
    result: "succeeded",
    committed: true,
  });

  if (isFirstDiscordLink) {
    await enqueueFirstDiscordLinkNotifications(
      db,
      {
        account,
        beforeUser,
        buildWelcomeNotification,
        siteOrigin,
      },
      traceId,
    );
  }
}

async function enqueueFirstDiscordLinkNotifications(
  db: DB,
  params: {
    account: AdapterAccount;
    beforeUser: typeof users.$inferSelect;
    buildWelcomeNotification: WelcomeNotificationBuilder;
    siteOrigin?: string;
  },
  traceId: string,
): Promise<void> {
  const notificationEnv = params.siteOrigin
    ? { NEXT_PUBLIC_SITE_URL: params.siteOrigin }
    : undefined;
  const notificationStatements: BatchItem<"sqlite">[] = [];

  try {
    const { buildWelcomeAccountNotification } = await import(
      "@/lib/notifications/templates/user"
    );
    const welcomeNotification = await params.buildWelcomeNotification(db, {
      recipientUserId: params.account.userId,
      type: "welcome_account",
      payload: buildWelcomeAccountNotification(notificationEnv),
      dedupeKey: `welcome_account:${params.account.userId}`,
      force: true,
    });
    if (welcomeNotification) {
      notificationStatements.push(welcomeNotification.statement);
    }
  } catch {
    logFlowTrace({
      flow: "discord_auth",
      phase: "welcome_notification_skipped",
      trace_id: traceId,
      result: "skipped",
      error_code: "WELCOME_NOTIFICATION_BUILD_FAILED",
    });
  }

  try {
    const { buildChannelAccountCreatedNotification } = await import(
      "@/lib/notifications/templates/channel"
    );
    const { buildOpsChannelWebhookStatement } = await import(
      "@/lib/notifications/opsWebhook"
    );
    const channelNotification = await buildOpsChannelWebhookStatement(db, {
      actorUserId: params.account.userId,
      payload: buildChannelAccountCreatedNotification({
        userId: params.account.userId,
        discordId: params.account.providerAccountId,
        userName: params.beforeUser.name,
        env: notificationEnv,
      }),
      dedupeKey: `channel_account_created:${params.account.userId}`,
    });
    if (channelNotification) {
      notificationStatements.push(channelNotification.statement);
    }
  } catch {
    // ops channel 通知は welcome と独立。失敗しても認証・welcome は続行する。
  }

  if (notificationStatements.length === 0) {
    return;
  }

  const warnings = await runPostCommitBestEffort(
    { flow: "discord_auth", traceId },
    [
      {
        name: "welcome_notification_enqueued",
        run: async () => {
          for (const statement of notificationStatements) {
            await statement;
          }
          const { wakeNotificationQueueAfterCommit } = await import(
            "@/lib/queues/wakeNotificationQueueAfterCommit"
          );
          await wakeNotificationQueueAfterCommit("web");
        },
      },
    ],
  );

  if (warnings.length > 0) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "welcome_notification_skipped",
      trace_id: traceId,
      result: "skipped",
      error_code:
        warnings[0]?.error_code ?? "WELCOME_NOTIFICATION_EXECUTE_FAILED",
    });
  }
}
