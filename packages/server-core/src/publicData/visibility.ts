/** 公開データ層で使う visibility の唯一の判定入口。 */
export type PublicVideoVisibility = "public";
export type PublicEventVisibility = "public";

export function isPublicVideoListable(value: unknown): value is "public" {
  return value === "public";
}

/** YouTube の限定公開はメタデータで管理し、FlameNode 上は public として扱う。 */
export function isPublicVideoDirect(
  value: unknown,
): value is PublicVideoVisibility {
  return value === "public";
}

export function normalizePublicEventVisibility(
  value: unknown,
): PublicEventVisibility | null {
  return value === "public" ? value : null;
}
