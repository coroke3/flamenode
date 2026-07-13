/** 公開データ層で使う visibility の唯一の判定入口。 */
export type PublicVideoVisibility = "public" | "limited";
export type PublicEventVisibility = "public" | "archived";

export function isPublicVideoListable(value: unknown): value is "public" {
  return value === "public";
}

/** limited は直接URLのみで表示でき、一覧・検索へは出さない。 */
export function isPublicVideoDirect(
  value: unknown,
): value is PublicVideoVisibility {
  return value === "public" || value === "limited";
}

export function normalizePublicVideoVisibility(value: unknown): "public" | null {
  return isPublicVideoListable(value) ? "public" : null;
}

export function normalizePublicEventVisibility(
  value: unknown,
): PublicEventVisibility | null {
  if (value === "public" || value === "archived") return value;
  return null;
}
