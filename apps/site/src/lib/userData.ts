/**
 * Build-time data for `/user`, `/user/[id]` and `/user/[id]/portfolio` (MIG-0504 / R-PAGE / Runtime S0).
 * CURRENT reads `users/index.json`, `users/ID.json` and `users/ID/works|collabs/N.json` from R2 per request
 * and answers 404 / unavailable for anything it cannot show. Here the same objects are read once at build
 * (`FLAMENODE_SNAPSHOT_DIR`, `FLAMENODE_SNAPSHOT_MANIFEST_FILE`, `FLAMENODE_SNAPSHOT_GENERATION`, as for
 * the about stats) and projected with CURRENT normalizers, which drop every non-public video. A user with
 * no published, manifest-allowed profile object (banned, merged, unapproved, private) gets no page, so the
 * gateway answers 404. With no snapshot configured the fixtures stand in so the build stays testable.
 */
import fs from "node:fs";
import path from "node:path";
import {
  SnapshotBuildError,
  loadUserProfileSnapshot,
  loadUsersIndexSnapshot,
  userProfileSnapshotKey,
  type SnapshotManifest,
  type SnapshotSource,
} from "./publicDataLoader.ts";
import {
  STATIC_USER_COLLABS_PAGE_SIZE,
  STATIC_USER_MAX_PAGES,
  STATIC_USER_WORKS_PAGE_SIZE,
  normalizeStaticUserProfile,
  normalizeStaticUserVideoPage,
  type StaticUserProfile,
  type StaticUserVideoPage,
} from "../../../../src/lib/publicData/staticUserProfileCore.ts";
import {
  normalizeStaticUsersIndex,
  type StaticUsersIndexEntry,
} from "../../../../src/lib/publicData/staticUsersIndexCore.ts";
import { normalizeXId } from "../../../../src/lib/utils/xid.ts";
import { FIXTURE_USERS_INDEX, FIXTURE_USER_PAGES, FIXTURE_USER_PROFILES } from "./userFixtures.ts";

type Payload = Record<string, unknown>;

export interface UserBuildEntry {
  profile: StaticUserProfile;
  /** Artifact pages 2..5 that were published, keyed by artifact page number. */
  worksPages: Map<number, StaticUserVideoPage>;
  collabsPages: Map<number, StaticUserVideoPage>;
}

export interface UserBuildData {
  /** Emitted users, keyed by the normalized X ID (the URL key). */
  users: Map<string, UserBuildEntry>;
  /** CURRENT legacy index entries; null when the index object is not published. */
  index: StaticUsersIndexEntry[] | null;
  source: "snapshot" | "fixture";
}

export interface UserPayloadSource {
  kind: "snapshot" | "fixture";
  index(): Promise<Payload | null>;
  profile(id: string): Promise<Payload | null>;
  page(id: string, section: "works" | "collabs", page: number): Promise<Payload | null>;
}

const X_ID_PATTERN = /^[a-z0-9_]{1,20}$/;
/** Missing / non-public objects mean "no page"; any other failure (hash, generation, json...) fails the build. */
const SKIPPABLE = new Set(["NOT_PUBLIC", "SNAPSHOT_MISSING"]);

function skippable(error: unknown): boolean {
  return error instanceof SnapshotBuildError && SKIPPABLE.has(error.code);
}

export function fixturePayloadSource(): UserPayloadSource {
  return {
    kind: "fixture",
    async index() {
      return FIXTURE_USERS_INDEX;
    },
    async profile(id) {
      return FIXTURE_USER_PROFILES[id] ?? null;
    },
    async page(id, section, page) {
      return FIXTURE_USER_PAGES[`${id}.${section}.${page}`] ?? null;
    },
  };
}

export function snapshotPayloadSource(
  source: SnapshotSource,
  manifest: SnapshotManifest,
  generation: string,
): UserPayloadSource {
  const options = { manifest, generation } as const;
  const read = async (load: () => Promise<Payload>): Promise<Payload | null> => {
    try {
      return await load();
    } catch (error) {
      if (skippable(error)) return null;
      throw error;
    }
  };
  return {
    kind: "snapshot",
    index: () => read(() => loadUsersIndexSnapshot(source, options)),
    profile: (id) => read(() => loadUserProfileSnapshot(source, userProfileSnapshotKey(id), options)),
    page: (id, section, page) =>
      read(() => loadUserProfileSnapshot(source, userProfileSnapshotKey(id, section, page), options)),
  };
}

/** Env-configured snapshot directory, or null (fixtures). A configured but unreadable manifest throws. */
export function userPayloadSourceFromEnv(env: Record<string, string | undefined> = process.env): UserPayloadSource | null {
  const dir = env.FLAMENODE_SNAPSHOT_DIR?.trim();
  const manifestFile = env.FLAMENODE_SNAPSHOT_MANIFEST_FILE?.trim();
  const generation = env.FLAMENODE_SNAPSHOT_GENERATION?.trim();
  if (!dir || !manifestFile || !generation) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8")) as SnapshotManifest;
  const fileSource: SnapshotSource = {
    async read(key) {
      const file = path.join(dir, key);
      return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
    },
  };
  return snapshotPayloadSource(fileSource, manifest, generation);
}

async function loadPages(
  source: UserPayloadSource,
  id: string,
  section: "works" | "collabs",
  total: number,
  artifactPageSize: number,
): Promise<Map<number, StaticUserVideoPage>> {
  const pages = new Map<number, StaticUserVideoPage>();
  const last = Math.min(STATIC_USER_MAX_PAGES, Math.ceil(total / artifactPageSize));
  for (let page = 2; page <= last; page += 1) {
    const payload = await source.page(id, section, page);
    const normalized = payload ? normalizeStaticUserVideoPage(payload, page, artifactPageSize) : null;
    if (normalized) pages.set(page, normalized);
  }
  return pages;
}

/** Reads everything the three routes need. Pure of globals so tests can pass their own source. */
export async function loadUserBuildDataFrom(source: UserPayloadSource): Promise<UserBuildData> {
  const indexPayload = await source.index();
  const normalizedIndex = indexPayload ? normalizeStaticUsersIndex(indexPayload) : null;
  const index = normalizedIndex?.items ?? null;
  const users = new Map<string, UserBuildEntry>();
  for (const entry of index ?? []) {
    const id = normalizeXId(entry.x_id);
    if (!X_ID_PATTERN.test(id) || users.has(id)) continue;
    const payload = await source.profile(id);
    const profile = payload ? normalizeStaticUserProfile(payload) : null;
    // A profile object that names another user is a producer error: never publish it under this URL.
    if (!profile || normalizeXId(profile.user.id) !== id) {
      console.warn(`[user-routes] no page for ${id}: profile snapshot unavailable`);
      continue;
    }
    users.set(id, {
      profile,
      worksPages: await loadPages(source, id, "works", profile.works.total, STATIC_USER_WORKS_PAGE_SIZE),
      collabsPages: await loadPages(source, id, "collabs", profile.collabs.total, STATIC_USER_COLLABS_PAGE_SIZE),
    });
  }
  // The index lists only creators that have a page: a card must not lead to the gateway 404.
  const listed = index ? index.filter((entry) => users.has(normalizeXId(entry.x_id))) : null;
  return { users, index: listed, source: source.kind };
}

let cached: Promise<UserBuildData> | null = null;

/** One read per build process; `/user`, `/user/[id]`, the portfolio and `index.json` share it. */
export function loadUserBuildData(): Promise<UserBuildData> {
  cached ??= loadUserBuildDataFrom(userPayloadSourceFromEnv() ?? fixturePayloadSource());
  return cached;
}
