/**
 * Table mirror for the event and video snapshot kinds (MIG-0509). CURRENT's event and video generators
 * (`rebuildEvent*`, `rebuildVideo` with its multi-stage related-video ranking) have no faithful set-based
 * equivalent short of re-implementing about 600 lines of SQL and ranking. Instead of copying that logic, the
 * tables those generators read are copied once, with a small number of keyset-paged SELECTs through the
 * read-only reader, into the schema-only scratch database; CURRENT's generators then run against the scratch
 * unchanged, so the objects are CURRENT's by construction (the parity test compares them with a run against the
 * full source database). Everything stays in the build process memory; nothing is uploaded.
 */
export interface MirrorSource {
  prepare(sql: string): { bind(...values: unknown[]): unknown };
}

type Row = Record<string, unknown>;

/** Tables read by the event and video generators (the test asserts every table in their SQL is listed or tracking). */
export const MIRRORED_TABLES = [
  "events",
  "event_staff",
  "event_groups",
  "event_group_events",
  "slots",
  "videos",
  "video_events",
  "video_members",
  "video_chapters",
  "video_softwares",
  "software_catalog",
  "x_users",
  "event_youtube_playlist_sync",
  "video_youtube_metadata",
  // Fence state is read by the generators (a pending fence must behave as in CURRENT, not as "no fence").
  "public_visibility_fences",
] as const;

export const DEFAULT_MIRROR_PAGE_SIZE = 300;

async function rows(db: MirrorSource, sql: string, ...values: unknown[]): Promise<Row[]> {
  const statement = db.prepare(sql).bind(...values) as { all(): Promise<{ results?: Row[] }> };
  return (await statement.all()).results ?? [];
}

async function run(db: MirrorSource, sql: string, ...values: unknown[]): Promise<void> {
  await (db.prepare(sql).bind(...values) as { run(): Promise<unknown> }).run();
}

export interface MirrorReport {
  statements: number;
  rows: number;
}

/**
 * Copies `tables` into `scratch` (same schema). Keyset paging on `rowid`; columns come from the scratch schema so a
 * column the source lacks fails loudly. Triggers of the scratch are dropped first: rows are inserted as they are.
 */
export async function mirrorTables(
  remote: MirrorSource,
  scratch: MirrorSource,
  tables: readonly string[] = MIRRORED_TABLES,
  pageSize: number = DEFAULT_MIRROR_PAGE_SIZE,
): Promise<MirrorReport> {
  const report: MirrorReport = { statements: 0, rows: 0 };
  // Tables are filled one after the other, in any order; the source already satisfied its own constraints.
  await run(scratch, "PRAGMA foreign_keys = OFF");
  for (const trigger of await rows(scratch, `SELECT name FROM sqlite_master WHERE type = 'trigger'`)) {
    await run(scratch, `DROP TRIGGER IF EXISTS "${String(trigger.name)}"`);
  }
  for (const table of tables) {
    const columns = (await rows(scratch, `PRAGMA table_info("${table}")`)).map((c) => String(c.name));
    if (columns.length === 0) throw new Error(`mirror: table ${table} is not in the schema`);
    const quoted = columns.map((c) => `"${c}"`).join(", ");
    const insert = `INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${columns.map(() => "?").join(", ")})`;
    let after = -1;
    for (;;) {
      const page = await rows(
        remote,
        `SELECT rowid AS __rid, ${quoted} FROM "${table}" WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`,
        after,
        pageSize,
      );
      report.statements += 1;
      for (const row of page) {
        await run(scratch, insert, ...columns.map((c) => row[c] ?? null));
        report.rows += 1;
      }
      if (page.length < pageSize) break;
      after = Number(page[page.length - 1].__rid);
    }
  }
  return report;
}
