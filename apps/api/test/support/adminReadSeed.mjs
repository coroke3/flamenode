import { insert } from "./personalHarness.mjs";
import { FUTURE, seed as seedPersonal } from "./personalSeed.mjs";

const T0 = 1_700_000_000;

/** Personal seed (users, terms, X links, requests, videos) + admin-only fixtures for MIG-0625. */
export function seed(sqlite) {
  seedPersonal(sqlite);
  const ins = (table, row) => insert(sqlite, table, row);

  // Roles / sessions. personalSeed makes u_carol an admin; add a moderator, a banned admin and a clean admin.
  sqlite.exec(`UPDATE "user" SET discord_id = 'd_' || substr(id, 3) WHERE id NOT IN ('u_dave', 'u_erin')`);
  sqlite.exec(`UPDATE "user" SET can_create_events = 1, role = 'moderator', is_notification_enabled = 0, "emailVerified" = 1700000500000 WHERE id = 'u_bob'`);
  sqlite.exec(`UPDATE "user" SET created_at = ${T0 + 50} WHERE id = 'u_alice'`);
  sqlite.exec(`UPDATE "user" SET created_at = ${T0 + 60} WHERE id = 'u_ivy'`);
  ins("user", { id: "u_root", name: "Root", email: "root@example.test", role: "admin", discord_id: "d_root", is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: "alice_x", created_at: T0 + 70 });
  ins("user", { id: "u_badmin", name: "BannedAdmin", email: "badmin@example.test", role: "admin", discord_id: "d_badmin", is_banned: 1, created_at: T0 + 71 });
  ins("session", { sessionToken: "tok-root", userId: "u_root", expires: FUTURE });
  ins("session", { sessionToken: "tok-badmin", userId: "u_badmin", expires: FUTURE });

  // X IDs for the xid tab: orphan link, owner/manager ordering, active holders, special characters in q.
  ins("x_users", { id: "orph_x", x_name: "Orphan 100%_x", approval_status: "approved" });
  ins("x_user_account_links", { x_user_id: "orph_x", auth_user_id: "u_ghost", link_role: "owner", created_at: T0 + 1, updated_at: T0 + 1 });
  ins("x_user_account_links", { x_user_id: "orph_x", auth_user_id: "u_ivy", link_role: "manager", created_at: T0 + 2, updated_at: T0 + 2 });
  ins("x_user_account_links", { x_user_id: "alice_x", auth_user_id: "u_root", link_role: "manager", created_at: T0 + 1, updated_at: T0 + 1 });
  sqlite.exec(`UPDATE "user" SET active_x_user_id = '@Orph_X ' WHERE id = 'u_ivy'`);
  for (let i = 0; i < 60; i += 1) {
    ins("x_users", { id: `bulk_x${String(i).padStart(2, "0")}`, x_name: `Bulk ${i}`, approval_status: i % 2 ? "pending" : "approved" });
  }

  // Many discord users to exercise paging (50/page) and ordering.
  for (let i = 0; i < 55; i += 1) {
    ins("user", { id: `u_pg${String(i).padStart(2, "0")}`, name: `Pager ${i}`, email: `pg${i}@example.test`, role: "user", discord_id: `d_pg${i}`, created_at: T0 + 1000 + i, is_tos_accepted: i % 2 });
  }

  // System settings (permissions tab).
  sqlite.exec(`INSERT INTO system_settings (id) VALUES ('default') ON CONFLICT(id) DO NOTHING`);
  sqlite.exec(`UPDATE system_settings SET default_editable_fields = '["title","tags"]', upcoming_editable_fields = '["title"]' WHERE id = 'default'`);

  // Events: public/private, accepting window, point event, special-character titles.
  const ev = (id, o) => ins("events", { id: `a-${id}`, title: o.title ?? `Admin Event ${id}`, visibility_status: o.vis ?? "public", ...o.cols });
  const NOW = Math.floor(Date.now() / 1000);
  ev("open", { cols: { start_time: NOW + 86_400, end_time: NOW + 2 * 86_400, entry_start_time: NOW - 100, entry_end_time: NOW + 1000 } });
  ev("closedentry", { cols: { start_time: NOW + 86_400, end_time: NOW + 2 * 86_400, entry_start_time: NOW - 100, entry_end_time: NOW - 1 } });
  ev("point", { cols: { start_time: NOW + 86_400, entry_start_time: NOW - 10 } });
  ev("ended", { cols: { start_time: NOW - 3 * 86_400, end_time: NOW - 2 * 86_400, entry_start_time: NOW - 5 * 86_400 } });
  ev("priv", { vis: "private", title: "100%_special", cols: { start_time: NOW + 5, entry_start_time: NOW - 10 } });
  ev("nostart", { vis: "private", cols: { start_time: null } });
  for (let i = 0; i < 65; i += 1) ev(`bulk${i}`, { cols: { start_time: T0 + i } });

  // Videos for the admin list: statuses, creators, event links. (personalSeed already inserted ~40 videos.)
  const av = (id, o = {}) =>
    ins("videos", {
      id,
      title: o.title ?? `Admin Video ${id}`,
      submitted_by_user_id: o.by ?? "u_alice",
      creator_display_name: o.name ?? `Creator ${id}`,
      creator_x_user_id: o.creator ?? "alice_x",
      youtube_video_id: `yt-${id}`,
      visibility_status: o.vis ?? "public",
      created_at: o.created ?? T0 + 9000,
    });
  av("av-pending-1", { vis: "pending", created: T0 + 9100 });
  av("av-pending-2", { vis: "pending", created: T0 + 9100, creator: "zed", name: "ZED 100%_x" });
  av("av-private", { vis: "private", title: "Percent 100% title" });
  av("av-voided", { vis: "voided" });
  for (let i = 0; i < 52; i += 1) av(`av-bulk${String(i).padStart(2, "0")}`, { created: T0 + 9200 + i, by: "u_root" });
  ins("video_events", { video_id: "av-pending-1", event_id: "a-open" });
  ins("video_events", { video_id: "av-private", event_id: "a-open" });
  ins("video_events", { video_id: "av-pending-2", event_id: "a-ended" });

  // Moderation cases.
  const now = Math.floor(Date.now() / 1000);
  const mc = (id, o) =>
    ins("video_moderation_cases", { id, video_id: o.video ?? "av-pending-1", case_type: o.type ?? "duplicate", status: o.status ?? "open", created_at: o.created ?? T0, attempt_count: o.attempts ?? 0, ...o.cols });
  mc("mc1", { created: T0 + 10, cols: { due_at: now - 3600, public_reason: "dup", private_note: "internal\nnote", related_x_user_id: "alice_x" } });
  mc("mc2", { created: T0 + 20, type: "rights", cols: { due_at: now + 3600 } });
  mc("mc3", { created: T0 + 30, status: "resolved", cols: { resolved_at: T0 + 40, resolved_by_user_id: "u_root" } });
  mc("mc4", { created: T0 + 40, type: "x_reapply", video: "missing-video", cols: { related_x_user_id: "ghost_x", locked_until: now + 60 } });
  mc("mc5", { created: T0 + 50, type: "void", status: "rejected", cols: { due_at: now - 10 } });
  for (let i = 0; i < 105; i += 1) mc(`mcb${String(i).padStart(3, "0")}`, { created: T0 + 100 + i, type: "operator", cols: { due_at: now + 100 } });

  // User detail fixtures: audit rows (actor + target), interactions, request history.
  const audit = (id, o) =>
    ins("audit_logs", { id, table_name: o.table ?? "user", target_id: o.target ?? "u_alice", operation: o.op ?? "UPDATE", actor_user_id: o.actor ?? "u_root", created_at: o.created, before_json: '{"secret":"x"}', after_json: '{"secret":"y"}' });
  for (let i = 0; i < 20; i += 1) audit(`au-on-${i}`, { target: "u_alice", created: T0 + 100 + i });
  for (let i = 0; i < 20; i += 1) audit(`au-by-${i}`, { actor: "u_alice", target: `rec-${i}`, table: "events", op: "CREATE", created: T0 + 300 + i });
  for (let i = 0; i < 3; i += 1) ins("video_interactions", { x_user_id: " ALICE_X ", video_id: `va${i + 1}`, interaction_type: "like", created_at: T0 });
  ins("video_interactions", { x_user_id: " ALICE_X ", video_id: "va1", interaction_type: "bookmark", created_at: T0 });
  ins("video_interactions", { x_user_id: "alice_x", video_id: "va2", interaction_type: "bookmark", created_at: T0 });
  ins("video_interactions", { x_user_id: "alice_x", video_id: "va2", interaction_type: "like", created_at: T0 });
  ins("video_interactions", { x_user_id: "alice_x", video_id: "va3", interaction_type: "bookmark", created_at: T0 });
  sqlite.exec(`UPDATE videos SET submitted_by_user_id = 'u_alice' WHERE id IN (SELECT id FROM videos WHERE creator_x_user_id = 'alice_x' LIMIT 25)`);
}
