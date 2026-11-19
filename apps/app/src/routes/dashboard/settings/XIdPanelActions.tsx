import * as React from "react";
import { useNavigate } from "react-router-dom";
import type { ProfileFields, XidProfileApi } from "../../../api/xidProfile.js";
import { isSafeRelativePath } from "../../next.js";
import { SocialLinksEditor } from "../../../components/shared/SocialLinksEditor.js";
import { YoutubeChannelPicker } from "../../../components/shared/YoutubeChannelPicker.js";
import { SquareIconEditor } from "../../../components/shared/SquareIconEditor.js";
import { SquareIconEditorBoundary } from "../../../components/shared/SquareIconEditorBoundary.js";
import { ConfirmDialog } from "../../../components/shared/ConfirmDialog.js";

/** MIG-0708 U03: Personal settings form controls, mounted after MIG-0636 contract integration. */
const NETWORK_ERROR = "通信または処理中に問題が発生しました。再読み込みしてお試しください。";
const MAX_CONVERTED_ICON_BYTES = 2 * 1024 * 1024;
const ALLOWED_ICON_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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
  const identityRef = React.useRef({ xUserId, generation: 0 });
  if (identityRef.current.xUserId !== xUserId) {
    identityRef.current = { xUserId, generation: identityRef.current.generation + 1 };
  }
  React.useEffect(() => { setError(null); }, [xUserId]);
  if (!approved || isActive) return null;

  const run = () => {
    const requestIdentity = identityRef.current;
    void execute(async () => {
      setError(null);
      try {
        const result = await api.setActive(xUserId);
        // Do not navigate the next account on a previous account's completion.
        if (identityRef.current !== requestIdentity) return;
        if (!result.ok) { setError(result.message ?? "切替に失敗しました。"); return; }
        // Do not turn a malformed / external next parameter into a navigation.
        if (next && isSafeRelativePath(next)) {
          navigate(next);
        } else {
          onRefresh();
        }
      } catch {
        if (identityRef.current === requestIdentity) setError(NETWORK_ERROR);
      }
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
  // The same X ID can be selected again after a detour A -> B -> A.
  // Track a monotonically increasing generation, not only the identity string.
  const identityRef = React.useRef({ xUserId, generation: 0 });
  if (identityRef.current.xUserId !== xUserId) {
    identityRef.current = { xUserId, generation: identityRef.current.generation + 1 };
  }
  // Refreshes can replace the authoritative icon after a write or account switch.
  React.useEffect(() => { setSelected(currentIconUrl); }, [currentIconUrl, xUserId]);
  // Identity changes invalidate previously displayed mutation notices.
  React.useEffect(() => { setError(null); setMessage(null); }, [xUserId]);
  const [upload, setUpload] = React.useState(false);
  const [uploadPending, setUploadPending] = React.useState(false);
  const uploadLock = React.useRef(false);
  const [editorKey, setEditorKey] = React.useState(0);
  // A different X ID must never inherit a previous account's editor or uploaded image.
  React.useEffect(() => { setUpload(false); }, [xUserId]);
  const update = (task: () => ReturnType<XidProfileApi["setIcon"]>, successText: string) => {
    const requestIdentity = identityRef.current;
    if (uploadLock.current) return;
    void execute(async () => {
      setError(null); setMessage(null);
      try {
        const result = await task();
        // The component may have changed accounts while the request was pending.
        if (identityRef.current !== requestIdentity) return;
        if (!result.ok) { setError(result.message ?? "アイコンの更新に失敗しました。"); return; }
        setMessage(result.message ?? successText);
        if (result.iconUrl) setSelected(result.iconUrl);
        onRefresh();
      } catch {
        if (identityRef.current === requestIdentity) setError(NETWORK_ERROR);
      }
    });
  };
  /** Editor produces an actual cropped 256x256 File, never the unprocessed original. */
  const onUploadProcessedFile = async (file: File): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (pending || uploadLock.current) {
      return { ok: false, message: "処理中です。少しお待ちください。" };
    }
    // Both the original and the converted file are capped at 2 MiB by CURRENT
    // and Hono SA-105. The 8 MiB limit covers the whole multipart request only.
    if (!ALLOWED_ICON_MIME_TYPES.has(file.type) || file.size === 0) {
      return { ok: false, message: "PNG・JPEG・WebP形式の画像が必要です。" };
    }
    if (file.size > MAX_CONVERTED_ICON_BYTES) {
      return { ok: false, message: "変換後の画像サイズが2MBを超えています。" };
    }
    const requestIdentity = identityRef.current;
    uploadLock.current = true;
    setUploadPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.uploadIcon(xUserId, file);
      if (identityRef.current !== requestIdentity) {
        return { ok: false, message: "X IDの選択が変更されました。" };
      }
      if (!result.ok) {
        const message = result.message ?? "アップロードに失敗しました。";
        setError(message);
        return { ok: false, message };
      }
      setMessage(result.message ?? "アイコンをアップロードしました。");
      if (result.iconUrl) setSelected(result.iconUrl);
      setUpload(false);
      setEditorKey((key) => key + 1);
      onRefresh();
      return { ok: true };
    } catch {
      const message = NETWORK_ERROR;
      if (identityRef.current === requestIdentity) setError(message);
      return { ok: false, message };
    } finally {
      uploadLock.current = false;
      setUploadPending(false);
    }
  };
  return (
    <div className="xids-stack">
      <p className="xids-compactLabel">アイコン候補（作品サムネから自動取得）</p>
      <div className="xids-iconRow" role="group" aria-label="X IDアイコン">
        {candidates.map(url => (
          <button key={url} type="button" className="xids-iconButton"
            disabled={pending || uploadPending} aria-busy={pending || uploadPending} aria-pressed={url === selected}
            aria-label="候補アイコンを選択"
            onClick={() => update(() => api.setIcon(xUserId, url), "アイコンを更新しました。")}>
            <img src={url} alt="" width={36} height={36} />
          </button>
        ))}
        <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
          disabled={pending || uploadPending} aria-expanded={upload}
          onClick={() => { setError(null); setUpload(v => !v); }}>
          画像をアップロード
        </button>
      </div>
      {upload ? (
        <SquareIconEditorBoundary>
          <SquareIconEditor key={`${xUserId}:${editorKey}`} pending={pending || uploadPending}
            onUseImage={onUploadProcessedFile} onCancel={() => setUpload(false)} />
        </SquareIconEditorBoundary>
      ) : null}
      {candidates.length === 0
        ? <p className="settings-accountNote">まだ候補がありません。画像をアップロードできます。</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <p className="xids-msgErr" role="alert">{error}</p> : null}
    </div>
  );
}

