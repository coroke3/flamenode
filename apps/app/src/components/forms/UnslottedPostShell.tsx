// MIG-0714 U03a: unmounted, dependency-inverted port of CURRENT UnslottedPostForm shell.
// This is NOT the complete VideoForm or a route: the parent supplies renderVideoForm.
// Labels/draft format mirror CURRENT. ISSUE-703 tightens shell identity lifecycle;\n// candidate-only until Lead review of the CURRENT parity deviation.
import * as React from "react";
import { Icon } from "../../routes/ui/Icon.js";
import { normalizeXId } from "@flamenode/domain/xid";
import { buildFormDraftStorageKey, useFormDraft } from "../../lib/useFormDraft.js";

export interface UnslottedEventChoice {
  id: string;
  title: string;
  status_label: string;
}

/** Original shell injects these exact props into its VideoForm child. */
export interface UnslottedFormRenderInput<
  Initial extends { event_ids?: string[]; part?: string | null },
  Event extends UnslottedEventChoice,
> {
  formKey: string;
  mode: "free";
  activeXSnapshot: string | null | undefined;
  initial: Initial & { event_ids: string[]; part: null };
  eventOptions: Event[];
  canEditEvents: false;
  onDraftFlushReady: (flush: () => boolean) => void;
  onSubmitSuccess: () => void;
}

export interface UnslottedPostShellProps<
  Initial extends { event_ids?: string[]; part?: string | null },
  Event extends UnslottedEventChoice,
> {
  initial: Initial;
  eventOptions: Event[];
  activeXId?: string | null;
  draftAuthUserId?: string;
  /** Host inserts the real SPA VideoForm and all its required injected ports. */
  renderVideoForm: (input: UnslottedFormRenderInput<Initial, Event>) => React.ReactNode;
}

type AffiliationChoice = "none" | "event" | null;

// MIG-0714 ISSUE-703 candidate fix, pending Lead/security/browser parity approval.
// Key the shell itself, not only the VideoForm child: the shell owns event
// selection, dirty flags, and the localStorage draft. A different auth user or
// Active X ID must never inherit those values on a same-instance rerender.
export function UnslottedPostShell<
  Initial extends { event_ids?: string[]; part?: string | null },
  Event extends UnslottedEventChoice,
>(props: UnslottedPostShellProps<Initial, Event>): React.ReactElement {
  const activeXKey = normalizeXId(props.activeXId ?? "") || "unassigned";
  const authUserId = props.draftAuthUserId?.trim() ?? "";
  return (
    <UnslottedPostShellForIdentity
      key={`unslotted-video:${authUserId || "anonymous"}:${activeXKey}`}
      {...props}
    />
  );
}

function UnslottedPostShellForIdentity<
  Initial extends { event_ids?: string[]; part?: string | null },
  Event extends UnslottedEventChoice,
