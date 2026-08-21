/**
 * 合作メンバー X ID 候補のR2静的インデックス（内部認証画面向け）。
 *
 * - 公開artifactに混ぜない。公開HTTP endpointから取得できない内部キーに置く。
 * - 同じ正規化X ID（trim / @除去 / 小文字化。normalizeXId相当）は1候補へ統合する。
 * - 表示名の大文字小文字は保持し、generation hashは内容依存で決定的。
 * - artifactは認証済みWeb routeからのみ読む。request pathでD1へfallbackしない。
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
/** layout/sort規則を変える時は必ず上げる。generation keyが変わる。 */
export const MEMBER_SUGGESTIONS_LAYOUT_VERSION = 1;

function normalizeId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export interface MemberSuggestionSourceEntry {
  /** DB由来の生値（大小文字混在可）。 */
  x_user_id: string;
  name?: string | null;
  /** x_users の現在表示名など、他の表示名より優先する正本名のとき true。 */
  isProfileName?: boolean;
  xAliases?: readonly string[];
  nameAliases?: readonly string[];
  occurrenceCount?: number;
  lastSeenAt?: number | null;
  approvalStatus?: string | null;
}

export interface MemberSuggestionItem {
  x_user_id: string;
  name: string;
  xAliases: string[];
  nameAliases: string[];
  occurrenceCount: number;
  lastSeenAt: number | null;
  approvalStatus: string | null;
}

export interface MemberSuggestionsManifest {
  schema_version: typeof MEMBER_SUGGESTIONS_SCHEMA_VERSION;
  generation: string;
  generated_at: number;
  total: number;
  object_key: string;
}

export interface MemberSuggestionsIndex {
  schema_version: typeof MEMBER_SUGGESTIONS_SCHEMA_VERSION;
  generation: string;
  generated_at: number;
  items: MemberSuggestionItem[];
}

/**
 * 候補を正規化X IDごとへ統合する。
 *
 * 表示名の優先順位:
 * 1. entries内で最初に現れるプロフィール表示名（x_users.x_name）
 * 2. それがなければ履歴表示名（videos / video_members、呼び出し側が新しい順で渡す）
 * 3. 最後に @xid 相当
 */
interface MemberSuggestionMergeState {
  item: MemberSuggestionItem;
  profileNameFound: boolean;
  seenNameLower: Set<string>;
  seenAliasLower: Set<string>;
}

export function buildMemberSuggestionItems(
  entries: readonly MemberSuggestionSourceEntry[],
): MemberSuggestionItem[] {
  const merged = new Map<string, MemberSuggestionMergeState>();

  const ensure = (rawId: string): MemberSuggestionMergeState | null => {
    const id = normalizeId(rawId);
    if (!id) return null;
    let entry = merged.get(id);
    if (!entry) {
      entry = {
        item: {
          x_user_id: id,
          name: "",
          xAliases: [],
          nameAliases: [],
          occurrenceCount: 0,
          lastSeenAt: null,
          approvalStatus: null,
        },
        profileNameFound: false,
        seenNameLower: new Set(),
        seenAliasLower: new Set(),
      };
      merged.set(id, entry);
    }
    return entry;
  };

  const pushHistoryName = (
    state: MemberSuggestionMergeState,
    rawName: string,
  ): void => {
    const name = rawName.trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (state.seenNameLower.has(lower)) return;
    state.seenNameLower.add(lower);
    if (!state.item.name) {
      // 履歴名は新しい順に渡される前提のため、最初の名前が暫定正本になる。
      state.item.name = name;
      return;
    }
    if (state.item.nameAliases.length >= MEMBER_SUGGESTIONS_MAX_NAME_ALIASES) {
      return;
    }
    state.item.nameAliases.push(name);
  };

  const applyProfileName = (
    state: MemberSuggestionMergeState,
    rawName: string,
  ): void => {
    const name = rawName.trim();
    if (!name || state.profileNameFound) return;
    state.profileNameFound = true;
    const lower = name.toLowerCase();
    const previous = state.item.name;
    const previousLower = previous ? previous.toLowerCase() : "";
    // プロフィール名と同じ（大小文字差のみ含む）aliasは排除する。
    state.item.nameAliases = state.item.nameAliases.filter(
      (alias) => alias.toLowerCase() !== lower,
    );
    if (previous && previousLower !== lower) {
      // 従来の正本名は最新の過去名として先頭へ退避する。
      state.item.nameAliases.unshift(previous);
      if (state.item.nameAliases.length > MEMBER_SUGGESTIONS_MAX_NAME_ALIASES) {
        state.item.nameAliases.length = MEMBER_SUGGESTIONS_MAX_NAME_ALIASES;
      }
      state.seenNameLower.add(previousLower);
    }
    state.seenNameLower.add(lower);
    state.item.name = name;
  };

  for (const source of entries) {
    const state = ensure(source.x_user_id);
    if (!state) continue;

    // 表示名の優先順位: プロフィール名 > 最新履歴名 > @xid。
    // entriesの並び順（x_users → aliases → 新しい順の履歴）は呼び出し側が保証する。
    if (source.name) {
      if (source.isProfileName) {
        applyProfileName(state, source.name);
      } else {
        pushHistoryName(state, source.name);
      }
    }

    for (const alias of source.xAliases ?? []) {
      const normalized = normalizeId(alias);
      if (!normalized || normalized === state.item.x_user_id) continue;
      if (state.seenAliasLower.has(normalized)) continue;
      if (state.item.xAliases.length >= MEMBER_SUGGESTIONS_MAX_X_ALIASES) continue;
      state.seenAliasLower.add(normalized);
      state.item.xAliases.push(normalized);
    }

    for (const historyName of source.nameAliases ?? []) {
      pushHistoryName(state, historyName);
    }

    state.item.occurrenceCount += Math.max(0, Math.floor(source.occurrenceCount ?? 0));
    const lastSeen = source.lastSeenAt;
    if (typeof lastSeen === "number" && Number.isFinite(lastSeen)) {
      state.item.lastSeenAt = Math.max(
        state.item.lastSeenAt ?? 0,
        Math.floor(lastSeen),
      );
    }
    if (source.approvalStatus != null && source.approvalStatus !== "") {
      state.item.approvalStatus = source.approvalStatus;
    }
  }

  // @id フォールバックは最後に適用する（優先順位3）。
  for (const state of merged.values()) {
    if (!state.item.name) state.item.name = `@${state.item.x_user_id}`;
  }

  // stable sort: 正規化X ID昇順で決定的な出力順を保証する。
  return Array.from(merged.values())
    .map((state) => state.item)
    .sort((left, right) =>
      left.x_user_id < right.x_user_id ? -1 : left.x_user_id > right.x_user_id ? 1 : 0,
    );
}

