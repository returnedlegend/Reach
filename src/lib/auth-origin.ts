import { accountFail as fail } from "./account-store";

export function canonicalAccountOrigin(): string | null {
  const configured =
    process.env.REACH_APP_ORIGIN || process.env.REACH_COMMUNITY_ORIGIN;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (
      url.origin !== configured ||
      !["http:", "https:"].includes(url.protocol)
    )
      return null;
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function accountRequestOrigin(request: Request): string {
  const canonical = canonicalAccountOrigin();
  if (canonical) return canonical;
  if (
    process.env.REACH_APP_ORIGIN ||
    process.env.REACH_COMMUNITY_ORIGIN ||
    process.env.NODE_ENV === "production"
  )
    fail(503, "Account origin is not configured.");
  const url = new URL(request.url);
  // Next development may rewrite request.url to its bind host. The browser's
  // direct Host header preserves the local authority; forwarded headers are
  // deliberately ignored and non-loopback hosts still require configuration.
  const host = request.headers.get("host");
  if (host) {
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host))
      fail(503, "Account origin is not configured.");
    const local = new URL(`${url.protocol}//${host}`);
    if (!["http:", "https:"].includes(local.protocol))
      fail(503, "Account origin is not configured.");
    return local.origin;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    fail(503, "Account origin is not configured.");
  return url.origin;
}
