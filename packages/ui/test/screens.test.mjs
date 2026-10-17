import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  VideoDetailView,
  EventDetailView,
  CreatorView,
} from "../dist/index.js";

const SAMPLE_VIDEO = {
  id: "video-123",
  title: "空白合作",
  creatorName: "空白合作チーム",
  creatorHandle: "vIXyOepPI395671",
  creatorAvatarUrl: "https://example.com/avatar.jpg",
  publishedAt: "2026.03.29",
  youtubeVideoId: "dQw4w9WgXcQ",
  introComment: "勇気を出してみんなを誘いました",
  highlights: "13人それぞれのパートが、1曲の中で順番に入れ替わります。",
  productionEpisode: "声をかけてから約1か月で全員のパートがそろいました。",
  afterword: "見てくださった皆さん、ありがとうございました。",
  musicTitle: "ホワイトスペースにおいで",
  musicUrl: "https://example.com/music",
  softwareUsed: "AviUtl, After Effects",
  likeCount: 42,
  isLiked: true,
  isSaved: false,
  events: [
    {
      id: "pvsf2026sp",
      title: "PVSF2026Sp",
      statusLabel: "開催済み",
      playlistUrl: "https://youtube.com/playlist",
    },
    {
      id: "pvsf-digest",
      title: "PVSF まとめ動画",
    },
  ],
  members: [
    {
      name: "メンバーA",
      xHandle: "member_a",
      role: "映像",
      chapter: "0:15",
      comment: "全力で挑みました",
    },
    {
      name: "メンバーB",
      role: "音響",
      chapter: "1:02",
    },
  ],
  chapters: [
    { time: "0:00", label: "イントロ", author: "主催" },
    { time: "0:15", label: "パートA", author: "メンバーA" },
    { time: "1:02", label: "パートB", author: "メンバーB" },
  ],
};

const SAMPLE_EVENT = {
  id: "event-pvsf2026sp",
  title: "PVSF2026Sp",
  bannerUrl: "https://example.com/banner.jpg",
  iconUrl: "https://example.com/icon.jpg",
  status: "public",
  statusLabel: "募集期間中",
  periodText: "2026.11.03 – 11.04",
  aboutText: "個人制作の映像作品を2日間にわたって連続上映するイベントです。",
  guidelinesText: "楽曲・素材の権利を確認したうえで提出してください。",
  metrics: [
    { value: "128", label: "作品" },
    { value: "96", label: "クリエイター" },
    { value: "128 / 160", label: "埋まり枠" },
  ],
  slotDays: [
    { label: "1日目 (11/03)", count: "64 / 80", percentage: "80%" },
    { label: "2日目 (11/04)", count: "64 / 80", percentage: "80%" },
  ],
  videos: [
    {
      id: "vid-1",
      title: "出展作品 1",
      duration: "3:45",
      creatorName: "クリエイター1",
    },
  ],
  scheduleItems: [
    { label: "募集期間", date: "2026.09.01 – 10.16" },
    { label: "上映開始", date: "2026.11.03 18:00" },
  ],
};

const SAMPLE_CREATOR = {
  id: "user-otako",
  name: "おたこ",
  handle: "012345rty",
  avatarUrl: "https://example.com/avatar.jpg",
  xUrl: "https://x.com/012345rty",
  youtubeUrl: "https://youtube.com/@012345rty",
  websiteUrl: "https://example.com",
  bio: "アニメと実写を混ぜた短編を作っています。",
  contactInfo: "依頼は X の DM へ。",
  ownVideos: [
    {
      id: "work-1",
      title: "個人制作作品 1",
      eventName: "PVSF2026Sp",
      duration: "2:30",
    },
  ],
  collabVideos: [
    {
      id: "collab-1",
      title: "合作参加作品 1",
      creatorName: "主催チーム",
      eventName: "PVSF2026Sp",
      duration: "5:00",
    },
  ],
};

// T01: Empty fixture renders empty state
test("T01: Empty fixture renders empty state for VideoDetail, EventDetail, and Creator", () => {
  const videoHtml = renderToStaticMarkup(
    React.createElement(VideoDetailView, { video: null }),
  );
  assert.match(videoHtml, /作品が見つかりません/);
  assert.match(videoHtml, /href="\/list"/);

  const eventHtml = renderToStaticMarkup(
    React.createElement(EventDetailView, { event: null }),
  );
  assert.match(eventHtml, /イベントが見つかりません/);
  assert.match(eventHtml, /href="\/event"/);

  const creatorHtml = renderToStaticMarkup(
    React.createElement(CreatorView, { creator: null }),
  );
  assert.match(creatorHtml, /クリエイターが見つかりません/);
  assert.match(creatorHtml, /href="\/user"/);
});

