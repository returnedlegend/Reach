# Google sign-in and email permission

Updated October 23, 2026. Reach now supports optional Google account sign-in alongside its existing email/password and community accounts. Google sign-in is **not required by Resend SMTP**. Pantry email still comes from Reach’s verified sending domain, after a user reviews and approves an inquiry. The app does not read the user’s Gmail inbox or send mail through their Gmail account.

## Configure Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/), select/create a project. Configure **Google Auth Platform → Branding, Audience and Data Access** (older console wording: OAuth consent screen). Set the application name, support contact, privacy-policy and terms URLs for your actual site, and the authorized domain. Use External audience if appropriate; while the app is in Testing, add the Google accounts that will test it. Follow any verification requirements Google presents before public use.
2. Create an OAuth client with application type **Web application** under **Clients**. This is separate from a Google Maps API key. You do not need to enable the Gmail API for this feature.
3. Add an exact **Authorized redirect URI**, for example:
   - Local: `http://localhost:3000/api/auth/google/callback`
   - If you use `127.0.0.1`, register `http://127.0.0.1:3000/api/auth/google/callback` separately.
   - Your own production host: `https://YOUR-HOST/api/auth/google/callback`.

   Use the exact scheme, hostname and port. The server constructs this callback from `REACH_APP_ORIGIN`; it does not trust a forwarded host or a client-supplied redirect URL. Production requires HTTPS. Never register a hostname you do not control. This server redirect flow does not load Google’s browser SDK.

4. Privately fill the project-root **`.env.local`**, preserving existing values:

   ```dotenv
   REACH_APP_ORIGIN=http://localhost:3000
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   ```

   Paste the Web application client ID and secret in those blank fields. Both stay server-side; do not use `NEXT_PUBLIC_` or paste them in chat. The actual ignored `.env.local` exists with blank placeholders for newly added variables. Source downloads omit that private file; copy `.env.example` on a fresh installation and preserve any previous settings. Restart the app after changing configuration. Do not change the origin of an already configured mail worker independently.

The **Continue with Google** button is now visible even before setup is complete. On an unconfigured installation, clicking it opens **Connect Google sign-in to Reach**, with the callback URL for the current browser origin and the exact environment names; it never redirects to an unrelated Google login or pretends to authenticate. No secret-entry fields are placed in the browser. Once configured, the age/terms checkbox is required and the same button starts the real Google-hosted authorization flow. Google chooses its account chooser, sign-in form or other verification screens based on the browser’s Google session; Reach does not control or reproduce Google’s password screen.

5. Run Node 24, `npm ci`, then `npm run dev`, and open `/account`. Confirm the age/terms/privacy checkbox and choose **Continue with Google**. The application asks only for `openid email profile`. In Testing, use an explicitly added test account. Missing configuration is shown honestly and existing Reach password login remains available.

## Existing accounts and account controls

Existing email/password accounts are not merged automatically with a Google account having the same email. First sign in using the existing Reach credentials, then choose **Link Google** in the profile. Select the same email address; an existing community account without email can link an available address. A Google identity can belong to only one Reach user. Existing user roles, favorites, messages and permissions remain attached to that Reach identity.

New Google identities create ordinary resident accounts, with no preset or shared password. Google is authoritative for Gmail and verified Workspace addresses; other third-party Google email addresses require Reach’s own email verification before verified-account features. Signing in again uses Google’s stable subject identifier, and cannot silently replace or re-verify a changed Reach email.

Google-only users can set a Reach password using **Forgot password** when account email delivery is configured. Password-protected deletion/change controls and disconnecting Google require a Reach password. After one is set, **Disconnect Google and sign out** requires that password, removes the identity link and pending link attempts, and revokes Reach sessions. It does not remove Google’s own remembered consent; users can do that in [Google account connections](https://myaccount.google.com/connections). Removing Google consent does not erase Reach data or existing Reach sessions; use Reach’s account controls as well.

## Security boundary

- Authorization Code flow with S256 PKCE, random one-use state, nonce, a ten-minute database expiry and a separate HttpOnly SameSite=Lax browser-binding cookie. Existing Reach session cookies remain HttpOnly SameSite=Strict. HTTPS cookies are Secure.
- Link callbacks are bound to the authenticated initiating Reach session and fail after its revocation/expiry. Linking rotates that session. Login creates a new random session and stores only its hash.
- `jose` verifies RS256 ID-token signatures using the fixed Google public-key endpoint, issuer, client audience, expiry and required claims. The local boundary additionally checks nonce, authorized party, issued-at and verified-email claims. Tokens do not enter the browser or session payload.
- No Google access/refresh token is persisted. Private temporary PKCE records are consumed before exchange and expired records are removed on new attempts. No model receives Google credentials. Scoped authentication attempts have persistent limits; token exchange has a ten-second abort and public-key retrieval has an eight-second timeout. Network/denial/invalid-token states never fabricate login success.
- Development incoming-request logs exclude the callback so authorization codes/state are not logged there. Configure production reverse-proxy/hosting logs to omit query strings for `/api/auth/google/callback`. Callback redirects have `no-store` and `no-referrer`; fixed result codes go in the account-page fragment, never provider diagnostic text, tokens or arbitrary redirect URLs.
- Auth and user email consent do not grant pantry organizer/admin privileges or remove contact enrollment, account verification, consent, rate limits and explicit message authorization requirements.

## Email still needs its own setup

Google sign-in does not configure Resend, its sender DNS, outbound SMTP connectivity, the worker, or signed inbound replies. Follow [SMTP + AI setup](SMTP-AI-SETUP.md). Users do not need to disclose Google passwords or grant Gmail scopes for Reach’s sending service. Sending from a user’s personal Gmail account would be a separate Gmail OAuth integration, with different scopes, token storage and Google verification obligations; it is not enabled here.

## Files changed

See the complete [file manifest](GOOGLE-SIGN-IN-FILES.md). The shared mail, pantry, routing and authentication data stores were preserved.

## Verification

See [independent verification](GOOGLE-SIGN-IN-VERIFICATION.md). Automated tests use synthetic Google claims and locally signed JWTs/mocked public keys; no real user signs in and no real email is sent. The public Google discovery document and official guidance were retrieved, but a successful live authorization/code exchange requires the operator’s configured OAuth client and a test user. Google Maps credentials do not establish OAuth readiness. Nothing was publicly deployed.

Official references, checked October 23, 2026:

- [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google discovery metadata](https://accounts.google.com/.well-known/openid-configuration)
- [OAuth for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [ID-token validation and when Google is authoritative for an email](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [jose](https://github.com/panva/jose)

## Google button asset

The button uses the unmodified Google G image downloaded from [Google’s official branding asset](https://developers.google.com/static/identity/images/g-logo.png), linked by its [branding guidelines](https://developers.google.com/identity/branding-guidelines), checked October 23, 2026. It is served locally as `public/google-g.png`; loading the button does not contact Google. The Google mark remains Google’s trademark and is used only to identify Google sign-in.
