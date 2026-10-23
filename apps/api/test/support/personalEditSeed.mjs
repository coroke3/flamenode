import { insert } from "./personalHarness.mjs";

// MIG-0630: video-edit data layered on top of personalSeed.seed(). Users/X IDs come from personalSeed
// (alice = alice_x + alice_y, frank = frank_a + frank_b, ivy = ivy_x, carol = site admin, bob/erin = no approved X).
const T0 = 1_700_000_000;

export const EDIT_VIDEOS = [];
/** videos whose lists exceed the S2 bounds (tested separately, excluded from the equality matrix) */
export const BIG_VIDEOS = ["ed-many", "ed-bytes", "ed-huge-first", "ed-bigmember", "ed-bigcollab"];

export function seedEdit(sqlite) {
  const ins = (table, row) => insert(sqlite, table, row);
  sqlite
    .prepare("UPDATE system_settings SET default_editable_fields = ?, upcoming_editable_fields = ? WHERE id = 'default'")
    .run("title,part,display_name,music", "title,youtube_url,members,chapters,event_ids,is_collab");

  const event = (id, allow, keys) =>
    ins("events", { id, title: `Edit ${id}`, visibility_status: "public", allow_user_video_edits: allow, user_video_edit_permission_keys_json: keys });
  event("ee1", 1, '{"version":2,"fallback":"inherit","allow":["members","is_collab"],"deny":["title"],"inherit":["music"]}');
  event("ee2", 1, "title,part,music");
  event("ee3", 0, null);
  event("ee4", 1, "{broken");
  event("ee5", 1, '["youtube_url","event_ids","chapters"]');
  event("ee6", 0, null);
  event("ee7", 0, null);
  event("ee-nokey", 1, null);
  ins("events", { id: "ee-open", title: "Edit open", visibility_status: "public", entry_start_time: 1, entry_end_time: 4_000_000_000, allow_user_video_event_links: 1 });

  const video = (id, o = {}) => {
    EDIT_VIDEOS.push(id);
    ins("videos", {
      id,
      title: o.title ?? `Edit title ${id}`,
      submitted_by_user_id: "u_zed_user",
      creator_display_name: o.name ?? `Creator ${id}`,
      creator_x_user_id: o.creator ?? null,
      creator_icon_url: o.icon ?? null,
      creator_youtube_channel_url: o.channel ?? null,
      creator_profile_text: o.profile ?? null,
      creator_other_social_links: o.social ?? null,
      youtube_video_id: o.yt === undefined ? null : o.yt,
      visibility_status: o.vis ?? "public",
      primary_event_id: o.event ?? null,
      collaboration_type: o.collab ?? "individual",
      scheduling_type: o.scheduling ?? "slotted",
      source_type: o.source ?? "youtube",
      part: o.part ?? null,
      music: o.music ?? null,
      credit: o.credit ?? null,
      intro_comment: o.intro ?? null,
      created_at: T0,
      updated_at: o.updated ?? T0 + 7,
    });
    for (const eventId of o.events ?? []) ins("video_events", { video_id: id, event_id: eventId });
  };
  const member = (id, videoId, xId, o = {}) =>
    ins("video_members", {
      id,
      video_id: videoId,
      x_user_id: xId,
      name: o.name ?? `Member ${id}`,
      role: o.role ?? null,
      comment: o.comment ?? null,
      order_index: o.order ?? 0,
      can_edit: o.edit ?? 0,
      is_public_member: o.pub ?? 1,
    });
  const staff = (id, eventId, xId, preset, keys = null) =>
    ins("event_staff", { id, event_id: eventId, x_user_id: xId, display_name: `Staff ${id}`, permission_preset: preset, custom_permission_keys_json: keys });

  // owners / policies
  video("ed-own1", { creator: "alice_x", event: "ee1", events: ["ee1"], yt: null, part: "A", music: "song", name: "Alice", icon: "https://i.test/a.png", profile: "prof", social: "[]", channel: "https://www.youtube.com/@alice" });
  video("ed-own2", { creator: "alice_y", event: "ee2", events: ["ee2", "ee-open"], yt: " ytOWN2 ", intro: "hello" });
  video("ed-pending", { creator: "alice_x", vis: "pending", yt: null });
  video("ed-own-ee4", { creator: "alice_x", event: "ee4", events: ["ee4"], yt: "ytEE4" });
  video("ed-own-ee5", { creator: "alice_x", event: "ee5", events: ["ee5", "ee6"], yt: "ytEE5" });
  video("ed-own-ee3", { creator: "alice_x", event: "ee3", events: ["ee3"], yt: "ytEE3" });
  video("ed-own-nokey", { creator: "alice_x", event: "ee-nokey", yt: "ytNK" });
  video("ed-manual", { creator: "alice_x", scheduling: "manual", source: "external", yt: null });
  video("ed-voided", { creator: "alice_x", vis: "voided", yt: "ytVOID" });
  video("ed-dangling", { creator: "alice_x", event: "ee-missing", events: ["ee-gone"], yt: "ytDANG" });
  video("ed-ivy", { creator: "ivy_x", event: "ee2", yt: "ytIVY" });
  video("ed-frank", { creator: "frank_b", yt: "ytFRANK", event: "ee1" });

  // collab members / subjects (links + notifications)
  video("ed-collab", { creator: "zed", collab: "collab", event: "ee1", events: ["ee1"], yt: "ytCOLLAB" });
  member("c1", "ed-collab", "alice_x", { edit: 1, order: 0, role: "lead", comment: "c" });
  member("c2", "ed-collab", "alice_y", { edit: 0, order: 1 });
  member("c3", "ed-collab", "frank_a", { edit: 1, pub: 0, order: 2 });
  member("c4", "ed-collab", null, { edit: 0, order: 3 });
  member("c5", "ed-collab", "FRANK_B", { edit: 0, order: 4 });
  member("c6", "ed-collab", "zed", { edit: 0, pub: 0, order: 5 });
  member("c7", "ed-collab", "ivy_x", { edit: 0, order: 6, name: "Ivy public" });
  member("c8", "ed-collab", "ivy_x", { edit: 1, pub: 0, order: 7, name: "Ivy hidden" });
  member("c9", "ed-collab", " ", { edit: 1, pub: 0, order: 8 });
  member("c10", "ed-collab", "alice_p", { edit: 1, order: 9 });
  sqlite.exec("UPDATE \"user\" SET is_notification_enabled = 0 WHERE id = 'u_ivy'");
  video("ed-collab2", { creator: "alice_x", collab: "collab", event: "ee2", yt: "ytCO2" });
  member("d1", "ed-collab2", "frank_a", { edit: 0, order: 0 });
  member("d2", "ed-collab2", "frank_b", { edit: 0, order: 1 });
  video("ed-collab-noedit", { creator: "zed", collab: "collab", yt: "ytCNE" });
  member("e1", "ed-collab-noedit", "alice_x", { edit: 0 });
  member("e2", "ed-collab-noedit", "ivy_x", { edit: 0 });

  // event staff
  video("ed-staff", { creator: "zed", event: "ee1", events: ["ee1"], yt: "ytST" });
  staff("st1", "ee1", "frank_a", "content_editor");
  staff("st2", "ee1", "ivy_x", "custom", '["video.permissions","video.status"]');
  staff("st3", "ee1", "alice_p", "manager");
  video("ed-staff2", { creator: "zed", event: "ee3", events: ["ee3"], yt: "ytST2" });
  staff("st4", "ee3", "alice_y", "reviewer");
  staff("st5", "ee3", "frank_b", "public_staff");
  video("ed-multi", { creator: "zed", event: "ee1", events: ["ee1", "ee2", "ee3", "ee4", "ee5", "ee6", "ee7"], yt: "ytMULTI" });
  staff("st6", "ee2", "frank_a", "content_editor");
  staff("st7", "ee7", "frank_a", "manager");
  staff("st8", "ee5", "ivy_x", "owner");
  video("ed-none", { creator: "zed", yt: "ytNONE" });
  video("ed-null-creator", { creator: null, yt: "ytNC" });

  // software
  ins("software_catalog", { id: "sw1", name: "Blender", normalized_name: "blender" });
  ins("software_catalog", { id: "sw2", name: "AfterEffects", normalized_name: "aftereffects" });
  ins("software_catalog", { id: "sw3", name: "Blender", normalized_name: "blender2" });
  ins("video_softwares", { video_id: "ed-own1", software_id: "sw1", raw_label: "blender 4" });
  ins("video_softwares", { video_id: "ed-own1", software_id: "sw2", raw_label: "AE" });
  ins("video_softwares", { video_id: "ed-own1", software_id: "sw3", raw_label: "Blender" });

  // S2 bound videos
  video("ed-many", { creator: "alice_x", yt: "ytMANY" });
  for (let i = 0; i < 130; i += 1) member(`mm${String(i).padStart(3, "0")}`, "ed-many", `mx_${i}`, { order: i, name: `Many ${i}` });
  video("ed-bytes", { creator: "alice_x", yt: "ytBYTES" });
  for (let i = 0; i < 100; i += 1) member(`mb${String(i).padStart(3, "0")}`, "ed-bytes", null, { order: i, name: `Bytes ${i}`, comment: "あ".repeat(500) });
  video("ed-huge-first", { creator: "alice_x", yt: "ytHUGE", intro: "x".repeat(50_000) });
  member("mh1", "ed-huge-first", null, { comment: "y".repeat(20_000) });
  video("ed-bigmember", { creator: "alice_x", yt: "ytBIGM" });
  member("mg1", "ed-bigmember", null, { comment: "z".repeat(70_000) });
  video("ed-bigcollab", { creator: "alice_x", collab: "collab", yt: "ytBIGC" });
  for (let i = 0; i < 120; i += 1) member(`bc${String(i).padStart(3, "0")}`, "ed-bigcollab", `bigc_${i}`, { order: i, edit: 1, name: `Collab ${i}` });
}
