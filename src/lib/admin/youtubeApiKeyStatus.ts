import "server-only";

export const YOUTUBE_API_KEY_STATUS_KV = "youtube-api:key-status:v1";

export type YoutubeApiKeyLabel = "primary" | "secondary";
export type YoutubeApiFailureKind = "quota" | "credential" | "transient" | "permanent";

export type YoutubeApiKeyRuntimeStatus = {
  configured: YoutubeApiKeyLabel[];
  activeKey: YoutubeApiKeyLabel | null;
  disabledUntil: Partial<Record<YoutubeApiKeyLabel, number>>;
  lastFailoverAt: number | null;
  lastFailoverFrom: YoutubeApiKeyLabel | null;
  lastFailureKind: YoutubeApiFailureKind | null;
  lastFailureReason: string | null;
  updatedAt: number | null;
};

function unixValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseYoutubeApiKeyStatus(
  raw: string | null,
): YoutubeApiKeyRuntimeStatus | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const configured = Array.isArray(value.configured)
      ? value.configured.filter(
          (item): item is YoutubeApiKeyLabel =>
            item === "primary" || item === "secondary",
        )
      : [];
    const disabled =
      value.disabled_until && typeof value.disabled_until === "object"
        ? (value.disabled_until as Record<string, unknown>)
        : {};
    const lastFailureKind =
      value.last_failure_kind === "quota" ||
      value.last_failure_kind === "credential" ||
      value.last_failure_kind === "transient" ||
      value.last_failure_kind === "permanent"
        ? value.last_failure_kind
        : null;

    return {
      configured,
      activeKey:
        value.active_key === "primary" || value.active_key === "secondary"
          ? value.active_key
          : null,
      disabledUntil: {
        primary: unixValue(disabled.primary) ?? undefined,
        secondary: unixValue(disabled.secondary) ?? undefined,
      },
      lastFailoverAt: unixValue(value.last_failover_at),
      lastFailoverFrom:
        value.last_failover_from === "primary" ||
        value.last_failover_from === "secondary"
          ? value.last_failover_from
          : null,
      lastFailureKind,
      lastFailureReason:
        typeof value.last_failure_reason === "string"
          ? value.last_failure_reason.slice(0, 100)
          : null,
      updatedAt: unixValue(value.updated_at),
    };
  } catch {
    return null;
  }
}

export async function loadYoutubeApiKeyStatus(
  kv: KVNamespace,
): Promise<YoutubeApiKeyRuntimeStatus | null> {
  try {
    return parseYoutubeApiKeyStatus(
      await kv.get(YOUTUBE_API_KEY_STATUS_KV),
    );
  } catch {
    return null;
  }
}
