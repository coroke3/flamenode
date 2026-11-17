// MIG-0730 U02c: unmounted form shell. Only an injected SA-085 adapter can save.
// DO NOT route-mount before MIG-0650, U01 shared VideoMembersField and review gates.
import * as React from "react";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";

export type AdminVideoMembersSaveResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
};

export type AdminVideoMembersSave = (payload: FormData) => Promise<AdminVideoMembersSaveResult>;

export interface AdminVideoMembersFormProps {
  video: { id: string; title: string; collaboration_type: string | null };
  initialMembersCount: number;
  /** Eventually: shared @flamenode/ui VideoMembersField with a members_json hidden input. */
  membersField?: React.ReactNode;
  /** Do not pass until the MIG-0650 SA-085 adapter is independently verified. */
  save?: AdminVideoMembersSave;
  onSaved?: () => void | Promise<void>;
}

/**
 * CURRENT FormData shape is preserved (video_id, hidden is_collab=false,
 * checkbox is_collab=true, members_json from the injected shared field).
 * Never fabricate members_json or publish edits when that field is missing.
 */
export function AdminVideoMembersForm(props: AdminVideoMembersFormProps): React.ReactElement {
  // A different video must receive independent form state, including an isolated submit latch.
  return <AdminVideoMembersFormForVideo key={props.video.id} {...props} />;
}

function AdminVideoMembersFormForVideo({
  video, initialMembersCount, membersField, save, onSaved,
}: AdminVideoMembersFormProps): React.ReactElement {
  const mounted = React.useRef(false);
  React.useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [isCollab, setIsCollab] = React.useState(
    video.collaboration_type === "collab" || initialMembersCount > 0,
  );
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<AdminVideoMembersSaveResult | null>(null);
  const inFlight = React.useRef(false);
  // A pending request can outlive the loss and later restoration of this form's
  // write capability. Retire its completion before any stale success callback.
  // Do not allow a collaboration-OFF destructive write merely because the
  // member editor was never supplied. A save port alone is not a complete form.
  // A supplied editor permits non-destructive local collaboration drafts even
  // before the write port is wired; only the *combination* grants save access.
  const hasMemberEditor = React.isValidElement(membersField);
  const enabled = Boolean(save) && hasMemberEditor;
  // Losing the required member field is also a write-capability revocation,
  // even when the save function itself remains present.
  // A true-to-true save adapter change may represent a new authorization
  // boundary. Reject the old asynchronous receipt even if the button remains.
  const saveCapabilityRef = React.useRef({ enabled, save });
  const saveCapabilityEpoch = React.useRef(0);
  React.useLayoutEffect(() => {
    if (saveCapabilityRef.current.enabled !== enabled ||
        saveCapabilityRef.current.save !== save) {
      saveCapabilityRef.current = { enabled, save };
      saveCapabilityEpoch.current += 1;
      setResult(null);
    }
  }, [enabled, save]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!enabled || !save || pending || inFlight.current) return;
    const formData = new FormData(event.currentTarget);
    const raw = formData.get("members_json");
    if (typeof raw !== "string") {
      setResult({ ok: false, message: "メンバー情報が不足しているため保存できません。" });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > MAX_VIDEO_MEMBERS ||
          parsed.some(member =>
            !member || typeof member !== "object" || Array.isArray(member) ||
            ("is_public_member" in member && member.is_public_member !== 1))) {
        setResult({ ok: false, message: `公開参加者は最大${MAX_VIDEO_MEMBERS}人までです。入力を確認してください。` });
        return;
      }
    } catch {
      setResult({ ok: false, message: "メンバー情報の形式が正しくありません。" });
      return;
    }

    const requestEpoch = saveCapabilityEpoch.current;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      const response = await save(formData);
      // A may finish after navigation to B; never deliver A's result or refresh to B.
      if (mounted.current && requestEpoch === saveCapabilityEpoch.current) {
        setResult(response);
        if (response.ok && onSaved) {
          // Save has already succeeded. A failed view refresh must not turn a
          // committed write into a false save-error message or invite a retry.
          try {
            await onSaved();
          } catch {
            if (mounted.current && requestEpoch === saveCapabilityEpoch.current) {
              setResult({
                ...response,
                message: "保存は完了しましたが、表示の更新に失敗しました。再読み込みして確認してください。",
              });
            }
          }
        }
      }
    } catch {
      if (mounted.current && requestEpoch === saveCapabilityEpoch.current) {
        setResult({ ok: false, message: "保存中にエラーが発生しました。再度確認してください。" });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={event => { void submit(event); }} className="fn-card"
      aria-label="参加者設定の編集フォーム" style={{ display: "grid", gap: 18 }}>
      <input type="hidden" name="video_id" value={video.id} />
      <input type="hidden" name="is_collab" value="false" />
      <header style={{ display: "grid", gap: 8 }}>
        <span className="fn-badge fn-badge-soft">Participants</span>
        <h2>参加者設定</h2>
        <p className="fn-muted">複数人参加作品の公開メンバーとメンバーチャプターを管理します。</p>
      </header>
      <label>
        <input type="checkbox" name="is_collab" value="true" checked={isCollab}
          disabled={pending || !hasMemberEditor} onChange={event => { if (hasMemberEditor) setIsCollab(event.target.checked); }} />
        この作品を合作作品として登録する
      </label>
      {isCollab ? (
        <fieldset disabled={pending || !enabled} style={{ border: 0, padding: 0 }}>
          {membersField ?? <p role="status">参加者フォームを準備しています。</p>}
        </fieldset>
      ) : (
        <section>
          <input type="hidden" name="members_json" value="[]" />
          <p>合作をOFFにすると、保存時に公開参加者とメンバーチャプターを空にします。</p>
        </section>
      )}
      {result && <p role={result.ok ? "status" : "alert"}>{result.message ??
        (result.ok ? "保存しました。" : "保存に失敗しました。")}</p>}
      {enabled ? (
        <button type="submit" className="fn-btn fn-btn-primary" disabled={pending}>
          {pending ? "保存中..." : "参加者設定を保存"}
        </button>
      ) : (
        <p role="status">保存機能は移行中です。現行の管理画面で操作してください。</p>
      )}
    </form>
  );
}
