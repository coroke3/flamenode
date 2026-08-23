import { and, eq } from "drizzle-orm";
import { CloudflareBindingsUnavailableError, getDatabase } from "@/lib/cloudflare";
import { events } from "@/lib/db/schema";
import {
  checkPublicApiRateLimit,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@/lib/api/publicApi";
import { loadStaticEventRelease } from "@/lib/publicData/loader";

function decodePathSegment(raw: string | undefined): string | null {
  try {
    const value = decodeURIComponent(raw ?? "").trim();
    return value.length > 0 && value.length <= 128 ? value : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limited = checkPublicApiRateLimit(request, "/api/event-endpoints/:id/release");
  if (limited) return limited;
  const eventId = decodePathSegment((await params).id);
  if (!eventId) return publicJsonResponse(request, { error: "not_found" }, "public, max-age=60", 404);

  let db: ReturnType<typeof getDatabase>;
  try {
    db = getDatabase();
  } catch (error) {
    if (error instanceof CloudflareBindingsUnavailableError) {
      return publicServiceUnavailableResponse("runtime_bindings_unavailable");
    }
    throw error;
  }
  if (!db) return publicServiceUnavailableResponse("db_unavailable");

  let event: { id: string; visibility_status: string; public_api_enabled: number } | undefined;
  try {
    const rows = await db
      .select({
        id: events.id,
        visibility_status: events.visibility_status,
        public_api_enabled: events.public_api_enabled,
      })
      .from(events)
      .where(
        and(
          eq(events.id, eventId),
          eq(events.visibility_status, "public"),
          eq(events.public_api_enabled, 1),
        )!,
      )
      .limit(1);
    event = rows[0];
  } catch {
    return publicServiceUnavailableResponse("database_unavailable");
  }
  if (!event) return publicJsonResponse(request, { error: "not_found" }, "public, max-age=60", 404);

  const loaded = await loadStaticEventRelease(event.id);
  if (!loaded.data) {
    if (loaded.state === "not_found") {
      return publicJsonResponse(request, { error: "not_found" }, "public, max-age=60", 404);
    }
    return publicServiceUnavailableResponse(
      loaded.state === "reflecting" ? "public_data_reflecting" : "public_data_unavailable",
    );
  }
  if (loaded.data.event.id !== event.id) {
    return publicServiceUnavailableResponse("public_data_unavailable");
  }
  return publicJsonResponse(
    request,
    loaded.data,
    "public, max-age=30, s-maxage=60, stale-while-revalidate=120",
  );
}
