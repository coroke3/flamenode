import {
  CloudflareBindingsUnavailableError,
  getEnv,
} from "@/lib/cloudflare";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
import { serveSlotSubmissionIcon } from "@/lib/media/slotSubmissionIcon";

const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slotId: string }> },
): Promise<Response> {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch (error) {
    if (!(error instanceof CloudflareBindingsUnavailableError)) throw error;
    console.error("[slot-submission-icon] runtime bindings unavailable", {
      missing: error.missing,
    });
    return new Response("Media access check unavailable", {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }
  const { slotId } = await params;

  let viewer: { id: string; active_x_user_id: string | null } | null = null;
  try {
    const user = await getCurrentUser();
    if (user && user.is_banned !== 1) {
      viewer = { id: user.id, active_x_user_id: user.active_x_user_id };
    }
  } catch (error) {
    if (error instanceof CurrentUserUnavailableError) {
      return new Response("Media access check unavailable", { status: 503 });
    }
    throw error;
  }

  try {
    return await serveSlotSubmissionIcon(env, slotId, viewer);
  } catch (error) {
    console.error("[slot-submission-icon] media read failed", {
      slotId,
      error,
    });
    return new Response("Media temporarily unavailable", {
      status: 503,
      headers: UNAVAILABLE_HEADERS,
    });
  }
}
