/**
 * Representative fixtures for MIG-0403 (Recipe R-PAGE / Runtime S0).
 * Provides sample data for representative Video, Event, and User pages,
 * including public, alias, private, and deleted states to verify fail-closed SSG emission.
 */
import type {
  EventPublicSnapshot,
  UserPublicSnapshot,
  VideoPublicSnapshot,
} from "./publicDataLoader.ts";

export interface RepresentativeVideoFixture extends VideoPublicSnapshot {
  readonly isPrivate?: boolean;
  readonly isDeleted?: boolean;
}

export interface RepresentativeEventFixture extends EventPublicSnapshot {
  readonly isPrivate?: boolean;
  readonly isDeleted?: boolean;
}

export interface RepresentativeUserFixture extends UserPublicSnapshot {
  readonly isPrivate?: boolean;
  readonly isDeleted?: boolean;
}

const REPRESENTATIVE_VIDEOS: readonly RepresentativeVideoFixture[] = [
  {
    kind: "video",
    id: "sample-video-1",
    title: "代表動画: FlameNodeローンチ記念フェス",
    description: "FlameNode公式ローンチ記念動画です。ボカロ・合成音声による共創フェス。",
    creatorName: "FlameNode Official",
    creatorHandle: "@flamenode_jp",
    creatorAvatarUrl: "https://flamenode.net/brand/logo.png",
    thumbnailUrl: "https://flamenode.net/brand/ogp-default.png",
    publishedAt: "2026-10-18T00:00:00Z",
    youtubeVideoId: "dKw1xV41f8s",
    canonicalUrl: "https://flamenode.net/sample-video-1",
    ogImageUrl: "https://flamenode.net/brand/ogp-default.png",
  },
  {
    kind: "video",
    id: "sample-video-alias",
    title: "代表動画: FlameNodeローンチ記念フェス（エイリアス）",
    description: "エイリアスURLからのリダイレクト・canonical確認用",
    creatorName: "FlameNode Official",
    canonicalUrl: "https://flamenode.net/sample-video-1",
    aliasOf: "sample-video-1",
  },
  {
    kind: "video",
    id: "private-video-hidden",
    title: "非公開動画（SSG生成禁止）",
    isPrivate: true,
  },
  {
    kind: "video",
    id: "deleted-video-purged",
    title: "削除済み動画（SSG生成禁止）",
    isDeleted: true,
  },
];

const REPRESENTATIVE_EVENTS: readonly RepresentativeEventFixture[] = [
  {
    kind: "event",
    id: "autumn-collab-2026",
    title: "FlameNode Autumn Festival 2026",
    description: "秋の音楽・動画クリエイター合同コラボレーションイベント。",
    bannerUrl: "https://flamenode.net/brand/banner.png",
    iconUrl: "https://flamenode.net/brand/icon.png",
    status: "upcoming",
    periodText: "2026-10-20 〜 2026-10-31",
    canonicalUrl: "https://flamenode.net/event/autumn-collab-2026",
    ogImageUrl: "https://flamenode.net/brand/banner.png",
  },
  {
    kind: "event",
    id: "draft-secret-event",
    title: "下書きイベント（SSG生成禁止）",
    isPrivate: true,
  },
  {
    kind: "event",
    id: "deleted-event",
    title: "削除イベント（SSG生成禁止）",
    isDeleted: true,
  },
];

const REPRESENTATIVE_USERS: readonly RepresentativeUserFixture[] = [
  {
    kind: "user",
    id: "miku-producer",
    title: "初音P (Miku Producer)",
    name: "初音P",
    handle: "@miku_prod",
    bio: "FlameNodeでボカロ楽曲・映像を制作しています。",
    avatarUrl: "https://flamenode.net/brand/avatar-miku.png",
    canonicalUrl: "https://flamenode.net/user/miku-producer",
    ogImageUrl: "https://flamenode.net/brand/avatar-miku.png",
  },
  {
    kind: "user",
    id: "suspended-user",
    title: "停止ユーザー（SSG生成禁止）",
    isPrivate: true,
  },
  {
    kind: "user",
    id: "deleted-user",
    title: "削除ユーザー（SSG生成禁止）",
    isDeleted: true,
  },
];

/** Filters out private and deleted items to guarantee fail-closed SSG emission */
export function getPublicRepresentativeVideos(): VideoPublicSnapshot[] {
  return REPRESENTATIVE_VIDEOS.filter((v) => !v.isPrivate && !v.isDeleted);
}

export function getPublicRepresentativeEvents(): EventPublicSnapshot[] {
  return REPRESENTATIVE_EVENTS.filter((e) => !e.isPrivate && !e.isDeleted);
}

export function getPublicRepresentativeUsers(): UserPublicSnapshot[] {
  return REPRESENTATIVE_USERS.filter((u) => !u.isPrivate && !u.isDeleted);
}
