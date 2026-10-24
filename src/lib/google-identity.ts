import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { z } from "zod";

if (typeof window !== "undefined")
  throw new Error("Google identity is server-only.");

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().max(254),
  email_verified: z.literal(true),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(200).optional(),
  hd: z.string().min(1).max(253).optional(),
});

/** Also validate locally after signature checking; stable sub is the identity. */
export function googleIdentityClaims(
  payload: JWTPayload,
  clientId: string,
  now = new Date(),
) {
  if (
    !["https://accounts.google.com", "accounts.google.com"].includes(
      String(payload.iss),
    ) ||
    !(typeof payload.aud === "string"
      ? payload.aud === clientId
      : Array.isArray(payload.aud) && payload.aud.includes(clientId)) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== clientId) ||
    (payload.azp !== undefined && payload.azp !== clientId) ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.exp) ||
    payload.exp <= +now / 1000 ||
    typeof payload.iat !== "number" ||
    !Number.isFinite(payload.iat) ||
    payload.iat > +now / 1000 + 5
  )
    throw new Error("Invalid Google identity.");
  const claims = claimsSchema.parse(payload);
  const email = claims.email.toLowerCase();
  return {
    ...claims,
    email,
    // Google is authoritative for Gmail or a verified Workspace account, not
    // every third-party address it once verified. Others still verify in Reach.
    authoritativeEmail: email.endsWith("@gmail.com") || !!claims.hd,
  };
}

export function createGoogleIdentityVerifier(fetcher: typeof fetch = fetch) {
  const keys = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
    {
      [customFetch]: fetcher,
      timeoutDuration: 8000,
      cacheMaxAge: 600_000,
    },
  );
  return async (
    idToken: string,
    clientId: string,
    signal: AbortSignal,
    now = new Date(),
  ) => {
    signal.throwIfAborted();
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
      requiredClaims: [
        "iss",
        "aud",
        "sub",
        "exp",
        "iat",
        "nonce",
        "email",
        "email_verified",
      ],
      currentDate: now,
    });
    signal.throwIfAborted();
    return payload;
  };
}
