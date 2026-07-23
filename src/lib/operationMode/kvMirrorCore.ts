import { isOperationMode } from "./resolve.ts";
import type { OperationMode } from "./types";

export const OPERATION_MODE_KV_KEY = "operation_mode:mirror";

export type OperationModeKvMirror = {
  mode: OperationMode;
  updated_at: number;
  reason?: string | null;
};

export function parseOperationModeKvMirror(
  raw: string | null,
): OperationModeKvMirror | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OperationModeKvMirror>;
    if (!isOperationMode(parsed.mode)) return null;
    if (typeof parsed.updated_at !== "number" || !Number.isFinite(parsed.updated_at)) {
      return null;
    }
    return {
      mode: parsed.mode,
      updated_at: parsed.updated_at,
      reason:
        typeof parsed.reason === "string" || parsed.reason === null
          ? parsed.reason
          : undefined,
    };
  } catch {
    return null;
  }
}
