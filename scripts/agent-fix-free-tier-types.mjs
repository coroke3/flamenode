#!/usr/bin/env node
import fs from "node:fs";

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, "utf8");
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`${path}: replacement target not found`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`${path}: replacement target is ambiguous`);
  }
  fs.writeFileSync(path, source.slice(0, index) + after + source.slice(index + before.length));
}

replaceOnce(
  "src/lib/actions/video/submitSlotVideo.ts",
  `        collaboration_type: parsed.data.is_collab ? "collab" : "individual",\n        part: slotPart,\n        updated_at: now,`,
  `        collaboration_type: parsed.data.is_collab ? "collab" : "individual",\n        part: slotPart,\n        score_dirty_at: now,\n        updated_at: now,`,
);
replaceOnce(
  "src/lib/actions/video/submitSlotVideo.ts",
  `        app_like_count: 0,\n        score: 0,\n        score_updated_at: null,\n        created_at: now,`,
  `        app_like_count: 0,\n        trending_view_count_24h: 0,\n        score: 0,\n        score_updated_at: null,\n        score_dirty_at: now,\n        created_at: now,`,
);

replaceOnce(
  "src/lib/actions/youtube-sync-admin.ts",
  `    ? { ...before, youtube_video_id: video.youtube_video_id, sync_status: "pending", sync_error: null, synced_at: null, updated_at: now }\n    : { video_id: videoId, youtube_video_id: video.youtube_video_id, youtube_privacy_status: null, youtube_availability_status: null, duration_seconds: null, view_count: 0, synced_at: null, sync_status: "pending", sync_error: null, updated_at: now };`,
  `    ? { ...before, youtube_video_id: video.youtube_video_id, sync_status: "pending", sync_error: null, synced_at: null, next_sync_at: now, consecutive_failures: 0, updated_at: now }\n    : { video_id: videoId, youtube_video_id: video.youtube_video_id, youtube_privacy_status: null, youtube_availability_status: null, duration_seconds: null, view_count: 0, synced_at: null, next_sync_at: now, consecutive_failures: 0, sync_status: "pending", sync_error: null, updated_at: now };`,
);
replaceOnce(
  "src/lib/actions/youtube-sync-admin.ts",
  `    ? db.update(videoYoutubeMetadata).set({ youtube_video_id: video.youtube_video_id, sync_status: "pending", sync_error: null, synced_at: null, updated_at: now })`,
  `    ? db.update(videoYoutubeMetadata).set({ youtube_video_id: video.youtube_video_id, sync_status: "pending", sync_error: null, synced_at: null, next_sync_at: now, consecutive_failures: 0, updated_at: now })`,
);

replaceOnce(
  "src/lib/import/legacy/apply.ts",
  `      scheduling_type: video.scheduling_type,\n      scheduled_time: video.scheduled_time,\n      updated_at: now,`,
  `      scheduling_type: video.scheduling_type,\n      scheduled_time: video.scheduled_time,\n      score_dirty_at: now,\n      updated_at: now,`,
);
replaceOnce(
  "src/lib/import/legacy/apply.ts",
  `    app_like_count: 0,\n    score: 0,\n    score_updated_at: null,\n    created_at: video.created_at ?? now,`,
  `    app_like_count: 0,\n    trending_view_count_24h: 0,\n    score: 0,\n    score_updated_at: null,\n    score_dirty_at: now,\n    created_at: video.created_at ?? now,`,
);
replaceOnce(
  "src/lib/import/legacy/apply.ts",
  `          view_count: 0,\n          synced_at: null,\n          sync_status: "pending",`,
  `          view_count: 0,\n          synced_at: null,\n          next_sync_at: args.now,\n          consecutive_failures: 0,\n          sync_status: "pending",`,
);

replaceOnce(
  "src/lib/video/syncVideoEvents.ts",
  `      view_count: 0,\n      synced_at: null,\n      sync_status: "pending",`,
  `      view_count: 0,\n      synced_at: null,\n      next_sync_at: args.now,\n      consecutive_failures: 0,\n      sync_status: "pending",`,
);
replaceOnce(
  "src/lib/video/syncVideoEvents.ts",
  `    youtube_video_id: args.youtubeVideoId,\n    sync_status: "pending",\n    updated_at: args.now,`,
  `    youtube_video_id: args.youtubeVideoId,\n    sync_status: "pending",\n    sync_error: null,\n    synced_at: null,\n    next_sync_at: args.now,\n    consecutive_failures: 0,\n    updated_at: args.now,`,
);
replaceOnce(
  "src/lib/video/syncVideoEvents.ts",
  `      youtube_video_id: args.youtubeVideoId,\n      sync_status: "pending",\n      updated_at: args.now,`,
  `      youtube_video_id: args.youtubeVideoId,\n      sync_status: "pending",\n      sync_error: null,\n      synced_at: null,\n      next_sync_at: args.now,\n      consecutive_failures: 0,\n      updated_at: args.now,`,
);

fs.rmSync("scripts/agent-fix-free-tier-types.mjs");
fs.rmSync(".github/workflows/agent-fix-free-tier-types.yml");
console.log("free-tier operational defaults applied");
