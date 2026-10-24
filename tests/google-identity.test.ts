import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createGoogleIdentityVerifier,
  googleIdentityClaims,
} from "../src/lib/google-identity";

const clientId = "123456-test.apps.googleusercontent.com";
const now = new Date("2026-10-23T18:00:00Z");
const claims = () => ({
  iss: "https://accounts.google.com",
  aud: clientId,
  sub: "synthetic-google-subject",
  nonce: "a".repeat(64),
  email: "test@gmail.com",
  email_verified: true,
  iat: +now / 1000,
  exp: +now / 1000 + 300,
});

describe("Google signed identity boundary", () => {
  it("verifies a real signed test JWT using the fixed public JWKS endpoint and sends no credentials", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = {
      ...(await exportJWK(publicKey)),
      kid: "test-key",
      alg: "RS256",
      use: "sig",
    };
    const requests: string[] = [];
    const verify = createGoogleIdentityVerifier(async (url, init) => {
      requests.push(String(url));
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return Response.json({ keys: [jwk] });
    });
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(privateKey);
    const payload = await verify(
      token,
      clientId,
      new AbortController().signal,
      now,
    );
    expect(googleIdentityClaims(payload, clientId, now).sub).toBe(
      "synthetic-google-subject",
    );
    expect(requests).toEqual(["https://www.googleapis.com/oauth2/v3/certs"]);
    const altered = token.split(".");
    altered[1] = Buffer.from(
      JSON.stringify({ ...claims(), sub: "attacker" }),
    ).toString("base64url");
    await expect(
      verify(altered.join("."), clientId, new AbortController().signal, now),
    ).rejects.toThrow();
  });

  it.each([
    ["issuer", { iss: "https://attacker.invalid" }],
    ["audience", { aud: "another-client" }],
    ["authorized party", { azp: "another-client" }],
    [
      "multiple audience without authorized party",
      { aud: [clientId, "another-client"] },
    ],
    ["expired", { exp: +now / 1000 - 1 }],
    ["future issued at", { iat: +now / 1000 + 60 }],
    ["unverified email", { email_verified: false }],
    ["invalid nonce", { nonce: "missing" }],
    ["invalid email", { email: "not-an-email" }],
  ])("rejects invalid %s claims", (_description, patch) => {
    expect(() =>
      googleIdentityClaims({ ...claims(), ...patch }, clientId, now),
    ).toThrow();
  });

  it("requires separate Reach email verification for third-party addresses", () => {
    expect(
      googleIdentityClaims(claims(), clientId, now).authoritativeEmail,
    ).toBe(true);
    expect(
      googleIdentityClaims(
        { ...claims(), email: "user@thirdparty.org" },
        clientId,
        now,
      ).authoritativeEmail,
    ).toBe(false);
    expect(
      googleIdentityClaims(
        { ...claims(), email: "user@workspace.org", hd: "workspace.org" },
        clientId,
        now,
      ).authoritativeEmail,
    ).toBe(true);
  });

  it("refuses an already aborted verification without a public-key request", async () => {
    let calls = 0;
    const verify = createGoogleIdentityVerifier(async () => {
      calls++;
      return Response.json({ keys: [] });
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      verify("invalid-token", clientId, controller.signal, now),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
