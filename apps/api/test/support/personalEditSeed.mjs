import { insert } from "./personalHarness.mjs";

// MIG-0630: video-edit data layered on top of personalSeed.seed(). Users/X IDs come from personalSeed
// (alice = alice_x + alice_y, frank = frank_a + frank_b, ivy = ivy_x, carol = site admin, bob/erin = no approved X).
const T0 = 1_700_000_000;

export const EDIT_VIDEOS = [];
/** videos whose lists exceed the S2 bounds (tested separately, excluded from the equality matrix) */
export const BIG_VIDEOS = [
  "ed-many", "ed-bytes", "ed-huge-first", "ed-bigmember", "ed-bigcollab",
  // MIG-0630 U02b: CURRENT throws (stage > 4 / > 18 questions) or the answers exceed the bound
  "ed-stage-many", "ed-q-many", "ed-ans-many",
];

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

  // ---- U02b form options: accepting / non-accepting events, questions, answers, suggestions, candidates
  const NOW = Math.floor(Date.now() / 1000);
  const open = (id, cols) => ins("events", { id, title: `Form ${id}`, visibility_status: "public", allow_user_video_event_links: 1, ...cols });
  open("ee-open2", { entry_start_time: 5, parts_json: '["A","B"]', youtube_description_template: "tmpl", required_video_fields_json: '["title"]' });
  open("ee-point", { start_time: NOW - 100, entry_start_time: 1, entry_end_time: NOW + 100_000 });
  open("ee-closed", { entry_start_time: 1, entry_end_time: NOW - 1000 });
  open("ee-ended", { start_time: NOW - 5000, end_time: NOW - 1000, entry_start_time: 1, entry_end_time: NOW + 100_000 });
  open("ee-future", { entry_start_time: NOW + 100_000 });
  open("ee-nolink", { entry_start_time: 1, allow_user_video_event_links: 0 });
  open("ee-noentry", { start_time: NOW - 100, end_time: NOW + 100_000 });
  ins("events", { id: "ee-private", title: "Form private", visibility_status: "private", allow_user_video_event_links: 1, entry_start_time: 1 });
  const q = (id, eventId, key, o = {}) =>
    ins("event_custom_questions", { id, event_id: eventId, question_key: key, label: o.label ?? `Label ${id}`, ...o.cols });
  q("fq1", "ee1", "fq_text", { cols: { type: "text", required: 1, sort_order: 1, placeholder: "ph", max_length: 40 } });
  q("fq2", "ee1", "fq_multi", { cols: { type: "checkbox", options_json: '["a","b","c"]', sort_order: 0 } });
  q("fq3", "ee1", "fq_off", { cols: { is_active: 0, sort_order: 2 } });
  q("fq4", "ee1", "fq_bad", { cols: { sort_order: 3 } });
  q("fq5", "ee1", "stage_permission", { label: "Stage perm", cols: { sort_order: 0, required: 1, description: "d", placeholder: "p" } });
  q("fq6", "ee1", "stage_permission_x y!", { label: "  ", cols: { sort_order: 1 } });
  q("fq6b", "ee1", "stage_permission_off", { cols: { sort_order: 2, is_active: 0 } });
  q("fq7", "ee-open", "open_q", { cols: { type: "select", options_json: '["x","y"]', sort_order: 0, visibility: "public" } });
  q("fq8", "ee-open", "stage_permission_open", { label: "Stage open", cols: { sort_order: 0 } });
  q("fq9", "ee2", "ee2_q", { cols: { type: "radio", options_json: '["1","2"]', sort_order: 0 } });
  q("fq10", "ee-open2", "open2_q", { cols: { sort_order: 0 } });
  const ans = (videoId, eventId, questionId, o = {}) =>
    ins("video_custom_answers", { video_id: videoId, event_id: eventId, question_id: questionId, answer_text: o.text ?? null, answer_json: o.json ?? null });
  ans("ed-own1", "ee1", "fq1", { text: "  hello  " });
  ans("ed-own1", "ee1", "fq2", { json: '[" a ","b",1,"",null,"c"]', text: "ignored" });
  ans("ed-own1", "ee1", "fq3", { text: "inactive question" });
  ans("ed-own1", "ee1", "fq4", { json: "{broken", text: " fallback " });
  ans("ed-own1", "ee1", "fq5", { text: " ok " });
  ans("ed-own1", "ee1", "fq6", { text: "second" });
  ans("ed-own1", "ee1", "fq6b", { text: "inactive stage" });
  ans("ed-own1", "ee-open", "fq7", { text: "stray answer on an accepting event" });
  ans("ed-own2", "ee2", "fq9", { json: "[]", text: "ignored: an array answer wins even when empty" });
  ans("ed-own2", "ee-open", "fq8", { text: "open stage" });
  ans("ed-own2", "ee-open", "fq7", { text: " y " });
  // CURRENT throws (-> page error / 503): 5 stage questions, 19 general questions
  ins("events", { id: "est5", title: "Stage five", visibility_status: "public" });
  for (let i = 0; i < 5; i += 1) q(`st5-${i}`, "est5", `stage_permission_${i}`, { cols: { sort_order: i } });
  video("ed-stage-many", { creator: "alice_x", events: ["est5"], yt: "ytSM" });
  ins("events", { id: "eq19", title: "Nineteen", visibility_status: "public" });
  for (let i = 0; i < 19; i += 1) q(`q19-${i}`, "eq19", `k${i}`, { cols: { sort_order: i } });
  video("ed-q-many", { creator: "alice_x", events: ["eq19"], yt: "ytQM" });
  // 6 events x 18 questions, all answered: 108 answers -> customAnswersTruncated, first 100 kept
  const manyEvents = ["ea1", "ea2", "ea3", "ea4", "ea5", "ea6"];
  for (const eventId of manyEvents) {
    ins("events", { id: eventId, title: `Answers ${eventId}`, visibility_status: "public" });
    for (let i = 0; i < 18; i += 1) q(`${eventId}-q${i}`, eventId, `a${i}`, { cols: { sort_order: i } });
  }
  video("ed-ans-many", { creator: "alice_x", events: manyEvents, yt: "ytAM" });
  for (const eventId of manyEvents) for (let i = 0; i < 18; i += 1) ans("ed-ans-many", eventId, `${eventId}-q${i}`, { text: `${eventId}/${i}` });

  // software suggestions (catalog names, then aliases) and candidates of alice_x (newest first, de-duplicated, normalized)
  ins("software_aliases", { software_id: "sw1", alias: "Blend", normalized_alias: "blend" });
  ins("software_aliases", { software_id: "sw2", alias: "AE", normalized_alias: "ae" });
  ins("software_aliases", { software_id: "sw2", alias: "Blender", normalized_alias: "blender-alias" });
  for (const [i, icon, channel, vis] of [
    [1, "https://i.test/a.png", "https://www.youtube.com/@alice", "public"],
    [2, "https://i.test/b.png", "https://youtube.com/c/alice2", "public"],
    [3, "https://i.test/c.png", "not a url", "public"],
    [4, "https://i.test/hidden.png", "https://www.youtube.com/@ALICE?x=1", "pending"],
    [5, null, "https://example.com/z", "public"],
    [6, "https://i.test/b.png", "https://m.youtube.com/user/alice6", "public"],
  ]) {
    ins("videos", {
      id: `ed-ic${i}`, title: `Icon ${i}`, submitted_by_user_id: "u_zed_user", creator_display_name: "Alice", creator_x_user_id: "alice_x",
      creator_icon_url: icon, creator_youtube_channel_url: channel, visibility_status: vis, collaboration_type: "individual",
      scheduling_type: "slotted", source_type: "youtube", created_at: T0 + i * 10, updated_at: T0,
    });
  }
}
