import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  xAccountLinkRequests as linkReqTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { Icon } from "@/components/ui/Icon";
import {
  DeleteXIdForm,
  SetActiveXButton,
  XIdLinkForm,
  XIdProfileForm,
} from "@/components/settings/XIdSettingsClient";
import { formatUnix } from "@/lib/utils/format";
import { sanitizeNextPath } from "@/lib/utils/next";
import { getXIconCandidates } from "@/lib/db/xIconResolution";

export const metadata: Metadata = { title: "設定" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  // next 未指定なら null として扱う (戻るボタンを出さない)。
  // 指定があれば sanitize した上で /dashboard/settings 自身に戻らないように補正する。
  const rawNext = params?.next?.trim();
  const next =
    rawNext && rawNext !== "/dashboard/settings"
      ? sanitizeNextPath(rawNext, "/dashboard")
      : null;
  const guard = await requireSession({
    next: next ?? "/dashboard/settings",
  });
  if (!guard.ok) return guard.element;
  const user = guard.user;

  const db = getDatabase();
  const xIds = db
    ? await db
        .select()
        .from(xUsersTable)
        .where(eq(xUsersTable.linked_discord_user_id, user.id))
    : [];

  const pendingLinkRequests = db
    ? await db
        .select()
        .from(linkReqTable)
        .where(
          and(
            eq(linkReqTable.discord_user_id, user.id),
            eq(linkReqTable.status, "pending"),
          )!,
        )
        .orderBy(desc(linkReqTable.requested_at))
    : [];

  // X ID ごとのアイコン候補を共通関数で取得する。
  // (旧コードはページ内で xUserIcons / videos.creator_icon_url を直接 select していたが、
  //  投稿フォーム側でも同じ候補ロジックを使うため `getXIconCandidates` に集約した)
  const iconCandidatesById: Record<string, string[]> = {};
  if (db && xIds.length > 0) {
    for (const x of xIds) {
      iconCandidatesById[x.id] = await getXIconCandidates(db, x.id, 12);
    }
  }

  return (
    <div
      style={{
        width: "min(96%, 800px)",
        margin: "0 auto",
        padding: "28px 16px 64px",
      }}
    >
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>
          設定
        </h1>
        <p style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13 }}>
          X ID 連携、アクティブ X ID の切替、Discord アカウント情報を管理します。
        </p>
        {next ? (
          <div style={{ marginTop: 14 }}>
            <Link href={next} className="fn-btn fn-btn-primary">
              <Icon name="chevron-right" size={13} aria-hidden /> 元の画面へ戻る
            </Link>
          </div>
        ) : null}
      </header>

      <section className="fn-card fn-mb-lg">
        <div className="fn-card-header">
          <h2 className="fn-card-title">Discord</h2>
        </div>
        <div className="fn-card-body">
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {user.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={user.image}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: 999, objectFit: "cover" }}
              />
            ) : (
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 999,
                  background: "var(--bg-elevated)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--text-muted)",
                }}
              >
                <Icon name="user" size={20} aria-hidden />
              </span>
            )}
            <div>
              <div style={{ fontWeight: 700 }}>{user.name}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                ID: {user.id}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="fn-card">
        <div className="fn-card-header">
          <h2 className="fn-card-title">連携 X ID</h2>
        </div>
        <div className="fn-card-body">
          <XIdLinkForm />
          <p className="fn-muted fn-text-sm" style={{ marginTop: 12 }}>
            申請後は運営（管理者）の承認が必要です。管理者の方は{" "}
            <Link href="/admin/x-link-requests">X 連携申請</Link> から承認できます。
          </p>

          {pendingLinkRequests.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <h3
                className="fn-text-sm"
                style={{
                  margin: "0 0 8px",
                  fontWeight: 700,
                  color: "var(--text-secondary)",
                }}
              >
                承認待ちの申請
              </h3>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "1.1em",
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                {pendingLinkRequests.map((r) => (
                  <li key={r.id}>
                    @{r.requested_x_id}
                    <span style={{ opacity: 0.75 }}>
                      {" "}
                      · {formatUnix(r.requested_at, { dateOnly: true })}{" "}
                      {formatUnix(r.requested_at, { timeOnly: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {xIds.length === 0 ? (
            <p
              className="fn-muted fn-text-sm"
              style={{ marginTop: pendingLinkRequests.length ? 16 : 20 }}
            >
              承認済みの X ID はまだありません。
              <br />
              上のフォームから連携を申請するか、運営の承認をお待ちください。
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
                gap: 12,
                marginTop: 18,
              }}
            >
              {xIds.map((x, index) => {
                const active = x.id === user.active_x_user_id;
                const approved = x.approval_status === "approved";
                return (
                  <section
                    key={`${x.id}-settings-${index}`}
                    aria-label={`@${x.id} の選択カード`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "44px 1fr",
                      gap: 12,
                      alignItems: "center",
                      padding: "14px 14px",
                      border: active
                        ? "1px solid var(--accent-primary)"
                        : "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      background: active
                        ? "var(--accent-primary-soft)"
                        : "var(--bg-base)",
                    }}
                  >
                    {x.icon_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={x.icon_url}
                        alt=""
                        width={44}
                        height={44}
                        style={{
                          borderRadius: 999,
                          objectFit: "cover",
                          background: "var(--bg-elevated)",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 999,
                          background: "var(--bg-elevated)",
                          display: "grid",
                          placeItems: "center",
                          color: "var(--text-muted)",
                        }}
                      >
                        <Icon name="user" size={18} aria-hidden />
                      </span>
                    )}
                    <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {x.x_name}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          @{x.id}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {approved ? (
                          <span className="fn-badge fn-badge-accent">承認済</span>
                        ) : x.approval_status === "pending" ? (
                          <span className="fn-badge fn-badge-warning">承認待ち</span>
                        ) : (
                          <span className="fn-badge fn-badge-danger">再申請</span>
                        )}
                        {active ? (
                          <span className="fn-badge fn-badge-soft">
                            <Icon name="check" size={11} aria-hidden /> アクティブ
                          </span>
                        ) : approved ? (
                          <SetActiveXButton xUserId={x.id} next={next} />
                        ) : null}
                        <Link
                          href={`/user/${x.id}`}
                          className="fn-btn fn-btn-ghost fn-btn-sm"
                        >
                          プロフィール
                        </Link>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {xIds.length > 0 ? (
            <div style={{ marginTop: 24, display: "grid", gap: 16 }}>
              {xIds.map((x, index) => (
                <section key={`profile-${x.id}-${index}`} className="fn-card">
                  <div className="fn-card-header">
                    <h3 className="fn-card-title">@{x.id} のプロフィール既定値</h3>
                  </div>
                  <div className="fn-card-body">
                    <XIdProfileForm
                      x={{
                        id: x.id,
                        x_name: x.x_name,
                        icon_url: x.icon_url,
                        profile_text: x.profile_text,
                        youtube_channel_url: x.youtube_channel_url,
                        other_social_links: x.other_social_links,
                      }}
                      iconCandidates={iconCandidatesById[x.id] ?? []}
                    />
                    <div style={{ marginTop: 12 }}>
                      <DeleteXIdForm xUserId={x.id} />
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
