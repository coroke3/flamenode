import * as React from "react";
import { useNavigate } from "react-router-dom";
import { parseXIdentityInput } from "@flamenode/domain/xid";
import type { XidRequestsApi } from "../../../api/xidRequests.js";

const INVALID_X_ID = "@username、username、または x.com / twitter.com のプロフィール URL を入力してください。";
const SAVE_ERROR = "申請の保存に失敗しました。時間をおいて再試行してください。";

/** CURRENT XIdLinkForm: both initial and additional X IDs use the same request. */
export function XIdLinkForm({
  api, onRefresh, compact = false, onSuccessRedirect,
}: {
  api: XidRequestsApi;
  onRefresh: () => void;
  compact?: boolean;
  onSuccessRedirect?: string | null;
}): React.ReactElement {
  const navigate = useNavigate();
  const busy = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [rawInput, setRawInput] = React.useState("");
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const preview = parseXIdentityInput(rawInput);

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy.current) return; // useRef closes the gap between two synchronous clicks
    if (!preview) {
      setErrMsg(INVALID_X_ID);
      return;
    }
    busy.current = true;
    setPending(true);
    setOkMsg(null);
    setErrMsg(null);
    void (async () => {
      try {
        // Preserve CURRENT's original form field, not just the preview.
        const result = await api.requestLink(rawInput);
        if (!result.ok) {
          setErrMsg(result.message ?? "申請に失敗しました。");
          return;
        }
        setOkMsg(result.message ?? "X ID申請を受け付けました。");
        setRawInput("");
        if (onSuccessRedirect) navigate(onSuccessRedirect);
        else onRefresh();
      } catch {
        setErrMsg(SAVE_ERROR);
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  };

  return (
    <form className="settings-form" onSubmit={onSubmit} aria-labelledby="xid-link-heading">
      {compact
        ? <span id="xid-link-heading" className="fn-sr-only">X IDを連携</span>
        : <p id="xid-link-heading" className="settings-cardDesc">X IDを連携します。2件目以降も同じ方法で申請でき、運営承認後に反映されます。</p>}
      <label className="settings-compactLabel" htmlFor="xid-input">連携する X ID</label>
      <div className="settings-inputRow">
        <span aria-hidden="true">@</span>
        <input id="xid-input" name="x_id" className="settings-input" autoComplete="username"
          placeholder="username または https://x.com/username" required
          value={rawInput} disabled={pending} onChange={(e) => { setRawInput(e.target.value); setErrMsg(null); }} />
      </div>
      {rawInput && preview ? <p role="status">申請名義: @{preview}</p> : null}
      {errMsg ? <p role="alert" className="settings-formError">{errMsg}</p> : null}
      {okMsg ? <p role="status">{okMsg}</p> : null}
      <button type="submit" className="fn-btn fn-btn-primary fn-btn-sm" disabled={pending || !preview} aria-busy={pending}>
        {pending ? "送信中…" : "X IDを連携"}
      </button>
    </form>
  );
}

/** CURRENT XIdMergeForm: only approved IDs may be merged, and source != target. */
export function XIdMergeForm({
  api, linkedXIds, onRefresh,
}: {
  api: XidRequestsApi;
  linkedXIds: readonly { id: string; label: string }[];
  onRefresh: () => void;
}): React.ReactElement | null {
  const busy = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const [sourceId, setSourceId] = React.useState(linkedXIds[0]?.id ?? "");
  const [targetId, setTargetId] = React.useState(linkedXIds[1]?.id ?? "");
  const ids = new Set(linkedXIds.map((x) => x.id));
  const source = ids.has(sourceId) ? sourceId : (linkedXIds[0]?.id ?? "");
  const target = ids.has(targetId) && targetId !== source
    ? targetId : (linkedXIds.find((x) => x.id !== source)?.id ?? "");

  if (linkedXIds.length < 2) return null;

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy.current || !source || !target || source === target || !ids.has(source) || !ids.has(target)) return;
    busy.current = true;
    setPending(true);
    setOkMsg(null);
    setErrMsg(null);
    void (async () => {
      try {
        const result = await api.requestMerge(source, target);
        if (result.ok) {
          setOkMsg(result.message ?? "X ID統合申請を受け付けました。");
          onRefresh();
        } else {
          setErrMsg(result.message ?? "統合申請に失敗しました。");
        }
      } catch {
        setErrMsg(SAVE_ERROR);
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  };
  return (
    <form className="settings-form settings-mergeForm" onSubmit={onSubmit} aria-labelledby="xid-merge-heading">
      <p id="xid-merge-heading" className="settings-cardDesc">
        連携済みのX ID同士を1つの名義へ統合します。運営が対象作品と変更内容を確認してから承認・実行します。
      </p>
      <div className="settings-mergePreview" aria-live="polite">
        <strong>統合元（無効化） @{source}</strong> → <strong>統合先（継続利用） @{target}</strong>
        <ol>
          <li>作品は削除せず、投稿者・合作メンバー・チャプター欄のX IDだけを統合先へ変更します。</li>
          <li>予約枠・連続枠・スタッフ・認証リンク・審査案件も統合先へ揃えます。</li>
          <li>統合元は通常の選択対象から外れ、監査と差し戻しの履歴は保持します。</li>
        </ol>
        <p>対象作品の動画ID・公開状態・内容は変わりません。競合や不整合があれば統合全体を中止します。</p>
      </div>
      <label className="settings-compactLabel">
        統合元 X ID
        <select name="x_id" className="settings-input" value={source} onChange={(e) => setSourceId(e.target.value)} disabled={pending}>
          {linkedXIds.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label className="settings-compactLabel">
        統合先 X ID
        <select name="target_x_user_id" className="settings-input" value={target} onChange={(e) => setTargetId(e.target.value)} disabled={pending}>
          {linkedXIds.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      {errMsg ? <p role="alert" className="settings-formError">{errMsg}</p> : null}
      {okMsg ? <p role="status">{okMsg}</p> : null}
      <button type="submit" className="fn-btn fn-btn-ghost fn-btn-sm" disabled={pending || source === target} aria-busy={pending}>
        {pending ? "申請中…" : "この組み合わせで統合を申請"}
      </button>
    </form>
  );
}
