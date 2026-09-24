import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  buildPublicHealthResponse,
  readPublicHealthCommit,
} from "@/lib/health/publicHealth";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    return buildPublicHealthResponse(
      readPublicHealthCommit(getCloudflareContext().env),
    );
  } catch {
    return buildPublicHealthResponse(undefined);
  }
}
