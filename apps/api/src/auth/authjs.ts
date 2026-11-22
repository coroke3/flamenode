/**
 * MIG-0802 / MIG-0803: UNMOUNTED @auth/core 0.41.3 request adapter (synthetic PoC).
 *
 * Never import this module from apps/api/src/app.ts or production entrypoints.
 * routes/auth.ts exposes only GET /api/auth/session, GET /api/auth/csrf, and
 * POST /api/auth/signout until production cutover (MIG-0805).
 *
 * MIG-0803 ports CURRENT accountRowWithoutTokens and linkDiscordAccountAtomically
 * semantics (CAS + audit + post-commit deduped welcome/ops notifications) so
 * adapter.linkAccount never runs an unguarded Drizzle insert.
 */
import { Auth, type AuthConfig } from "@auth/core";
import type { AdapterAccount } from "@auth/core/adapters";
import Discord from "@auth/core/providers/discord";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@flamenode/db/schema";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { QueueWakeHost } from "@flamenode/server-core/ports";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import {
  mutateWithAudit,
  type AtomicAuditMutationInput,
} from "@flamenode/server-core/audit/mutate";
import {
  runPostCommitBestEffort,
  type PostCommitTask,
} from "@flamenode/server-core/audit/postCommit";
import {
  createTraceId,
  logFlowTrace,
} from "@flamenode/server-core/observability/flowTrace";
import {
  formatActiveXLabel,
  resolveNotificationActor,
} from "@flamenode/server-core/notifications/actor";
import {
  escapeDiscordMention,
  type DiscordBlock,
} from "@flamenode/server-core/notifications/discordText";
import { buildOpsChannelWebhookStatement } from "@flamenode/server-core/notifications/opsOutbox";
import { wakeNotificationQueueAfterCommit } from "@flamenode/server-core/queues/wakeNotificationQueueAfterCommit";
import {
  applyDatabaseAuthSessionClaims,
  authAdapterTables,
  authRuntimeDefaults,
  discordProviderOptions,
  resolveAuthRuntimeCredentials,
} from "@flamenode/server-core/auth/config";
import { authRedirectTarget } from "@flamenode/server-core/auth/redirect";

export type UnmountedAuthInputs = {
  d1: D1Database;
  authSecret: string | null | undefined;
  discordClientId: string | null | undefined;
  discordClientSecret: string | null | undefined;
  /** These origins come from explicit configuration, never request Host. */
  authOrigin: string;
  siteOrigin: string;
  queueWakeHost?: QueueWakeHost;
};

type UserRow = typeof schema.users.$inferSelect;
type AccountRow = typeof schema.accounts.$inferSelect;

type NotificationStatementEnvelope = Readonly<{
  statement: BatchItem<"sqlite">;
}>;

export type LinkDiscordAccountOptions = {
  siteOrigin?: string;
  queueWakeHost?: QueueWakeHost;
  mutate?: (db: ServerCoreDb, input: AtomicAuditMutationInput) => Promise<readonly string[]>;
  buildWelcomeStatement?: (
    db: ServerCoreDb,
    input: { recipientUserId: string; siteOrigin?: string },
  ) => Promise<NotificationStatementEnvelope | null>;
};

const NULL_QUEUE_WAKE_HOST: QueueWakeHost = {
  readEnv: () => null,
  readWaitUntil: () => null,
  readKv: () => null,
};

const JST_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

function logSafeAuthError(error: Error): void {
  const candidate = error as Error & { type?: unknown };
  const errorType =
    typeof candidate.type === "string" ? candidate.type : error.name;
  const safeType = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(errorType)
    ? errorType
    : "AUTH_ERROR";
  console.error(`[auth][error] ${safeType}`);
}

