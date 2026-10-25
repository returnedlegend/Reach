/** Local development only. Never trust Origin or proxy headers as authority. */
export function localDevelopmentOrigin(request: Request): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  const host = request.headers.get("host") || url.host;
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(host))
    return null;
  if (!["http:", "https:"].includes(url.protocol)) return null;
  try {
    return new URL(`${url.protocol}//${host}`).origin;
  } catch {
    return null;
  }
}
