import "server-only";
import { loadPublicJson } from "./loader";
import {
  normalizeStaticUserProfile,
  type StaticUserProfile,
  type StaticUserProfilePayload,
} from "./staticUserProfileCore";

export async function loadStaticUserProfile(xUserId: string): Promise<{
  profile: StaticUserProfile | null;
  strategy: Awaited<ReturnType<typeof loadPublicJson>>["strategy"];
  enqueued: boolean;
}> {
  const result = await loadPublicJson<StaticUserProfilePayload>({
    r2Key: `users/${xUserId}.json`,
    targetType: "user",
    targetId: xUserId,
    reason: "public_user_profile_miss",
  });
  return {
    profile: result.data ? normalizeStaticUserProfile(result.data) : null,
    strategy: result.strategy,
    enqueued: result.enqueued,
  };
}
