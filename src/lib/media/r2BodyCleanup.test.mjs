import assert from "node:assert/strict";
import test from "node:test";
import { cancelR2BodyBestEffort } from "../r2Body.ts";
import {
  PUBLIC_MEDIA_ACCESS_SQL,
  servePublicMedia,
} from "./publicMedia.ts";
import {
  createManageXIconUrl,
  serveManageXIcon,
} from "./manageXIcon.ts";
import { serveSlotSubmissionIconRow } from "./slotSubmissionIcon.ts";

function cancellableBody(state) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel() {
      state.cancelled += 1;
    },
  });
}

function publicMediaEnv(state, options = {}) {
  return {
    DB: {
      prepare(sql) {
        assert.equal(sql, PUBLIC_MEDIA_ACCESS_SQL);
        return {
          bind() {
            return {
              async first() {
                return { allowed: 1 };
              },
            };
          },
        };
      },
    },
    BUCKET: {
      async get() {
        return {
          size: options.size ?? 3,
          body: cancellableBody(state),
          httpEtag: '"etag"',
          httpMetadata: { contentType: options.contentType ?? "image/webp" },
        };
      },
    },
  };
}

test("R2 cleanup helperはcancel失敗を元の処理へ伝播させない", async () => {
  await assert.doesNotReject(() =>
    cancelR2BodyBestEffort({
      body: {
        async cancel() {
          throw new Error("cancel failed");
        },
      },
    }),
  );
});

test("public mediaはunsafe objectのR2 bodyを404前に解放する", async () => {
  const state = { cancelled: 0 };
  const response = await servePublicMedia(
    publicMediaEnv(state, { contentType: "image/svg+xml" }),
    "event-icons/event/icon.svg",
  );
  assert.equal(response.status, 404);
  assert.equal(state.cancelled, 1);
});

test("public mediaは304で返すR2 bodyを解放する", async () => {
  const state = { cancelled: 0 };
  const response = await servePublicMedia(
    publicMediaEnv(state),
    "event-icons/event/icon.webp",
    new Request("https://example.test/api/media/event-icons/event/icon.webp", {
      headers: { "If-None-Match": '"etag"' },
    }),
  );
  assert.equal(response.status, 304);
  assert.equal(state.cancelled, 1);
});

test("manage iconは304で返すR2 bodyを解放する", async () => {
  const secret = "r2-cleanup-manage-icon-secret";
  const signed = await createManageXIconUrl("xicons/user/icon.webp", secret);
  assert.ok(signed);
  const parsed = new URL(`https://example.test${signed}`);
  const state = { cancelled: 0 };
  const response = await serveManageXIcon(
    {
      AUTH_SECRET: secret,
      BUCKET: {
        async get() {
          return {
            size: 3,
            body: cancellableBody(state),
            httpEtag: '"manage-etag"',
            httpMetadata: { contentType: "image/webp" },
          };
        },
      },
    },
    "xicons/user/icon.webp",
    new Request(parsed, { headers: { "If-None-Match": '"manage-etag"' } }),
  );
  assert.equal(response.status, 304);
  assert.equal(state.cancelled, 1);
});

test("slot submission iconはunsafe objectのR2 bodyを404前に解放する", async () => {
  const state = { cancelled: 0 };
  const response = await serveSlotSubmissionIconRow(
    {
      BUCKET: {
        async get() {
          return {
            size: 3,
            body: cancellableBody(state),
            httpEtag: '"slot-etag"',
            httpMetadata: { contentType: "image/svg+xml" },
          };
        },
      },
    },
    {
      slot_status: "submitted",
      reserved_by_user_id: "user-1",
      slot_x_user_id: "x-1",
      slot_visibility_mode: "public_name",
      event_visibility_status: "public",
      creator_icon_url: "/api/media/xicons/user/icon.svg",
    },
    null,
  );
  assert.equal(response.status, 404);
  assert.equal(state.cancelled, 1);
});
