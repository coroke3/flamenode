import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareScheduledSyncCandidates,
  mergeScheduledSyncCandidates,
} from "./scheduledSelection.ts";

function legacyEligibility(row) {
  return row.sync_status === "failed"
    ? Number(row.updated_at ?? 0)
    : Number(row.synced_at ?? 0);
}

function legacyScheduledSelection(rows, now, intervalSec, limit) {
  return rows
    .filter((row) => {
      if (row.sync_status === "failed" && row.sync_error?.startsWith("permanent:")) {
        return false;
      }
      if (row.sync_status !== "synced" && row.sync_status !== "failed") {
        return false;
      }
      return legacyEligibility(row) <= now - intervalSec;
    })
    .sort(
      (a, b) =>
        legacyEligibility(a) - legacyEligibility(b) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((row) => ({ id: row.id, youtube_video_id: row.youtube_video_id }));
}

function splitScheduledSelection(rows, now, intervalSec, limit) {
  const synced = rows
    .filter(
      (row) =>
        row.sync_status === "synced" &&
        Number(row.synced_at ?? 0) <= now - intervalSec,
    )
    .map((row) => ({
      id: row.id,
      youtube_video_id: row.youtube_video_id,
      eligibility: Number(row.synced_at ?? 0),
    }))
    .sort(compareScheduledSyncCandidates)
    .slice(0, limit);

  const failed = rows
    .filter(
      (row) =>
        row.sync_status === "failed" &&
        !row.sync_error?.startsWith("permanent:") &&
        Number(row.updated_at ?? 0) <= now - intervalSec,
    )
    .map((row) => ({
      id: row.id,
      youtube_video_id: row.youtube_video_id,
      eligibility: Number(row.updated_at ?? 0),
    }))
    .sort(compareScheduledSyncCandidates)
    .slice(0, limit);

  return mergeScheduledSyncCandidates([synced, failed], limit);
}

function legacyActiveEventSelection(videos, events, now, intervalSec, graceSec, limit) {
  const rows = [];
  for (const event of events) {
    if (event.visibility_status !== "public") continue;
    if (event.start_time == null && event.end_time == null) continue;
    if (event.start_time != null && event.start_time > now + graceSec) continue;
    if (event.end_time != null && event.end_time < now - graceSec) continue;

    for (const video of videos) {
      const linked =
        video.primary_event_id === event.id ||
        video.event_ids?.includes(event.id);
      if (!linked) continue;
      if (!video.youtube_video_id || video.visibility_status === "voided") continue;
      if (video.blocked) continue;
      if (
        video.sync_status === "failed" &&
        video.sync_error?.startsWith("permanent:")
      ) {
        continue;
      }
      if (video.sync_status !== "synced" && video.sync_status !== "failed") {
        continue;
      }
      if (legacyEligibility(video) > now - intervalSec) continue;
      rows.push(video);
    }
  }

  return rows
    .sort(
      (a, b) =>
        legacyEligibility(a) - legacyEligibility(b) || a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((row) => ({ id: row.id, youtube_video_id: row.youtube_video_id }));
}

function splitActiveEventSelection(videos, events, now, intervalSec, graceSec, limit) {
  const activeEvents = events.filter((event) => {
    if (event.visibility_status !== "public") return false;
    if (event.start_time == null && event.end_time == null) return false;
    if (event.start_time != null && event.start_time > now + graceSec) return false;
    if (event.end_time != null && event.end_time < now - graceSec) return false;
    return true;
  });

  const lanes = [[], [], [], []];
  for (const event of activeEvents) {
    for (const video of videos) {
      if (!video.youtube_video_id || video.visibility_status === "voided") continue;
      if (video.blocked) continue;
      if (
        video.sync_status === "failed" &&
        video.sync_error?.startsWith("permanent:")
      ) {
        continue;
      }

      const viaPrimary = video.primary_event_id === event.id;
      const viaVideoEvents =
        video.event_ids?.includes(event.id) &&
        video.primary_event_id !== event.id;

      if (!viaPrimary && !viaVideoEvents) continue;

      const candidate = {
        id: video.id,
        youtube_video_id: video.youtube_video_id,
        eligibility: legacyEligibility(video),
      };

      if (video.sync_status === "synced") {
        if (candidate.eligibility > now - intervalSec) continue;
        if (viaPrimary) lanes[0].push(candidate);
        if (viaVideoEvents) lanes[1].push(candidate);
      } else if (video.sync_status === "failed") {
        if (candidate.eligibility > now - intervalSec) continue;
        if (viaPrimary) lanes[2].push(candidate);
        if (viaVideoEvents) lanes[3].push(candidate);
      }
    }
  }

  for (const lane of lanes) {
    lane.sort(compareScheduledSyncCandidates);
    lane.splice(limit);
  }

  return mergeScheduledSyncCandidates(lanes, limit);
}

const defaultFixture = [
  {
    id: "v-sync-old",
    youtube_video_id: "yt-sync-old",
    sync_status: "synced",
    synced_at: 100,
    updated_at: 500,
  },
  {
    id: "v-failed-recent",
    youtube_video_id: "yt-failed-recent",
    sync_status: "failed",
    synced_at: 50,
    updated_at: 900,
    sync_error: "transient:youtube_api_timeout",
  },
  {
    id: "v-failed-old",
    youtube_video_id: "yt-failed-old",
    sync_status: "failed",
    synced_at: 400,
    updated_at: 120,
    sync_error: "transient:youtube_api_timeout",
  },
  {
    id: "v-permanent",
    youtube_video_id: "yt-permanent",
    sync_status: "failed",
    synced_at: 10,
    updated_at: 10,
    sync_error: "permanent:youtube_video_missing_or_private",
  },
  {
    id: "v-sync-fresh",
    youtube_video_id: "yt-sync-fresh",
    sync_status: "synced",
    synced_at: 950,
    updated_at: 950,
  },
];

test("synced/failed 分割 merge は legacy CASE 選択と一致する", () => {
  const now = 1000;
  const intervalSec = 300;
  const limit = 3;

  const legacy = legacyScheduledSelection(defaultFixture, now, intervalSec, limit);
  const split = splitScheduledSelection(defaultFixture, now, intervalSec, limit);

  assert.deepEqual(split, legacy);
});

test("primary / video_events 分割 merge は legacy OR 選択と一致する", () => {
  const now = 1000;
  const intervalSec = 300;
  const graceSec = 86400;
  const limit = 4;
  const events = [
    {
      id: "e-active",
      visibility_status: "public",
      start_time: 500,
      end_time: 1500,
    },
    {
      id: "e-future",
      visibility_status: "public",
      start_time: 5000,
      end_time: 6000,
    },
  ];
  const videos = [
    {
      id: "v-primary",
      youtube_video_id: "yt-primary",
      primary_event_id: "e-active",
      event_ids: ["e-active"],
      visibility_status: "public",
      blocked: false,
      sync_status: "synced",
      synced_at: 200,
      updated_at: 200,
    },
    {
      id: "v-ve-only",
      youtube_video_id: "yt-ve-only",
      primary_event_id: "other",
      event_ids: ["e-active"],
      visibility_status: "public",
      blocked: false,
      sync_status: "failed",
      synced_at: 100,
      updated_at: 150,
      sync_error: "transient:youtube_api_timeout",
    },
    {
      id: "v-dup-both",
      youtube_video_id: "yt-dup-both",
      primary_event_id: "e-active",
      event_ids: ["e-active"],
      visibility_status: "public",
      blocked: false,
      sync_status: "synced",
      synced_at: 100,
      updated_at: 100,
    },
    {
      id: "v-future-event",
      youtube_video_id: "yt-future",
      primary_event_id: "e-future",
      event_ids: ["e-future"],
      visibility_status: "public",
      blocked: false,
      sync_status: "synced",
      synced_at: 50,
      updated_at: 50,
    },
    {
      id: "v-blocked",
      youtube_video_id: "yt-blocked",
      primary_event_id: "e-active",
      event_ids: ["e-active"],
      visibility_status: "public",
      blocked: true,
      sync_status: "synced",
      synced_at: 10,
      updated_at: 10,
    },
  ];

  const legacy = legacyActiveEventSelection(
    videos,
    events,
    now,
    intervalSec,
    graceSec,
    limit,
  );
  const split = splitActiveEventSelection(
    videos,
    events,
    now,
    intervalSec,
    graceSec,
    limit,
  );

  assert.deepEqual(split, legacy);
});

test("mergeScheduledSyncCandidates dedupes duplicate ids across lanes", () => {
  const merged = mergeScheduledSyncCandidates(
    [
      [
        { id: "v-dup", youtube_video_id: "yt-dup", eligibility: 50 },
        { id: "v-other", youtube_video_id: "yt-other", eligibility: 80 },
      ],
      [{ id: "v-dup", youtube_video_id: "yt-dup", eligibility: 20 }],
    ],
    2,
  );

  assert.deepEqual(merged, [
    { id: "v-dup", youtube_video_id: "yt-dup" },
    { id: "v-other", youtube_video_id: "yt-other" },
  ]);
});

test("lane ごと limit 超過でも global top limit を維持する", () => {
  const now = 1000;
  const intervalSec = 0;
  const limit = 2;
  const rows = [
    {
      id: "sync-a",
      youtube_video_id: "yt-a",
      sync_status: "synced",
      synced_at: 10,
      updated_at: 10,
    },
    {
      id: "sync-b",
      youtube_video_id: "yt-b",
      sync_status: "synced",
      synced_at: 30,
      updated_at: 30,
    },
    {
      id: "failed-a",
      youtube_video_id: "yt-fa",
      sync_status: "failed",
      synced_at: 0,
      updated_at: 20,
      sync_error: "transient:youtube_api_timeout",
    },
  ];

  assert.deepEqual(
    splitScheduledSelection(rows, now, intervalSec, limit),
    legacyScheduledSelection(rows, now, intervalSec, limit),
  );
});
