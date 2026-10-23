import { insert } from "./personalHarness.mjs";

// MIG-0623: Entry data layered on top of personalSeed.seed(). All times are relative to "now" and at least a few
// hundred seconds away from every boundary, so CURRENT (Date.now at call time) and the API agree.
export const NOW = Math.floor(Date.now() / 1000);
const T = NOW + 100_000; // slot start times: far future, distinct

export function seedEntry(sqlite) {
  const ins = (table, row) => insert(sqlite, table, row);
  const event = (id, o = {}) =>
    ins("events", { id, title: o.title ?? `Title ${id}`, visibility_status: "public", ...o.cols });

  // ---- events
  event("e_open1", { cols: { entry_start_time: NOW - 1000, entry_end_time: NOW + 5000, allow_user_video_event_links: 1, parts_json: '["A部","B部"]', youtube_description_template: "tmpl {{title}}", required_video_fields_json: '["software"]' } });
  event("e_open2", { cols: { start_time: NOW - 100, end_time: NOW + 9000, entry_start_time: NOW - 50, entry_end_time: NOW + 2000, allow_user_video_event_links: 1, slot_part_gap_minutes: 30 } });
  event("e_open3", { cols: { start_time: NOW + 7200, end_time: NOW + 20000, entry_start_time: NOW - 10 * 60, allow_user_video_event_links: 0 } });
  event("e_open4", { cols: { entry_end_time: NOW + 5000, allow_user_video_event_links: 1 } });
  event("e_point", { cols: { start_time: NOW - 50, entry_start_time: NOW - 1000, entry_end_time: NOW + 4000, allow_user_video_event_links: 1 } });
  event("e_closed", { cols: { entry_start_time: NOW - 9000, entry_end_time: NOW - 500, allow_user_video_event_links: 1 } });
  event("e_ended", { cols: { start_time: NOW - 5000, end_time: NOW - 1000, entry_start_time: NOW - 9000, entry_end_time: NOW + 3000, allow_user_video_event_links: 1, allow_unslotted_posts: 0 } });
  event("e_noentry", { cols: { start_time: NOW - 100, end_time: NOW + 100_000, allow_user_video_event_links: 1 } });
  event("e_future_entry", { cols: { entry_start_time: NOW + 4000, entry_end_time: NOW + 9000, allow_user_video_event_links: 1 } });
  ins("events", { id: "e_private", title: "Private open", visibility_status: "private", entry_start_time: NOW - 1000, entry_end_time: NOW + 5000, allow_user_video_event_links: 1, allow_unslotted_posts: 1 });
  // unslotted candidates: allowed, ended (public), private-allowed (hidden), and a title-search family
  event("e_unslot_a", { title: "Unslotted Alpha 100%_x", cols: { allow_unslotted_posts: 1, start_time: NOW + 500_000, end_time: NOW + 600_000, parts_json: '["Solo"]' } });
  event("e_unslot_b", { title: "Unslotted Beta", cols: { allow_unslotted_posts: 1, start_time: NOW + 500_000, end_time: NOW + 600_000 } });
  event("e_unslot_nodate", { title: "Unslotted nodate", cols: { allow_unslotted_posts: 1 } });
  event("e_past_a", { title: "Past Alpha", cols: { start_time: NOW - 900_000, end_time: NOW - 800_000, required_video_fields_json: '["title"]' } });
  event("e_past_b", { title: "Past Beta", cols: { start_time: NOW - 700_000, end_time: NOW - 600_000 } });
  event("e_past_private", { title: "Past hidden", cols: {} });
  sqlite.exec("UPDATE events SET visibility_status = 'private', end_time = " + (NOW - 5) + ", start_time = " + (NOW - 50) + " WHERE id = 'e_past_private'");
  event("e_stage_only", { title: "Stage only", cols: { allow_unslotted_posts: 1 } });

  // ---- slots (available counts per event; reserved slots for index / slotted)
  const slot = (id, o) => ins("slots", { id, event_id: "e_open1", status: "reserved", sort_order: 0, ...o });
  for (let i = 0; i < 5; i += 1) slot(`av1-${i}`, { status: "available", start_time: T + 50_000 + i * 900 });
  for (let i = 0; i < 3; i += 1) slot(`av2-${i}`, { event_id: "e_open2", status: "available", start_time: T + 60_000 + i * 900 });
  slot("av-closed", { event_id: "e_closed", status: "available", start_time: T + 70_000 });
  // alice: group of 3 consecutive slots + a separate later part + variants
  slot("sl-g1", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", reservation_group_id: "grp1", start_time: T, display_name: "Alice Disp", reserved_x_id_snapshot: "alice_x_snap" });
  slot("sl-g2", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", reservation_group_id: "grp1", start_time: T + 900, display_name: "Alice Disp" });
  slot("sl-g3", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", reservation_group_id: "grp1", start_time: T + 1800, display_name: "Alice Disp" });
  slot("sl-p2", { reserved_by_user_id: "u_alice", x_user_id: null, start_time: T + 40_000, slot_label: "late" });
  slot("sl-sub", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", status: "submitted", video_id: "va1", start_time: T + 2 * 900 + 3000, event_id: "e_open2" });
  slot("sl-sub-novid", { reserved_by_user_id: "u_alice", x_user_id: "alice_x", status: "submitted", video_id: null, start_time: T + 3100 });
  slot("sl-avail", { reserved_by_user_id: "u_alice", x_user_id: null, status: "available", start_time: T + 3200 });
  slot("sl-other-x", { reserved_by_user_id: "u_alice", x_user_id: "alice_y", start_time: T + 3300 });
  slot("sl-notime", { reserved_by_user_id: "u_alice", x_user_id: null, start_time: null, slot_label: "no time slot", sort_order: 7, event_id: "e_open2" });
  slot("sl-noevent", { reserved_by_user_id: "u_alice", x_user_id: null, event_id: "ghost-event", start_time: T + 3400 });
  // another Discord account holds a reservation made for alice_x: alice (active alice_x) may continue only while 'reserved'
  slot("sl-foreign", { reserved_by_user_id: "u_bob", x_user_id: "alice_x", start_time: T + 3500 });
  slot("sl-foreign-sub", { reserved_by_user_id: "u_bob", x_user_id: "alice_x", status: "submitted", video_id: "va2", start_time: T + 3600 });
  slot("sl-bob", { reserved_by_user_id: "u_bob", x_user_id: "bob_x", start_time: T + 3700 });
  slot("sl-frank", { reserved_by_user_id: "u_frank", x_user_id: null, start_time: T + 3800, event_id: "e_open2" });
  slot("sl-ivy", { reserved_by_user_id: "u_ivy", x_user_id: "ivy_x", start_time: T + 3900, event_id: "e_stage_only" });
  slot("sl-ivy-noparts", { reserved_by_user_id: "u_ivy", x_user_id: null, start_time: T + 4000, event_id: "e_open2" });
  // 'many' holds 26 reserved slots: the index shows 24 (LIMIT) ordered by start_time
  for (let i = 0; i < 26; i += 1) slot(`sl-many-${i}`, { reserved_by_user_id: "u_many", x_user_id: null, start_time: T + 10_000 + (25 - i) * 60, event_id: i % 2 ? "e_open1" : "e_open2" });
  // part computation: e_open1 slots of other users that make a second part for sl-p2
  slot("sl-other-part", { reserved_by_user_id: "u_zed_user", x_user_id: "zed", start_time: T + 40_900 });

  // ---- custom questions: general (active/inactive), stage-permission rows, an event with the max
  const q = (id, eventId, key, o = {}) =>
    ins("event_custom_questions", { id, event_id: eventId, question_key: key, label: o.label ?? `Label ${id}`, ...o.cols });
  q("q1", "e_open1", "extra_text", { cols: { type: "text", required: 1, sort_order: 2, placeholder: "ph" } });
  q("q2", "e_open1", "extra_select", { cols: { type: "select", options_json: '[" A ","B","B",1,"C"]', sort_order: 1, description: "pick", max_length: 50 } });
  q("q3", "e_open1", "extra_off", { cols: { is_active: 0, sort_order: 3 } });
  q("q4", "e_open1", "stage_permission", { label: "Stage perm", cols: { required: 1, sort_order: 0, description: "stage desc", placeholder: "stage ph" } });
  q("q5", "e_open1", "stage_permission_2", { label: "Stage perm 2", cols: { is_active: 0, sort_order: 1 } });
  q("q6", "e_open1", "stage_permissionX", { cols: { sort_order: 4 } });
  q("q7", "e_open2", "radio_q", { cols: { type: "radio", options_json: '["x","y"]', sort_order: 0, visibility: "public" } });
  q("q8", "e_unslot_a", "check_q", { cols: { type: "checkbox", options_json: '["1","2"]', sort_order: 0 } });
  q("q9", "e_unslot_a", "stage_permission", { cols: { sort_order: 0 } });
  q("q10", "e_past_a", "same_sort_1", { cols: { sort_order: 5 } });
  q("q11", "e_past_a", "same_sort_0", { cols: { sort_order: 5 } });
  q("q12", "e_stage_only", "stage_permission_1", { cols: { sort_order: 0, required: 1 } });

  // ---- software suggestions
  for (const [id, name] of [["sw1", "Premiere"], ["sw2", "After Effects"], ["sw3", "Blender"]]) {
    ins("software_catalog", { id, name, normalized_name: name.toLowerCase() });
  }
  ins("software_aliases", { software_id: "sw1", alias: "PremierePro", normalized_alias: "premierepro" });
  ins("software_aliases", { software_id: "sw3", alias: "Blender", normalized_alias: "blender" });
  ins("software_aliases", { software_id: "sw2", alias: "AE", normalized_alias: "ae" });
}
