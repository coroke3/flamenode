#!/usr/bin/env node
/**
 * MIG-0411 U05 (= MIG-0409 U05 (a)): CPU of one server-rendered page per kind at the upper
 * bound of its lists, local Node only (not workerd / production). Run with NODE_ENV=production
 * (the Worker bundle uses React's production build):
 *
 *   NODE_ENV=production node --experimental-strip-types --no-warnings \
 *     apps/site/src/gateway/renderPublicPage.measure.mjs [--runs 300] [--cold]
 *
 * --cold measures only the first render in a fresh process (React + UI module load included).
 * CPU = process.cpuUsage() around one renderPublicPageHtml call (user + system).
 */
import { renderPublicPageHtml } from "./renderPublicPage.ts";

// Upper bounds (CURRENT): video members MAX_VIDEO_MEMBERS = 100 (src/lib/video/atomicLimits.ts),
// chapters 128 (MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO), related RELATED_MAX_LIMIT = 30;
// event works EVENT_VIDEO_DISPLAY_LIMIT = 8, staff PUBLIC_STAFF_MAX_PER_EVENT = 20, 20 slot parts;
// creator works / collabs 8 + 8 per page (UserProfilePage.tsx). Texts: 1,000-char titles,
// 10,000-char bodies.
export const MAX_INPUT = { members: 100, chapters: 128, related: 30, eventVideos: 8, staff: 20, slotParts: 20, creatorWorks: 8, creatorCollabs: 8 };

const long = (c, n) => c.repeat(n);
const img = (i) => `https://img.example/${i}.jpg`;

export function maxInputs() {
  const title = long("長", 1000);
  const body = long("説", 10_000);
  const card = (i) => ({ href: `/w${i}`, title, thumbnailUrl: img(i), creatorName: long("名", 100), creatorIconUrl: img(i), durationLabel: "12:34", metaLabel: "2026.10.18" });
  return {
    video: {
      entity: "video",
      video: {
        id: "vid-max", title,
        creator: { name: long("名", 200), xUserId: "creator_x", iconUrl: img(0), profileHref: "/user/creator_x", youtubeChannelUrl: "https://www.youtube.com/@c" },
        publishedLabel: "2026.10.18", thumbnailUrl: img(1), hasYoutube: true,
        music: title, credit: title, musicReferenceUrl: "https://example.com/m", introComment: body, softwareLabel: long("ソ", 200),
        highlights: body, productionStory: body, closingComment: body,
        primaryEvent: { id: "ev", title, iconUrl: img(2), statusLabel: "開催中", statusTone: "success", accepting: true, playlistUrl: "https://www.youtube.com/playlist?list=PL" },
        otherEvents: Array.from({ length: 10 }, (_, i) => ({ id: `ev${i}`, title })),
        members: Array.from({ length: MAX_INPUT.members }, (_, i) => ({ id: `m${i}`, name: long("名", 50), xUserId: `x${i}`, iconUrl: img(i), role: "映像", comment: long("コ", 500), profileHref: i % 2 ? `/user/x${i}` : null, chapterTimes: ["0:00", "1:00"] })),
        chapters: Array.from({ length: MAX_INPUT.chapters }, (_, i) => ({ id: `c${i}`, timeLabel: `${i}:00`, label: long("章", 100), authorName: long("名", 50), kind: i % 2 ? "member" : "comment" })),
        related: Array.from({ length: MAX_INPUT.related }, (_, i) => ({ href: `/r${i}`, title, creatorName: long("名", 100), thumbnailUrl: img(i) })),
        likeCount: 99999,
      },
    },
    user: {
      entity: "user",
      creator: {
        id: "creator-max", name: long("名", 200), iconUrl: img(0), youtubeChannelUrl: "https://www.youtube.com/@c",
        socialLinks: Array.from({ length: 10 }, (_, i) => ({ label: `link ${i}`, url: `https://example.com/${i}` })),
        profileText: body, contact: long("連", 2000),
        works: { items: Array.from({ length: MAX_INPUT.creatorWorks }, (_, i) => card(i)), total: 800, currentPage: 1, totalPages: 100, pageSize: 8, buildHref: (p) => (p <= 1 ? "/user/creator-max" : `/user/creator-max?worksPage=${p}`) },
        collabs: { items: Array.from({ length: MAX_INPUT.creatorCollabs }, (_, i) => card(100 + i)), total: 800, currentPage: 1, totalPages: 100, pageSize: 8, buildHref: (p) => (p <= 1 ? "/user/creator-max" : `/user/creator-max?collabPage=${p}`) },
      },
    },
    event: {
      entity: "event",
      event: {
        id: "ev-max", title, imageUrl: img(0), iconUrl: img(1), explanation: body, statusLabel: "募集期間中", statusTone: "success",
        periodLabel: "2026.11.03 – 11.04", entryAction: "reserve", playlistUrl: "https://www.youtube.com/playlist?list=PL",
        videoTotal: 701, creatorTotal: 737, slotFilled: 98, slotTotal: 120, dayMetric: { label: "募集締切まで", days: 3 },
        schedule: [{ label: "募集期間", value: "2026.10.01 – 10.31" }, { label: "投稿期間", value: "2026.11.03 – 11.04" }],
        slotParts: Array.from({ length: MAX_INPUT.slotParts }, (_, i) => ({ label: `${i + 1}日目`, filled: 5, total: 6 })),
        staff: Array.from({ length: MAX_INPUT.staff }, (_, i) => ({ name: long("名", 50), roleLabel: "運営", iconUrl: img(i), xUserId: `s${i}`, profileHref: `/user/s${i}` })),
        videos: Array.from({ length: MAX_INPUT.eventVideos }, (_, i) => ({ id: `e${i}`, youtubeVideoId: `yt${i}`, ...card(i) })),
      },
    },
  };
}

const PATHS = { video: "/vid-max", user: "/user/creator-max", event: "/event/ev-max" };
const cpuMs = (start) => { const u = process.cpuUsage(start); return (u.user + u.system) / 1000; };

export async function measure({ runs = 300, cold = false } = {}) {
  const inputs = maxInputs();
  const out = {};
  for (const kind of cold ? ["video"] : ["video", "user", "event"]) {
    const opts = { origin: "https://site.example", canonicalPath: PATHS[kind] };
    if (cold) {
      const start = process.cpuUsage();
      const html = await renderPublicPageHtml(inputs[kind], opts);
      out.cold = { kind, cpuMs: cpuMs(start), bytes: Buffer.byteLength(html) };
      continue;
    }
    const html = await renderPublicPageHtml(inputs[kind], opts); // warm (module load excluded)
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const start = process.cpuUsage();
      await renderPublicPageHtml(inputs[kind], opts);
      samples.push(cpuMs(start));
    }
    samples.sort((a, b) => a - b);
    const q = (p) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
    out[kind] = { runs, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: samples.at(-1), bytes: Buffer.byteLength(html) };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => process.argv.includes(name);
  const runsAt = process.argv.indexOf("--runs");
  const result = await measure({ runs: runsAt > 0 ? Number(process.argv[runsAt + 1]) : 300, cold: arg("--cold") });
  console.log(JSON.stringify({ node: process.version, env: process.env.NODE_ENV ?? "development", ...result }, null, 2));
}
