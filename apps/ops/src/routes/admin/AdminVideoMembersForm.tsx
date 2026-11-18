// MIG-0730 U02c: unmounted form shell. Only an injected SA-085 adapter can save.
// DO NOT route-mount before MIG-0650, U01 shared VideoMembersField and review gates.
import * as React from "react";
import { VideoMembersField } from "@flamenode/ui";
import { MAX_VIDEO_MEMBERS } from "@flamenode/domain/video/atomicLimits";
import { SaveSuccessNotice } from "../../components/shared/SaveSuccessNotice.js";
import { OpsLink } from "../../components/shared/OpsLink.js";
import { memberVideoPublicHref } from "./memberVideoPublicHref.js";

export type AdminVideoMembersSaveResult = {
  ok: boolean;
  message?: string;
  pendingPublicReflection?: boolean;
};

export type AdminVideoMembersSave = (payload: FormData) => Promise<AdminVideoMembersSaveResult>;
const UNVERIFIED_SAVE = "保存結果を確認できませんでした。最新状態を再取得してください。";

// A standalone form can receive an untrusted video object, without the
// Preview and its validated route target. Match the unmounted HTTP adapter's
// accepted video ID boundary before offering any injected write capability.
function isSafeVideoId(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64 ||
      value.trim() !== value || value === "." || value === ".." ||
      /[\/\\\x00-\x1f]/.test(value)) return false;
  try { encodeURIComponent(value); return true; }
  catch { return false; }
}

/**
 * The injected write port is a runtime trust boundary even though the
 * TypeScript callback is typed. A malformed success must not call onSaved.
 * Concrete SA-085 must separately verify the authoritative videoId receipt.
 */
function normalizeInjectedSaveResult(value: unknown): AdminVideoMembersSaveResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: UNVERIFIED_SAVE };
  }
  // A legacy/injected save port may return a getter-backed or Proxy receipt.
  // Read each property once: a changing ok getter could previously validate
  // as false, return true, and invoke onSaved without a confirmed commit.
  try {
    const body = value as Record<string, unknown>;
    const ok = body.ok;
    const message = body.message;
    const pendingPublicReflection = body.pendingPublicReflection;
    if (typeof ok !== "boolean" ||
        (message !== undefined &&
          (typeof message !== "string" || message.length > 300)) ||
        (pendingPublicReflection !== undefined &&
          typeof pendingPublicReflection !== "boolean")) {
      return { ok: false, message: UNVERIFIED_SAVE };
    }
    return {
      ok,
      ...(typeof message === "string" ? { message } : {}),
      ...(typeof pendingPublicReflection === "boolean"
        ? { pendingPublicReflection } : {}),
    };
  } catch {
    // Never surface private provider/accessor errors or refresh on ambiguity.
    return { ok: false, message: UNVERIFIED_SAVE };
  }
}

