import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyImportPreviewToken } from "./importPreviewToken.ts";

test("legacy import preview token is stable across payload key order", async () => {
  const a = await buildLegacyImportPreviewToken({
    payload: { events: [{ id: "ev1", title: "Event" }], videos: [] },
    strategy: {
      events: "skip",
      videos: "merge",
      updateXUsers: false,
      importMode: "archive",
      enqueueStaticRebuild: true,
      staticRebuildStrategy: "event",
    },
  });
  const b = await buildLegacyImportPreviewToken({
    payload: { videos: [], events: [{ title: "Event", id: "ev1" }] },
    strategy: {
      staticRebuildStrategy: "event",
      enqueueStaticRebuild: true,
      importMode: "archive",
      updateXUsers: false,
      videos: "merge",
      events: "skip",
    },
  });

  assert.equal(a, b);
});

test("legacy import preview token changes with conflict strategy", async () => {
  const base = {
    payload: { events: [{ id: "ev1", title: "Event" }], videos: [] },
    strategy: {
      videos: "skip",
      updateXUsers: false,
      importMode: "archive",
      enqueueStaticRebuild: true,
      staticRebuildStrategy: "event",
    },
  };

  const skip = await buildLegacyImportPreviewToken({
    ...base,
    strategy: { ...base.strategy, events: "skip" },
  });
  const update = await buildLegacyImportPreviewToken({
    ...base,
    strategy: { ...base.strategy, events: "update" },
  });

  assert.notEqual(skip, update);
});

test("legacy import preview token changes with payload content", async () => {
  const base = {
    strategy: {
      events: "skip",
      videos: "merge",
      updateXUsers: false,
      importMode: "archive",
      enqueueStaticRebuild: true,
      staticRebuildStrategy: "event",
    },
  };

  const original = await buildLegacyImportPreviewToken({
    ...base,
    payload: { events: [{ id: "ev1", title: "Event" }], videos: [] },
  });
  const changed = await buildLegacyImportPreviewToken({
    ...base,
    payload: { events: [{ id: "ev1", title: "Changed" }], videos: [] },
  });

  assert.notEqual(original, changed);
});

test("legacy import preview token changes with static rebuild strategy", async () => {
  const base = {
    payload: { events: [{ id: "ev1", title: "Event" }], videos: [] },
    strategy: {
      events: "skip",
      videos: "merge",
      updateXUsers: false,
      importMode: "archive",
      enqueueStaticRebuild: true,
      staticRebuildStrategy: "event",
    },
  };

  const eventOnly = await buildLegacyImportPreviewToken(base);
  const full = await buildLegacyImportPreviewToken({
    ...base,
    strategy: { ...base.strategy, staticRebuildStrategy: "full" },
  });

  assert.notEqual(eventOnly, full);
});

test("legacy import preview token changes when static rebuild enqueue changes", async () => {
  const base = {
    payload: { events: [{ id: "ev1", title: "Event" }], videos: [] },
    strategy: {
      events: "skip",
      videos: "merge",
      updateXUsers: false,
      importMode: "archive",
      staticRebuildStrategy: "event",
    },
  };

  const enabled = await buildLegacyImportPreviewToken({
    ...base,
    strategy: { ...base.strategy, enqueueStaticRebuild: true },
  });
  const disabled = await buildLegacyImportPreviewToken({
    ...base,
    strategy: { ...base.strategy, enqueueStaticRebuild: false },
  });

  assert.notEqual(enabled, disabled);
});
