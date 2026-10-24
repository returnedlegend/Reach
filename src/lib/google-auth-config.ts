import { canonicalAccountOrigin } from "./auth-origin";

/** Web OAuth credentials only; Google Maps keys cannot configure sign-in. */
export function googleAuthConfiguration() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const origin = canonicalAccountOrigin();
  if (
    process.env.REACH_ACCOUNT_ENABLED === "false" ||
    !origin ||
    !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
    !/^[A-Za-z0-9_-]{10,200}$/.test(clientSecret) ||
    /(?:placeholder|your_|example|xxxxxxxx)/i.test(clientId + clientSecret)
  )
    return null;
  const url = new URL(origin);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return null;
  return {
    clientId,
    clientSecret,
    origin,
    redirectUri: `${origin}/api/auth/google/callback`,
  };
}
