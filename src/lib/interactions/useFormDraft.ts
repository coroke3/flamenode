"use client";

import * as React from "react";

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 500;
const MAX_BYTES = 256 * 1024;

const SENSITIVE_KEY_PATTERN =
  /password|token|secret|credential|authorization|api[_-]?key/i;

export interface FormDraftKeyParts {
  authUserId: string;
  formId: string;
  schemaVersion: string;
}

export function buildFormDraftStorageKey(parts: FormDraftKeyParts): string {
  return `fn:draft:${parts.authUserId}:${parts.formId}:${parts.schemaVersion}`;
}

export type DraftMetadata = Record<string, string | number | boolean | null>;

interface StoredDraftEnvelope<T> {
  savedAt: number;
  metadata?: DraftMetadata;
  value: T;
}

export function draftMetadataMatches(
  expected: DraftMetadata | undefined,
  actual: unknown,
): boolean {
  if (!expected) return true;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const record = actual as Record<string, unknown>;
  return Object.keys(expected).every((key) => record[key] === expected[key]);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function containsForbiddenValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (value == null) return false;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return false;
  }
  if (typeof File !== "undefined" && value instanceof File) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenValue(item, depth + 1));
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) return true;
      if (containsForbiddenValue(nested, depth + 1)) return true;
    }
  }
  return false;
}

export function sanitizeDraftValue<T>(value: T): T | null {
  if (containsForbiddenValue(value)) return null;
  return value;
}

export interface UseFormDraftOptions<T> {
  storageKey: string;
  value: T;
  enabled?: boolean;
  /** Draft expiration. Existing forms retain the historical 24 hour default. */
  ttlMs?: number;
  /** Debounce used for ordinary edits. Explicit flushes bypass this delay. */
  debounceMs?: number;
  /** Maximum UTF-8 bytes written to localStorage. */
  maxBytes?: number;
  /** Set false while an empty/pristine form is first mounted. */
  shouldSave?: boolean;
  metadata?: DraftMetadata;
  validateMetadata?: (metadata: unknown) => boolean;
  onRestore?: (value: T) => void;
  onStale?: (value: T) => void;
}

export interface UseFormDraftResult<T = unknown> {
  clearDraft: () => void;
  /** Flush the latest render value, or an optional synchronously-built value. */
  flushDraft: (nextValue?: T) => boolean;
  restoreStaleDraft: () => boolean;
  restored: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
}

/**
 * Browser-local form draft persistence.
 *
 * The hook deliberately has no server or database dependency.  It also owns
 * pagehide/visibilitychange flushing so callers cannot accidentally lose the
 * last debounce window during a navigation or Worker/network failure.
 */
