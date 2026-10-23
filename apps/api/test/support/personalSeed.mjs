import { insert } from "./personalHarness.mjs";

const T0 = 1_700_000_000;
export const FUTURE = Date.now() + 3_600_000;

export const USERS = [
  "alice", // approved x (alice_x, alice_y) + pending/rejected/imported, active " ALICE_X "
  "bob", // tos accepted on an older major -> reaccept required
  "carol", // tos not accepted
  "dave", // only a rejected X
  "erin", // pending request, no linked X
  "frank", // two approved X, no active
  "gina", // accepted a later minor version -> reaccept not required
  "hank", // consent row on latest major only (no accepted_terms_version_id)
  "many", // 81 approved X ids
  "ivy", // single approved X, active unset -> auto-resolved
  "banned",
];

export function seed(sqlite) {
  const ins = (table, row) => insert(sqlite, table, row);

  // ---- terms: T1 old major, T2 latest major (published), T3 later minor
  ins("terms_versions", { id: "T1", version_label: "v1", body_markdown: "# Terms v1", status: "archived", severity: "major", published_at: 1000, created_by_user_id: "admin", updated_at: 1000 });
  ins("terms_versions", { id: "T2", version_label: "v2", body_markdown: "# Terms v2\n\n* a", status: "published", severity: "major", published_at: 2000, created_by_user_id: "admin", updated_at: 2000 });
  ins("terms_versions", { id: "T3", version_label: "v2.1", body_markdown: "# minor", status: "archived", severity: "minor", published_at: 3000, created_by_user_id: "admin", updated_at: 3000 });

  const userRows = {
    alice: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: " ALICE_X " },
    bob: { is_tos_accepted: 1, accepted_terms_version_id: "T1", active_x_user_id: null },
    carol: { is_tos_accepted: 0, accepted_terms_version_id: null, active_x_user_id: null },
    dave: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: "dave_r" },
    erin: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: null },
    frank: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: null },
    gina: { is_tos_accepted: 1, accepted_terms_version_id: "T3", active_x_user_id: null },
    hank: { is_tos_accepted: 1, accepted_terms_version_id: null, active_x_user_id: null },
    many: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: "many_0" },
    ivy: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: null },
    banned: { is_tos_accepted: 1, accepted_terms_version_id: "T2", active_x_user_id: null, is_banned: 1 },
  };
  for (const name of USERS) {
    ins("user", {
      id: `u_${name}`,
      name: name === "dave" ? null : `Name ${name}`,
      email: `${name}@example.test`,
      image: name === "bob" ? null : `https://img.test/${name}.png`,
      role: name === "carol" ? "admin" : "user",
      created_at: T0,
      ...userRows[name],
    });
    ins("session", { sessionToken: `tok-${name}`, userId: `u_${name}`, expires: FUTURE });
  }
  ins("session", { sessionToken: "tok-expired", userId: "u_alice", expires: Date.now() - 1000 });
  ins("user_tos_consents", { id: "c1", user_id: "u_bob", terms_version_id: "T1", consented_at: 1500, consent_context: "entry" });
  ins("user_tos_consents", { id: "c2", user_id: "u_hank", terms_version_id: "T2", consented_at: 2500, consent_context: "entry" });

  // ---- X users and links
  const xUser = (id, status, extra = {}) =>
    ins("x_users", { id, x_name: `X ${id}`, icon_url: `https://x.test/${id}.png`, approval_status: status, ...extra });
  const link = (xId, userName, createdAt = T0, reqId = null) =>
    ins("x_user_account_links", { x_user_id: xId, auth_user_id: `u_${userName}`, link_role: "owner", created_by_request_id: reqId, created_at: createdAt, updated_at: createdAt });

  xUser("alice_x", "approved", { youtube_channel_url: "https://www.youtube.com/@alicex", profile_text: "hello", portfolio_contact: "portfolio_contact", other_social_links: "[]" });
  xUser("alice_y", "approved", { portfolio_contact: " contact@example.test " });
  xUser("alice_p", "pending");
  xUser("alice_r", "rejected");
  xUser("alice_i", "imported");
  for (const id of ["alice_x", "alice_y", "alice_p", "alice_r", "alice_i"]) link(id, "alice", T0 + 5, id === "alice_p" ? "req-p" : null);
  xUser("dave_r", "rejected");
  link("dave_r", "dave");
  xUser("frank_a", "approved");
  xUser("frank_b", "approved");
  link("frank_a", "frank");
  link("frank_b", "frank");
  xUser("ivy_x", "approved");
  link("ivy_x", "ivy");
  xUser("zed", "approved", { youtube_channel_url: "https://www.youtube.com/@zed" });
  for (let i = 0; i < 81; i += 1) {
    xUser(`many_${i}`, "approved");
    link(`many_${i}`, "many");
  }

  // ---- x_identity_requests
  const request = (id, user, status, type, xId, at) =>
    ins("x_identity_requests", { id, request_type: type, requested_by_auth_user_id: `u_${user}`, requested_x_id: xId, status, requested_at: at, updated_at: at });
  request("req-p", "alice", "pending", "new_link", "alice_p", T0 + 100);
  request("req-old", "alice", "approved", "new_link", "alice_x", T0 + 1);
  ins("x_identity_requests", { id: "req-m", request_type: "merge", requested_by_auth_user_id: "u_alice", source_x_user_id: "alice_y", target_x_user_id: "alice_x", status: "pending", requested_at: T0 + 200, updated_at: T0 + 200 });
  request("req-erin1", "erin", "pending", "new_link", "erin_old", T0 + 10);
  request("req-erin2", "erin", "pending", "existing_link", "erin_new", T0 + 20);
  request("req-erin3", "erin", "rejected", "new_link", "erin_rej", T0 + 30);
  for (let i = 0; i < 55; i += 1) request(`req-bulk-${i}`, "carol", "done", "alias", `c${i}`, T0 + 1000 + i);

  // ---- events and slots
  ins("events", { id: "ev1", title: "Event One", accent_color: "#ff8800" });
  ins("events", { id: "ev2", title: "Event Two", accent_color: " " });
  ins("events", { id: "PVSFSummary", title: "Summary" });
  const slot = (id, o) => ins("slots", { id, event_id: "ev1", status: "reserved", sort_order: 0, ...o });
  slot("s-other", { reserved_by_user_id: "u_zed_user", start_time: T0 });
  slot("s-avail", { reserved_by_user_id: "u_alice", status: "available", start_time: T0 - 500 });
  slot("s-notime", { reserved_by_user_id: "u_alice", x_user_id: null, status: "reserved", start_time: null, slot_label: "no time" });
  slot("s-late", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", status: "reserved", start_time: T0 + 9000 });
  slot("s-early-other-x", { reserved_by_user_id: "u_alice", x_user_id: "alice_y", status: "reserved", start_time: T0 - 9000 });
  slot("s-early", { reserved_by_user_id: "u_alice", x_user_id: null, event_id: "ev2", status: "submitted", start_time: T0 + 10, video_id: "va1", sort_order: 1 });
  slot("s-erin", { reserved_by_user_id: "u_erin", x_user_id: null, event_id: "missing-event", start_time: T0 });
  slot("s-bob", { reserved_by_user_id: "u_bob", x_user_id: "bob_x", start_time: T0 });

  // ---- videos
  let n = 0;
  const video = (id, o = {}) => {
    n += 1;
    ins("videos", {
      id,
      title: `Title ${id}`,
      submitted_by_user_id: "u_zed_user",
      creator_display_name: o.name ?? `Name ${id}`,
      creator_x_user_id: o.creator ?? null,
      creator_icon_url: o.icon === undefined ? `https://ic.test/${id}.png` : o.icon,
      creator_youtube_channel_url: o.channel ?? null,
      youtube_video_id: o.yt === undefined ? `yt${id}` : o.yt,
      visibility_status: o.vis ?? "public",
      primary_event_id: o.event ?? null,
      scheduled_time: o.sched === undefined ? T0 + n : o.sched,
      created_at: o.created ?? T0 + n * 10,
      app_like_count: o.likes ?? 0,
    });
  };
  // alice_x: 11 videos (>8 so hasMore), one voided, one private, mixed events and likes
  for (let i = 1; i <= 11; i += 1) video(`va${i}`, { creator: "alice_x", likes: i, event: i % 3 === 0 ? "ev1" : null, created: T0 + 100 + i });
  video("va-voided", { creator: "alice_x", vis: "voided", likes: 100, created: T0 + 500 });
  video("va-private", { creator: "alice_x", vis: "private", likes: 5, created: T0 + 501 });
  video("va-pvsf", { creator: "alice_x", likes: 1000, event: "PVSFSummary", created: T0 + 502 });
  video("va-pvsf2", { creator: "alice_x", likes: 1000, created: T0 + 503 });
  ins("video_events", { video_id: "va-pvsf2", event_id: "PVSFSummary" });
  ins("video_events", { video_id: "va1", event_id: "ev2" });
  ins("video_events", { video_id: "va2", event_id: "ev1" });
  ins("video_events", { video_id: "va4", event_id: "ev3" });
  video("va-tie1", { creator: "alice_x", created: T0 + 300 });
  video("va-tie2", { creator: "alice_x", created: T0 + 300 });
  // alice_y own video
  for (let i = 1; i <= 3; i += 1) video(`vy${i}`, { creator: "alice_y", likes: 2, created: T0 + 200 + i });
  // others' videos where alice_x / alice_y are editors
  for (let i = 1; i <= 30; i += 1) video(`vc${i}`, { creator: i % 4 === 0 ? null : "zed", created: T0 + 1000 + i, icon: i % 5 === 0 ? null : undefined, name: i % 6 === 0 ? " " : undefined });
  video("vc-voided", { creator: "zed", vis: "voided", created: T0 + 2000 });
  video("vc-private", { creator: "zed", vis: "private", created: T0 + 2001 });
  const member = (id, videoId, xId, canEdit = 1) =>
    ins("video_members", { id, video_id: videoId, x_user_id: xId, name: `m-${id}`, can_edit: canEdit, order_index: 0 });
  for (let i = 1; i <= 30; i += 1) member(`mc${i}`, `vc${i}`, i % 2 ? "alice_x" : "alice_y");
  member("mc-dup", "vc1", "alice_y"); // second membership -> DISTINCT must collapse the row
  member("mc-noedit", "vc2", "alice_x", 0);
  member("mc-pending-x", "vc3", "alice_p"); // not approved -> not an editor
  member("mc-own", "va1", "alice_y"); // creator alice_x is approved too -> excluded
  member("mc-voided", "vc-voided", "alice_x");
  member("mc-private", "vc-private", "alice_x");
  member("mc-noscope", "vc4", "zed");
  // interactions for alice: 30 public likes, bookmarks, private/voided hidden
  for (let i = 1; i <= 30; i += 1) {
    ins("video_interactions_auth", { auth_user_id: "u_alice", video_id: `vc${i}`, interaction_type: "like", created_at: T0 + i });
  }
  for (const id of ["va1", "va2", "vc-private", "vc-voided"]) {
    ins("video_interactions_auth", { auth_user_id: "u_alice", video_id: id, interaction_type: "bookmark", created_at: T0 + 50 });
  }
  ins("video_interactions_auth", { auth_user_id: "u_alice", video_id: "va-private", interaction_type: "like", created_at: T0 + 60 });
  ins("video_interactions_auth", { auth_user_id: "u_alice", video_id: "vc-voided", interaction_type: "like", created_at: T0 + 61 });
  ins("video_interactions_auth", { auth_user_id: "u_bob", video_id: "va1", interaction_type: "bookmark", created_at: T0 });
  ins("video_interactions_auth", { auth_user_id: "u_frank", video_id: "va1", interaction_type: "like", created_at: T0 });
  // view counts
  for (let i = 1; i <= 11; i += 1) ins("video_youtube_metadata", { video_id: `va${i}`, view_count: i * 10, updated_at: T0 });
  ins("video_youtube_metadata", { video_id: "vy1", view_count: 7, updated_at: T0 });
  ins("video_youtube_metadata", { video_id: "va-voided", view_count: 9999, updated_at: T0 });

  // ---- chapters (alice_x, alice_y, zed), one on a deleted video
  for (let i = 1; i <= 30; i += 1) {
    ins("video_chapters", {
      id: `ch${i}`,
      video_id: i === 5 ? "gone-video" : `va${(i % 11) + 1}`,
      x_user_id: i % 3 === 0 ? "alice_y" : i % 3 === 1 ? "alice_x" : "zed",
      chapter_time: i + 0.5,
      chapter_label: `label ${i}`,
      visibility: i % 4 === 0 ? "private" : "public",
      created_at: T0 + (i % 7) * 10,
      updated_at: T0,
    });
  }
  // many: videos for first and last ids
  video("vm0", { creator: "many_0", created: T0 + 3000, likes: 4 });
  video("vm80", { creator: "many_80", created: T0 + 3001, likes: 6, event: "ev1" });
  video("vm-pending", { creator: "alice_p", created: T0 + 3002 });
  video("vf1", { creator: "frank_a", created: T0 + 3003 });
  video("vi1", { creator: "ivy_x", created: T0 + 3004 });
  ins("video_chapters", { id: "ch-many", video_id: "vm0", x_user_id: "many_80", chapter_time: 1, chapter_label: "m", visibility: "public", created_at: T0, updated_at: T0 });

  // icon / channel candidates for alice_x (duplicates and a non-channel URL)
  video("vcand1", { creator: "alice_x", icon: "https://ic.test/dup.png", channel: "https://youtube.com/@alicex/", created: T0 + 4000 });
  video("vcand2", { creator: "alice_x", icon: "https://ic.test/dup.png", channel: "https://example.com/not-youtube", created: T0 + 4001 });
  video("vcand3", { creator: "ALICE_X", icon: null, channel: "https://m.youtube.com/channel/UC123", created: T0 + 4002 });
  video("vcand4", { creator: "alice_x", vis: "private", icon: "https://ic.test/private.png", channel: "ftp://bad", created: T0 + 4003 });
}