function strictConfiguredOrigin(value: string): string {
  let parsed: URL;
  try {
    // CURRENT's configuredHttpOrigin trims whitespace and accepts the optional
    // trailing slash/default TLS port. Compare normalized origins, not raw URLs.
    parsed = new URL(value.trim());
  } catch {
    throw new Error("AUTH_ORIGIN_INVALID");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  // This non-production host deliberately requires HTTPS (even though CURRENT
  // may allow HTTP on a non-loopback origin). Never enable the loopback
  // allowance or rely on request Host to derive the configured origin.
  if (
    parsed.protocol !== "https:" ||
    parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new Error("AUTH_ORIGIN_INVALID");
  }
  return parsed.origin;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** OAuth bearer/refresh/id token are never persisted; keep identifying metadata only. */
export function accountRowWithoutTokens(
  account: AdapterAccount,
): typeof schema.accounts.$inferInsert {
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

function notificationAppUrl(path: string, siteOrigin: string | undefined): string {
  const origin = strictConfiguredOrigin(siteOrigin ?? "");
  const target = new URL(path.startsWith("/") ? path : `/${path}`, `${origin}/`);
  if (target.origin !== origin) throw new Error("NOTIFICATION_PATH_INVALID");
  return target.href;
}

function formatBlocks(blocks: readonly DiscordBlock[]): string {
  const sections: string[] = [];
  for (const block of blocks) {
    const lines = block.lines.filter(
      (line): line is string => typeof line === "string" && line.trim().length > 0,
    );
    if (block.heading) sections.push(block.heading);
    if (lines.length > 0) sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function buildWelcomePayload(siteOrigin: string | undefined): { content: string; url: string } {
  const onboardingUrl = notificationAppUrl("/onboarding", siteOrigin);
  const rulesUrl = notificationAppUrl("/rules", siteOrigin);
  const content = formatBlocks([
    {
      heading: "【FlameNode】アカウント登録が完了しました",
      lines: [
        "FlameNode へようこそ。Discord アカウントとの連携が完了しました。",
        "作品の投稿やイベント参加には、利用規約への同意と X ID 連携申請が必要です。",
      ],
    },
    {
      heading: "■ いま行うこと",
      lines: [
        "1. 利用規約を読み、同意する",
        "2. X ID 連携申請を送信する（運営承認後に投稿が可能になります）",
        `はじめの設定を開く\n${onboardingUrl}`,
        `利用規約を確認する\n${rulesUrl}`,
      ],
    },
    {
      heading: "■ 補足",
      lines: [
        "設定はいつでもダッシュボードから変更できます。",
        "通知が届かない場合は、Discord の DM 設定で Bot からのメッセージを許可してください。",
      ],
    },
  ]);
  return { content, url: onboardingUrl };
}

function buildAccountCreatedPayload(input: {
  userId: string;
  discordId: string;
  discordName: string | null | undefined;
  activeXId: string | null | undefined;
  activeXName: string | null | undefined;
  siteOrigin: string | undefined;
}) {
  const discordLabel = input.discordName?.trim()
    ? escapeDiscordMention(input.discordName.trim())
    : "未設定";
  const activeXLabel = formatActiveXLabel({
    activeXId: input.activeXId,
    activeXName: input.activeXName,
  });
  const path = `/admin/users?q=${encodeURIComponent(input.userId)}`;
  const adminUrl = notificationAppUrl(path, input.siteOrigin);
  const jstNow = new Date().toLocaleString("ja-JP", JST_FORMAT);
  const content = formatBlocks([
    {
      heading: "【運営通知】新規アカウントが作成されました",
      lines: [
        "Discord 連携による初回ログインが完了しました。",
        `発生時刻（日本時間）: ${jstNow}`,
      ],
    },
    {
      heading: "■ ユーザー",
      lines: [
        `Discord: ${discordLabel} (${input.discordId})`,
        `user_id: ${input.userId}`,
        `Active X: ${activeXLabel}`,
      ],
    },
    {
      heading: "■ 確認",
      lines: [`ユーザー管理を開く\n${adminUrl}`],
    },
  ]);
  return { content, url: path };
}

async function defaultBuildWelcomeStatement(
  db: ServerCoreDb,
  input: { recipientUserId: string; siteOrigin?: string },
): Promise<NotificationStatementEnvelope | null> {
  const payload = buildWelcomePayload(input.siteOrigin);
  const recipient = (
    await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, input.recipientUserId))
      .limit(1)
  )[0];
  if (!recipient) return null;
  const row: typeof schema.notificationOutbox.$inferInsert = {
    id: crypto.randomUUID(),
    recipient_user_id: recipient.id,
    type: "welcome_account",
    payload_json: JSON.stringify(payload),
    delivery_route: "dm",
    correlation_id: null,
    status: "pending",
    attempt_count: 0,
    processing_started_at: null,
    lease_token: null,
    lease_expires_at: null,
    next_attempt_at: null,
    last_error: null,
    processed_at: null,
    event_id: null,
    dedupe_key: `welcome_account:${input.recipientUserId}`,
    created_at: Math.floor(Date.now() / 1000),
  };
  return {
    statement: db.insert(schema.notificationOutbox).values(row).onConflictDoNothing(),
  };
}

async function loadAccountAndOwner(
  db: ServerCoreDb,
  account: AdapterAccount,
): Promise<{
  beforeUser: UserRow;
  existingAccount: AccountRow | undefined;
}> {
  const beforeUser = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, account.userId))
      .limit(1)
  )[0];
  if (!beforeUser) throw new Error("AUTH_LINK_USER_NOT_FOUND");

  const existingAccount = (
    await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.provider, account.provider),
          eq(schema.accounts.providerAccountId, account.providerAccountId),
        )!,
      )
      .limit(1)
  )[0];
  if (existingAccount && existingAccount.userId !== account.userId) {
    throw new Error("AUTH_DISCORD_ID_CONFLICT");
  }

  const discordOwner = (
    await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.discord_id, account.providerAccountId))
      .limit(1)
  )[0];
  if (discordOwner && discordOwner.id !== account.userId) {
    throw new Error("AUTH_DISCORD_ID_CONFLICT");
  }

  return { beforeUser, existingAccount };
}