export function useFormDraft<T>({
  storageKey,
  value,
  enabled = true,
  ttlMs = DRAFT_TTL_MS,
  debounceMs = DEBOUNCE_MS,
  maxBytes = MAX_BYTES,
  shouldSave = true,
  metadata,
  validateMetadata,
  onRestore,
  onStale,
}: UseFormDraftOptions<T>): UseFormDraftResult<T> {
  const [restored, setRestored] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<number | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const skipNextSave = React.useRef(false);
  const timerRef = React.useRef<number | null>(null);
  const generationRef = React.useRef(0);
  const staleKeyRef = React.useRef<string | null>(null);
  const staleValueFingerprintRef = React.useRef<string | null>(null);
  const staleValueRef = React.useRef<T | null>(null);
  const valueRef = React.useRef(value);
  const metadataRef = React.useRef(metadata);
  valueRef.current = value;
  metadataRef.current = metadata;

  const cancelPendingSave = React.useCallback(() => {
    if (timerRef.current != null && typeof window !== "undefined") {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = null;
    generationRef.current += 1;
  }, []);

  const writeDraft = React.useCallback(
    (nextValue: T): boolean => {
      if (!enabled || typeof window === "undefined") return false;
      const sanitized = sanitizeDraftValue(nextValue);
      if (sanitized == null) {
        setSaveError("下書きに保存できない値が含まれています。");
        return false;
      }
      try {
        const envelope: StoredDraftEnvelope<T> = {
          savedAt: Date.now(),
          metadata: metadataRef.current,
          value: sanitized,
        };
        const serialized = JSON.stringify(envelope);
        if (byteLength(serialized) > maxBytes) {
          setSaveError("下書きのサイズが上限を超えたため保存できませんでした。");
          return false;
        }
        window.localStorage.setItem(storageKey, serialized);
        setLastSavedAt(envelope.savedAt);
        setRestored(false);
        setSaveError(null);
        return true;
      } catch {
        setSaveError("下書きの保存に失敗しました。ブラウザの保存領域を確認してください。");
        return false;
      }
    },
    [enabled, maxBytes, storageKey],
  );

  const flushDraft = React.useCallback((nextValue?: T): boolean => {
    cancelPendingSave();
    return writeDraft(nextValue === undefined ? valueRef.current : nextValue);
  }, [cancelPendingSave, writeDraft]);

  React.useEffect(() => {
    setRestored(false);
    setLastSavedAt(null);
    setSaveError(null);
    cancelPendingSave();
    staleKeyRef.current = null;
    staleValueFingerprintRef.current = null;
    staleValueRef.current = null;
    if (!enabled || typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredDraftEnvelope<T>;
      const now = Date.now();
      if (
        !parsed ||
        typeof parsed.savedAt !== "number" ||
        !Number.isFinite(parsed.savedAt) ||
        !Object.prototype.hasOwnProperty.call(parsed, "value")
      ) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      if (now - parsed.savedAt > ttlMs || parsed.savedAt > now + 60_000) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      const metadataValid = validateMetadata
        ? validateMetadata(parsed.metadata)
        : draftMetadataMatches(metadata, parsed.metadata);
      if (!metadataValid) {
        staleKeyRef.current = storageKey;
        staleValueRef.current = parsed.value;
        try {
          staleValueFingerprintRef.current = JSON.stringify(valueRef.current);
        } catch {
          staleValueFingerprintRef.current = null;
        }
        onStale?.(parsed.value);
        return;
      }
      skipNextSave.current = true;
      onRestore?.(parsed.value);
      setRestored(true);
    } catch {
      setSaveError("保存済みの下書きを読み込めませんでした。");
    }
    return cancelPendingSave;
  }, [
    cancelPendingSave,
    enabled,
    metadata,
    onRestore,
    onStale,
    storageKey,
    ttlMs,
    validateMetadata,
  ]);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined" || shouldSave === false) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (staleKeyRef.current === storageKey) {
      let fingerprint = "";
      try {
        fingerprint = JSON.stringify(value);
      } catch {
        return;
      }
      if (fingerprint === staleValueFingerprintRef.current) return;
      staleKeyRef.current = null;
      staleValueFingerprintRef.current = null;
      staleValueRef.current = null;
    }

    cancelPendingSave();
    const generation = generationRef.current;
    timerRef.current = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      writeDraft(valueRef.current);
      timerRef.current = null;
    }, Math.max(0, debounceMs));

    return cancelPendingSave;
  }, [
    cancelPendingSave,
    debounceMs,
    enabled,
    shouldSave,
    storageKey,
    value,
    writeDraft,
  ]);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const flushOnPageHide = () => {
      if (shouldSave !== false) flushDraft();
    };
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushOnPageHide();
    };
    window.addEventListener("pagehide", flushOnPageHide);
    document.addEventListener("visibilitychange", flushOnVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushOnPageHide);
      document.removeEventListener("visibilitychange", flushOnVisibilityChange);
    };
  }, [enabled, flushDraft, shouldSave]);

  const clearDraft = React.useCallback(() => {
    cancelPendingSave();
    skipNextSave.current = false;
    staleKeyRef.current = null;
    staleValueFingerprintRef.current = null;
    staleValueRef.current = null;
    setRestored(false);
    setLastSavedAt(null);
    setSaveError(null);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      setSaveError("下書きの削除に失敗しました。");
    }
  }, [cancelPendingSave, storageKey]);

  const restoreStaleDraft = React.useCallback((): boolean => {
    const stale = staleValueRef.current;
    if (stale == null || staleKeyRef.current !== storageKey) return false;
    staleKeyRef.current = null;
    staleValueFingerprintRef.current = null;
    staleValueRef.current = null;
    // The user's explicit choice makes the stale value current.  Do not skip
    // the next effect: once onRestore updates the controlled form, the normal
    // debounce writes it with the current metadata and the stale prompt will
    // not reappear on the next mount.
    skipNextSave.current = false;
    onRestore?.(stale);
    setRestored(true);
    return true;
  }, [onRestore, storageKey]);

  React.useEffect(() => cancelPendingSave, [cancelPendingSave]);

  return {
    clearDraft,
    flushDraft,
    restoreStaleDraft,
    restored,
    lastSavedAt,
    saveError,
  };
}
