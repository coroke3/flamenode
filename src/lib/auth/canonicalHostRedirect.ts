import { configuredHttpOrigin, isLoopbackHostname } from "./origin.ts";

type CanonicalHostRedirectInput = {
  configuredOrigin: string | null | undefined;
  forwardedHost: string | null | undefined;
  host: string | null | undefined;
  pathname: string;
  search: string;
};

function parseRequestHost(value: string | null | undefined): URL | null {
  const host = value?.split(",")[0]?.trim().toLowerCase();
  if (!host) return null;

  try {
    const url = new URL(`https://${host}`);
    // Reject hosts that the URL parser normalizes away (e.g. default :443).
    return url.host === host ? url : null;
  } catch {
    return null;
  }
}

/**
 * Returns the canonical URL when a non-loopback request arrived through a
 * different host. Invalid or absent configuration deliberately preserves the
 * incoming request.
 */
export function resolveCanonicalHostRedirect(
  input: CanonicalHostRedirectInput,
): string | null {
  let canonicalOrigin: string;
  try {
    canonicalOrigin = configuredHttpOrigin(
      input.configuredOrigin,
      "NEXT_PUBLIC_SITE_URL",
      { allowLoopback: true },
    );
  } catch {
    return null;
  }

  const requestUrl = parseRequestHost(input.forwardedHost || input.host);
  if (
    !requestUrl ||
    isLoopbackHostname(requestUrl.hostname) ||
    requestUrl.host === new URL(canonicalOrigin).host
  ) {
    return null;
  }

  const target = new URL(canonicalOrigin);
  target.pathname = input.pathname.startsWith("/")
    ? input.pathname
    : `/${input.pathname}`;
  target.search = input.search;
  return target.toString();
}
