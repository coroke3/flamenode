export type HttpOriginOptions = {
  allowLoopback?: boolean;
};

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]"
  );
}

export function configuredHttpOrigin(
  value: string | null | undefined,
  name: string,
  options: HttpOriginOptions = {},
): string {
  const raw = nonEmpty(value);
  if (!raw) throw new Error(`${name}_MISSING`);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name}_INVALID_ORIGIN`);
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name}_INVALID_ORIGIN`);
  }

  if (!options.allowLoopback && isLoopbackHostname(url.hostname)) {
    throw new Error(`${name}_LOCALHOST_FORBIDDEN`);
  }

  return url.origin;
}

export function requestHasSameOrigin(
  originHeader: string | null,
  configuredOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    return (
      configuredHttpOrigin(originHeader, "REQUEST_ORIGIN", {
        allowLoopback: true,
      }) === configuredOrigin
    );
  } catch {
    return false;
  }
}
