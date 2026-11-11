// Values pinned to CURRENT: normalize.ts (50 decisions), cpuBudget.ts (250 rows).
// Avoid importing Next's source tree into the Hono runtime.
type CanonicalVisibility = "private" | "public";
type LegacyImportStrategy = "create_only" | "skip_existing" | "replace_imported";
type LegacyVideoFieldDecision =
  | { source_key: string; action: "custom_question"; question_label: string }
  | { source_key: string; action: "ignore" };
export const MAX_LEGACY_VIDEO_FIELD_DECISIONS = 50;
export const MAX_LEGACY_IMPORT_SELECTED_ROWS = 250;

/**
 * MIG-0645 U02 input boundary, copied from CURRENT RH-002.
 * Pure helpers only. No auth, D1/R2 operations, or Hono route mounting.
 */
export const LEGACY_IMPORT_MAX_FILES = 20;
export const LEGACY_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const LEGACY_IMPORT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const LEGACY_IMPORT_MAX_FIELD_DECISIONS_BYTES = 16 * 1024;

export function legacyImportMode(value: FormDataEntryValue | null): "apply" | "preview" {
  return value === "apply" ? "apply" : "preview";
}

export function legacyImportVisibility(value: FormDataEntryValue | null): CanonicalVisibility {
  return value === "private" ? "private" : "public";
}

export function legacyImportStrategy(value: FormDataEntryValue | null): LegacyImportStrategy {
  if (value === "skip_existing" || value === "replace_imported") return value;
  return "create_only";
}

export function legacyImportStringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export type LegacyImportInputError = {
  status: 400 | 413;
  message: string;
};

export function validateLegacyImportFileEnvelope(
  files: ReadonlyArray<{ name: string; size: number }>,
): LegacyImportInputError | null {
  if (files.length === 0) return { status: 400, message: "JSON・CSV・TSVファイルを選択してください。" };
  if (files.length > LEGACY_IMPORT_MAX_FILES) {
    return { status: 400, message: `ファイル数は最大${LEGACY_IMPORT_MAX_FILES}件です。` };
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > LEGACY_IMPORT_MAX_FILE_BYTES) {
      return { status: 400, message: `${file.name}: 1ファイル2MBまでです。大きいファイルは物理分割してください。` };
    }
    totalBytes += file.size;
    if (totalBytes > LEGACY_IMPORT_MAX_TOTAL_BYTES) {
      return { status: 400, message: "ファイル合計は4MBまでです。複数回に分けてください。" };
    }
  }
  return null;
}

export function validateLegacyImportSelectedRows(rowCount: number): LegacyImportInputError | null {
  if (rowCount > MAX_LEGACY_IMPORT_SELECTED_ROWS) {
    return {
      status: 413,
      message: `今回の選択範囲は${rowCount.toLocaleString()}行です。合計${MAX_LEGACY_IMPORT_SELECTED_ROWS}行以下になるよう、各ファイルの開始・終了位置を狭めてください。`,
    };
  }
  return null;
}

/** Preserve CURRENT decision JSON size, shape, error ordering and exact messages. */
export function parseLegacyImportVideoFieldDecisions(formData: FormData): LegacyVideoFieldDecision[] {
  const raw = legacyImportStringField(formData, "video_custom_field_decisions");
  if (!raw) return [];
  if (new TextEncoder().encode(raw).byteLength > LEGACY_IMPORT_MAX_FIELD_DECISIONS_BYTES) {
    throw new Error("動画の未対応項目の指定が大きすぎます。");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("動画の未対応項目の指定をJSONとして読み取れませんでした。");
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_LEGACY_VIDEO_FIELD_DECISIONS) {
    throw new Error(`動画の未対応項目の指定は最大${MAX_LEGACY_VIDEO_FIELD_DECISIONS}件です。`);
  }

  return parsed.map((item, index): LegacyVideoFieldDecision => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`動画の未対応項目の指定${index + 1}件目が不正です。`);
    }
    const record = item as Record<string, unknown>;
    const sourceKey = typeof record.source_key === "string" ? record.source_key : "";
    if (record.action === "ignore") {
      if (Object.keys(record).some((key) => key !== "source_key" && key !== "action")) {
        throw new Error(`動画項目「${sourceKey || index + 1}」の除外指定に不明な値があります。`);
      }
      return { source_key: sourceKey, action: "ignore" };
    }
    if (record.action === "custom_question") {
      if (
        Object.keys(record).some(
          (key) => key !== "source_key" && key !== "action" && key !== "question_label",
        ) ||
        typeof record.question_label !== "string"
      ) {
        throw new Error(`動画項目「${sourceKey || index + 1}」の質問文Q指定が不正です。`);
      }
      return {
        source_key: sourceKey,
        action: "custom_question",
        question_label: record.question_label,
      };
    }
    throw new Error(`動画項目「${sourceKey || index + 1}」の処理方法が不正です。`);
  });
}
