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

  // review summaries: stage-permission questions (active/inactive, >24 chars answer) and required questions
  const q = (id, event, key, o = {}) => ins("event_custom_questions", { id, event_id: event, question_key: key, label: o.label ?? `Label ${key}`, required: o.required ?? 0, sort_order: o.sort ?? 0, is_active: o.active ?? 1 });
  q("q1", "a-open", "stage_permission", { required: 1, sort: 0, label: "Stage use" });
  q("q2", "a-open", "stage_permission_2", { sort: 1 });
  q("q3", "a-open", "req_q", { required: 1, sort: 2 });
  q("q4", "a-ended", "stage_permission", { active: 0 });
  q("q5", "a-ended", "req_q2", { required: 1 });
  const ans = (video, event, question, o) => ins("video_custom_answers", { video_id: video, event_id: event, question_id: question, answer_text: o.text ?? null, answer_json: o.json ?? null });
  ans("av-pending-1", "a-open", "q1", { text: "OK to use everything on stage, including long text over twenty-four characters" });
  ans("av-pending-1", "a-open", "q3", { json: "[]" });
  ans("av-private", "a-open", "q1", { text: "short ok" });
  ans("av-private", "a-open", "q3", { text: "yes" });
  ans("av-pending-2", "a-ended", "q4", { text: "ignored (inactive)" });

  // Video review detail members, chapters and software (MIG-0635)
  ins("video_members", { id: "vm-1", video_id: "av-pending-1", name: "Member One", role: "Director", x_user_id: "alice_x", is_public_member: 1, order_index: 0, can_edit: 1, comment: "c1" });
  ins("video_members", { id: "vm-2", video_id: "av-pending-1", name: "Member Two", role: "Illustrator", x_user_id: "orph_x", is_public_member: 1, order_index: 1, can_edit: 0, comment: "c2" });
  ins("video_members", { id: "vm-hidden", video_id: "av-pending-1", name: "Hidden Member", role: "Editor", x_user_id: null, is_public_member: 0, order_index: 2, can_edit: 1, comment: "secret" });

  ins("video_chapters", { id: "vm-1:member:ch1", video_id: "av-pending-1", chapter_time: 125, chapter_label: "Intro", note: "intro note", x_user_id: "alice_x", created_at: T0, updated_at: T0 });
  ins("video_chapters", { id: "vm-1:legacy:ch2", video_id: "av-pending-1", chapter_time: 250, chapter_label: "Climax", note: "climax note", x_user_id: "alice_x", created_at: T0, updated_at: T0 });
  ins("video_chapters", { id: "vm-2:member:ch3", video_id: "av-pending-1", chapter_time: 300, chapter_label: "Outro", note: "", x_user_id: "orph_x", created_at: T0, updated_at: T0 });


  // Video with > 100 members to test 404 overflow (MIG-0635)
  av("av-overflow", { vis: "public", title: "Overflow Video" });
  for (let i = 0; i < 101; i += 1) {
    ins("video_members", { id: `vm-ov-${i}`, video_id: "av-overflow", name: `Member ${i}`, is_public_member: 1, order_index: i, can_edit: 0 });
  }

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

  // event groups
  const eg = (id, o) => ins("event_groups", { id, name: o.name, slug: id, group_type: o.type ?? "series", visibility_status: o.vis ?? "public", sort_order: o.sort ?? 0, description: o.desc ?? null, updated_at: T0 + 40000 });
  eg("eg1", { name: "Alpha", sort: 1 });
  eg("eg2", { name: "Beta", sort: 1, type: "genre", vis: "private" });
  eg("eg3", { name: "Gamma", sort: 0, type: "other", vis: "archived", desc: "d" });
  eg("eg-empty", { name: "Empty", sort: 5 });
  for (const [ev, i] of [["ev1", 0], ["ev2", 1], ["a-open", 2], ["a-ended", 3]]) ins("event_group_events", { event_group_id: "eg1", event_id: ev });
  ins("event_group_events", { event_group_id: "eg2", event_id: "ev1" });

  // event templates (admin templates + new-event pages).
  for (let i = 0; i < 4; i += 1) {
    ins("event_templates", { id: `tpl${i}`, name: `Template ${i}`, description: i % 2 ? null : `desc ${i}`, source_event_id: i === 0 ? "ev1" : null, settings_json: `{"event_type":"event","n":${i}}`, created_by_user_id: "u_root", updated_at: T0 + 30000 + i });
  }
  ins("event_templates", { id: "tpl-big", name: "Big", description: null, source_event_id: null, settings_json: JSON.stringify({ pad: "x".repeat(70_000) }), created_by_user_id: "u_root", updated_at: T0 + 30010 });

  // x-id-merges: merge requests in every state (snapshot / no snapshot), reverts, and rows the impact counts touch.
  const mg = (id, o) =>
    ins("x_identity_requests", { id, request_type: "merge", requested_by_auth_user_id: "u_root", source_x_user_id: o.source, target_x_user_id: o.target, status: o.status ?? "pending", requested_at: o.at, updated_at: o.at, restore_snapshot_json: o.snap ?? null, revert_deadline_at: o.deadline ?? null, parent_request_id: o.parent ?? null });
  mg("mg1", { source: "alice_x", target: "alice_y", at: T0 + 20000, snap: '{"a":1}', deadline: T0 + 99 });
  mg("mg2", { source: "orph_x", target: "ghost_target", status: "approved", at: T0 + 20001 });
  mg("mg3", { source: "alice_y", target: "alice_x", status: "done", at: T0 + 20002, snap: '{"b":2}', deadline: Math.floor(Date.now() / 1000) + 3600 });
  mg("mg4", { source: "ic_ext", target: "ic_int", status: "rejected", at: T0 + 20003 });
  for (let i = 0; i < 55; i += 1) mg(`mgb${i}`, { source: "bulk_x00", target: "bulk_x01", at: T0 + 10000 + i });
  const rv = (id, o) =>
    ins("x_identity_requests", { id, request_type: "revert_merge", requested_by_auth_user_id: "u_root", parent_request_id: o.parent, status: o.status ?? "pending", requested_at: o.at, updated_at: o.at, restore_snapshot_json: o.snap ?? null, revert_deadline_at: o.deadline ?? null });
  rv("rv1", { parent: "mg3", at: T0 + 21000, snap: '{"c":3}', deadline: Math.floor(Date.now() / 1000) + 3600 });
  rv("rv2", { parent: "mg3", at: T0 + 21001, status: "done" });
  rv("rv3", { parent: "mg1", at: T0 + 21002, snap: '{"d":4}', deadline: T0 });
  for (let i = 0; i < 102; i += 1) rv(`rvb${i}`, { parent: "mg1", at: T0 + 22000 + i });
  ins("slots", { id: "s-merge-snap", event_id: "ev1", status: "reserved", sort_order: 0, video_id: "va4", reserved_x_id_snapshot: " @Alice_X " });
  ins("slots", { id: "s-merge-x", event_id: "ev1", status: "reserved", sort_order: 0, video_id: "va5", x_user_id: "alice_x" });
  ins("video_moderation_cases", { id: "mc-merge", video_id: "va6", case_type: "duplicate", status: "open", created_at: T0, related_x_user_id: "alice_x" });

  // x-link-requests: pending of each type, '@'/case/space variants, legacy-cased x_users id, internal/external icons.
  ins("x_users", { id: "ic_int", x_name: "Internal icon", icon_url: "/api/media/xicons/ic_int.png", approval_status: "approved" });
  ins("x_users", { id: "ic_pend", x_name: "Pending icon", icon_url: "/api/media/xicons/ic_pend.png", approval_status: "pending" });
  ins("x_users", { id: "ic_ext", x_name: "External icon", icon_url: "https://pbs.example.test/ic_ext.png", approval_status: "approved" });
  ins("x_users", { id: "ic_bad", x_name: "Bad ns", icon_url: "/api/media/video-icons/x.png", approval_status: "approved" });
  ins("x_users", { id: " Legacy_X ", x_name: "Legacy cased", icon_url: null, approval_status: "approved" });
  const xr = (id, o) =>
    ins("x_identity_requests", { id, request_type: o.type ?? "new_link", requested_by_auth_user_id: o.by ?? "u_alice", requested_x_id: o.x ?? null, source_x_user_id: o.source ?? null, target_x_user_id: o.target ?? null, status: o.status ?? "pending", requested_at: o.at, updated_at: o.at });
  xr("xl1", { x: "@IC_INT ", at: T0 + 90000 });
  xr("xl2", { x: "ic_pend", type: "existing_link", target: "ic_ext", at: T0 + 90001 });
  xr("xl3", { x: "legacy_x", type: "alias", target: "ic_bad", at: T0 + 90002, by: "u_ghost2" });
  xr("xl4", { x: "nobody", at: T0 + 90003 });
  xr("xl5", { x: "   ", at: T0 + 90004 });
  xr("xl-merge", { type: "merge", source: "ic_ext", target: "ic_int", at: T0 + 90005 });
  for (let i = 0; i < 105; i += 1) xr(`xlb${i}`, { x: `bulk_x${String(i % 60).padStart(2, "0")}`, at: T0 + 6000 + i });
  for (let i = 0; i < 12; i += 1) xr(`xrej${i}`, { x: `rej${i}`, status: "rejected", ...(i % 4 === 3 ? { type: "merge", source: "ic_ext", target: "ic_int" } : {}), at: T0 + 7000 + i });
  const al = (id, table, o) => ins("audit_logs", { id, table_name: table, target_id: o.target ?? "t", operation: o.op ?? "UPDATE", actor_user_id: "u_root", created_at: o.at, before_json: o.before ?? null, after_json: o.after ?? null });
  al("al1", "x_users", { at: T0 + 8000, before: '{"approval_status":"pending","x_name":"a"}', after: '{"approval_status":"approved","x_name":"a"}' });
  al("al2", "x_identity_requests", { at: T0 + 8001, op: "CREATE", after: '{"id":"z","status":"pending"}' });
  al("al3", "x_user_account_links", { at: T0 + 8002, op: "DELETE", before: "not json", after: null });
  al("al4", "x_users", { at: T0 + 8003, op: "RESTORE", before: "{}", after: '{"a":1}' });
  al("al5", "events", { at: T0 + 8004, before: "{}", after: '{"a":1}' });
  al("al6", "x_users", { at: T0 + 8005, before: '{"k1":1,"k2":2,"k3":3,"k4":4,"k5":5,"k6":6,"k7":7,"k0":0}', after: '{"k1":2,"k2":3,"k3":4,"k4":5,"k5":6,"k6":7,"k7":8,"k0":1}' });
  for (let i = 0; i < 32; i += 1) al(`alb${i}`, "x_users", { at: T0 + 8100 + i, before: `{"n":${i}}`, after: `{"n":${i + 1}}` });
}
