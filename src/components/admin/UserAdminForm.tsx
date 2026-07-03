"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  refreshXUserIcon,
  setUserBanned,
  setUserCanCreateEvents,
  setUserNotifications,
  setUserRole,
} from "@/lib/actions/user-admin";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface UserAdminFormProps {
  user: {
    id: string;
    role: "user" | "admin" | "moderator" | null;
    is_banned: number | null;
    can_create_events: number | null;
    is_notification_enabled: number | null;
  };
  xUserIds: string[];
}

export function UserAdminForm({
  user,
  xUserIds,
}: UserAdminFormProps): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [banReason, setBanReason] = React.useState("");
  const [banConfirmOpen, setBanConfirmOpen] = React.useState(false);

  const run = (fd: FormData, action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>, okMsg: string) => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await action(fd);
      if (!r.ok) {
        setError(r.message ?? "操作に失敗しました。");
        return;
      }
      setSuccess(okMsg);
      router.refresh();
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 12 }}>
          <Icon name="warning" size={12} aria-hidden /> {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" style={{ color: "var(--accent-primary)", fontSize: 12 }}>
          <Icon name="check" size={12} aria-hidden /> {success}
        </p>
      ) : null}

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>ロール</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["user", "moderator", "admin"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={`fn-btn fn-btn-sm ${user.role === r ? "fn-btn-primary" : "fn-btn-ghost"}`}
              disabled={busy}
              onClick={() => {
                const fd = new FormData();
                fd.set("user_id", user.id);
                fd.set("role", r);
                run(fd, setUserRole, `ロールを ${r} に変更しました。`);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          BAN 状態
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          現在: {user.is_banned === 1 ? "BAN 中" : "通常"}
        </p>
        {user.is_banned === 1 ? (
          <button
            type="button"
            className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={busy}
            onClick={() => {
              const fd = new FormData();
              fd.set("user_id", user.id);
              fd.set("is_banned", "0");
              run(fd, setUserBanned, "BAN を解除しました。");
            }}
          >
            BAN を解除
          </button>
        ) : (
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <input
              type="text"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="BAN 理由 (必須)"
              className="fn-input"
              style={{ flex: 1 }}
              maxLength={500}
            />
            <button
              type="button"
              className="fn-btn fn-btn-danger fn-btn-sm"
              disabled={busy || !banReason.trim()}
              onClick={() => setBanConfirmOpen(true)}
            >
              BAN
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          開催権限
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          ON のユーザーは将来のイベント作成権限候補として扱います。開催申請フローは作成しません。
        </p>
        <button
          type="button"
          className={`fn-btn fn-btn-sm ${user.can_create_events === 1 ? "fn-btn-primary" : "fn-btn-ghost"}`}
          disabled={busy}
          onClick={() => {
            const next = user.can_create_events === 1 ? 0 : 1;
            const fd = new FormData();
            fd.set("user_id", user.id);
            fd.set("can_create_events", String(next));
            run(fd, setUserCanCreateEvents, "開催権限を更新しました。");
          }}
        >
          {user.can_create_events === 1 ? "開催権限ON" : "開催権限OFF"}
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>通知</h2>
        <button
          type="button"
          className={`fn-btn fn-btn-sm ${user.is_notification_enabled === 1 ? "fn-btn-primary" : "fn-btn-ghost"}`}
          disabled={busy}
          onClick={() => {
            const next = user.is_notification_enabled === 1 ? 0 : 1;
            const fd = new FormData();
            fd.set("user_id", user.id);
            fd.set("is_notification_enabled", String(next));
            run(fd, setUserNotifications, "通知設定を更新しました。");
          }}
        >
          {user.is_notification_enabled === 1 ? "通知ON" : "通知OFF"}
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          連携 X ID のアイコン再計算
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          各 X ID について、同 creator_x_user_id の最新作品の icon_url から `x_users.icon_url` を再設定します。
        </p>
        {xUserIds.length === 0 ? (
          <p className="fn-muted fn-text-sm" style={{ marginTop: 6 }}>
            連携済 X ID がありません。
          </p>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {xUserIds.map((xid) => (
              <button
                key={xid}
                type="button"
                className="fn-btn fn-btn-ghost fn-btn-sm"
                disabled={busy}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("x_user_id", xid);
                  run(fd, refreshXUserIcon, `@${xid} のアイコンを再計算しました。`);
                }}
              >
                @{xid}
              </button>
            ))}
          </div>
        )}
      </section>
      <ConfirmDialog
        open={banConfirmOpen}
        title="ユーザーを BAN"
        message={`このユーザーを BAN します。\n理由: ${banReason}`}
        confirmLabel="BAN する"
        cancelLabel="キャンセル"
        tone="danger"
        onConfirm={() => {
          setBanConfirmOpen(false);
          const fd = new FormData();
          fd.set("user_id", user.id);
          fd.set("is_banned", "1");
          fd.set("reason", banReason);
          run(fd, setUserBanned, "BAN しました。");
        }}
        onCancel={() => setBanConfirmOpen(false)}
      />
    </div>
  );
}
