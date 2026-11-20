// MIG-0714 U02a: dependency-inverted VideoForm submit boundary.
// No Server Actions, network, browser storage, or routing effects in this module.
import type { VideoActionResult } from "../../lib/videoTypes.js";

/** CURRENT VideoForm mode uses "edit"; the Hono submit port uses "update". */
export type VideoFormMode = "free" | "slot" | "edit";
export type VideoSubmitMode = "free" | "slot" | "update";
export type VideoSubmitAdapter = (
  mode: VideoSubmitMode,
  formData: FormData,
) => Promise<VideoActionResult>;

export function mapVideoSubmitMode(mode: VideoFormMode): VideoSubmitMode {
  switch (mode) {
    case "free":
      return "free";
    case "slot":
      return "slot";
    case "edit":
      return "update";
    default:
      // Fail closed for a malformed runtime mode, never choose "free" silently.
      throw new TypeError("Unsupported video submission mode");
  }
}

/**
 * Preserve FormData *identity* and repeated key values; the caller owns the
 * validation, pending state, draft cleanup and guard redirect semantics.
 * There is deliberately no fallback to a legacy Server Action.
 */
export function submitVideoForm(
  mode: VideoFormMode,
  formData: FormData,
  submit: VideoSubmitAdapter,
): Promise<VideoActionResult> {
  const wireMode = mapVideoSubmitMode(mode);
  return submit(wireMode, formData);
}
