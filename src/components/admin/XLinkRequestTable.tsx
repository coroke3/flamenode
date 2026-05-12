"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { approveXIdLinkRequest, rejectXIdLinkRequest } from "@/lib/actions/xid-admin";
import { formatUnix } from "@/lib/utils/format";
import { Icon } from "@/components/ui/Icon";

export interface XLinkRequestRow {
  id: string;
  requested_x_id: string;
  discord_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
}

export function XLinkRequestTable({
  rows,
}: {
  rows: XLinkRequestRow[];
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const run = (
    fn: (fd: FormData) => Promise<{ ok: boolean; message?: string }>,
    requestId: string,
  ) => {
    setMsg(null);
    const fd = new FormData();
    fd.set("request_id", requestId);
    startTransition(async () => {
      const r = await fn(fd);
      setMsg(r.message ?? (r.ok ? "処理しました。" : "処理に失敗しました。"));
      if (r.ok) router.refresh();
    });
  };

  if (rows.length === 0) {
    return (
      <p className="fn-muted fn-text-sm" style={{ margin: 0 }}>
        承認待ちの X ID 連携申請はありません。
      </p>
    );
  }

  return (
    <div>
      {msg ? (
        <p
          role="status"
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          {msg}
        </p>
      ) : null}
      <table className="fn-table">
        <thead>
          <tr>
            <th>申請 ID</th>
            <th>X ID</th>
            <th>申請者 Discord</th>
            <th>申請日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.id}</td>
              <td>
                <strong>@{r.requested_x_id}</strong>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {r.discord_image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={r.discord_image}
                      alt=""
                      width={32}
                      height={32}
                      style={{ borderRadius: 999, objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        background: "var(--bg-elevated)",
                        color: "var(--text-muted)",
                      }}
                    >
                      <Icon name="discord" size={14} aria-hidden />
                    </span>
                  )}
                  <span>
                    <strong>{r.discord_name ?? "Discord user"}</strong>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--text-muted)",
                      }}
                    >
                      {r.discord_user_id}
                    </span>
                  </span>
                </div>
              </td>
              <td style={{ fontSize: 12 }}>
                {formatUnix(r.requested_at, { dateOnly: true })}{" "}
                {formatUnix(r.requested_at, { timeOnly: true })}
              </td>
              <td>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="fn-btn fn-btn-primary fn-btn-sm"
                    disabled={pending}
                    onClick={() => run(approveXIdLinkRequest, r.id)}
                  >
                    承認
                  </button>
                  <button
                    type="button"
                    className="fn-btn fn-btn-ghost fn-btn-sm"
                    disabled={pending}
                    onClick={() => run(rejectXIdLinkRequest, r.id)}
                  >
                    却下
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
