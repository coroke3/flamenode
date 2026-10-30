/** MIG-0724 U01: browser-safe CURRENT review UI metadata; never an authorization boundary. */
export type ReviewActionResult = {
  ok: boolean;
  message?: string;
  retryable?: boolean;
  pendingPublicReflection?: boolean;
  nextHref?: string;
  traceId?: string;
};
export type ReviewAction = (fd: FormData) => Promise<ReviewActionResult>;
export type VideoVisibilityStatus = "pending" | "public" | "private" | "voided";
export const VIDEO_STATUS_LABELS: Record<VideoVisibilityStatus, { label: string; description: string }> = {
  pending: { label: "公開待ち", description: "提出済みで運営確認や公開処理を待っている状態です。" },
  public: { label: "公開", description: "一覧やイベントページから閲覧できる通常公開です。YouTube限定公開の動画もこの状態で扱います。" },
  private: { label: "非公開", description: "投稿者本人と管理者だけが閲覧できる状態です。" },
  voided: { label: "無効化", description: "重複、権利確認、取り下げなどで無効化された状態です。" },
};
export const VOID_REASON_LABELS = {
  x_id_invalid: "X ID 不正", duplicate: "重複投稿",
  withdrawn_by_creator: "投稿者による取り下げ",
  operator_decision: "運営判断", expired: "期限切れ",
} as const;
export const COMMUNICATION_ERROR_MESSAGE =
  "通信エラーが発生しました。状態を再取得してもう一度お試しください。";
export const PUBLIC_REFLECTION_DELAY_MESSAGE =
  "公開ページへの反映は、静的データの再生成が完了するまでしばらく時間がかかることがあります。";
export function videoVisibilityLabel(status: string): string {
  // Review queue uses CURRENT admin labels; the form's pending option says 公開待ち.
  if (status === "pending") return "審査待ち";
  return Object.prototype.hasOwnProperty.call(VIDEO_STATUS_LABELS, status)
    ? VIDEO_STATUS_LABELS[status as VideoVisibilityStatus].label
    : status;
}
export function videoVisibilityBadgeClass(status: string): string {
  if (status === "public") return "fn-badge-accent";
  if (status === "pending") return "fn-badge-warning";
  if (status === "voided") return "fn-badge-danger";
  return "fn-badge-soft";
}
export function youtubeThumbUrl(id: string | null | undefined, size: "default" | "maxresdefault"): string {
  const trimmed = id?.trim() ?? "";
  return /^[A-Za-z0-9_-]{11}$/.test(trimmed) ? `/api/youtube-thumbnail/${trimmed}/${size}` : "";
}
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}
const formatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});
export function formatUnix(sec: number): string {
  return Number.isFinite(sec) ? formatter.format(new Date(sec * 1000)) : "-";
}
export function formatRelative(sec: number, now = Date.now() / 1000): string {
  if (!Number.isFinite(sec)) return "";
  const diff = now - sec;
  if (diff < 60) return "今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}日前`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}か月前`;
  return `${Math.floor(diff / 31536000)}年前`;
}
