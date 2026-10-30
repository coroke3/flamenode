import * as React from "react";
import type { AdminVideoMutation } from "../../api/adminVideoStatus.js";

/** MIG-0729 U02: CURRENT SA-043 form; held unmounted until MIG-0603. */
export function CreateModerationCaseForm({
  videoId, action, onRefresh,
}: {
  videoId: string;
  action: AdminVideoMutation;
  onRefresh: () => void;
}): React.ReactElement {
  const formRef = React.useRef<HTMLFormElement>(null);
  const inFlight = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setSuccess(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("video_id", videoId);
    void (async () => {
      try {
        const result = await action(data);
        if (!result.ok) {
          setError(result.message ?? "ケースの作成に失敗しました。");
          if (result.retryable) onRefresh();
          return;
        }
        setSuccess(result.message ?? "case を作成しました。");
        formRef.current?.reset();
        onRefresh();
      } catch {
        setError("通信状態を確認し、ケースの現在の状態を再取得してください。");
        onRefresh();
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  }

  return (
    <form ref={formRef} onSubmit={submit} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="video_id" value={videoId} />
      <label>種別
        <select name="case_type" className="fn-select" defaultValue="rights" disabled={pending}>
          <option value="rights">rights: 権利・楽曲・素材確認</option>
          <option value="duplicate">duplicate: 重複投稿</option>
          <option value="void">void: 一時停止・確認中</option>
          <option value="x_reapply">x_reapply: X ID再申請</option>
          <option value="operator">operator: 運営判断</option>
        </select>
      </label>
      <label>公開理由
        <textarea name="public_reason" className="fn-input" rows={2} maxLength={1000}
          placeholder="ユーザーに見せてもよい理由" disabled={pending} />
      </label>
      <label>内部メモ
        <textarea name="private_note" className="fn-input" rows={2} maxLength={2000}
          placeholder="運営内メモ" disabled={pending} />
      </label>
      <label>期限
        <input name="due_at" type="datetime-local" className="fn-input" disabled={pending} />
      </label>
      <label>関連X ID
        <input name="related_x_user_id" className="fn-input" maxLength={40}
          placeholder="@x_id" disabled={pending} />
      </label>
      <label>起票時の作品状態
        <select name="video_status" className="fn-select" defaultValue="" disabled={pending}>
          <option value="">変更しない</option>
          <option value="voided">voided: 一時的に公開停止</option>
          <option value="pending">pending: 再確認待ち</option>
        </select>
      </label>
      {error ? <p role="alert" className="fn-badge fn-badge-danger">{error}</p> : null}
      {success ? <p role="status" className="fn-badge">{success}</p> : null}
      <button className="fn-btn fn-btn-primary" type="submit" disabled={pending}
        aria-busy={pending} aria-label="モデレーションケースを作成">
        {pending ? "作成中..." : "ケースを作成"}
      </button>
    </form>
  );
}