export function XIdCompactProfileForm({
  api, x, iconCandidates, channelCandidates = [], onRefresh, onCancel,
}: {
  api: XidProfileApi;
  x: { id: string; x_name: string; icon_url: string | null; profile_text: string | null;
    portfolio_contact: string | null; youtube_channel_url: string | null; other_social_links: string | null };
  iconCandidates: readonly string[];
  channelCandidates: string[];
  onRefresh: () => void;
  onCancel?: () => void;
}): React.ReactElement {
  const { pending, execute } = usePendingAction();
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const identityRef = React.useRef({ xUserId: x.id, generation: 0 });
  if (identityRef.current.xUserId !== x.id) {
    identityRef.current = { xUserId: x.id, generation: identityRef.current.generation + 1 };
  }
  React.useEffect(() => { setError(null); setMessage(null); }, [x.id]);
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
    const requestIdentity = identityRef.current;
    void execute(async () => {
      setError(null); setMessage(null);
      try {
        const result = await api.updateProfile(x.id, fields);
        if (identityRef.current !== requestIdentity) return;
        if (!result.ok) { setError(result.message ?? "更新に失敗しました。"); return; }
        setMessage(result.message ?? "保存しました。");
        onRefresh();
        onCancel?.();
      } catch {
        if (identityRef.current === requestIdentity) setError(NETWORK_ERROR);
      }
    });
  };
  return (
    <div className="xids-stack">
      <form key={x.id} onSubmit={onSubmit}>
        <label className="xids-compactLabel">表示名オーバーライド（空欄で @ハンドル表示）
          <input name="x_name" className="xids-input" maxLength={80} disabled={pending}
            placeholder={`@${x.id}`} defaultValue={x.x_name} />
        </label>
        <label className="xids-compactLabel">About / 自己紹介
          <textarea name="profile_text" className="xids-textarea" rows={3} maxLength={2000}
            placeholder="制作スタイル、得意なこと、活動紹介など"
            disabled={pending} defaultValue={x.profile_text ?? ""} />
        </label>
        <label className="xids-compactLabel">Contact / 連絡先
          <textarea name="portfolio_contact" className="xids-textarea" rows={2} maxLength={1200}
            placeholder="依頼・連絡先、メール、フォームURL、DM可否など"
            disabled={pending} defaultValue={x.portfolio_contact ?? ""} />
        </label>
        <label className="xids-compactLabel">YouTube チャンネル（過去の作品から候補を表示）</label>
        <YoutubeChannelPicker defaultValue={x.youtube_channel_url}
          candidates={channelCandidates} disabled={pending} />
        <SocialLinksEditor initialValue={x.other_social_links} disabled={pending} />
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
  const [error, setError] = React.useState<string | null>(null);
  // A -> B -> A must not reuse the first A request's confirmation or result.
  const identityRef = React.useRef({ xUserId, generation: 0 });
  if (identityRef.current.xUserId !== xUserId) {
    identityRef.current = { xUserId, generation: identityRef.current.generation + 1 };
  }
  React.useEffect(() => {
    setOpen(false);
    setError(null);
  }, [xUserId]);
  const expected = `DELETE ${xUserId}`;
  if (isActive) return null;

  const doDelete = () => {
    const requestIdentity = identityRef.current;
    // ConfirmDialog only invokes onConfirm after the literal expectedText is
    // entered. The HTTP client and Hono repeat the confirmation check.
    void execute(async () => {
      setError(null);
      try {
        const result = await api.deleteXId(xUserId, expected);
        if (identityRef.current !== requestIdentity) return;
        if (!result.ok) { setError(result.message ?? "削除に失敗しました。"); return; }
        onRefresh();
      } catch {
        if (identityRef.current === requestIdentity) setError(NETWORK_ERROR);
      }
    });
  };
  return (
    <div className="xids-row">
      <button type="button" className="fn-btn fn-btn-ghost fn-btn-sm"
        disabled={pending} onClick={() => { setError(null); setOpen(true); }}>
        連携を解除
      </button>
      {error ? <p role="alert" className="xids-msgErr">{error}</p> : null}
      <ConfirmDialog open={open} title="X ID 連携を削除しますか?"
        message={<>
          <p style={{ margin: 0 }}>
            この X ID <strong>@{xUserId}</strong> とDiscordアカウントの紐付けを解除します。
          </p>
          <ul style={{ margin: "8px 0 0", paddingLeft: "1.2em", fontSize: 12 }}>
            <li>X ID自体・過去の作品・履歴は削除されません。</li>
            <li>このDiscordアカウントからは編集できなくなります。</li>
            <li>同じX IDを再連携すれば編集権限は戻ります。</li>
          </ul>
        </>}
        expectedText={expected} confirmLabel="連携を削除する" tone="danger"
        busy={pending}
        onConfirm={() => { setOpen(false); doDelete(); }}
        onCancel={() => setOpen(false)} />
    </div>
  );
}