// T02: Blocked / unavailable fixture suppresses content and displays safety state
test("T02: Non-public / blocked / unavailable fixture suppresses active content", () => {
  const blockedVideoHtml = renderToStaticMarkup(
    React.createElement(VideoDetailView, {
      video: { ...SAMPLE_VIDEO, isBlocked: true },
    }),
  );
  assert.match(blockedVideoHtml, /作品が見つかりません/);
  assert.doesNotMatch(blockedVideoHtml, /空白合作/);
  assert.doesNotMatch(blockedVideoHtml, /youtube-nocookie\.com/);

  const unavailableEventHtml = renderToStaticMarkup(
    React.createElement(EventDetailView, {
      event: { ...SAMPLE_EVENT, isUnavailable: true },
    }),
  );
  assert.match(unavailableEventHtml, /イベントが見つかりません/);
  assert.doesNotMatch(unavailableEventHtml, /PVSF2026Sp/);

  const blockedCreatorHtml = renderToStaticMarkup(
    React.createElement(CreatorView, {
      creator: { ...SAMPLE_CREATOR, isBlocked: true },
    }),
  );
  assert.match(blockedCreatorHtml, /クリエイターが見つかりません/);
  assert.doesNotMatch(blockedCreatorHtml, /おたこ/);
});

// T03: 390px mobile layout attributes and container styling
test("T03: Responsive containers allow wrapping with no fixed-overflow locks", () => {
  const videoHtml = renderToStaticMarkup(
    React.createElement(VideoDetailView, { video: SAMPLE_VIDEO }),
  );
  // Grid layout uses flexible minmax columns
  assert.match(videoHtml, /grid-template-columns/);
  assert.match(videoHtml, /minmax\(0,\s*1fr\)/);
  assert.match(videoHtml, /box-sizing:border-box/);
  assert.match(videoHtml, /flex-wrap:wrap/);

  const eventHtml = renderToStaticMarkup(
    React.createElement(EventDetailView, { event: SAMPLE_EVENT }),
  );
  assert.match(eventHtml, /aspect-ratio:4\s*\/\s*1/);
  assert.match(eventHtml, /grid-template-columns/);
  assert.match(eventHtml, /flex-wrap:wrap/);

  const creatorHtml = renderToStaticMarkup(
    React.createElement(CreatorView, { creator: SAMPLE_CREATOR }),
  );
  assert.match(creatorHtml, /flex-wrap:wrap/);
  assert.match(creatorHtml, /grid-template-columns/);
});

// T04: Keyboard accessibility and semantic heading hierarchy
test("T04: Semantic heading hierarchy and accessible interactive elements", () => {
  const videoHtml = renderToStaticMarkup(
    React.createElement(VideoDetailView, { video: SAMPLE_VIDEO }),
  );
  // Single H1 for video title
  assert.match(videoHtml, /<h1[^>]*>空白合作<\/h1>/);
  // H2 for members and chapters
  assert.match(videoHtml, /<h2[^>]*>参加メンバー/);
  assert.match(videoHtml, /<h2[^>]*>チャプター/);
  // Accessible landmarks and controls
  assert.match(videoHtml, /aria-label="動画プレイヤー"/);
  assert.match(videoHtml, /aria-label="作品基本情報"/);
  assert.match(videoHtml, /role="group"/);
  assert.match(videoHtml, /aria-pressed="true"/);
  assert.match(videoHtml, /role="region"/);
  assert.match(videoHtml, /aria-label="参加メンバー一覧"/);

  const eventHtml = renderToStaticMarkup(
    React.createElement(EventDetailView, { event: SAMPLE_EVENT }),
  );
  assert.match(eventHtml, /<h1[^>]*>PVSF2026Sp<\/h1>/);
  assert.match(eventHtml, /<h2[^>]*id="ed-about-heading"[^>]*>イベント概要<\/h2>/);
  assert.match(eventHtml, /<h2[^>]*id="ed-slots-heading"[^>]*>上映枠<\/h2>/);
  assert.match(eventHtml, /<h2[^>]*id="ed-videos-heading"[^>]*>投稿作品/);
  assert.match(eventHtml, /aria-label="イベント日程"/);

  const creatorHtml = renderToStaticMarkup(
    React.createElement(CreatorView, { creator: SAMPLE_CREATOR }),
  );
  assert.match(creatorHtml, /<h1[^>]*>おたこ<\/h1>/);
  assert.match(creatorHtml, /<h2[^>]*id="cr-works-heading"[^>]*>作品/);
  assert.match(creatorHtml, /<h2[^>]*id="cr-collab-heading"[^>]*>参加作品/);
  assert.match(creatorHtml, /aria-label="クリエイター情報"/);
  assert.match(creatorHtml, /aria-label="X @012345rty"/);
  assert.match(creatorHtml, /aria-label="YouTube"/);
});
