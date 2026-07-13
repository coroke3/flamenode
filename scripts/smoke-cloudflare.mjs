#!/usr/bin/env node

const siteUrl =
  process.env.SITE_URL?.replace(/\/$/, "");

const workerUrls = [
  ["fast-jobs", process.env.FAST_JOBS_URL],
  ["content-jobs", process.env.CONTENT_JOBS_URL],
  ["sync-jobs", process.env.SYNC_JOBS_URL],
].filter(([, url]) => Boolean(url));

const expectedCommit =
  process.env.BUILD_COMMIT_SHA ??
  process.env.GITHUB_SHA ??
  null;

async function request(
  url,
  options = {},
) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller =
      new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      15_000,
    );

    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        ...options,
      });

      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      if (attempt < 3) {
        await new Promise((resolve) =>
          setTimeout(resolve, 2000),
        );
      }
    }
  }

  throw lastError;
}

function assertStatus(
  response,
  label,
  accepted,
) {
  if (!accepted(response.status)) {
    throw new Error(
      `${label}: unexpected status ${response.status}`,
    );
  }
}

if (!siteUrl) {
  throw new Error(
    "SITE_URL is required.",
  );
}

const top = await request(siteUrl);
assertStatus(
  top,
  "top page",
  (status) => status >= 200 && status < 400,
);

const html = await top.text();
const asset =
  html.match(
    /\/_next\/static\/[^"'\s]+/,
  )?.[0];

if (!asset) {
  throw new Error(
    "No Next.js static asset found.",
  );
}

const assetResponse =
  await request(`${siteUrl}${asset}`);

assertStatus(
  assetResponse,
  "Next.js asset",
  (status) => status === 200,
);

const health =
  await request(`${siteUrl}/api/health`);

assertStatus(
  health,
  "Pages health",
  (status) => status === 200,
);

const auth =
  await request(
    `${siteUrl}/api/auth/callback/discord`,
  );

assertStatus(
  auth,
  "Auth callback",
  (status) =>
    status !== 0 &&
    status < 500,
);

const commits = [];

for (const [service, baseUrl] of workerUrls) {
  const normalized =
    baseUrl.replace(/\/$/, "");

  const response =
    await request(`${normalized}/health`);

  assertStatus(
    response,
    `${service} health`,
    (status) => status === 200,
  );

  const body = await response.json();

  if (
    body.ok !== true ||
    body.service !== service
  ) {
    throw new Error(
      `${service}: invalid health payload`,
    );
  }

  commits.push(body.commit);

  if (
    expectedCommit &&
    body.commit !== expectedCommit
  ) {
    throw new Error(
      `${service}: commit mismatch`,
    );
  }
}

if (
  new Set(commits).size > 1
) {
  throw new Error(
    "Worker commit SHA mismatch.",
  );
}

for (const endpoint of [
  "/rebuild",
  "/process-queue",
]) {
  const contentJobs =
    process.env.CONTENT_JOBS_URL
      ?.replace(/\/$/, "");

  if (!contentJobs) continue;

  const response = await request(
    `${contentJobs}${endpoint}`,
    { method: "POST" },
  );

  if (
    ![401, 403, 404, 405].includes(
      response.status,
    )
  ) {
    throw new Error(
      `${endpoint}: unauthenticated request was not rejected`,
    );
  }
}

console.log(
  "[smoke-cloudflare] OK",
);
