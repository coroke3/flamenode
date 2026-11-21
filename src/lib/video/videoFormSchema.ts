/**
 * MIG-0651: canonical SA-086/088/089 video schema lives in
 * @flamenode/domain/video. Keep CURRENT Next imports as compatibility bridge.
 */
export {
  normalizeIconUrl,
  videoIconModeSchema,
  videoFormSchema,
  parseVideoForm,
} from "@flamenode/domain/video";
export type {
  VideoIconMode,
  VideoFormData,
  ParseVideoFormOptions,
} from "@flamenode/domain/video";
