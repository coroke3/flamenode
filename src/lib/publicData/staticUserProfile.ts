import "server-only";

import { createPublicJsonLoader } from "./createPublicJsonLoader";
import {
  normalizeStaticUserProfile,
  type StaticUserProfile,
  type StaticUserProfilePayload,
} from "./staticUserProfileCore";

export const loadStaticUserProfile =
  createPublicJsonLoader<
    StaticUserProfilePayload,
    StaticUserProfile
  >({
    r2Key: (xUserId) => `users/${xUserId}.json`,
    targetType: "user",
    reason: "public_user_profile_miss",
    normalize: normalizeStaticUserProfile,
  });

export type { StaticUserProfile } from "./staticUserProfileCore";
