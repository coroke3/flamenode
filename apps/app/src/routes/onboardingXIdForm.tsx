import * as React from "react";
import { parseXIdentityInput } from "@flamenode/domain/xid";
import type { XidRequestsApi } from "../api/xidRequests.js";

const INVALID_X_ID = "@username、username、または x.com / twitter.com のプロフィール URL を入力してください.";

export function OnboardingXIdForm({
  api, onRefresh, initialValue = "",
}: {
  api: XidRequestsApi;
  onRefresh: () => void;
  initialValue?: string;
}): React.ReactElement {
  const busy = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [rawInput, setRawInput] = React.useState(initialValue);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const preview = parseXIdentityInput(rawInput);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    if (!preview) {
      setError(INVALID_X_ID);
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    setStatus(null);
    void (async () => {
      try {
        const result = await api.requestLink(rawInput);
        if (result.ok) {
          setStatus("X ID 連携を申請しました。");
          onRefresh(); // only read the onboarding state; never switch to a synthetic loading screen
        } else {
          setError(result.message ?? "申請に失敗しました。");
        }
      } catch {
        setError("申請の保存に失敗しました。時間をおいて再試行してください。");
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  };

  return (
    <form className="onb-xIdForm" onSubmit={onSubmit} aria-labelledby="ob-xid-form-label">
      <span id="ob-xid-form-label" className="fn-sr-only">X ID を申請する</span>
      <label className="onb-compactLabel" htmlFor="ob-xid-input">X ID</label>
      <div className="onb-xIdInputRow">
        <span className="onb-xIdAt" aria-hidden="true">@</span>
        <input id="ob-xid-input" type="text" name="x_id" autoComplete="username" required
          className="onb-xIdInput" placeholder="username または https://x.com/username"
          value={rawInput} disabled={pending}
          onChange={(e) => { setRawInput(e.target.value); setError(null); }} />
      </div>
      <p className="onb-inputHint">入力例: username / @username / https://x.com/username</p>
      {rawInput && preview ? (
        <p className="onb-xIdPreview" role="status" aria-live="polite">申請する X ID：<strong>@{preview}</strong></p>
      ) : rawInput ? (
        <p className="onb-xIdPreviewWarn" role="status" aria-live="polite">入力を認識できません</p>
      ) : null}
      {error ? <p role="alert" className="onb-formError">{error}</p> : null}
      {status ? <p role="status" aria-live="polite">{status}</p> : null}
      <button type="submit" className="fn-btn fn-btn-primary" disabled={pending || !preview} aria-busy={pending}>
        {pending ? "申請中…" : "この X ID で申請する"}
      </button>
    </form>
  );
}
