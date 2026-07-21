import { getEnv } from "@/lib/cloudflare";
import { buildPublicHealthResponse } from "@/lib/health/publicHealth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    return buildPublicHealthResponse(getEnv().BUILD_COMMIT_SHA);
  } catch {
    return buildPublicHealthResponse(undefined);
  }
}
