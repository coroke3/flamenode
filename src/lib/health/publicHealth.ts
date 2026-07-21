const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

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
