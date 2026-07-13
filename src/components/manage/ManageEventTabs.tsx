"use client";

import * as React from "react";
import Link from "next/link";
import {
  usePathname,
  useSearchParams,
} from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  resolveManageEventNav,
  type ManageEventNavKey,
} from "@/lib/manage/eventNavigation";
import { ManageEventMoreMenu } from "./ManageEventMoreMenu";

interface ManageEventTabsProps {
  eventId: string;
  isAdmin?: boolean;
}

const PRIMARY_ITEMS: Array<{
  key: ManageEventNavKey;
  label: string;
  icon: IconName;
  href: (eventId: string) => string;
}> = [
  {
    key: "overview",
    label: "概要",
    icon: "grid",
    href: (id) => `/manage/events/${id}`,
  },
  {
    key: "pending",
    label: "対応待ち",
    icon: "check",
    href: (id) =>
      `/manage/events/${id}/videos?status=pending`,
  },
  {
    key: "content",
    label: "参加者・作品",
    icon: "list",
    href: (id) =>
      `/manage/events/${id}/videos?status=all`,
  },
  {
    key: "settings",
    label: "設定",
    icon: "settings",
    href: (id) =>
      `/manage/events/${id}/edit`,
  },
];

export function ManageEventTabs({
  eventId,
  isAdmin = false,
}: ManageEventTabsProps): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const encodedId =
    encodeURIComponent(eventId);

  const active =
    resolveManageEventNav({
      pathname,
      searchParams,
      eventId,
    });

  return (
    <div className="fn-console-event-nav">
      <nav
        className="fn-console-event-tabs"
        aria-label="イベント運営メニュー"
      >
        {PRIMARY_ITEMS.map((item) => {
          const href =
            item.href(encodedId);
          const selected =
            item.key === active;

          return (
            <Link
              key={item.key}
              href={href}
              className={`fn-btn fn-btn-sm ${
                selected
                  ? "fn-btn-primary"
                  : "fn-btn-ghost"
              }`}
              aria-current={
                selected ? "page" : undefined
              }
            >
              <Icon
                name={item.icon}
                size={12}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {active === "content" ? (
        <nav
          className="fn-console-event-subtabs"
          aria-label="参加者・作品"
        >
          <Link
            href={`/manage/events/${encodedId}/videos?status=all`}
          >
            提出状況
          </Link>
          <Link
            href={`/manage/events/${encodedId}/slots`}
          >
            枠管理
          </Link>
          <Link
            href={`/manage/events/${encodedId}/audience`}
          >
            登録者プレビュー
          </Link>
        </nav>
      ) : null}

      {active === "settings" ? (
        <nav
          className="fn-console-event-subtabs"
          aria-label="設定"
        >
          <Link
            href={`/manage/events/${encodedId}/edit`}
          >
            イベント設定
          </Link>
          <Link
            href={`/manage/events/${encodedId}/youtube-playlist`}
          >
            YouTube再生リスト
          </Link>
          <Link
            href={`/manage/events/${encodedId}/staff`}
          >
            運営メンバー
          </Link>
        </nav>
      ) : null}

      <ManageEventMoreMenu
        eventId={eventId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
