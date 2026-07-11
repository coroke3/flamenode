/** Public smoke-check endpoint. It intentionally does not inspect bindings or secrets. */
export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { ok: true, service: "flamenode-pages", runtime: "edge" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
