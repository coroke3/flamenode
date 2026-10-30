import * as React from "react";
import { useNavigate } from "react-router-dom";
import type { ProfileFields, XidProfileApi } from "../../../api/xidProfile.js";

/** MIG-0708 U03: isolated form components (not mounted until MIG-0636 contracts). */
const NETWORK_ERROR = "通信または処理中に問題が発生しました。再読み込みしてお試しください。";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** A ref closes the same-tick double-click race that React pending state alone cannot prevent. */
function usePendingAction() {
  const lock = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const execute = React.useCallback(async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try { await fn(); }
    finally { lock.current = false; setPending(false); }
  }, []);
  return { pending, execute };
}

export function SetActiveXButton({
  api, xUserId, approved, isActive = false, next, onRefresh,
}: {
  api: XidProfileApi;
  xUserId: string;
  approved: boolean;
  isActive?: boolean;
  next?: string | null;
  onRefresh: () => void;
}): React.ReactElement | null {
  const navigate = useNavigate();
  const { pending, execute } = usePendingAction();
  const [error, setError] = React.useState<string | null>(null);
  if (!approved || isActive) return null;

  const run = () => {
    void execute(async () => {
      setError(null);
      try {
        const result = await api.setActive(xUserId);
        if (!result.ok) { setError(result.message ?? "切替に失敗しました。"); return; }
        // Do not turn a malformed / external next parameter into a navigation.
        if (next && next.startsWith("/") && !next.startsWith("//") &&
          !next.includes("\\") && !next.includes("://") && !/[\u0000-\u001f\u007f]/.test(next)) {
          navigate(next);
        } else {
          onRefresh();
        }
      } catch { setError(NETWORK_ERROR); }
    });
  };
  return (
    <span className="xids-row">
      <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={pending} aria-busy={pending} onClick={run}>
        {pending ? "設定中…" : "アクティブに設定"}
      </button>
      {error ? <span className="xids-msgErr" role="alert">{error}</span> : null}
    </span>
  );
}

export function XIdIconPicker({
  api, xUserId, currentIconUrl, candidates, onRefresh,
}: {
  api: XidProfileApi;
  xUserId: string;
  currentIconUrl: string | null;
  candidates: readonly string[];
  onRefresh: () => void;
}): React.ReactElement {
  const { pending, execute } = usePendingAction();
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(currentIconUrl);
  const [upload, setUpload] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);
  const update = (task: () => ReturnType<XidProfileApi["setIcon"]>, successText: string) => {
    void execute(async () => {
      setError(null); setMessage(null);
      try {
        const result = await task();
        if (!result.ok) { setError(result.message ?? "アイコンの更新に失敗しました。"); return; }
        setMessage(result.message ?? successText);
        if (result.iconUrl) setSelected(result.iconUrl);
        onRefresh();
      } catch { setError(NETWORK_ERROR); }
    });
  };
  const onFileChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    // Mirror target upload ceiling before attempting to transmit a large blob.
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("画像は8MB以下にしてください。");
      ev.target.value = "";
      return;
    }
    update(() => api.uploadIcon(xUserId, file), "アイコンをアップロードしました。");
    ev.target.value = "";
  };
  return (
    <div className="xids-stack">
      <p className="xids-compactLabel">アイコン候補（作品サムネから自動取得）</p>
      <div className="xids-iconRow" role="group" aria-label="X IDアイコン">
        {candidates.map(url => (
          <button key={url} type="button" className="xids-iconButton"
            disabled={pending} aria-busy={pending} aria-pressed={url === selected}
            aria-label="候補アイコンを選択"
            onClick={() => update(() => api.setIcon(xUserId, url), "アイコンを更新しました。")}>
            <img src={url} alt="" width={36} height={36} />
          </button>
        ))}
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending} aria-expanded={upload}
          onClick={() => { setError(null); setUpload(v => !v); }}>
          画像をアップロード
        </button>
      </div>
      {upload ? (
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp"
          aria-label="アイコン画像ファイル" disabled={pending} onChange={onFileChange} />
      ) : null}
      {candidates.length === 0
        ? <p className="settings-accountNote">まだ候補がありません。画像をアップロードできます。</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p className="xids-msgErr" role="alert">{error}</p> : null}
    </div>
  );
}

