import "server-only";

import { getEnvAsync, type FlameNodeEnv } from "@/lib/cloudflare";
import { configuredHttpOrigin, requestHasSameOrigin } from "./origin";

export type WriteOriginGuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 503; error: string };

type EnvLoader = () => Promise<FlameNodeEnv>;

export async function requireSameOriginWrite(
  request: Request,
  loadEnv: EnvLoader = getEnvAsync,
): Promise<WriteOriginGuardResult> {
  let configuredOrigin: string;
  try {
    const env = await loadEnv();
    const allowLocalPreview =
      process.env.NODE_ENV !== "production" ||
      env.FLAMENODE_LOCAL_PREVIEW === "1";
    configuredOrigin = configuredHttpOrigin(
      env.NEXT_PUBLIC_SITE_URL,
      "NEXT_PUBLIC_SITE_URL",
      { allowLoopback: allowLocalPreview },
    );
  } catch {
    return {
      ok: false,
      status: 503,
      error: "origin_verification_unavailable",
    };
  }

  if (!requestHasSameOrigin(request.headers.get("Origin"), configuredOrigin)) {
    return { ok: false, status: 403, error: "invalid_origin" };
  }
  return { ok: true };
}
