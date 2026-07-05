export function publicUserHref(xUserId: string): string {
  return `/user/${encodeURIComponent(xUserId)}`;
}

/** 設定画面から公開プロフィールへ遷移する Link / a 用 */
export const publicPageLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
