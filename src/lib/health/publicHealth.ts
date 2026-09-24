const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

/** Read only the deployment marker; health probes do not need other bindings. */
export function readPublicHealthCommit(env: unknown): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>).BUILD_COMMIT_SHA;
  return typeof value === "string" ? value : undefined;
}

export function buildPublicHealthResponse(commitValue: string | undefined): Response {
  const commit = commitValue?.trim() ?? "";
  if (!COMMIT_PATTERN.test(commit)) {
    return Response.json(
      {
        ok: false,
        service: "flamenode-web",
        runtime: "cloudflare-worker",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    {
      ok: true,
      service: "flamenode-web",
      commit: commit.toLowerCase(),
      runtime: "cloudflare-worker",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