export function assertMemberSuggestionsRowLimit(
  items: readonly MemberSuggestionItem[],
): void {
  if (items.length > MEMBER_SUGGESTIONS_MAX_ROWS) {
    throw new Error(
      `member_suggestions_row_limit_exceeded (${items.length} > ${MEMBER_SUGGESTIONS_MAX_ROWS})`,
    );
  }
}

export function memberSuggestionsGenerationMaterial(
  items: readonly MemberSuggestionItem[],
): string {
  return JSON.stringify({
    layout_version: MEMBER_SUGGESTIONS_LAYOUT_VERSION,
    items: items.map((item) => ({
      x_user_id: item.x_user_id,
      name: item.name,
      xAliases: [...item.xAliases].sort(),
      nameAliases: [...item.nameAliases],
      occurrence_count: item.occurrenceCount,
      last_seen_at: item.lastSeenAt,
      approval_status: item.approvalStatus,
    })),
  });
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

export function buildMemberSuggestionArtifacts(args: {
  items: readonly MemberSuggestionItem[];
  generatedAt: number;
  generation: string;
}): { manifest: MemberSuggestionsManifest; index: MemberSuggestionsIndex } {
  const generation = safeGenerationForObjectKey(args.generation);
  const items = args.items;
  return {
    manifest: {
      schema_version: MEMBER_SUGGESTIONS_SCHEMA_VERSION,
      generation,
      generated_at: args.generatedAt,
      total: items.length,
      object_key: memberSuggestionsIndexObjectKey(generation),
    },
    index: {
      schema_version: MEMBER_SUGGESTIONS_SCHEMA_VERSION,
      generation,
      generated_at: args.generatedAt,
      items: items.map((item) => ({
        x_user_id: item.x_user_id,
        name: item.name,
        xAliases: [...item.xAliases],
        nameAliases: [...item.nameAliases],
        occurrenceCount: item.occurrenceCount,
        lastSeenAt: item.lastSeenAt,
        approvalStatus: item.approvalStatus,
      })),
    },
  };
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
  if (!Number.isFinite(total) || total < 0) return null;
  return { generation, total: Math.floor(total) };
}

/** index payload検証。generation不一致・schema不一致はnull（routeは503）。 */
export function parseMemberSuggestionsIndex(
  payload: unknown,
  expectedGeneration?: string,
): MemberSuggestionItem[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.schema_version !== MEMBER_SUGGESTIONS_SCHEMA_VERSION) return null;
  if (
    expectedGeneration != null &&
    record.generation !== expectedGeneration
  ) {
    return null;
  }
  const rawItems = record.items;
  if (!Array.isArray(rawItems)) return null;
  const items: MemberSuggestionItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const xUserId = item.x_user_id;
    const name = item.name;
    if (typeof xUserId !== "string" || typeof name !== "string") return null;
    if (!/^[a-z0-9_]{1,64}$/.test(xUserId)) return null;
    const xAliases = stringArray(item.xAliases);
    const nameAliases = stringArray(item.nameAliases);
    if (xAliases == null || nameAliases == null) return null;
    const occurrenceCount = Number(item.occurrenceCount ?? 0);
    if (!Number.isFinite(occurrenceCount) || occurrenceCount < 0) return null;
    const lastSeenRaw = item.lastSeenAt;
    let lastSeenAt: number | null = null;
    if (typeof lastSeenRaw === "number" && Number.isFinite(lastSeenRaw)) {
      lastSeenAt = Math.floor(lastSeenRaw);
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
      occurrenceCount: Math.floor(occurrenceCount),
      lastSeenAt,
      approvalStatus: approvalStatus ?? null,
    });
    if (items.length > MEMBER_SUGGESTIONS_MAX_ROWS) return null;
  }
  return items;
}

function stringArray(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    out.push(entry);
  }
  return out;
}
