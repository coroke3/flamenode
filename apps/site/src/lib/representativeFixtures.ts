/**
 * Representative snapshot fixtures for MIG-0403 (Recipe R-PAGE / Runtime S0).
 *
 * One public entity per kind plus private, voided and deleted ones. They are read
 * through the MIG-0401 loader (`loadPublicBuildSnapshot`) exactly like a real
 * snapshot: only `visibility: "public"` keys are in the manifest allow list,
 * private/voided keys are on the deny list (and marked so in the envelope), and
 * a deleted entity is in neither list and has no object. A page is built only
 * for what the loader accepts.
 * Full data generation is Phase 5 (MIG-0411 / MIG-0509).
 */
import { createHash } from "node:crypto";
import {
  loadPublicBuildSnapshot,
  SnapshotBuildError,
  type EventPublicSnapshot,
  type PublicSnapshot,
  type SnapshotKind,
  type UserPublicSnapshot,
  type VideoPublicSnapshot,
} from "./publicDataLoader.ts";

const GENERATION = "mig-0403-representative";

type FixtureVisibility = "public" | "private" | "voided" | "deleted";
type Fixture = Readonly<{ visibility: FixtureVisibility; payload: Record<string, unknown> & { kind: SnapshotKind; id: string } }>;

const FIXTURES: readonly Fixture[] = [
  {
    visibility: "public",
    payload: {
      kind: "video",
      id: "repvideo01",
      title: "代表作品: 合同作品のサンプル",
      youtubeVideoId: "repYTid0001",
      creatorName: "代表クリエイター",
      creatorXUserId: "rep_creator",
      creatorIconUrl: "/brand/flamenode-icon-192.png",
      creatorHasPublicProfile: true,
      scheduledTime: 1792238400, // 2026-10-17T12:00:00Z = 2026/10/17 21:00 JST
      music: "代表楽曲",
      credit: "代表アーティスト",
      introComment: "MIG-0403 の代表 fixture です。公開作品の静的 HTML を確認します。",
      // A field the DTO must drop even when a generator leaks it.
      privateNote: "非公開メモ",
    },
  },
  { visibility: "private", payload: { kind: "video", id: "repvideo-private", title: "非公開作品" } },
  { visibility: "voided", payload: { kind: "video", id: "repvideo-voided", title: "無効化作品" } },
  { visibility: "deleted", payload: { kind: "video", id: "repvideo-deleted", title: "削除済み作品" } },
  {
    visibility: "public",
    payload: {
      kind: "event",
      id: "rep-event-2026",
      title: "代表イベント 2026",
      explanation: "MIG-0403 の代表イベント fixture です。",
      iconUrl: "/brand/flamenode-icon-512.png",
      statusLabel: "開始前",
      periodLabel: "2026/11/01 〜 2026/11/30",
      entryAction: "reserve",
    },
  },
  { visibility: "private", payload: { kind: "event", id: "rep-event-private", title: "非公開イベント" } },
  { visibility: "deleted", payload: { kind: "event", id: "rep-event-deleted", title: "削除済みイベント" } },
  {
    visibility: "public",
    payload: {
      kind: "user",
      id: "rep_creator",
      title: "代表クリエイター",
      name: "代表クリエイター",
      iconUrl: "/brand/flamenode-icon-512.png",
      profileText: "MIG-0403 の代表クリエイター fixture です。",
    },
  },
  { visibility: "private", payload: { kind: "user", id: "rep_private_user", title: "非公開ユーザー" } },
  { visibility: "deleted", payload: { kind: "user", id: "rep_deleted_user", title: "削除済みユーザー" } },
];

function keyOf(fixture: Fixture): string {
  return `snapshot/${fixture.payload.kind}/${fixture.payload.id}.json`;
}

function envelope(fixture: Fixture): Uint8Array {
  const { payload } = fixture;
  const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: 1,
    generation: GENERATION,
    key: keyOf(fixture),
    visibility: fixture.visibility,
    payload,
    sha256,
  }));
}

const manifest = {
  schemaVersion: 1 as const,
  generation: GENERATION,
  allowedKeys: FIXTURES.filter((f) => f.visibility === "public").map(keyOf),
  blockedKeys: FIXTURES.filter((f) => f.visibility === "private" || f.visibility === "voided").map(keyOf),
};

const source = {
  async read(key: string): Promise<Uint8Array | null> {
    const fixture = FIXTURES.find((f) => keyOf(f) === key);
    return fixture && fixture.visibility !== "deleted" ? envelope(fixture) : null;
  },
};


async function loadKind(kind: SnapshotKind): Promise<PublicSnapshot[]> {
  const loaded: PublicSnapshot[] = [];
  for (const fixture of FIXTURES.filter((f) => f.payload.kind === kind)) {
    try {
      loaded.push(await loadPublicBuildSnapshot(source, keyOf(fixture), { manifest, generation: GENERATION }));
    } catch (error) {
      // Not public: no page. Any other rejection (missing object, bad hash, ...) fails the build.
      if (!(error instanceof SnapshotBuildError) || error.code !== "NOT_PUBLIC") throw error;
    }
  }
  return loaded;
}

export async function loadRepresentativeVideos(): Promise<VideoPublicSnapshot[]> {
  return (await loadKind("video")) as VideoPublicSnapshot[];
}

export async function loadRepresentativeEvents(): Promise<EventPublicSnapshot[]> {
  return (await loadKind("event")) as EventPublicSnapshot[];
}

export async function loadRepresentativeUsers(): Promise<UserPublicSnapshot[]> {
  return (await loadKind("user")) as UserPublicSnapshot[];
}
