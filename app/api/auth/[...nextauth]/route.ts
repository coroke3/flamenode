import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { handleAuthRouteRequest } from "@/lib/auth/authRouteError";

export async function GET(request: NextRequest): Promise<Response> {
  return handleAuthRouteRequest(handlers.GET, request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleAuthRouteRequest(handlers.POST, request);
}