export interface AdminVideoMembersFormProps {
  video: { id: string; title: string; youtube_video_id?: string | null; collaboration_type: string | null };
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
  // A bare native element other than the canonical hidden member input is
  // not a member editor. Without this guard even <div /> plus save would let
  // an individual video submit a fabricated empty members_json payload.
  // A fragment, arbitrary function, memo wrapper or placeholder composite can
  // render nothing while looking like a valid React element. Accept only the
  // canonical shared VideoMembersField (used by the Ops preview), or the exact
  // hidden members_json input used by the direct FormData regression harness.
  // The submit handler still validates the serialized FormData independently.
  const sharedEditor = React.isValidElement(membersField) &&
    membersField.type === VideoMembersField
    ? membersField.props as React.ComponentProps<typeof VideoMembersField>
    : null;
  // Element identity alone is insufficient: a canonical field may explicitly
  // be read-only, belong to another video, serialize to a different field, or
  // lack one of its required privileged adapters. OFF would otherwise submit a
  // locally synthesized members_json=[] even though that field is unwriteable.
  const nativeMemberProps = React.isValidElement(membersField) &&
    membersField.type === "input"
    ? membersField.props as {
        type?: unknown; name?: unknown; value?: unknown; disabled?: unknown;
      }
    : null;
  // A disabled or empty native placeholder is not a usable editor, even if
  // the form generates members_json=[] on collaboration OFF. Without this
  // guard the placeholder alone could authorize a destructive OFF submit.
  const hasHiddenMemberInput = nativeMemberProps !== null &&
    nativeMemberProps.type === "hidden" &&
    nativeMemberProps.name === "members_json" &&
    typeof nativeMemberProps.value === "string" &&
    (nativeMemberProps.disabled === undefined ||
      nativeMemberProps.disabled === false ||
      nativeMemberProps.disabled === null);
  // A known shared editor may keep *local* collaboration drafts even while
  // its save adapter is unavailable. This must not imply write authorization.
  const hasMemberEditor = sharedEditor !== null || hasHiddenMemberInput;
  const writableMemberEditor = hasHiddenMemberInput || Boolean(
    sharedEditor &&
    (sharedEditor.disabled === undefined || sharedEditor.disabled === false) &&
    (sharedEditor.hiddenName === undefined || sharedEditor.hiddenName === "members_json") &&
    sharedEditor.permissionTargetVideoId === video.id &&
    typeof sharedEditor.searchXUsers === "function" &&
    typeof sharedEditor.applyPermissionBatch === "function"
  );
  // A malformed injected save port must not render an actionable button.
  const enabled = typeof save === "function" && writableMemberEditor && isSafeVideoId(video.id);
  // Losing the required member field is also a write-capability revocation,
  // even when the save function itself remains present.
  // A true-to-true save adapter change may represent a new authorization
  // boundary. Reject the old asynchronous receipt even if the button remains.
  // The post-save refresh callback is also scoped to the authority that
  // initiated the PUT. A new callback must not execute an old receipt.
  // Even with the same save function and an enabled button, rotating either
  // privileged member adapter changes the authorization context. A response
  // started under the old ports must not refresh or confirm the new context.
  const searchPort = sharedEditor?.searchXUsers;
  const permissionPort = sharedEditor?.applyPermissionBatch;
  const permissionTarget = sharedEditor?.permissionTargetVideoId;
  // A direct native member field can be replaced with a different same-video
  // snapshot while a save is in flight. Retire the previous receipt rather
  // than marking the replacement as saved. The shared editor uses the parent
  // snapshot key and its privileged adapter identity for equivalent isolation.
  const nativeSourceValue = hasHiddenMemberInput
    ? nativeMemberProps!.value as string : null;
  const saveCapabilityRef = React.useRef({
    enabled, save, onSaved, searchPort, permissionPort, permissionTarget, nativeSourceValue,
  });
  const saveCapabilityEpoch = React.useRef(0);
  React.useLayoutEffect(() => {
    const previous = saveCapabilityRef.current;
    if (previous.enabled !== enabled || previous.save !== save ||
        previous.onSaved !== onSaved ||
        previous.searchPort !== searchPort ||
        previous.permissionPort !== permissionPort ||
        previous.permissionTarget !== permissionTarget ||
        previous.nativeSourceValue !== nativeSourceValue) {
      saveCapabilityRef.current = {
        enabled, save, onSaved, searchPort, permissionPort, permissionTarget, nativeSourceValue,
      };
      saveCapabilityEpoch.current += 1;
      setResult(null);
    }
  }, [enabled, save, onSaved, searchPort, permissionPort, permissionTarget, nativeSourceValue]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!enabled || !save || pending || inFlight.current) return;
    // The direct native hidden-input adapter is only a test/legacy bridge.
    // While collaboration is OFF the actual fieldset is disabled and the form
    // submits a synthesized []. Do not allow a malformed/privileged original
    // member field to authorize a destructive OFF write by hiding it.
    if (!isCollab && nativeMemberProps !== null) {
      try {
        const original: unknown = JSON.parse(nativeMemberProps.value as string);
        if (!Array.isArray(original) || original.length > MAX_VIDEO_MEMBERS ||
            original.some(member => !member || typeof member !== "object" ||
              Array.isArray(member) || "can_edit" in member ||
              ("is_public_member" in member && member.is_public_member !== 1))) {
          setResult({ ok: false, message: "メンバー情報の形式が正しくありません。" });
          return;
        }
      } catch {
        setResult({ ok: false, message: "メンバー情報の形式が正しくありません。" });
        return;
      }
    }
    const formData = new FormData(event.currentTarget);
    const raw = formData.get("members_json");
    if (typeof raw !== "string") {
      setResult({ ok: false, message: "メンバー情報が不足しているため保存できません。" });
      return;
    }
    // All source fields must have one canonical interpretation. The caller
    // may inject another save adapter, so do not rely solely on its checks.
    const ids = formData.getAll("video_id");
    const flags = formData.getAll("is_collab");
    const members = formData.getAll("members_json");
    let unknownKey = false;
    formData.forEach((_, key) => {
      if (key !== "video_id" && key !== "is_collab" && key !== "members_json") unknownKey = true;
    });
    const canonicalOn = flags.length === 2 &&
      flags[0] === "false" && flags[1] === "true";
    const canonicalOff = flags.length === 1 && flags[0] === "false";
    if (unknownKey || ids.length !== 1 || ids[0] !== video.id ||
        members.length !== 1 || members[0] !== raw ||
        !(isCollab ? canonicalOn : canonicalOff) ||
        (!isCollab && raw !== "[]")) {
      setResult({ ok: false, message: "参加者設定の入力を確認してください。" });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > MAX_VIDEO_MEMBERS ||
          parsed.some(member =>
            !member || typeof member !== "object" || Array.isArray(member) ||
            // Never transport collaborator privilege intents in members_json.
            "can_edit" in member ||
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
      const response = normalizeInjectedSaveResult(await save(formData));
      // A may finish after navigation to B; never deliver A's result or refresh to B.
      if (mounted.current && requestEpoch === saveCapabilityEpoch.current) {
        setResult(response);
        if (response.ok && typeof onSaved === "function") {
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
        // A thrown save port may have committed before its response was lost.
        // Do not imply a retry is safe: the caller must refresh server state.
        setResult({ ok: false, message: UNVERIFIED_SAVE });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  // Invalid standalone preview IDs must never create document-relative or
  // protocol-relative navigation; only validated IDs enter the Ops detail URL.
  const detailHref = isSafeVideoId(video.id)
    ? "/admin/videos/" + encodeURIComponent(video.id)
    : "/admin/videos";

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
      {/* Keep the editor mounted while OFF: a temporary checkbox draft must
          not erase unsaved member rows, chapters, or a pending permission UI.
          The disabled fieldset excludes its members_json from FormData when
          OFF; only the explicit [] input below can be submitted. */}
      <fieldset disabled={pending || !enabled || !isCollab}
        style={{ border: 0, padding: 0, display: isCollab ? undefined : "none" }}>
        {sharedEditor
          ? React.cloneElement(
              membersField as React.ReactElement<React.ComponentProps<typeof VideoMembersField>>,
              // DOM fieldset.disabled does not update the shared editor's
              // internal permission epoch, search, or async mutation guards.
              // Preserve row drafts while retiring privileged confirmation
              // and search state whenever the parent cannot edit.
              { disabled: sharedEditor.disabled === true || pending || !enabled || !isCollab },
            )
          : membersField ?? <p role="status">参加者フォームを準備しています。</p>}
      </fieldset>
      {!isCollab ? (
        <section>
          <input type="hidden" name="members_json" value="[]" />
          <p>合作をOFFにすると、保存時に公開参加者とメンバーチャプターを空にします。</p>
        </section>
      ) : null}
      {result ? result.ok ? (
        <SaveSuccessNotice
          message={result.message ?? "保存しました。"}
          pendingPublicReflection={result.pendingPublicReflection}
        />
      ) : (
        <p role="alert">{result.message ?? "保存に失敗しました。"}</p>
      ) : null}
      {/* CURRENT member form footer: keep navigation even while writes remain
          deliberately disabled; only the authorized adapter enables saving. */}
      <footer style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {enabled ? (
          <button type="submit" className="fn-btn fn-btn-primary" disabled={pending}>
            {pending ? "保存中..." : "参加者設定を保存"}
          </button>
        ) : (
          <p role="status">保存機能は移行中です。現行の管理画面で操作してください。</p>
        )}
        <OpsLink href={detailHref} className="fn-btn fn-btn-ghost">詳細へ戻る</OpsLink>
        <a href={memberVideoPublicHref(video)} className="fn-btn fn-btn-ghost"
          target="_blank" rel="noopener noreferrer">公開ページ</a>
      </footer>
    </form>
  );
}
