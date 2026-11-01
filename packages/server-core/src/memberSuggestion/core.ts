/** Canonical read-only R2 member-suggestion artifact contract (RH-019).
 * CURRENT: src/lib/video/memberSuggestionsCore.ts. Only reader-used symbols
 * are moved here; artifact generation remains in CURRENT until its owner moves.
 */
export const MEMBER_SUGGESTIONS_SCHEMA_VERSION = 1 as const;
/** 内部データのため公開R2配信路径には置かない。 */
export const MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY =
  "internal/member-suggestions/v1/manifest.json";
export const MEMBER_SUGGESTIONS_GENERATION_PREFIX =
  "internal/member-suggestions/v1/g";
export const MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES = 64 * 1024;
export const MEMBER_SUGGESTIONS_MAX_INDEX_BYTES = 8 * 1024 * 1024;
/** row count guard。超過時はpartial indexを静かにpublishせずbuildを失敗させる。 */
export const MEMBER_SUGGESTIONS_MAX_ROWS = 20_000;
/** alias無限保持の防止。超過分は新しい方から採用する。 */
export const MEMBER_SUGGESTIONS_MAX_NAME_ALIASES = 12;
export const MEMBER_SUGGESTIONS_MAX_X_ALIASES = 12;

export interface MemberSuggestionItem {
  x_user_id: string;
  name: string;
  xAliases: string[];
  nameAliases: string[];
  occurrenceCount: number;
  lastSeenAt: number | null;
  approvalStatus: string | null;
}

export function safeGenerationForObjectKey(generation: string): string {
  const normalized = generation.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new Error("invalid member suggestions generation");
  }
  return normalized;
}

export function memberSuggestionsIndexObjectKey(generation: string): string {
  return `${MEMBER_SUGGESTIONS_GENERATION_PREFIX}/${safeGenerationForObjectKey(generation)}/index.json`;
}

/** manifest payload検証。不正ならnull（routeは503を返す）。 */
export function parseMemberSuggestionsManifest(payload: unknown):
  | { generation: string; total: number }
  | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.schema_version !== MEMBER_SUGGESTIONS_SCHEMA_VERSION) return null;
  const generation = record.generation;
  if (typeof generation !== "string" || generation.length === 0) return null;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(generation)) return null;
  const total = Number(record.total);
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    total > MEMBER_SUGGESTIONS_MAX_ROWS
  ) {
    return null;
  }
  // readerはgenerationからobject keyを再生成するため、旧artifactのobject_key欠落や
  // 互換field差分は読み取り可否に使わない。CPU/件数に影響する境界だけfail-closedにする。
  return { generation, total };
}

/** index payload検証。generation不一致・schema不一致はnull（routeは503）。 */
export function parseMemberSuggestionsIndex(
  payload: unknown,
  expectedGeneration?: string,
): MemberSuggestionItem[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.schema_version !== MEMBER_SUGGESTIONS_SCHEMA_VERSION) return null;
  const generation = record.generation;
  if (
    typeof generation !== "string" ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(generation) ||
    (expectedGeneration != null && generation !== expectedGeneration)
  ) {
    return null;
  }
  const rawItems = record.items;
  if (!Array.isArray(rawItems) || rawItems.length > MEMBER_SUGGESTIONS_MAX_ROWS) {
    return null;
  }
  const items: MemberSuggestionItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const xUserId = item.x_user_id;
    const name = item.name;
    if (
      typeof xUserId !== "string" ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return null;
    }
    if (!/^[a-z0-9_]{1,64}$/.test(xUserId)) return null;
    const xAliases = stringArray(
      item.xAliases,
      MEMBER_SUGGESTIONS_MAX_X_ALIASES,
      (entry) => /^[a-z0-9_]{1,64}$/.test(entry) && entry !== xUserId,
    );
    const nameAliases = stringArray(
      item.nameAliases,
      MEMBER_SUGGESTIONS_MAX_NAME_ALIASES,
      (entry) => entry.trim().length > 0,
    );
    if (xAliases == null || nameAliases == null) return null;
    const occurrenceCount = Number(item.occurrenceCount ?? 0);
    if (!Number.isSafeInteger(occurrenceCount) || occurrenceCount < 0) return null;
    const lastSeenRaw = item.lastSeenAt;
    let lastSeenAt: number | null = null;
    if (typeof lastSeenRaw === "number" && Number.isSafeInteger(lastSeenRaw)) {
      lastSeenAt = lastSeenRaw;
    } else if (lastSeenRaw != null) {
      return null;
    }
    const approvalStatus = item.approvalStatus;
    if (approvalStatus != null && typeof approvalStatus !== "string") return null;
    items.push({
      x_user_id: xUserId,
      name,
      xAliases,
      nameAliases,
      occurrenceCount,
      lastSeenAt,
      approvalStatus: approvalStatus ?? null,
    });
  }
  return items;
}

function stringArray(
  value: unknown,
  maxLength: number,
  validate: (entry: string) => boolean,
): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxLength) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !validate(entry)) return null;
    out.push(entry);
  }
  return out;
}