async function isConsistentAfterRace(
  db: ServerCoreDb,
  account: AdapterAccount,
): Promise<boolean> {
  const rereadAccount = (
    await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.provider, account.provider),
          eq(schema.accounts.providerAccountId, account.providerAccountId),
        )!,
      )
      .limit(1)
  )[0];
  const rereadUser = (
    await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, account.userId))
      .limit(1)
  )[0];
  return (
    rereadAccount?.userId === account.userId &&
    rereadUser?.discord_id === account.providerAccountId
  );
}

async function enqueueFirstDiscordLinkNotifications(
  db: ServerCoreDb,
  params: {
    account: AdapterAccount;
    beforeUser: UserRow;
    options: LinkDiscordAccountOptions;
    traceId: string;
  },
): Promise<void> {
  const { account, beforeUser, options, traceId } = params;
  const postCommitTasks: PostCommitTask[] = [];
  const buildWelcome = options.buildWelcomeStatement ?? defaultBuildWelcomeStatement;

  try {
    const welcome = await buildWelcome(db, {
      recipientUserId: account.userId,
      siteOrigin: options.siteOrigin,
    });
    if (welcome) {
      const statement = welcome.statement;
      postCommitTasks.push({
        name: "welcome_notification_enqueued",
        run: async () => {
          await statement;
        },
      });
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
    const actor = await resolveNotificationActor(db as never, account.userId);
    const discordName =
      actor?.discordName?.trim() || beforeUser.name?.trim() || "不明";
    const opsWebhook = await buildOpsChannelWebhookStatement(db, {
      target: "account",
      threadName: `[アカウント作成] ${discordName}`,
      actorUserId: account.userId,
      payload: buildAccountCreatedPayload({
        userId: account.userId,
        discordId: account.providerAccountId,
        discordName: actor?.discordName ?? beforeUser.name,
        activeXId: actor?.activeXId,
        activeXName: actor?.activeXName,
        siteOrigin: options.siteOrigin,
      }),
      dedupeKey: `channel_account_created:${account.userId}`,
    });
    postCommitTasks.push({
      name: "ops_notification_enqueued",
      run: async () => {
        await opsWebhook.statement;
      },
    });
  } catch {
    // Ops channel notification is independent of welcome DM and must never fail auth.
  }

  if (postCommitTasks.length === 0) return;

  const warnings = await runPostCommitBestEffort(
    { flow: "discord_auth", traceId },
    postCommitTasks,
  );
  if (postCommitTasks.length > warnings.length) {
    const wakeHost = options.queueWakeHost ?? NULL_QUEUE_WAKE_HOST;
    await runPostCommitBestEffort({ flow: "discord_auth", traceId }, [
      {
        name: "notification_queue_wake",
        run: async () => {
          await wakeNotificationQueueAfterCommit("web", undefined, wakeHost);
        },
      },
    ]);
  }
  if (warnings.length > 0) {
    logFlowTrace({
      flow: "discord_auth",
      phase: "notification_post_commit_failed",
      trace_id: traceId,
      result: "failed",
      error_code: warnings[0]?.error_code ?? "NOTIFICATION_EXECUTE_FAILED",
    });
  }
}

/**
 * MIG-0803 U01: atomic Discord account linking with CAS + audit + post-commit
 * best-effort welcome/ops notifications. Preserves CURRENT linkDiscordAccountAtomically
 * semantics on D1 without persisting OAuth tokens.
 */
export async function linkDiscordAccountAtomically(
  db: ServerCoreDb,
  account: AdapterAccount,
  options: LinkDiscordAccountOptions = {},
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

  let beforeUser: UserRow;
  let existingAccount: AccountRow | undefined;
  try {
    ({ beforeUser, existingAccount } = await loadAccountAndOwner(db, account));
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_DISCORD_ID_CONFLICT") {
      logFlowTrace({
        flow: "discord_auth",
        phase: "account_link_committed",
        trace_id: traceId,
        result: "failed",
        error_code: "AUTH_DISCORD_ID_CONFLICT",
        committed: false,
      });
    }
    throw error;
  }

  const needsAccountInsert = !existingAccount;
  const needsDiscordId =
    !beforeUser.discord_id?.trim() ||
    beforeUser.discord_id !== account.providerAccountId;
  const isFirstDiscordLink = !beforeUser.discord_id?.trim();

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

  const mutationStatements: BatchItem<"sqlite">[] = [];
  const expectedMutationChanges: Array<number | null> = [];
  if (needsAccountInsert) {
    mutationStatements.push(
      db
        .insert(schema.accounts)
        .values(accountRowWithoutTokens(account))
        .onConflictDoNothing(),
    );
    expectedMutationChanges.push(null);
  }
  if (needsDiscordId) {
    mutationStatements.push(
      db
        .update(schema.users)
        .set({ discord_id: account.providerAccountId })
        .where(
          and(
            eq(schema.users.id, account.userId),
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

  if (needsDiscordId) {
    const mutate = options.mutate ?? mutateWithAudit;
    try {
      await mutate(db, {
        mutationStatements,
        expectedMutationChanges,
        // Auth.js pre-reads (<=3) + linkDiscordAccountAtomically pre-reads (3).
        callerQueryCount: 6,
        audits: [
          {
            table_name: "user",
            target_id: account.userId,
            operation: "UPDATE",
            before: { ...beforeUser },
            after: { ...beforeUser, discord_id: account.providerAccountId },
            actor_user_id: account.userId,
            reason: "auth_link_discord",
            context: "auth",
            retention_class: "long_audit",
          },
        ],
      });
    } catch (error) {
      if (await isConsistentAfterRace(db, account)) {
        logFlowTrace({
          flow: "discord_auth",
          phase: "account_link_committed",
          trace_id: traceId,
          result: "succeeded",
          committed: true,
          error_code: "AUTH_LINK_ALREADY_CONSISTENT",
        });
        return;
      }
      throw error;
    }
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
    await enqueueFirstDiscordLinkNotifications(db, {
      account,
      beforeUser,
      options,
      traceId,
    });
  }
}

function wrapAdapterOperation<TArgs extends unknown[], TResult>(
  fn: ((...args: TArgs) => TResult | PromiseLike<TResult>) | undefined,
  phase: string,
  errorCode: string,
): ((...args: TArgs) => Promise<TResult>) | undefined {
  if (!fn) return undefined;
  return async (...args: TArgs): Promise<TResult> => {
    const traceId = createTraceId();
    try {
      const result = await fn(...args);
      logFlowTrace({
        flow: "discord_auth",
        phase,
        trace_id: traceId,
        result: "succeeded",
      });
      return result;
    } catch (error) {
      logFlowTrace({
        flow: "discord_auth",
        phase,
        trace_id: traceId,
        result: "failed",
        error_code: errorCode,
      });
      throw error;
    }
  };
}

export function buildUnmountedAuthConfig(input: UnmountedAuthInputs): AuthConfig {
  const authOrigin = strictConfiguredOrigin(input.authOrigin);
  const siteOrigin = strictConfiguredOrigin(input.siteOrigin);
  if (authOrigin !== siteOrigin) throw new Error("AUTH_ORIGIN_MISMATCH");
  if (!input.d1) throw new Error("AUTH_DATABASE_UNAVAILABLE");
  const credentials = resolveAuthRuntimeCredentials({
    authSecret: input.authSecret,
    discordClientId: input.discordClientId,
    discordClientSecret: input.discordClientSecret,
    allowLocalDevSecret: false,
  });
  const db = drizzle(input.d1, { schema });
  const adapter = DrizzleAdapter(db as never, authAdapterTables() as never);
  return {
    ...authRuntimeDefaults(),
    basePath: "/api/auth",
    secret: credentials.secret,
    // Never log stack, Cookie, tokens, secrets or untrusted URLs.
    logger: { error: logSafeAuthError },
    providers: [Discord(discordProviderOptions(credentials))],
    adapter: {
      ...adapter,
      createUser: wrapAdapterOperation(
        adapter.createUser,
        "user_created",
        "AUTH_USER_CREATE_FAILED",
      ),
      createSession: wrapAdapterOperation(
        adapter.createSession,
        "session_created",
        "AUTH_SESSION_CREATE_FAILED",
      ),
      deleteSession: wrapAdapterOperation(
        adapter.deleteSession
          ? async (sessionToken: string): Promise<void> => {
              await adapter.deleteSession!(sessionToken);
            }
          : undefined,
        "signout_completed",
        "AUTH_SESSION_DELETE_FAILED",
      ),
      async linkAccount(account) {
        await linkDiscordAccountAtomically(db, account, {
          siteOrigin,
          queueWakeHost: input.queueWakeHost,
        });
      },
    },
    callbacks: {
      async redirect({ url }) {
        return authRedirectTarget(url, authOrigin);
      },
      async session({ session, user }) {
        return applyDatabaseAuthSessionClaims(session, user);
      },
    },
  };
}

/** Native Fetch Request/Response; caller must enforce the route allowlist. */
export function invokeUnmountedAuth(request: Request, config: AuthConfig): Promise<Response> {
  return Auth(request, config);
}
