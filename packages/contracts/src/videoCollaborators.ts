import { z } from "zod";

/**
 * MIG-0650: collaborator permission & admin video member write contracts
 * (SA-082..085, D-16-1). URL path parameters supply `videoId` (and `xUserId`
 * for SA-082/083). Callers must not treat client JSON as authorization proof.
 */
export const MAX_VIDEO_COLLABORATOR_BATCH = 100;

export const VideoCollabPrivilegeModeSchema = z.enum(["normal", "admin", "event"]);
export type VideoCollabPrivilegeMode = z.infer<typeof VideoCollabPrivilegeModeSchema>;

const booleanOrLegacyFlagSchema = z.union([
  z.boolean(),
  z.literal("1"),
  z.literal("0"),
  z.literal("true"),
  z.literal("false"),
]);

/** SA-082: PUT /api/videos/:videoId/collaborators/:xUserId */
export const VideoCollaboratorUpsertBodySchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  can_edit: booleanOrLegacyFlagSchema.optional(),
  notify: booleanOrLegacyFlagSchema.optional(),
  edit_privilege_mode: VideoCollabPrivilegeModeSchema.optional(),
  user_id: z.string().trim().max(128).optional().nullable(),
  x_user_id: z.string().trim().max(32).optional(),
});
export type VideoCollaboratorUpsertBody = z.infer<typeof VideoCollaboratorUpsertBodySchema>;

/** SA-083: DELETE /api/videos/:videoId/collaborators/:xUserId (optional body) */
export const VideoCollaboratorDeleteBodySchema = z.object({
  edit_privilege_mode: VideoCollabPrivilegeModeSchema.optional(),
  x_user_id: z.string().trim().max(32).optional(),
});
export type VideoCollaboratorDeleteBody = z.infer<typeof VideoCollaboratorDeleteBodySchema>;

export const VideoCollaboratorBatchIntentSchema = z.object({
  x_user_id: z.string().trim().min(1).max(32),
  display_name: z.string().trim().min(1).max(80),
  intent: z.enum(["on", "off"]),
});
export type VideoCollaboratorBatchIntent = z.infer<typeof VideoCollaboratorBatchIntentSchema>;

/** SA-084: POST /api/videos/:videoId/collaborators/batch */
export const VideoCollaboratorBatchBodySchema = z.object({
  edit_privilege_mode: VideoCollabPrivilegeModeSchema.optional(),
  notify: z.boolean().optional().default(true),
  intents: z.array(VideoCollaboratorBatchIntentSchema).min(1).max(MAX_VIDEO_COLLABORATOR_BATCH),
});
export type VideoCollaboratorBatchBody = z.infer<typeof VideoCollaboratorBatchBodySchema>;

/** Response shape for SA-082..084 (`VideoCollabResult` / `VideoCollabPermissionBatchResult`). */
export const VideoCollabResultSchema = z.object({
  ok: z.boolean(),
  videoId: z.string().optional(),
  message: z.string().optional(),
  granted: z.array(z.string()).optional(),
  revoked: z.array(z.string()).optional(),
  unchanged: z.number().int().optional(),
});
export type VideoCollabResult = z.infer<typeof VideoCollabResultSchema>;

/** SA-085: PUT /api/videos/:videoId/members */
export const VideoAdminMembersBodySchema = z
  .object({
    is_collab: z.union([z.string(), z.array(z.string()).max(16)]).optional(),
    members_json: z.string().optional(),
  })
  .strict();
export type VideoAdminMembersBody = z.infer<typeof VideoAdminMembersBodySchema>;

/** Response shape for SA-085 (`VideoActionResult`). */
export const VideoAdminMembersResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  videoId: z.string().optional(),
  youtubeVideoId: z.string().optional(),
  eventId: z.string().optional(),
  pendingPublicReflection: z.boolean().optional(),
});
export type VideoAdminMembersResult = z.infer<typeof VideoAdminMembersResultSchema>;
