export type OpsWebhookTarget = "account" | "event" | "system";

export const OPS_WEBHOOK_TARGETS = ["account", "event", "system"] as const;

export function isOpsWebhookTarget(v: unknown): v is OpsWebhookTarget {
  return (
    typeof v === "string" &&
    (OPS_WEBHOOK_TARGETS as readonly string[]).includes(v)
  );
}

const DISCORD_THREAD_NAME_MAX = 100;

function neutralizeDiscordMentionsInThreadName(input: string): string {
  return input
    .replace(/@everyone/gi, (match) => `@\u200b${match.slice(1)}`)
    .replace(/@here/gi, (match) => `@\u200b${match.slice(1)}`)
    .replace(/<@&[0-9]+>/g, "")
    .replace(/<@!?[0-9]+>/g, "");
}

/** Discord forum thread_name 向けに改行・制御文字を除去し長さを制限する。 */
export function sanitizeDiscordThreadName(input: string, fallback: string): string {
  const cleaned = neutralizeDiscordMentionsInThreadName(input)
    .replace(/[\r\n\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned.length > 0 ? cleaned : fallback.trim();
  if (base.length <= DISCORD_THREAD_NAME_MAX) return base;
  return base.slice(0, DISCORD_THREAD_NAME_MAX).trimEnd();
}

type ForumWebhookEnv = {
  DISCORD_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL_FORUM_ACCOUNT?: string;
  DISCORD_WEBHOOK_URL_FORUM_EVENT?: string;
  DISCORD_WEBHOOK_URL_FORUM_SYSTEM?: string;
};

const FORUM_ENV_BY_TARGET: Record<
  OpsWebhookTarget,
  keyof ForumWebhookEnv
> = {
  account: "DISCORD_WEBHOOK_URL_FORUM_ACCOUNT",
  event: "DISCORD_WEBHOOK_URL_FORUM_EVENT",
  system: "DISCORD_WEBHOOK_URL_FORUM_SYSTEM",
};

/** forum ターゲットまたは legacy Webhook URL を解決する。 */
export function resolveForumWebhookUrl(
  env: ForumWebhookEnv,
  target: OpsWebhookTarget | null,
): { url: string; kind: "forum" | "legacy" } | { error: string } {
  if (target != null) {
    const envKey = FORUM_ENV_BY_TARGET[target];
    const url = env[envKey]?.trim();
    if (!url) {
      return { error: `forum_webhook_unconfigured:${target}` };
    }
    return { url, kind: "forum" };
  }
  const legacy = env.DISCORD_WEBHOOK_URL?.trim();
  if (!legacy) {
    return { error: "discord_channel_webhook_unconfigured" };
  }
  return { url: legacy, kind: "legacy" };
}
