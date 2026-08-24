import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";

if (process.env.FLAMENODE_PUBLIC_EVENT_STAFF_ROUTE_EXECUTION !== "1") {
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
        FLAMENODE_PUBLIC_EVENT_STAFF_ROUTE_EXECUTION: "1",
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

  let currentBucket;
  mock.module("@opennextjs/cloudflare", {
    namedExports: {
      getCloudflareContext() {
        return { env: { BUCKET: currentBucket } };
      },
    },
  });
  mock.module("react", {
    namedExports: {
      cache(fn) {
        return fn;
      },
    },
  });

  const { GET, OPTIONS } = await import(
    "../../../app/api/public/events/[id]/staff/route.ts"
  );

  const manifestKey = "visibility/blocked-entities.v1.json";
  const eventKey = "events/PVSF2026Sp/base.v1.json";

  function eventArtifact() {
    return {
      generated_at: 1_700_000_000,
      event: {
        id: "PVSF2026Sp",
        title: "PVSF 2026 Spring",
        visibility_status: "public",
      },
      public_staff: [
        {
          display_name: "Mochi",
          public_role_label: "主催",
          x_user_id: "mochi_staff",
          x_name: "Mochi",
          icon_url: null,
          permission_preset: "owner",
        },
      ],
    };
  }

  function manifestObject(etag, entities = []) {
    const value = JSON.stringify({
      schema_version: 1,
      revision: 1,
      generated_at: 1_700_000_000,
      entities,
    });
    return {
      etag,
      size: new TextEncoder().encode(value).byteLength,
      async text() {
        return value;
      },
    };
  }

  function artifactObject(value = eventArtifact()) {
    const serialized = JSON.stringify(value);
    return {
      size: new TextEncoder().encode(serialized).byteLength,
      async json() {
        return value;
      },
    };
  }

  function bucketHarness({ manifests, artifact = artifactObject() }) {
    const gets = [];
    let manifestIndex = 0;
    currentBucket = {
      async get(key) {
        gets.push(key);
        if (key === manifestKey) {
          const index = Math.min(manifestIndex, manifests.length - 1);
          manifestIndex += 1;
          const value = manifests[index];
          if (value instanceof Error) throw value;
          return value;
        }
        if (key === eventKey) {
          if (artifact instanceof Error) throw artifact;
          return artifact;
        }
        return null;
      },
    };
    return gets;
  }

  function request(headers = {}) {
    return new Request(
      "https://flamenode.example/api/public/events/PVSF2026Sp/staff",
      { headers },
    );
  }

  function params(id = "PVSF2026Sp") {
    return { params: Promise.resolve({ id }) };
  }

  test("GET returns the allowlist DTO from R2 with ETag and PVSF CORS", async () => {
    const gets = bucketHarness({
      manifests: [manifestObject('"manifest-1"')],
    });
    const response = await GET(
      request({ Origin: "https://pvsf.jp" }),
      params(),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(gets, [manifestKey, eventKey, manifestKey]);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://pvsf.jp",
    );
    assert.match(response.headers.get("Vary") ?? "", /Origin/);
    assert.equal(
      response.headers.get("Cache-Control"),
      "public, max-age=0, must-revalidate",
    );
    assert.equal(
      response.headers.get("Cloudflare-CDN-Cache-Control"),
      "no-store",
    );
    assert.match(response.headers.get("ETag") ?? "", /^"[a-f0-9]{64}"$/);
    const payload = await response.json();
    assert.deepEqual(payload.staff, [
      {
        display_name: "Mochi",
        role_label: "主催",
        x_id: "mochi_staff",
        x_name: "Mochi",
        icon_url: null,
        has_public_profile: false,
      },
    ]);
    assert.equal(payload.event_id, "PVSF2026Sp");
    assert.equal("permission_preset" in payload.staff[0], false);
  });

  test("GET honors If-None-Match only after both visibility reads", async () => {
    bucketHarness({ manifests: [manifestObject('"manifest-1"')] });
    const first = await GET(request(), params());
    const etag = first.headers.get("ETag");
    assert.ok(etag);

    const gets = bucketHarness({
      manifests: [manifestObject('"manifest-1"')],
    });
    const conditional = await GET(
      request({ "If-None-Match": etag }),
      params(),
    );
    assert.equal(conditional.status, 304);
    assert.deepEqual(gets, [manifestKey, eventKey, manifestKey]);
  });

  test("GET and OPTIONS allow the verified www PVSF origin", async () => {
    const gets = bucketHarness({
      manifests: [manifestObject('"manifest-www"')],
    });
    const response = await GET(
      request({ Origin: "https://www.pvsf.jp" }),
      params(),
    );
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://www.pvsf.jp",
    );
    assert.deepEqual(gets, [manifestKey, eventKey, manifestKey]);

    const preflight = await OPTIONS(
      new Request("https://flamenode.example/api/public/events/e/staff", {
        method: "OPTIONS",
        headers: {
          Origin: "https://www.pvsf.jp",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("Access-Control-Allow-Origin"),
      "https://www.pvsf.jp",
    );
  });

  test("GET blocks fenced events and manifest races without reading D1", async () => {
    const blockedGets = bucketHarness({
      manifests: [
        manifestObject('"manifest-blocked"', [
          {
            entity_type: "event",
            entity_id: "PVSF2026Sp",
            fence_token: "fence-1",
            blocked_at: 1_700_000_000,
          },
        ]),
      ],
    });
    const blocked = await GET(request(), params());
    assert.equal(blocked.status, 404);
    assert.deepEqual(blockedGets, [manifestKey]);

    const raceGets = bucketHarness({
      manifests: [
        manifestObject('"manifest-1"'),
        manifestObject('"manifest-2"'),
      ],
    });
    const race = await GET(request(), params());
    assert.equal(race.status, 503);
    assert.deepEqual(raceGets, [manifestKey, eventKey, manifestKey]);
    assert.equal((await race.json()).error, "public_visibility_manifest_changed");
  });

  test("GET filters staff whose X user is fenced while preserving the event artifact", async () => {
    const gets = bucketHarness({
      manifests: [
        manifestObject('"manifest-x-user-blocked"', [
          {
            entity_type: "x_user",
            entity_id: "mochi_staff",
            fence_token: "x-fence-1",
            blocked_at: 1_700_000_000,
          },
        ]),
      ],
    });
    const response = await GET(request(), params());
    assert.equal(response.status, 200);
    assert.deepEqual(gets, [manifestKey, eventKey, manifestKey]);
    const payload = await response.json();
    assert.deepEqual(payload.staff, []);
  });

  test("GET maps missing manifest/artifact and malformed path to fail-closed responses", async () => {
    const missingManifestGets = bucketHarness({ manifests: [null] });
    const missingManifest = await GET(request(), params());
    assert.equal(missingManifest.status, 503);
    assert.equal(
      (await missingManifest.json()).error,
      "public_visibility_manifest_unavailable",
    );
    assert.deepEqual(missingManifestGets, [manifestKey]);

    const missingArtifactGets = bucketHarness({
      manifests: [manifestObject('"manifest-1"')],
      artifact: null,
    });
    const missingArtifact = await GET(request(), params());
    assert.equal(missingArtifact.status, 503);
    assert.equal((await missingArtifact.json()).error, "public_data_unavailable");
    assert.deepEqual(missingArtifactGets, [manifestKey, eventKey]);

    const invalidPathGets = bucketHarness({
      manifests: [manifestObject('"manifest-1"')],
    });
    const invalidPath = await GET(request(), params("a%2Fb"));
    assert.equal(invalidPath.status, 404);
    assert.deepEqual(invalidPathGets, []);
  });

  test("OPTIONS allows only the exact PVSF origin and conditional GET header", async () => {
    const allowed = await OPTIONS(
      new Request("https://flamenode.example/api/public/events/e/staff", {
        method: "OPTIONS",
        headers: {
          Origin: "https://pvsf.jp",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "If-None-Match",
        },
      }),
    );
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("Access-Control-Allow-Origin"),
      "https://pvsf.jp",
    );
    assert.match(
      allowed.headers.get("Vary") ?? "",
      /Access-Control-Request-Headers/,
    );

    const denied = await OPTIONS(
      new Request("https://flamenode.example/api/public/events/e/staff", {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  });
}
