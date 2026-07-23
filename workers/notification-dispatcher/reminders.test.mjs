import assert from "node:assert/strict";
import { test } from "node:test";
import { enqueueSlotDeadlineReminders } from "./reminders.ts";

function createDb(groups = [], onGroupsRead) {
  const statements = [];
  const boundValues = [];
  return {
    statements,
    boundValues,
    prepare(sql) {
      statements.push(sql);
      let values = [];
      return {
        bind(...nextValues) {
          values = nextValues;
          boundValues.push({ sql, values });
          return this;
        },
        async all() {
          onGroupsRead?.();
          return { results: groups };
        },
        async run() {
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

test("reminder URLはNEXT_PUBLIC_SITE_URLだけを正本にする", async () => {
  const DB = createDb([
    {
      event_id: "event-1",
      recipient_user_id: "user-1",
      event_title: "テストイベント",
      entry_end_time: 1_800_000_000,
      slot_count: 2,
    },
  ]);

  assert.equal(
    await enqueueSlotDeadlineReminders({
      DB,
      NEXT_PUBLIC_SITE_URL: "https://flamenode.example/",
      APP_ORIGIN: "https://attacker.example",
      NEXT_PUBLIC_APP_URL: "https://legacy.example",
    }),
    1,
  );

  const insert = DB.boundValues.find(({ sql }) =>
    sql.includes("INSERT INTO notification_outbox"),
  );
  const payload = JSON.parse(insert.values[2]);
  assert.match(
    payload.content,
    /https:\/\/flamenode\.example\/event\/event-1\/slots/,
  );
  assert.match(
    payload.content,
    /https:\/\/flamenode\.example\/event\/event-1/,
  );
  assert.doesNotMatch(payload.content, /attacker|legacy/);
});

test("reminderはsite URLの未設定・不正・localhostをfail-closedにする", async () => {
  const invalidValues = [
    undefined,
    "not-a-url",
    "http://flamenode.example",
    "https://localhost:3000",
    "https://sub.localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://flamenode.example/path",
  ];

  for (const NEXT_PUBLIC_SITE_URL of invalidValues) {
    const DB = createDb();
    await assert.rejects(
      enqueueSlotDeadlineReminders({ DB, NEXT_PUBLIC_SITE_URL }),
      /NEXT_PUBLIC_SITE_URL (?:is|required)/,
    );
    assert.equal(DB.statements.length, 0);
  }
});

test("reminderはAbortSignalを副作用前に確認する", async () => {
  const controller = new AbortController();
  const DB = createDb(
    [
      {
        event_id: "event-1",
        recipient_user_id: "user-1",
        event_title: "テストイベント",
        entry_end_time: 1_800_000_000,
        slot_count: 1,
      },
    ],
    () => controller.abort(new Error("deadline reached")),
  );

  await assert.rejects(
    enqueueSlotDeadlineReminders(
      { DB, NEXT_PUBLIC_SITE_URL: "https://flamenode.example" },
      50,
      controller.signal,
    ),
    /deadline reached/,
  );
  assert.equal(
    DB.statements.some((sql) => sql.includes("INSERT INTO notification_outbox")),
    false,
  );
});
