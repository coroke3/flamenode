import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export function ManageEventMoreMenu({
  eventId,
  isAdmin,
}: {
  eventId: string;
  isAdmin: boolean;
}): React.ReactElement {
  const id = encodeURIComponent(eventId);

  return (
    <div className="fn-console-event-more-row">
      <details className="fn-console-event-more">
        <summary>
          <Icon
            name="more"
            size={13}
            aria-hidden
          />
          その他
        </summary>

        <div className="fn-console-event-more-menu">
          <Link
            href={`/manage/notifications?event=${id}`}
          >
            通知
          </Link>
          <Link href={`/event/${id}`}>
            公開ページ
          </Link>
        </div>
      </details>

      {isAdmin ? (
        <details className="fn-console-event-more">
          <summary>
            <Icon
              name="settings"
              size={13}
              aria-hidden
            />
            サイト管理で開く
          </summary>

          <div className="fn-console-event-more-menu">
            <Link
              href={`/admin/videos?event=${id}&status=pending`}
            >
              管理者用審査
            </Link>
            <Link
              href={`/admin/audit?table=events&record=${id}`}
            >
              監査ログ
            </Link>
            <Link
              href={`/admin/notifications?event=${id}`}
            >
              管理者通知ログ
            </Link>
            <Link
              href={`/admin/videos?event=${id}`}
            >
              全作品管理
            </Link>
          </div>
        </details>
      ) : null}
    </div>
  );
}
