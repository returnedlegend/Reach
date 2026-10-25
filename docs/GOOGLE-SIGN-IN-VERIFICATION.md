# Independent Google sign-in verification

Reviewed October 23, 2026. This report covers the server handler and account-identity boundary in `src/lib/google-auth.ts`; UI behavior and signed-JWT verifier internals have separate implementation-owned checks.

Independent command: `npm test -- tests/google-auth-independent.test.ts` passed 10/10 tests. `npm run typecheck` passed after the test additions. The separate `tests/google-identity.test.ts` is implementation-owned and covers JWT validation. Recovery tests inject a local mail sender and do not contact an email provider. No real Google login, email, Gmail access, or token persistence was exercised.

Before enabling live login, an operator must privately configure a Google Web OAuth client and its exact `${REACH_APP_ORIGIN}/api/auth/google/callback` redirect URI, deploy over HTTPS, and test with an authorized account. Google Maps API keys are unrelated and cannot configure sign-in. Existing Reach accounts must be signed into before linking; a matching email alone never merges accounts.

## Account UI review

Read-only review of `src/components/google-sign-in.tsx` and `src/components/account-panel.tsx`: consent is required before starting sign-in or linking; browser calls use same-origin credentials, no-store caching, and no-referrer policy; navigation accepts only the Google authorization origin and path. The callback fragment is removed from browser history before its fixed result notice is shown. `googleSignInNotice` uses an own-property check, so values such as `__proto__` cannot select inherited object properties. Success and linked notices tell the user to check the current account/connection state; the fragment itself does not establish authentication. The account state is loaded from Reach’s account API.

Code-review finding resolved during implementation: a saved Google link can outlive removed OAuth client configuration. The original UI said Google could still be used and offered a disconnect action the handler rejected before password verification. The UI now says the saved identity remains but sign-in is unavailable; the handler permits password-confirmed unlinking with the canonical Reach origin and existing account session, without OAuth credentials. The independent regression confirms configuration removal, accurate status, successful unlink, and session revocation. Browser-suite results are owned by the implementation agent and are intentionally not reported here.

## Main-agent integration evidence

The main agent implemented architecture, server/client integration and signed-JWT/browser checks. The reused `gpt-6-luna` verification agent at high reasoning effort independently reviewed the account boundary and implemented ten handler cases, finding the removed-configuration recovery issue and rechecking its fix. No compute savings were measured. Setup and remaining credentials are in [GOOGLE-SIGN-IN.md](GOOGLE-SIGN-IN.md).

## Visible Google button follow-up (October 23, 2026)

The account screen now keeps a recognizable **Continue with Google** button visible even when OAuth is not configured. Clicking it in that state focuses an inline owner setup guide, shows the browser origin’s exact callback URL and required server variables, and makes no authorization-start request. No Google password or client-secret entry fields are added to Reach. Once configured, the same button retains the real OAuth start flow and navigates to `accounts.google.com`; Google controls its account chooser/sign-in UI.

Validation for this UI follow-up: **466 unit tests**, TypeScript, and the production build passed. **18 production-browser checks** passed on mobile/desktop: visible unconfigured button and locally served official Google icon, owner setup/focus/actual-origin callback, no external-start request before setup, configured consent/authorization URL and synthetic Google cancellation, failure recovery, existing linking, and six retained account checks. The final explanatory wording was cleaned up afterward and production was rebuilt. The Google-hosted screen in browser checks is explicitly intercepted as a synthetic fixture, so this does not establish real Google login. The real OAuth client remains unconfigured; it needs operator-owned credentials, a matching registered callback URI, and an authorized Google test account.

Updated screenshots are in the existing `google-*-consent.png` and `google-*-unconfigured.png` evidence files. The OAuth backend was not changed by this follow-up.
