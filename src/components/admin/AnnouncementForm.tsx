"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
  createAnnouncement,
  updateAnnouncement,
} from "@/lib/actions/announcement";

export interface AnnouncementInitial {
  id?: string;
  title?: string;
  body?: string;
  severity?: "info" | "warning" | "danger";
  target_audience?: "all" | "creators" | "admins";
  is_published?: number;
  publish_at?: number | null;
  expire_at?: number | null;
}

interface Props {
  mode: "create" | "edit";
  initial?: AnnouncementInitial;
}

function unixToInput(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AnnouncementForm({
  mode,
  initial = {},
}: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r =
        mode === "create" ? await createAnnouncement(fd) : await updateAnnouncement(fd);
      if (!r.ok) {
        setError(r.message ?? "失敗しました。");
        return;
      }
      setSuccess("保存しました。");
      if (mode === "create" && r.id) {
        router.push(`/admin/announcements/${r.id}/edit`);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {mode === "edit" && initial.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}
      <div>
        <label className="fn-label">タイトル *</label>
        <input
          name="title"
          type="text"
          defaultValue={initial.title ?? ""}
          className="fn-input"
          maxLength={200}
          required
        />
      </div>
      <div>
        <label className="fn-label">本文 (Markdown) *</label>
        <textarea
          name="body"
          defaultValue={initial.body ?? ""}
          className="fn-input"
          rows={8}
          maxLength={8000}
          required
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">重要度</label>
          <select
            name="severity"
            defaultValue={initial.severity ?? "info"}
            className="fn-select"
          >
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="danger">danger</option>
          </select>
        </div>
        <div>
          <label className="fn-label">対象</label>
          <select
            name="target_audience"
            defaultValue={initial.target_audience ?? "all"}
            className="fn-select"
          >
            <option value="all">全員</option>
            <option value="creators">クリエイター</option>
            <option value="admins">管理者</option>
          </select>
        </div>
        <div>
          <label className="fn-label">公開</label>
          <select
            name="is_published"
            defaultValue={String(initial.is_published ?? 0)}
            className="fn-select"
          >
            <option value="0">下書き</option>
            <option value="1">公開</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="fn-label">掲載開始</label>
          <input
            name="publish_at"
            type="datetime-local"
            defaultValue={unixToInput(initial.publish_at)}
            className="fn-input"
          />
        </div>
        <div>
          <label className="fn-label">掲載終了</label>
          <input
            name="expire_at"
            type="datetime-local"
            defaultValue={unixToInput(initial.expire_at)}
            className="fn-input"
          />
        </div>
      </div>

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

      <button
        type="submit"
        className="fn-btn fn-btn-primary"
        disabled={busy}
        aria-busy={busy}
      >
        <Icon name="check" size={13} aria-hidden />
        {busy ? "保存中…" : mode === "create" ? "作成" : "保存"}
      </button>
    </form>
  );
}
