// MIG-0714 U02a: dependency-inverted VideoForm submit boundary.
// No Server Actions, network, browser storage, or routing effects in this module.
import type { ComponentProps } from "react";
import type { VideoActionResult } from "../../lib/videoTypes.js";
import type { VideoMembersField } from "./VideoMembersField.js";

/** CURRENT VideoForm mode uses "edit"; the Hono submit port uses "update". */
export type VideoFormMode = "free" | "slot" | "edit";
export type VideoSubmitMode = "free" | "slot" | "update";
export type VideoSubmitAdapter = (
  mode: VideoSubmitMode,
  formData: FormData,
) => Promise<VideoActionResult>;

function mapVideoSubmitMode(mode: VideoFormMode): VideoSubmitMode {
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

/**
 * MIG-0714 U02b (preparation): these are exactly the two mandatory ports of
 * the already-ported MIG-0713 VideoMembersField. Use the component's own prop
 * types so a future search/permission API contract change fails compilation.
 */
export type VideoMemberAdapters = Pick<
  ComponentProps<typeof VideoMembersField>,
  "searchXUsers" | "applyPermissionBatch"
>;

/** Required effects injected by the future SPA VideoForm, never imported from Next. */
export type VideoFormPorts = VideoMemberAdapters & {
  submit: VideoSubmitAdapter;
};
