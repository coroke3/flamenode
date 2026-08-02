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

interface StoredDraftEnvelope<T> {
  savedAt: number;
  value: T;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function containsForbiddenValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (value == null) return false;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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
  onRestore?: (value: T) => void;
}

export function useFormDraft<T>({
  storageKey,
  value,
  enabled = true,
  onRestore,
}: UseFormDraftOptions<T>): {
  clearDraft: () => void;
  restored: boolean;
} {
  const [restored, setRestored] = React.useState(false);
  const skipNextSave = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredDraftEnvelope<T>;
      if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      skipNextSave.current = true;
      onRestore?.(parsed.value);
      setRestored(true);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [enabled, onRestore, storageKey]);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const sanitized = sanitizeDraftValue(value);
    if (sanitized == null) return;

    const timer = window.setTimeout(() => {
      try {
        const envelope: StoredDraftEnvelope<T> = {
          savedAt: Date.now(),
          value: sanitized,
        };
        const serialized = JSON.stringify(envelope);
        if (byteLength(serialized) > MAX_BYTES) return;
        window.localStorage.setItem(storageKey, serialized);
      } catch {
        // quota exceeded 等は黙って破棄
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [enabled, storageKey, value]);

  const clearDraft = React.useCallback(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  return { clearDraft, restored };
}
