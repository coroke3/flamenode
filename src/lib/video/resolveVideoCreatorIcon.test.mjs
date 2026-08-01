import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_RESOLVE_VIDEO_ICON_EXECUTION !== "1") {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--test",
      fileURLToPath(import.meta.url),
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TEST_CONTEXT: undefined,
        FLAMENODE_RESOLVE_VIDEO_ICON_EXECUTION: "1",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return {
          url: "data:text/javascript,export%20{}",
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  let currentHarness;

  mock.module("@/lib/cloudflare", {
    namedExports: {
      getEnv() {
        return currentHarness.env;
      },
    },
  });

  mock.module("@/lib/db/xIconResolution", {
    namedExports: {
      async getXIconCandidates(db, activeXId, limit) {
        return currentHarness.getXIconCandidates(db, activeXId, limit);
      },
    },
  });

  const {
    resolveVideoCreatorIcon,
    rollbackUploadedVideoIcon,
  } = await import("./resolveVideoCreatorIcon.ts");

  function pushChunk(parts, type, data) {
    const length = data.length;
    parts.push(
      (length >> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    );
    for (let i = 0; i < 4; i += 1) parts.push(type.charCodeAt(i));
    for (const byte of data) parts.push(byte);
    parts.push(0, 0, 0, 0);
  }

  function buildPng({ width = 64, height = 64 } = {}) {
    const parts = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 2;
    pushChunk(parts, "IHDR", ihdr);
    pushChunk(parts, "IDAT", new Uint8Array([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff]));
    pushChunk(parts, "IEND", new Uint8Array(0));
    return new Uint8Array(parts);
  }

  function createHarness({ candidates = [] } = {}) {
    const puts = [];
    const deletes = [];
    const bucket = {
      put: async (key, buffer, opts) => {
        puts.push({ key, buffer, opts });
      },
      delete: async (key) => {
        deletes.push(key);
      },
    };
    const dbAccess = [];
    const db = new Proxy(
      {},
      {
        get(_target, prop) {
          return (...args) => {
            dbAccess.push({ prop: String(prop), args });
            throw new Error(`unexpected db.${String(prop)}`);
          };
        },
      },
    );
    const getCandidatesCalls = [];
    const harness = {
      env: { BUCKET: bucket },
      puts,
      deletes,
      db,
      dbAccess,
      getCandidatesCalls,
      async getXIconCandidates(dbArg, activeXId, limit) {
        getCandidatesCalls.push({ dbArg, activeXId, limit });
        return candidates;
      },
    };
    return harness;
  }

  function baseArgs(harness, overrides = {}) {
    const formData = new FormData();
    return {
      formData,
      parsed: { icon_mode: "keep", icon_url: null },
      activeXId: "x-user-1",
      videoId: "video-1",
      existingIconUrl: "/api/media/video-icons/x-user-1/existing.png",
      db: harness.db,
      ...overrides,
    };
  }

  test("mode=keep は existingIconUrl を返し R2 put しない", async () => {
    currentHarness = createHarness();
    const existingIconUrl = "/api/media/video-icons/x-user-1/existing.png";

    const result = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        parsed: { icon_mode: "keep", icon_url: null },
        existingIconUrl,
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      value: { iconUrl: existingIconUrl, uploadedKey: null },
    });
    assert.deepEqual(currentHarness.puts, []);
    assert.deepEqual(currentHarness.getCandidatesCalls, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("mode=none は iconUrl=null", async () => {
    currentHarness = createHarness();

    const result = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        parsed: { icon_mode: "none", icon_url: null },
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      value: { iconUrl: null, uploadedKey: null },
    });
    assert.deepEqual(currentHarness.puts, []);
    assert.deepEqual(currentHarness.getCandidatesCalls, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("mode=existing + 外部 https URL は候補チェックなしで ok", async () => {
    currentHarness = createHarness();
    const iconUrl = "https://example.com/icon.png";

    const result = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        parsed: { icon_mode: "existing", icon_url: iconUrl },
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      value: { iconUrl, uploadedKey: null },
    });
    assert.deepEqual(currentHarness.getCandidatesCalls, []);
    assert.deepEqual(currentHarness.puts, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("mode=existing + /api/media/ が候補外なら拒否", async () => {
    currentHarness = createHarness({ candidates: [] });
    const iconUrl = "/api/media/xicons/x-user-1/other.webp";

    const result = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        parsed: { icon_mode: "existing", icon_url: iconUrl },
      }),
    });

    assert.deepEqual(result, {
      ok: false,
      message: "選択できないアイコンです。",
    });
    assert.equal(currentHarness.getCandidatesCalls.length, 1);
    assert.deepEqual(currentHarness.getCandidatesCalls[0], {
      dbArg: currentHarness.db,
      activeXId: "x-user-1",
      limit: 40,
    });
    assert.deepEqual(currentHarness.puts, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("mode=existing + /api/media/ が候補内なら ok で R2 put しない", async () => {
    const iconUrl = "/api/media/xicons/x-user-1/candidate.webp";
    currentHarness = createHarness({ candidates: [iconUrl] });

    const result = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        parsed: { icon_mode: "existing", icon_url: iconUrl },
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      value: { iconUrl, uploadedKey: null },
    });
    assert.equal(currentHarness.getCandidatesCalls.length, 1);
    assert.deepEqual(currentHarness.puts, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("mode=upload + 空または非 File は拒否", async () => {
    currentHarness = createHarness();

    const missingFile = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        parsed: { icon_mode: "upload", icon_url: null },
      }),
    });
    assert.deepEqual(missingFile, {
      ok: false,
      message: "画像ファイルが必要です。",
    });

    const formData = new FormData();
    formData.set("icon_file", new File([], "empty.png", { type: "image/png" }));
    const emptyFile = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        formData,
        parsed: { icon_mode: "upload", icon_url: null },
      }),
    });
    assert.deepEqual(emptyFile, {
      ok: false,
      message: "画像ファイルが必要です。",
    });

    const nonFileForm = new FormData();
    nonFileForm.set("icon_file", "not-a-file");
    const nonFile = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        formData: nonFileForm,
        parsed: { icon_mode: "upload", icon_url: null },
      }),
    });
    assert.deepEqual(nonFile, {
      ok: false,
      message: "画像ファイルが必要です。",
    });
    assert.deepEqual(currentHarness.puts, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("mode=upload + 有効な最小 PNG は R2 put され uploadedKey を返す", async () => {
    currentHarness = createHarness();
    const png = buildPng({ width: 64, height: 64 });
    const formData = new FormData();
    formData.set("icon_file", new File([png], "icon.png", { type: "image/png" }));

    const result = await resolveVideoCreatorIcon({
      ...baseArgs(currentHarness, {
        formData,
        parsed: { icon_mode: "upload", icon_url: null },
        activeXId: "x-user-1",
        videoId: "video-1",
      }),
    });

    const expectedKey = "video-icons/x-user-1/video-1.png";
    assert.deepEqual(result, {
      ok: true,
      value: {
        iconUrl: `/api/media/${expectedKey}`,
        uploadedKey: expectedKey,
      },
    });
    assert.equal(currentHarness.puts.length, 1);
    assert.equal(currentHarness.puts[0].key, expectedKey);
    assert.equal(currentHarness.puts[0].opts.httpMetadata.contentType, "image/png");
    assert.deepEqual(currentHarness.getCandidatesCalls, []);
    assert.deepEqual(currentHarness.dbAccess, []);
  });

  test("rollbackUploadedVideoIcon は BUCKET.delete を呼ぶ", async () => {
    currentHarness = createHarness();
    const key = "video-icons/x-user-1/video-1.png";

    await rollbackUploadedVideoIcon(key);

    assert.deepEqual(currentHarness.deletes, [key]);
  });

  test("resolve 経路は db 更新や x_users 参照をしない", async () => {
    const mediaIcon = "/api/media/xicons/x-user-1/candidate.webp";
    currentHarness = createHarness({ candidates: [mediaIcon] });
    const png = buildPng({ width: 64, height: 64 });

    const scenarios = [
      {
        label: "keep",
        args: baseArgs(currentHarness, {
          parsed: { icon_mode: "keep", icon_url: null },
        }),
      },
      {
        label: "none",
        args: baseArgs(currentHarness, {
          parsed: { icon_mode: "none", icon_url: null },
        }),
      },
      {
        label: "existing-external",
        args: baseArgs(currentHarness, {
          parsed: {
            icon_mode: "existing",
            icon_url: "https://cdn.example.com/icon.png",
          },
        }),
      },
      {
        label: "existing-media",
        args: baseArgs(currentHarness, {
          parsed: { icon_mode: "existing", icon_url: mediaIcon },
        }),
      },
      {
        label: "upload",
        args: (() => {
          const formData = new FormData();
          formData.set(
            "icon_file",
            new File([png], "icon.png", { type: "image/png" }),
          );
          return baseArgs(currentHarness, {
            formData,
            parsed: { icon_mode: "upload", icon_url: null },
          });
        })(),
      },
    ];

    for (const scenario of scenarios) {
      currentHarness.dbAccess.length = 0;
      const result = await resolveVideoCreatorIcon(scenario.args);
      assert.equal(result.ok, true, `${scenario.label} should resolve`);
      assert.deepEqual(
        currentHarness.dbAccess,
        [],
        `${scenario.label} must not touch db methods`,
      );
    }

    assert.equal(
      currentHarness.getCandidatesCalls.length,
      1,
      "getXIconCandidates is only used for /api/media existing icons",
    );
    assert.equal(currentHarness.puts.length, 1, "only upload mode performs R2 put");
  });
}
