/**
 * MIG-0728 U01: CURRENT EventGroupForm (SA-026 / SA-027) with single-flight guard.
 */
import * as React from "react";
import {
  createAdminEventGroupsApi,
  eventGroupPublicHref,
  type AdminEventGroupsApi,
} from "../../api/adminEventGroups.js";
import { SaveSuccessNotice } from "../../components/shared/SaveSuccessNotice.js";

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

const GROUP_TYPES: { value: NonNullable<EventGroupInitial["group_type"]>; label: string }[] = [
  { value: "series", label: "系列" },
  { value: "genre", label: "ジャンル" },
  { value: "related", label: "関連" },
  { value: "collection", label: "コレクション" },
  { value: "other", label: "その他" },
];

export function EventGroupForm({
  mode,
  initial = {},
  api,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: EventGroupInitial;
  api?: AdminEventGroupsApi;
  onSaved?: (outcome: { id?: string; pendingPublicReflection?: boolean }) => void;
}): React.ReactElement {
  const client = React.useMemo(() => api ?? createAdminEventGroupsApi(), [api]);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    message: string;
    pendingPublicReflection?: boolean;
  } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (busyRef.current) return;
    if (mode === "edit" && !initial.id) return;
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r =
        mode === "create"
          ? await client.create(raw)
          : await client.update(initial.id!, raw);
      if (r.anonymous) {
        window.location.assign("/entry");
        return;
      }
      if (!r.ok) {
        setError(r.message ?? "失敗しました。");
        return;
      }
      if (mode === "create" && !r.id) {
        setError("保存に失敗しました。再読み込みして、もう一度お試しください。");
        return;
      }
      setSuccess({
        message: "保存しました。",
        pendingPublicReflection: r.pendingPublicReflection,
      });
      onSaved?.({ id: r.id, pendingPublicReflection: r.pendingPublicReflection });
    } catch {
      setError("保存に失敗しました。再読み込みして、もう一度お試しください。");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      aria-label={mode === "create" ? "イベントグループ作成" : "イベントグループ編集"}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {mode === "edit" && initial.id ? (
        <input type="hidden" name="id" value={initial.id} />
      ) : null}
      {mode === "edit" && initial.base_updated_at != null ? (
        <input
          type="hidden"
          name="base_updated_at"
          value={String(initial.base_updated_at)}
        />
      ) : null}
      <label className="fn-field">
        <span className="fn-label">名前 *</span>
        <input
          name="name"
          type="text"
          defaultValue={initial.name ?? ""}
          className="fn-input"
          maxLength={120}
          required
          disabled={busy}
        />
      </label>
      <div className="fn-field">
        <label className="fn-field">
          <span className="fn-label">スラッグ *</span>
          <input
            name="slug"
            type="text"
            defaultValue={initial.slug ?? ""}
            className="fn-input"
            maxLength={64}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
            disabled={busy}
          />
        </label>
        <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>
          公開 URL: {eventGroupPublicHref("{slug}")}
        </p>
      </div>
      <label className="fn-field">
        <span className="fn-label">説明</span>
        <textarea
          name="description"
          defaultValue={initial.description ?? ""}
          className="fn-input"
          rows={4}
          maxLength={2000}
          disabled={busy}
        />
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <label className="fn-field">
          <span className="fn-label">種別</span>
          <select
            name="group_type"
            defaultValue={initial.group_type ?? "series"}
            className="fn-select"
            disabled={busy}
          >
            {GROUP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fn-field">
          <span className="fn-label">公開状態</span>
          <select
            name="visibility_status"
            defaultValue={initial.visibility_status ?? "public"}
            className="fn-select"
            disabled={busy}
          >
            <option value="public">公開</option>
            <option value="private">非公開</option>
            <option value="archived">アーカイブ</option>
          </select>
        </label>
        <label className="fn-field">
          <span className="fn-label">表示順</span>
          <input
            name="sort_order"
            type="number"
            defaultValue={initial.sort_order ?? 0}
            className="fn-input"
            min={-9999}
            max={9999}
            step={1}
            disabled={busy}
          />
        </label>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <label className="fn-field">
          <span className="fn-label">アイコン URL</span>
          <input
            name="icon_url"
            type="url"
            defaultValue={initial.icon_url ?? ""}
            className="fn-input"
            maxLength={500}
            disabled={busy}
          />
        </label>
        <label className="fn-field">
          <span className="fn-label">アクセント色</span>
          <input
            name="accent_color"
            type="text"
            defaultValue={initial.accent_color ?? ""}
            className="fn-input"
            placeholder="#ff5500"
            maxLength={32}
            disabled={busy}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" style={{ color: "var(--accent-danger)", fontSize: 13 }}>
          {error}
        </p>
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
          disabled={busy || (mode === "edit" && !initial.id)}
          aria-busy={busy}
        >
          {busy ? "保存中…" : mode === "create" ? "作成" : "保存"}
        </button>
      </div>
    </form>
  );
}
