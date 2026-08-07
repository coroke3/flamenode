import { getEnv } from "@/lib/cloudflare";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
import { serveSlotSubmissionIcon } from "@/lib/media/slotSubmissionIcon";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slotId: string }> },
): Promise<Response> {
  const env = getEnv();
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

  return serveSlotSubmissionIcon(env, slotId, viewer);
}
