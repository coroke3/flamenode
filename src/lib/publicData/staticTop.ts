import "server-only";
import {
  loadPublicJson,
  type PublicJsonLoadResult,
} from "./loader";
import {
  normalizeStaticTop,
  type StaticTopData,
  type StaticTopPayload,
} from "./staticTopCore";

export async function loadStaticTopPage(): Promise<{
  top: StaticTopData | null;
} & PublicJsonLoadResult<StaticTopData>> {
  const result = await loadPublicJson<StaticTopPayload>({
    r2Key: "top.json",
    targetType: "top",
    targetId: "global",
    reason: "public_top_miss",
  });
  const top = result.data ? normalizeStaticTop(result.data) : null;
  return {
    ...result,
    data: top,
    top,
  };
}
