"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  createEventGroup,
  updateEventGroup,
} from "@/lib/actions/event-group-admin";
import { SaveSuccessNotice } from "@/components/ui/SaveSuccessNotice";
import { eventGroupPublicHref } from "@/lib/eventGroupRoutes";

export interface EventGroupInitial {
  id?: string;
  base_updated_at?: number | null;
  name?: string;
  slug?: string;
  description?: string | null;
  group_type?: "series" | "genre" | "related" | "collection" | "other";
  icon_url?: string | null;
  img_url?: string | null;
  accent_color?: string | null;
  visibility_status?: "public" | "private" | "archived";
  sort_order?: number;
}

interface Props {
  mode: "create" | "edit";
  initial?: EventGroupInitial;
}

const GROUP_TYPES: { value: EventGroupInitial["group_type"]; label: string }[] = [
  { value: "series", label: "系列" },
  { value: "genre", label: "ジャンル" },
  { value: "related", label: "関連" },
  { value: "collection", label: "コレクション" },
  { value: "other", label: "その他" },
];

export function EventGroupForm({
  mode,
  initial = {},
}: Props): React.ReactElement {
  const router = useRouter();
  const [busy, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const r =
          mode === "create"
            ? await createEventGroup(fd)
            : await updateEventGroup(fd);
        if (!r.ok) {
          setError(r.message ?? "失敗しました。");
          return;
        }
        setSuccess({
          message: "保存しました。",
          pendingPublicReflection: r.pendingPublicReflection,
        });
        if (mode === "create" && r.id) {
          router.push(`/admin/event-groups/${r.id}/edit`);
        } else {
          router.refresh();
        }
      } catch {
        setError("保存に失敗しました。再読み込みして、もう一度お試しください。");
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
      {mode === "edit" && initial.base_updated_at != null ? (
        <input
          type="hidden"
          name="base_updated_at"
          value={initial.base_updated_at}
        />
      ) : null}
      <div>
        <label className="fn-label">名前 *</label>
        <input
          name="name"
          type="text"
          defaultValue={initial.name ?? ""}
          className="fn-input"
          maxLength={120}
          required
        />
      </div>
      <div>
        <label className="fn-label">スラッグ *</label>
        <input
          name="slug"
          type="text"
          defaultValue={initial.slug ?? ""}
          className="fn-input"
          maxLength={64}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          required
        />
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
          公開 URL: {eventGroupPublicHref("{slug}")}
        </p>
      </div>
      <div>
        <label className="fn-label">説明</label>
        <textarea
          name="description"
          defaultValue={initial.description ?? ""}
          className="fn-input"
          rows={4}
          maxLength={2000}
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label className="fn-label">種別</label>
          <select
            name="group_type"
            defaultValue={initial.group_type ?? "series"}
            className="fn-select"
          >
            {GROUP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="fn-label">公開状態</label>
          <select
            name="visibility_status"
            defaultValue={initial.visibility_status ?? "public"}
            className="fn-select"
          >
            <option value="public">公開</option>
            <option value="private">非公開</option>
            <option value="archived">アーカイブ</option>
          </select>
        </div>
        <div>
          <label className="fn-label">表示順</label>
          <input
            name="sort_order"
            type="number"
            defaultValue={initial.sort_order ?? 0}
            className="fn-input"
            min={-9999}
            max={9999}
            step={1}
          />
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <label className="fn-label">アイコン URL</label>
          <input
            name="icon_url"
            type="url"
            defaultValue={initial.icon_url ?? ""}
            className="fn-input"
            maxLength={500}
          />
        </div>
        <div>
          <label className="fn-label">アクセント色</label>
          <input
            name="accent_color"
            type="text"
            defaultValue={initial.accent_color ?? ""}
            className="fn-input"
            placeholder="#ff5500"
            maxLength={32}
          />
        </div>
      </div>
      {error ? (
        <p style={{ color: "var(--accent-danger)", fontSize: 13 }}>{error}</p>
      ) : null}
      {success ? (
        <SaveSuccessNotice
          message={success.message}
          pendingPublicReflection={success.pendingPublicReflection}
          style={{ color: "var(--accent-success)", fontSize: 13 }}
        />
      ) : null}
      <div>
        <button
          type="submit"
          className="fn-btn fn-btn-primary"
          disabled={busy}
        >
          {busy ? "保存中…" : mode === "create" ? "作成" : "保存"}
        </button>
      </div>
    </form>
  );
}
