import { getLiveEventSubmissions } from "@/lib/staticRebuild/liveApi";
import { handleLiveApiGet } from "@/lib/staticRebuild/liveGuard";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return handleLiveApiGet(id, getLiveEventSubmissions);
}
