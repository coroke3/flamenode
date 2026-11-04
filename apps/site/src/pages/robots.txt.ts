/**
 * MIG-0621 U01 — static robots.txt, preserving CURRENT app/robots.ts output.
 * Do not route production traffic here before the Phase 5 cutover gate.
 */
import { siteOrigin } from "../lib/pageHead.ts";

/** Keep in exactly the same order as CURRENT's MetadataRoute.Robots disallow list. */
export const ROBOTS_DISALLOW = [
  "/api/",
  "/admin/",
  "/manage/",
  "/dashboard/",
  "/entry",
  "/entry/",
  "/onboarding",
  "/dev/",
  "/maintenance",
] as const;

/** Next resolveRobots line order / final newline, without a Next.js runtime dependency. */
export function buildRobotsText(origin: string = siteOrigin()): string {
  return [
    "User-Agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    "",
    `Host: ${origin}`,
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function GET(): Response {
  return new Response(buildRobotsText(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