export function XIdCompactProfileForm({
  api, x, iconCandidates, onRefresh, onCancel,
}: {
  api: XidProfileApi;
  x: { id: string; x_name: string; icon_url: string | null; profile_text: string | null;
    portfolio_contact: string | null; youtube_channel_url: string | null; other_social_links: string | null };
  iconCandidates: readonly string[];
  onRefresh: () => void;
  onCancel?: () => void;
}): React.ReactElement {
  const { pending, execute } = usePendingAction();
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    // Node test and browser FormData implementations differ for HTMLFormElement;
    // reading the named controls also preserves empty strings exactly.
    const form = ev.currentTarget;
    const read = (name: string) => (form.elements.namedItem(name) as
      HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
    const fields: ProfileFields = {
      x_name: read("x_name"),
      profile_text: read("profile_text"),
      portfolio_contact: read("portfolio_contact"),
      youtube_channel_url: read("youtube_channel_url"),
      other_social_links: read("other_social_links"),
    };
    void execute(async () => {
      setError(null); setMessage(null);
      try {
        const result = await api.updateProfile(x.id, fields);
        if (!result.ok) { setError(result.message ?? "更新に失敗しました。"); return; }
        setMessage(result.message ?? "保存しました。");
        onRefresh();
        onCancel?.();
      } catch { setError(NETWORK_ERROR); }
    });
  };
  return (
    <div className="xids-stack">
      <form onSubmit={onSubmit}>
        <label className="xids-compactLabel">表示名オーバーライド（空欄で @ハンドル表示）
          <input name="x_name" className="xids-input" maxLength={80} disabled={pending}
            defaultValue={x.x_name} />
        </label>
        <label className="xids-compactLabel">About / 自己紹介
          <textarea name="profile_text" className="xids-textarea" rows={3} maxLength={2000}
            disabled={pending} defaultValue={x.profile_text ?? ""} />
        </label>
        <label className="xids-compactLabel">Contact / 連絡先
          <textarea name="portfolio_contact" className="xids-textarea" rows={2} maxLength={1200}
            disabled={pending} defaultValue={x.portfolio_contact ?? ""} />
        </label>
        <label className="xids-compactLabel">YouTube チャンネル
          <input name="youtube_channel_url" className="xids-input"
            disabled={pending} defaultValue={x.youtube_channel_url ?? ""} />
        </label>
        <label className="xids-compactLabel">その他のSNSリンク（JSON）
          <textarea name="other_social_links" className="xids-textarea"
            disabled={pending} defaultValue={x.other_social_links ?? ""} />
        </label>
        <div className="xids-rowEnd">
          {onCancel ? <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={pending} onClick={onCancel}>キャンセル</button> : null}
          <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={pending} aria-busy={pending}>{pending ? "保存中…" : "保存"}</button>
        </div>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert" className="xids-msgErr">{error}</p> : null}
      </form>
      <XIdIconPicker api={api} xUserId={x.id} currentIconUrl={x.icon_url}
        candidates={iconCandidates} onRefresh={onRefresh} />
    </div>
  );
}

export function DeleteXIdForm({
  api, xUserId, isActive, onRefresh,
}: {
  api: XidProfileApi;
  xUserId: string;
  isActive: boolean;
  onRefresh: () => void;
}): React.ReactElement | null {
  const { pending, execute } = usePendingAction();
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const expected = `DELETE ${xUserId}`;
  if (isActive) return null;
  const onDelete = () => {
    if (confirmation !== expected) return;
    void execute(async () => {
      setError(null);
      try {
        const result = await api.deleteXId(xUserId, confirmation);
        if (!result.ok) { setError(result.message ?? "削除に失敗しました。"); return; }
        setOpen(false); setConfirmation("");
        onRefresh();
      } catch { setError(NETWORK_ERROR); }
    });
  };
  return (
    <div className="xids-row">
      <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={pending} onClick={() => { setError(null); setOpen(true); }}>
        連携を解除
      </button>
      {open ? (
        <section role="group" aria-label="X ID連携の解除確認" className="xids-stack">
          <p>この X ID @{xUserId} とDiscordアカウントの紐付けを解除します。X ID自体・作品・履歴は削除されません。</p>
          <label>確認のため「{expected}」と入力してください。
            <input className="xids-input" value={confirmation} disabled={pending}
              onChange={e => setConfirmation(e.target.value)} />
          </label>
          <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
            disabled={pending} onClick={() => { setOpen(false); setConfirmation(""); }}>キャンセル</button>
          <button type="button" className="fn-btn fn-btn-primary fn-btn-sm"
            disabled={pending || confirmation !== expected} aria-busy={pending}
            onClick={onDelete}>{pending ? "解除中…" : "連携を削除する"}</button>
          {error ? <p role="alert" className="xids-msgErr">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
