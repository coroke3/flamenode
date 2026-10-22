import { insert } from "./personalHarness.mjs";

export const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
export const FUTURE_MS = Date.now() + 3_600_000;

// name -> role. Every user has a session token `tok-<name>`.
export const USERS = {
  admin: "admin",
  owner: "user", // owner of evA
  mgr: "user", // manager of evA, reviewer of evB (two staff rows)
  rev: "user", // reviewer of evA (no event.slots / event.members)
  slot: "user", // slot_manager of evB only
  custom: "user", // custom preset on evA: legacy key videos.title + xid.link_requests
  removed: "user", // linked approved X but no staff row any more
  pending: "user", // owner row exists but the X account is still pending approval
  plain: "user", // no X at all
  banned: "user", // owner of evA but banned
  pubstaff: "user", // public_staff preset only (no permissions)
  two: "user", // two approved X: x1 = manager evA (active), x2 = owner evA
  ghost: "user", // staff row of an event that does not exist
  outsider: "user", // owner of evC only (IDOR peer)
  many: "user", // staff of 101 events
};

export function seed(sqlite) {
  const ins = (table, row) => insert(sqlite, table, row);
  const xLinks = {
    owner: [["owner_x", "approved"]],
    mgr: [["mgr_x", "approved"]],
    rev: [["rev_x", "approved"]],
    slot: [["slot_x", "approved"]],
    custom: [["custom_x", "approved"]],
    removed: [["removed_x", "approved"]],
    pending: [["pending_x", "pending"]],
    banned: [["banned_x", "approved"]],
    pubstaff: [["pubstaff_x", "approved"]],
    two: [["two_x1", "approved"], ["two_x2", "approved"]],
    ghost: [["ghost_x", "approved"]],
    outsider: [["outsider_x", "approved"]],
    many: [["many_x", "approved"]],
  };
  for (const [name, role] of Object.entries(USERS)) {
    ins("user", {
      id: `u_${name}`,
      name: `Name ${name}`,
      email: `${name}@example.test`,
      image: null,
      role,
      created_at: NOW,
      is_banned: name === "banned" ? 1 : 0,
      active_x_user_id: name === "two" ? " TWO_X1 " : name === "owner" ? "other_x" : null,
      discord_id: `d_${name}`,
    });
    ins("session", { sessionToken: `tok-${name}`, userId: `u_${name}`, expires: FUTURE_MS });
  }
  ins("session", { sessionToken: "tok-expired", userId: "u_owner", expires: Date.now() - 1000 });
  for (const [name, list] of Object.entries(xLinks)) {
    for (const [xId, status] of list) {
      ins("x_users", { id: xId, x_name: `X ${xId}`, icon_url: xId === "owner_x" ? "https://x.test/o.png" : xId === "mgr_x" ? "/api/media/xicons/mgr.png" : null, approval_status: status });
      ins("x_user_account_links", { x_user_id: xId, auth_user_id: `u_${name}`, link_role: "owner", created_at: NOW, updated_at: NOW });
    }
  }

  const event = (id, o = {}) =>
    ins("events", {
      id,
      title: `Event ${id}`,
      visibility_status: "public",
      accent_color: "#ff8800",
      start_time: NOW - DAY,
      end_time: NOW + DAY,
      entry_start_time: NOW - DAY,
      entry_end_time: NOW + DAY,
      created_at: NOW - 10 * DAY,
      slot_part_gap_minutes: 10,
      parts_json: JSON.stringify([" Part A ", "", 5, "Part B"]),
      ...o,
    });
  event("evA");
  event("evB", { visibility_status: "private", start_time: NOW + 5 * DAY, end_time: NOW + 6 * DAY, entry_start_time: null, entry_end_time: null, slot_part_gap_minutes: null, parts_json: "not json" });
  event("evC", { start_time: NOW + 3 * DAY, end_time: NOW + 4 * DAY, entry_start_time: NOW + 2 * DAY, entry_end_time: NOW + 3 * DAY, accent_color: null });
  event("evD", { start_time: NOW - 9 * DAY, end_time: NOW - 8 * DAY, entry_start_time: null, entry_end_time: null });
  event("evNull", { start_time: null, end_time: null, entry_start_time: null, entry_end_time: null });
  event("evPoint", { start_time: NOW - 2 * DAY, end_time: null, entry_start_time: NOW - DAY, entry_end_time: null });
  event("evTie1", { start_time: NOW + 7 * DAY, end_time: NOW + 8 * DAY, entry_start_time: null, entry_end_time: null });
  event("evTie2", { start_time: NOW + 7 * DAY, end_time: NOW + 8 * DAY, entry_start_time: null, entry_end_time: null });
  for (let i = 0; i < 101; i += 1) event(`evMany${String(i).padStart(3, "0")}`, { start_time: NOW - (i + 20) * DAY, end_time: NOW - (i + 19) * DAY, entry_start_time: null, entry_end_time: null });

  let staffN = 0;
  const staff = (eventId, xId, preset, o = {}) => {
    staffN += 1;
    ins("event_staff", {
      id: `st${staffN}`,
      event_id: eventId,
      x_user_id: xId,
      display_name: o.name ?? `Staff ${staffN}`,
      permission_preset: preset,
      custom_permission_keys_json: o.custom ?? null,
      is_public: o.pub ?? 0,
      public_role_label: o.label ?? null,
      created_at: NOW,
      updated_at: NOW,
    });
  };
  staff("evA", "owner_x", "owner", { name: "Zed owner", pub: 1, label: "Producer" });
  staff("evA", "mgr_x", "manager", { name: "Mgr", pub: 1 });
  staff("evB", "mgr_x", "reviewer", { name: "Mgr on B" });
  staff("evA", "rev_x", "reviewer", { name: "Rev" });
  staff("evB", "slot_x", "slot_manager", { name: "Slot" });
  staff("evA", "custom_x", "custom", { name: "Custom", custom: JSON.stringify(["videos.title", "xid.link_requests", 7, "bogus.key"]) });
  staff("evA", "pending_x", "owner", { name: "Pending" });
  staff("evA", "banned_x", "owner", { name: "Banned" });
  staff("evA", "pubstaff_x", "public_staff", { name: "Pub" });
  staff("evA", "two_x1", "manager", { name: "Two1" });
  staff("evA", "two_x2", "owner", { name: "Two2" });
  staff("evC", "two_x2", "reviewer", { name: "Two2 C" });
  staff("missingEvent", "ghost_x", "owner", { name: "Ghost" });
  staff("evC", "outsider_x", "owner", { name: "Outsider" });
  staff("evA", "removed_x_gone", "owner", { name: "Not linked to anyone" });
  staff("evD", "owner_x", "custom", { name: "Broken custom", custom: "{not json" });
  staff("evTie1", "mgr_x", "public_staff", { name: "No perms" });
  for (let i = 0; i < 101; i += 1) staff(`evMany${String(i).padStart(3, "0")}`, "many_x", "manager", { name: `Many ${i}` });

  // pending reviews
  const video = (id, status) => ins("videos", { id, title: `V ${id}`, submitted_by_user_id: "u_plain", creator_display_name: `C ${id}`, visibility_status: status, created_at: NOW });
  video("v1", "pending");
  video("v2", "pending");
  video("v3", "public");
  video("v4", "pending");
  video("v5", "voided");
  ins("video_events", { video_id: "v1", event_id: "evA" });
  ins("video_events", { video_id: "v2", event_id: "evA" });
  ins("video_events", { video_id: "v3", event_id: "evA" });
  ins("video_events", { video_id: "v4", event_id: "evB" });
  ins("video_events", { video_id: "v5", event_id: "evB" });

  // inbox (audit_logs) and notifications
  for (let i = 0; i < 25; i += 1) {
    ins("audit_logs", {
      id: `al${i}`,
      table_name: "events",
      target_id: i % 5 === 0 ? "evB" : i % 7 === 0 ? "evC" : "evA",
      operation: i % 3 === 0 ? "UPDATE" : i % 3 === 1 ? "CREATE" : "DELETE",
      actor_user_id: i % 2 ? "u_admin" : "u_owner",
      created_at: NOW - 1000 + i,
    });
  }
  ins("audit_logs", { id: "al-other-table", table_name: "videos", target_id: "evA", operation: "UPDATE", actor_user_id: "u_admin", created_at: NOW });
  for (let i = 0; i < 25; i += 1) {
    ins("notification_outbox", {
      id: `n${i}`,
      type: i % 2 ? "video_posted" : "slot_reserved",
      payload_json: JSON.stringify({ i }),
      status: i % 4 === 0 ? "failed" : "sent",
      attempt_count: i,
      last_error: i % 4 === 0 ? "boom" : null,
      event_id: i % 5 === 0 ? "evB" : i % 7 === 0 ? "evC" : "evA",
      recipient_user_id: "u_owner",
      dedupe_key: `dk${i}`,
      lease_token: `secret-${i}`,
      created_at: NOW - 2000 + i,
    });
  }
  ins("notification_outbox", { id: "n-global", type: "x", payload_json: "{}", status: "failed", event_id: null, created_at: NOW });

  // X link requests: icons (external, none -> video fallback, empty, internal approved/pending), legacy casing, targets
  const xu = (id, status, icon) => ins("x_users", { id, x_name: `Req ${id}`, icon_url: icon, approval_status: status });
  xu("req_a", "approved", "https://x.test/a.png");
  xu("req_b", "pending", null);
  xu("req_c", "approved", "");
  xu("req_i", "approved", "/api/media/xicons/i.png");
  xu("req_p", "pending", "/api/media/xicons/p.png");
  xu(" LegacyD ", "approved", "https://x.test/legacy.png");
  const v = (id, creator, icon, createdAt) =>
    ins("videos", { id, title: id, submitted_by_user_id: "u_plain", creator_display_name: id, creator_x_user_id: creator, creator_icon_url: icon, visibility_status: "public", created_at: createdAt });
  v("vi1", "req_b", "https://v.test/old.png", NOW - 500);
  v("vi2", "req_b", "https://v.test/new.png", NOW - 100);
  v("vi3", "req_b", "", NOW - 50);
  v("vi4", " ReqLegacyV ", "https://v.test/legacyv.png", NOW - 10);
  const xr = (id, type, requested, target, status, at) =>
    ins("x_identity_requests", { id, request_type: type, requested_by_auth_user_id: "u_plain", requested_x_id: requested, target_x_user_id: target, status, requested_at: at, updated_at: at });
  xr("xr1", "new_link", "@Req_A", null, "pending", NOW + 1);
  xr("xr2", "existing_link", "req_b", "req_a", "pending", NOW + 2);
  xr("xr3", "new_link", "req_c", "REQ_I", "pending", NOW + 3);
  xr("xr4", "existing_link", "legacyd", "req_p", "pending", NOW + 4);
  xr("xr5", "new_link", "reqlegacyv", "nobody", "pending", NOW + 5);
  xr("xr7", "new_link", "req_a", null, "approved", NOW + 7);
  for (let i = 0; i < 105; i += 1) xr(`xrbulk${i}`, "new_link", `bulk${i}`, null, "pending", NOW - 1000 + i);

  // youtube playlist sync: evA synced (one public video with a playlist item), evC failed, evB has no config row
  ins("event_youtube_playlist_sync", { event_id: "evA", playlist_id: "PL1", enabled: 1, sync_mode: "all", sync_interval_minutes: 60, sync_status: "synced", next_sync_at: NOW + 1000, last_synced_at: NOW - 10, last_full_scan_at: NOW - 20 });
  ins("event_youtube_playlist_sync", { event_id: "evC", playlist_id: "PL2", enabled: 1, sync_mode: "all", sync_status: "failed", last_error: "boom" });
  ins("event_youtube_playlist_sync", { event_id: "evD", enabled: 0 });
  ins("event_youtube_playlist_items", { event_id: "evA", playlist_item_id: "pi1", youtube_video_id: "yt-vi1", seen_at: NOW });
  ins("event_youtube_playlist_items", { event_id: "evA", playlist_item_id: "pi2", youtube_video_id: "yt-v3", seen_at: NOW });
  ins("videos", { id: "vyt1", title: "yt1", submitted_by_user_id: "u_plain", creator_display_name: "c", youtube_video_id: "yt-vi1", visibility_status: "public", created_at: NOW });
  ins("videos", { id: "vyt2", title: "yt2", submitted_by_user_id: "u_plain", creator_display_name: "c", youtube_video_id: "yt-v3", visibility_status: "pending", created_at: NOW });
  ins("video_events", { video_id: "vyt1", event_id: "evA" });
  ins("video_events", { video_id: "vyt2", event_id: "evA" });

  // slots: evA has 130 rows (paging, ties), evB a few, evC some
  ins("user", { id: "u_slotter", name: "Slotter", email: "slotter@example.test", role: "user", created_at: NOW, discord_id: "d_slotter" });
  for (let i = 0; i < 130; i += 1) {
    ins("slots", {
      id: `sA${String(i).padStart(3, "0")}`,
      event_id: "evA",
      status: i % 3 === 0 ? "available" : i % 3 === 1 ? "reserved" : "submitted",
      start_time: i % 10 === 0 ? null : NOW + Math.floor(i / 2) * 60,
      sort_order: i % 2,
      slot_label: i % 4 === 0 ? `Label ${i}` : null,
      display_name: i % 3 === 0 ? null : `Name ${i}`,
      x_user_id: i % 3 === 1 ? "owner_x" : null,
      reserved_by_user_id: i % 3 === 0 ? null : "u_slotter",
      video_id: i % 3 === 2 ? "v3" : null,
      reservation_group_id: i % 6 === 1 ? "grp1" : null,
      updated_at: NOW,
      version: 1 + (i % 4),
    });
  }
  ins("slots", { id: "sAsnap1", event_id: "evA", status: "submitted", start_time: NOW, sort_order: 0, x_user_id: "owner_x", reserved_x_id_snapshot: "req_a", updated_at: NOW });
  ins("slots", { id: "sAsnap2", event_id: "evA", status: "reserved", start_time: NOW, sort_order: 0, reserved_x_id_snapshot: "ghost_snapshot", updated_at: NOW });
  ins("slots", { id: "sAblank", event_id: "evA", status: "reserved", start_time: NOW, sort_order: 0, reserved_x_id_snapshot: "  ", updated_at: NOW });
  for (const id of ["vi1", "vi2", "vi3"]) ins("video_events", { video_id: id, event_id: "evA" });
  ins("video_events", { video_id: "vi4", event_id: "evA" });
  for (let i = 0; i < 4; i += 1) ins("slots", { id: `sB${i}`, event_id: "evB", status: "reserved", start_time: NOW + i, sort_order: 0, reserved_by_user_id: "u_removed", updated_at: NOW });
  ins("slots", { id: "sC0", event_id: "evC", status: "available", start_time: NOW, sort_order: 0, updated_at: NOW });
}