>({
  initial,
  eventOptions,
  activeXId,
  draftAuthUserId,
  renderVideoForm,
}: UnslottedPostShellProps<Initial, Event>): React.ReactElement {
  const [affiliation, setAffiliation] = React.useState<AffiliationChoice>(null);
  const [selectedEventId, setSelectedEventId] = React.useState("");
  const [formDirty, setFormDirty] = React.useState(false);
  const [shellDirty, setShellDirty] = React.useState(false);
  const [missingRestoredEvent, setMissingRestoredEvent] = React.useState(false);
  const videoDraftFlushRef = React.useRef<() => boolean>(() => false);
  // An in-flight submit may complete after an affiliation/event change.
  // Keep success scoped to the selection version that launched it; the new
  // selection's draft must not be cleared by the departed form.
  const selectionRevisionRef = React.useRef(0);

  const selectedEvent = eventOptions.find((event) => event.id === selectedEventId);
  const selectedEventOptions = React.useMemo(
    () => (selectedEvent ? [selectedEvent] : []),
    [selectedEvent],
  );
  const activeXKey = normalizeXId(activeXId ?? "") || "unassigned";
  const authUserId = draftAuthUserId?.trim() ?? "";
  const shellDraftKey = authUserId
    ? buildFormDraftStorageKey({
        authUserId,
        formId: `unslotted-shell:${activeXKey}`,
        schemaVersion: "unslotted-shell-v1",
      })
    : "";
  const formKey = `unslotted-video:${authUserId || "anonymous"}:${activeXKey}`;

  // Only a draft identity change should trigger restoration. Event-option
  // arrays are refreshed independently while a person may be editing; tying
  // onRestore to their reference would replay an older localStorage draft and
  // discard the in-progress affiliation choice on every list refresh.
  const latestEventOptionsRef = React.useRef(eventOptions);
  latestEventOptionsRef.current = eventOptions;
  // An event may be temporarily absent while its options are loading. Keep
  // only that original ID pending; never invent a replacement from the list.
  const pendingRestoredEventIdRef = React.useRef("");
  const restoreShellDraft = React.useCallback((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const draft = value as Record<string, unknown>;
    const nextAffiliation = draft.affiliation === "none" || draft.affiliation === "event"
      ? draft.affiliation
      : null;
    const nextEventId = typeof draft.selectedEventId === "string" ? draft.selectedEventId : "";
    const unavailable = nextAffiliation === "event" && Boolean(nextEventId) &&
      !latestEventOptionsRef.current.some((event) => event.id === nextEventId);
    pendingRestoredEventIdRef.current = unavailable ? nextEventId : "";
    setAffiliation(nextAffiliation);
    if (unavailable) {
      setSelectedEventId("");
      setMissingRestoredEvent(true);
    } else {
      setSelectedEventId(nextAffiliation === "event" ? nextEventId : "");
      setMissingRestoredEvent(false);
    }
  }, []);

  // Restore only when the exact previously saved event becomes eligible.
  // A new options array must never replay localStorage over the user's edits.
  React.useEffect(() => {
    const pendingId = pendingRestoredEventIdRef.current;
    if (!pendingId || shellDirty || formDirty ||
        !eventOptions.some((event) => event.id === pendingId)) return;
    pendingRestoredEventIdRef.current = "";
    setSelectedEventId(pendingId);
    setMissingRestoredEvent(false);
  }, [eventOptions, shellDirty, formDirty]);

  const shellDraftValue = React.useMemo(
    () => ({ affiliation, selectedEventId }),
    [affiliation, selectedEventId],
  );
  const { clearDraft: clearShellDraft, flushDraft: flushShellDraft } = useFormDraft({
    storageKey: shellDraftKey || "fn:draft:disabled:unslotted-shell-v1",
    value: shellDraftValue,
    enabled: Boolean(authUserId),
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    shouldSave: shellDirty || formDirty,
    onRestore: restoreShellDraft,
  });

  // An identity-keyed remount cancels the draft hook's pending debounce.
  // Flush only the departing shell's dirty draft, using its old storage key,
  // before a new user / Active X shell can mount. Never flush a pristine form.
  const departingDraftRef = React.useRef({ dirty: false, flush: flushShellDraft });
  departingDraftRef.current = { dirty: shellDirty || formDirty, flush: flushShellDraft };
  React.useEffect(() => () => {
    const departing = departingDraftRef.current;
    if (departing.dirty) departing.flush();
  }, []);

  const handleVideoDraftFlushReady = React.useCallback((flush: () => boolean) => {
    videoDraftFlushRef.current = flush;
  }, []);
  const handleVideoSubmitSuccess = React.useCallback(() => {
    pendingRestoredEventIdRef.current = "";
    // A successful submit may synchronously navigate/unmount this shell before
    // React commits the clean flags. Prevent the departing-identity cleanup
    // from recreating the draft that clearShellDraft just removed.
    departingDraftRef.current.dirty = false;
    clearShellDraft();
    setShellDirty(false);
    setFormDirty(false);
  }, [clearShellDraft]);

  const confirmReset = React.useCallback((): boolean => {
    // Event/affiliation changes no longer remount VideoForm, so the common
    // work draft remains available while the selected event changes.
    return true;
  }, []);

  // Active X ID 切替時の未保存確認と同期flushは子の VideoForm が一元管理する。
  // 親でも同じイベントを購読すると1回の切替でconfirmが二重表示されるため、
  // shell側は選択状態のdraft保存だけを担当する。

  const selectAffiliation = (next: Exclude<AffiliationChoice, null>) => {
    if (next === affiliation || !confirmReset()) return;
    pendingRestoredEventIdRef.current = "";
    selectionRevisionRef.current += 1;
    videoDraftFlushRef.current();
    setShellDirty(true);
    setAffiliation(next);
    if (next === "none") {
      setSelectedEventId("");
      setMissingRestoredEvent(false);
    }
  };

  const selectEvent = (eventId: string) => {
    if (eventId === selectedEventId || !confirmReset()) return;
    pendingRestoredEventIdRef.current = "";
    selectionRevisionRef.current += 1;
    videoDraftFlushRef.current();
    setShellDirty(true);
    setMissingRestoredEvent(false);
    setSelectedEventId(eventId);
  };

  const selectionRevisionAtRender = selectionRevisionRef.current;

  return (
    <div
      style={{ display: "grid", gap: 16 }}
      onChangeCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("form")) {
          setFormDirty(true);
        }
      }}
    >
      <fieldset
        style={{
          margin: 0,
          padding: 16,
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          background: "var(--bg-surface)",
          display: "grid",
          gap: 12,
        }}
      >
        <legend style={{ padding: "0 8px", fontSize: 14, fontWeight: 800 }}>
          この作品をイベントに所属させますか？
        </legend>
        <p className="fn-muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>
          枠なし投稿では、イベントに所属しない通常作品か、公開イベント1件への所属を選択します。
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 10,
          }}
        >
          {([
            ["none", "イベントに所属しない", "イベントとの関係を持たない通常作品として掲載します。"],
            ["event", "イベントに所属する", "終了済み、または運営が個別許可した公開イベント1件へ所属させます。"],
          ] as const).map(([value, title, description]) => {
            const disabled = value === "event" && eventOptions.length === 0;
            const selected = affiliation === value;
            return (
              <label
                key={value}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  alignItems: "start",
                  gap: 10,
                  padding: 14,
                  border: `1px solid ${selected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  borderRadius: "var(--radius-sm)",
                  background: selected
                    ? "color-mix(in srgb, var(--accent-primary) 8%, var(--bg-surface))"
                    : "var(--bg-elevated)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                }}
              >
                <input
                  type="radio"
                  name="unslotted_affiliation_choice"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => selectAffiliation(value)}
                  style={{ marginTop: 3, accentColor: "var(--accent-primary)" }}
                />
                <span style={{ display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 14 }}>{title}</strong>
                  <span className="fn-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                    {description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {affiliation === "event" ? (
          <div style={{ display: "grid", gap: 6 }}>
            <label className="fn-label" htmlFor="unslotted_event_choice">
              所属イベント
            </label>
            <select
              id="unslotted_event_choice"
              className="fn-select"
              value={selectedEventId}
              onChange={(event) => selectEvent(event.target.value)}
              required
            >
              <option value="">イベントを選択してください</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} — {event.status_label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </fieldset>

      {affiliation === null ? (
        <div role="status" className="fn-muted" style={{ padding: 14 }}>
          <Icon name="info" size={13} aria-hidden /> 掲載方法を選択してください。
        </div>
      ) : affiliation === "event" && !selectedEvent ? (
        <div role="status" className="fn-muted" style={{ padding: 14 }}>
          <Icon name="calendar" size={13} aria-hidden />{" "}
          {missingRestoredEvent
            ? "保存済みイベントは現在の候補にありません。イベントを検索して選び直してください。作品情報の下書きは保持されています。"
            : "所属イベントを選択してください。"}
        </div>
      ) : (
        // CURRENT renders <VideoForm key={formKey}>. Keep the same remount
        // boundary even when the injected renderer returns an unkeyed form.
        <React.Fragment key={formKey}>
          {renderVideoForm({
            formKey,
            mode: "free",
            activeXSnapshot: activeXId,
            initial: {
              ...initial,
              event_ids: selectedEvent ? [selectedEvent.id] : [],
              part: null,
            } as Initial & { event_ids: string[]; part: null },
            eventOptions: selectedEventOptions,
            canEditEvents: false,
            onDraftFlushReady: handleVideoDraftFlushReady,
            onSubmitSuccess: () => {
              if (selectionRevisionAtRender !== selectionRevisionRef.current) return;
              handleVideoSubmitSuccess();
            },
          })}
        </React.Fragment>
      )}
    </div>
  );
}
