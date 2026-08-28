import {
  CloudflareBindingsUnavailableError,
  getEnv,
} from "@/lib/cloudflare";
import {
  CurrentUserUnavailableError,
  getCurrentUser,
} from "@/lib/auth/currentUser";
import {
  isValidSlotSubmissionIconSlotId,
  probeSlotSubmissionIcon,
  serveSlotSubmissionIconRow,
} from "@/lib/media/slotSubmissionIcon";

const UNAVAILABLE_HEADERS = {
  "Cache-Control": "no-store",
  "Retry-After": "30",
} as const;
const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slotId: string }> },
): Promise<Response> {
  const { slotId } = await params;
  // 明らかに不正なIDはCloudflare binding/D1/Auth.jsを起動する前に拒否する。
  // binding障害時でもinvalid inputを503へ誤分類せず、probe系botの固定費も抑える。
  if (!isValidSlotSubmissionIconSlotId(slotId)) {
    return new Response("Not found", {
      status: 404,
      headers: NOT_FOUND_HEADERS,
    });
  }

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

  try {
    const probe = await probeSlotSubmissionIcon(env, slotId);
    if (probe.kind === "unavailable") {
      return new Response("Media access check unavailable", {
        status: 503,
        headers: UNAVAILABLE_HEADERS,
      });
    }
    if (probe.kind === "not_found") {
      return new Response("Not found", {
        status: 404,
        headers: NOT_FOUND_HEADERS,
      });
    }
    if (probe.kind === "public") {
      // public_name はD1の公開判定だけで確定する。Auth.jsを起動しない。
      return await serveSlotSubmissionIconRow(env, probe.row, null);
    }

    let viewer: { id: string; active_x_user_id: string | null } | null = null;
    try {
      const user = await getCurrentUser();
      if (user && user.is_banned !== 1) {
        viewer = { id: user.id, active_x_user_id: user.active_x_user_id };
      }
    } catch (error) {
      if (error instanceof CurrentUserUnavailableError) {
        return new Response("Media access check unavailable", {
          status: 503,
          headers: UNAVAILABLE_HEADERS,
        });
      }
      throw error;
    }

    return await serveSlotSubmissionIconRow(env, probe.row, viewer);
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
