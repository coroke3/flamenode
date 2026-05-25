import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * 監査ログの (table_name, record_id) を対応する管理画面 / 公開ページへ
 * 飛べるリンクに変換するヘルパー。
 *
 * - videos: /admin/videos/{id} (管理) + /{youtube_id ?? id} (公開) は使えないので id だけリンク
 * - events: /admin/events/{id}/edit (管理) + /event/{id} (公開)
 * - users: /admin/users/{id}
 * - x_users: /admin/users?view=xid&q={id} (検索結果ジャンプ)
 * - slots / video_chapters 等: 親 record の管理画面にフォールバック
 *
 * 不明なテーブル名はリンクなしの素のテキストを返す。
 */
export interface AuditTargetLinkProps {
  tableName: string;
  recordId: string;
  /** モバイル等でテキストを省略表示にしたい場合 */
  maxChars?: number;
}

const TABLE_LINKS: Record<
  string,
  (id: string) => { adminHref?: string; publicHref?: string; label?: string }
> = {
  videos: (id) => ({
    adminHref: `/admin/videos/${encodeURIComponent(id)}`,
  }),
  events: (id) => ({
    adminHref: `/admin/events/${encodeURIComponent(id)}/edit`,
    publicHref: `/event/${encodeURIComponent(id)}`,
  }),
  users: (id) => ({
    adminHref: `/admin/users/${encodeURIComponent(id)}`,
  }),
  x_users: (id) => ({
    adminHref: `/admin/users?view=xid&q=${encodeURIComponent(id)}`,
    publicHref: `/user/${encodeURIComponent(id)}`,
  }),
  video_chapters: () => ({}),
  video_members: () => ({}),
  slots: (id) => ({
    adminHref: `/admin/audit?table=slots&record=${encodeURIComponent(id)}`,
  }),
  event_staff: () => ({}),
  event_staff_permissions: () => ({}),
  notification_outbox: () => ({}),
  x_account_link_requests: (id) => ({
    adminHref: `/admin/users?view=links&q=${encodeURIComponent(id)}`,
  }),
};

export function AuditTargetLink({
  tableName,
  recordId,
  maxChars = 24,
}: AuditTargetLinkProps): React.ReactElement {
  const resolver = TABLE_LINKS[tableName];
  const display =
    recordId.length > maxChars ? `${recordId.slice(0, maxChars)}…` : recordId;
  const links = resolver ? resolver(recordId) : {};
  const adminHref = links.adminHref;
  const publicHref = links.publicHref;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontFamily: "monospace",
          fontSize: 11,
          color: "var(--text-secondary)",
          wordBreak: "break-all",
        }}
        title={recordId}
      >
        {display}
      </span>
      {adminHref ? (
        <Link
          href={adminHref}
          className="fn-btn fn-btn-ghost fn-btn-sm"
          style={{ padding: "0 6px", height: 20, fontSize: 10 }}
          aria-label="管理画面で開く"
          title="管理画面"
        >
          <Icon name="external" size={10} aria-hidden /> 管理
        </Link>
      ) : null}
      {publicHref ? (
        <Link
          href={publicHref}
          className="fn-btn fn-btn-ghost fn-btn-sm"
          style={{ padding: "0 6px", height: 20, fontSize: 10 }}
          aria-label="公開ページを開く"
          title="公開ページ"
        >
          <Icon name="external" size={10} aria-hidden /> 公開
        </Link>
      ) : null}
    </span>
  );
}
