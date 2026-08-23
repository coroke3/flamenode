"use client";

import * as React from "react";
import {
  VideoForm,
  type EventOption,
  type VideoFormInitialValues,
} from "@/components/forms/VideoForm";
import { Icon } from "@/components/ui/Icon";
import { normalizeXId } from "@/lib/utils/xid";
import type { CustomQuestion } from "@/lib/video/customQuestions";
import {
  buildFormDraftStorageKey,
  useFormDraft,
} from "@/lib/interactions/useFormDraft";

interface UnslottedEventOption extends EventOption {
  status_label: string;
  custom_questions?: CustomQuestion[];
}

type VideoFormProps = React.ComponentProps<typeof VideoForm>;

type UnslottedPostFormProps = Omit<
  VideoFormProps,
  "mode" | "initial" | "eventOptions" | "canEditEvents"
> & {
  initial: VideoFormInitialValues;
  eventOptions: UnslottedEventOption[];
};

type AffiliationChoice = "none" | "event" | null;

export function UnslottedPostForm({
  initial,
  eventOptions,
  ...videoFormProps
}: UnslottedPostFormProps): React.ReactElement {
  const [affiliation, setAffiliation] = React.useState<AffiliationChoice>(null);
  const [selectedEventId, setSelectedEventId] = React.useState("");
  const [formDirty, setFormDirty] = React.useState(false);
  const [shellDirty, setShellDirty] = React.useState(false);
  const [missingRestoredEvent, setMissingRestoredEvent] = React.useState(false);
  const videoDraftFlushRef = React.useRef<() => boolean>(() => false);

  const selectedEvent = eventOptions.find((event) => event.id === selectedEventId);
  const selectedEventOptions = React.useMemo(
    () => (selectedEvent ? [selectedEvent] : []),
    [selectedEvent],
  );
  const activeXKey = normalizeXId(videoFormProps.activeXId ?? "") || "unassigned";
  const authUserId = videoFormProps.draftAuthUserId?.trim() ?? "";
  const shellDraftKey = authUserId
    ? buildFormDraftStorageKey({
        authUserId,
        formId: `unslotted-shell:${activeXKey}`,
        schemaVersion: "unslotted-shell-v1",
      })
    : "";
  const formKey = `unslotted-video:${authUserId || "anonymous"}:${activeXKey}`;

  const restoreShellDraft = React.useCallback((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const draft = value as Record<string, unknown>;
    const nextAffiliation = draft.affiliation === "none" || draft.affiliation === "event"
      ? draft.affiliation
      : null;
    const nextEventId = typeof draft.selectedEventId === "string" ? draft.selectedEventId : "";
    setAffiliation(nextAffiliation);
    if (nextAffiliation === "event" && !eventOptions.some((event) => event.id === nextEventId)) {
      setSelectedEventId("");
      setMissingRestoredEvent(Boolean(nextEventId));
    } else {
      setSelectedEventId(nextAffiliation === "event" ? nextEventId : "");
      setMissingRestoredEvent(false);
    }
  }, [eventOptions]);

  const shellDraftValue = React.useMemo(
    () => ({ affiliation, selectedEventId }),
    [affiliation, selectedEventId],
  );
  const { clearDraft: clearShellDraft } = useFormDraft({
    storageKey: shellDraftKey || "fn:draft:disabled:unslotted-shell-v1",
    value: shellDraftValue,
    enabled: Boolean(authUserId),
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    shouldSave: shellDirty || formDirty,
    onRestore: restoreShellDraft,
  });

  const handleVideoDraftFlushReady = React.useCallback((flush: () => boolean) => {
    videoDraftFlushRef.current = flush;
  }, []);
  const handleVideoSubmitSuccess = React.useCallback(() => {
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
    videoDraftFlushRef.current();
    setShellDirty(true);
    setMissingRestoredEvent(false);
    setSelectedEventId(eventId);
  };

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
        <VideoForm
          key={formKey}
          {...videoFormProps}
          mode="free"
          activeXSnapshot={videoFormProps.activeXId}
          initial={{
            ...initial,
            event_ids: selectedEvent ? [selectedEvent.id] : [],
            part: null,
          }}
          eventOptions={selectedEventOptions}
          canEditEvents={false}
          onDraftFlushReady={handleVideoDraftFlushReady}
          onSubmitSuccess={handleVideoSubmitSuccess}
        />
      )}
    </div>
  );
}
