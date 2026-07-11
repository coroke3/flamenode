/** 副作用を持つ Worker HTTP endpoint 用の最小認可。 */

export interface WorkerAdminTokenEnv {
  WORKER_ADMIN_TOKEN?: string;
}

/** この管理 endpoint は入力を受け取らない。0 byte までを許可する。 */
export const MAX_WORKER_ADMIN_BODY_BYTES = 0;

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/**
 * 認可に失敗した場合だけ Response を返す。成功時は null。
 * token 未設定時に endpoint の存在を公開しないため 404 を返す。
 */
export function rejectUnauthorizedWorkerRequest(
  request: Request,
  env: WorkerAdminTokenEnv,
): Response | null {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const configuredToken = env.WORKER_ADMIN_TOKEN?.trim();
  if (!configuredToken) return new Response("Not Found", { status: 404 });

  const contentLength = request.headers.get("content-length");
  if (request.body !== null || (contentLength !== null && !/^0*$/.test(contentLength.trim()))) {
    return new Response("Payload Too Large", { status: 413 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match || !constantTimeEqual(match[1], configuredToken)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  return null;
}
