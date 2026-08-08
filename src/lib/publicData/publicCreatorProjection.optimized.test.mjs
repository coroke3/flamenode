import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  buildPublicUsersIndexItems,
  loadPublicCreatorProjectionSources,
} from "./publicCreatorProjection.ts";

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE x_users (
      id TEXT PRIMARY KEY,
      x_name TEXT,
      icon_url TEXT,
      profile_text TEXT,
      youtube_channel_url TEXT,
      approval_status TEXT
    );
    CREATE TABLE videos (
      id TEXT PRIMARY KEY,
      creator_x_user_id TEXT,
      creator_display_name TEXT,
      creator_icon_url TEXT,
      collaboration_type TEXT,
      visibility_status TEXT NOT NULL,
      primary_event_id TEXT,
      scheduled_time INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE video_members (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      x_user_id TEXT
    );
    CREATE TABLE video_events (
      video_id TEXT NOT NULL,
      event_id TEXT NOT NULL
    );
  `);

  let prepareCount = 0;
  const d1 = {
    prepare(sql) {
      prepareCount += 1;
      let params = [];
      const statement = {
        bind(...values) {
          params = values;
          return statement;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...params) };
        },
      };
      return statement;
    },
  };
  return { sqlite, d1, getPrepareCount: () => prepareCount };
}

function insertVideo(sqlite, {
  id,
  creator,
  display = creator,
  icon = null,
  collaboration = "individual",
  visibility = "public",
  event = null,
  scheduled = 0,
  created = scheduled,
  updated = scheduled,
}) {
  sqlite.prepare(`
    INSERT INTO videos (
      id, creator_x_user_id, creator_display_name, creator_icon_url,
      collaboration_type, visibility_status, primary_event_id,
      scheduled_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    creator,
    display,
    icon,
    collaboration,
    visibility,
    event,
    scheduled,
    created,
    updated,
  );
}

test("creator projection は8 query相当を3 queryへ統合し既存意味論を維持する", async () => {
  const { sqlite, d1, getPrepareCount } = createDb();
  try {
    sqlite.prepare(
      "INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)",
    ).run("registered", "Registered", "approved");
    sqlite.prepare(
      "INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)",
    ).run("known-pending", "Pending", "pending");
    sqlite.prepare(
      "INSERT INTO x_users (id, x_name, approval_status) VALUES (?, ?, ?)",
    ).run("icon-user", "Icon User", "approved");

    insertVideo(sqlite, {
      id: "registered-own",
      creator: "registered",
      display: "Registered Snapshot",
      scheduled: 100,
      updated: 100,
    });
    insertVideo(sqlite, {
      id: "known-pending-own",
      creator: "known-pending",
      display: "Pending Snapshot",
      scheduled: 200,
      updated: 200,
    });
    insertVideo(sqlite, {
      id: "orphan-own",
      creator: "orphan",
      display: "Orphan Snapshot",
      scheduled: 300,
      updated: 300,
    });
    insertVideo(sqlite, {
      id: "other-own",
      creator: "registered",
      display: "Registered New",
      scheduled: 900,
      updated: 900,
    });
    sqlite.prepare(
      "INSERT INTO video_members (id, video_id, x_user_id) VALUES (?, ?, ?)",
    ).run("member-orphan", "other-own", "orphan");

    insertVideo(sqlite, {
      id: "both-role",
      creator: "both-role",
      display: "Both",
      scheduled: 400,
      updated: 400,
    });
    sqlite.prepare(
      "INSERT INTO video_members (id, video_id, x_user_id) VALUES (?, ?, ?)",
    ).run("member-both", "both-role", "both-role");

    insertVideo(sqlite, {
      id: "icon-individual",
      creator: "icon-user",
      display: "Icon Individual",
      icon: "https://example.com/individual.png",
      collaboration: "individual",
      scheduled: 100,
      created: 100,
      updated: 100,
    });
    insertVideo(sqlite, {
      id: "icon-collab",
      creator: "icon-user",
      display: "Icon Collab",
      icon: "https://example.com/collab.png",
      collaboration: "collab",
      scheduled: 800,
      created: 800,
      updated: 800,
    });

    insertVideo(sqlite, {
      id: "summary-primary",
      creator: "summary-only",
      event: "PVSFSummary",
      scheduled: 1000,
      updated: 1000,
    });
    insertVideo(sqlite, {
      id: "summary-linked",
      creator: "summary-linked",
      scheduled: 1100,
      updated: 1100,
    });
    sqlite.prepare(
      "INSERT INTO video_events (video_id, event_id) VALUES (?, ?)",
    ).run("summary-linked", "PVSFSummary");
    insertVideo(sqlite, {
      id: "private-video",
      creator: "private-only",
      visibility: "private",
      scheduled: 1200,
      updated: 1200,
    });

    const sources = await loadPublicCreatorProjectionSources(d1, 9999);
    assert.equal(getPrepareCount(), 3, "projection input should use exactly three D1 statements");

    assert.deepEqual(
      sources.registeredUsers.map((row) => row.id).sort(),
      ["icon-user", "registered"],
      "pending x_user must not be publicly registered",
    );
    assert.equal(
      sources.orphans.some((row) => row.x_id === "known-pending"),
      false,
      "existing but unapproved x_user must not be misclassified as orphan",
    );

    const orphan = sources.orphans.find((row) => row.x_id === "orphan");
    assert.deepEqual(orphan, {
      x_id: "orphan",
      personal_count: 1,
      updated_at: 300,
    });
    assert.equal(sources.collabCounts.get("orphan"), 1);
    assert.equal(sources.totalWorks.get("orphan"), 2);

    assert.equal(sources.personalCounts.get("both-role"), 1);
    assert.equal(sources.collabCounts.get("both-role"), 1);
    assert.equal(
      sources.totalWorks.get("both-role"),
      1,
      "same video in personal and collab relation must be counted once in total",
    );

    assert.equal(
      sources.iconUrls.get("icon-user"),
      "https://example.com/individual.png",
      "icon fallback must keep individual-video priority",
    );
    assert.equal(sources.totalWorks.has("summary-only"), false);
    assert.equal(sources.totalWorks.has("summary-linked"), false);
    assert.equal(sources.totalWorks.has("private-only"), false);

    const items = buildPublicUsersIndexItems(sources, 9999);
    const orphanItem = items.find((row) => row.x_id === "orphan");
    assert.equal(orphanItem?.personal_count, 1);
    assert.equal(orphanItem?.collab_count, 0);
    assert.equal(orphanItem?.total_works, 1);
  } finally {
    sqlite.close();
  }
});
