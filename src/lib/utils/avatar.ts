/** 表示名または X ID からアバター初期文字を得る。 */
export function getUserAvatarInitial(label: string | null | undefined): string {
  const trimmed = (label ?? "").trim().replace(/^@/, "");
  return trimmed.slice(0, 1).toLowerCase() || "?";
}
