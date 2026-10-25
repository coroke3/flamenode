/**
 * Build-time creator index for the `/user` search Island (MIG-0504): only the fields CURRENT's
 * filter / sort / card use, only creators that have a page (see userData.ts).
 */
import { loadUserBuildData } from "../../lib/userData.ts";

export async function GET(): Promise<Response> {
  const data = await loadUserBuildData();
  const entries = (data.index ?? []).map((e) => ({
    x_id: e.x_id,
    x_name: e.x_name,
    icon_url: e.icon_url,
    personal_count: e.personal_count,
    collab_count: e.collab_count,
    total_works: e.total_works,
    sort_score: e.sort_score,
  }));
  return new Response(JSON.stringify(entries), { headers: { "Content-Type": "application/json" } });
}
