"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type Status = { configured: boolean; linked: boolean; hasPassword: boolean };
const notices: Record<string, string> = {
  success:
    "Google sign-in returned. Check your current Reach account below. Reach has no access to your Gmail inbox.",
  linked:
    "Google sign-in returned. Check the connection status in your profile below. Your Gmail inbox is not connected.",
  cancelled:
    "Google sign-in was cancelled. No email was sent. You can try again or use your Reach password.",
  expired:
    "This Google sign-in attempt expired or was already used. Please start again.",
  conflict:
    "This Google identity or email cannot be linked automatically. Sign in to your existing Reach account first, then choose Link Google. Accounts are not merged automatically.",
  "email-mismatch":
    "Choose the Google account with the same email as your Reach account. Your Reach email was not changed.",
  failed:
    "Google sign-in could not be completed. Please try again or use your Reach sign-in.",
};
export function googleSignInNotice(result: string | null) {
  return result && Object.hasOwn(notices, result) ? notices[result] : undefined;
}

export function GoogleSignIn({
  signedIn,
  onDisconnected,
}: {
  signedIn: boolean;
  onDisconnected: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [localOrigin, setLocalOrigin] = useState("");
  const setupPanel = useRef<HTMLElement>(null);
  const descriptionId = useId();
  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google/status", {
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      const value = await response.json();
      if (!response.ok || typeof value.configured !== "boolean")
        throw new Error();
      setStatus(value);
    } catch {
      setError(
        "Google sign-in status could not be loaded. Your Reach password sign-in is still available.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [signedIn]);
  useEffect(() => {
    if (showSetup) setupPanel.current?.focus();
  }, [showSetup]);

  async function start() {
    if (busy || loading || !status) return;
    if (!status.configured) {
      setLocalOrigin(window.location.origin);
      setShowSetup(true);
      return;
    }
    if (!consent) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google/start", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: signedIn ? "link" : "signin",
          adultConfirmed: true,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Google sign-in is temporarily unavailable.",
        );
      const url = new URL(data.url);
      if (
        url.origin !== "https://accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth"
      )
        throw new Error(
          "Reach returned an invalid sign-in link. Please try again.",
        );
      window.location.assign(url.toString());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Google sign-in could not be started. Please try again.",
      );
      setBusy(false);
    }
  }
  async function disconnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google/disconnect", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(new FormData(form).get("password") || ""),
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Could not disconnect Google.");
      form.reset();
      onDisconnected();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not disconnect Google.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-google" aria-label="Google sign-in">
      <h3>{signedIn ? "Google sign-in" : "Continue with Google"}</h3>
      <p id={descriptionId}>
        Google shares your name, email address and account identifier with
        Reach. Reach does not request permission to read or send Gmail. Pantry
        emails use Reach’s email service and still require your review and
        approval.
      </p>
      {loading ? (
        <p role="status">Checking Google sign-in…</p>
      ) : status?.linked ? (
        <>
          <p role="status">
            {status.configured
              ? "Google sign-in is connected."
              : "Your Google identity is saved, but Google sign-in is unavailable on this server."}
          </p>
          {!status.hasPassword ? (
            <p>
              {status.configured
                ? "You can keep using Google to sign in. "
                : "Google cannot be used to sign in until the server configuration is restored. "}
              To set a Reach password or use password-protected account
              controls, sign out and choose Forgot password. Recovery requires
              Reach email delivery to be configured.
            </p>
          ) : (
            <form onSubmit={disconnect}>
              <fieldset disabled={busy}>
                <label className="account-field">
                  Current Reach password
                  <input
                    className="input input-bordered"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                  />
                </label>
                <button className="btn btn-outline">
                  Disconnect Google and sign out
                </button>
              </fieldset>
            </form>
          )}
          <p>
            To remove Google’s saved permission too, visit{" "}
            <a
              href="https://myaccount.google.com/connections"
              target="_blank"
              rel="noreferrer"
            >
              your Google account connections
            </a>
            .
          </p>
        </>
      ) : (
        <>
          {!status?.configured && !error && (
            <p role="status">
              Google sign-in is not configured on this Reach server. You can
              still use the existing Reach sign-in.
            </p>
          )}
          {status?.configured && (
            <>
              <label className="account-check">
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={busy}
                />
                <span>
                  I confirm I am at least 18 and agree to the{" "}
                  <a href="/terms">terms</a> and{" "}
                  <a href="/privacy">privacy policy</a>.{" "}
                  {signedIn
                    ? "I want to link Google to this Reach account."
                    : "I want to continue to Google to sign in to Reach."}
                </span>
              </label>
            </>
          )}
          <button
            type="button"
            className="btn btn-outline account-google-button"
            disabled={
              busy || loading || !status || (status.configured && !consent)
            }
            onClick={() => void start()}
            aria-describedby={descriptionId}
          >
            <img
              src="/google-g.png"
              width={20}
              height={20}
              alt=""
              aria-hidden="true"
            />
            {busy
              ? "Opening Google…"
              : signedIn
                ? "Link Google"
                : "Continue with Google"}
          </button>
          {status?.configured && (
            <p className="account-google-hint">
              Opens Google’s secure sign-in page. Choose a Google account or
              sign in there, then return to Reach.
            </p>
          )}
          {showSetup && !status?.configured && (
            <section
              ref={setupPanel}
              tabIndex={-1}
              className="account-google-setup"
              aria-label="Connect Google sign-in"
            >
              <h4>Connect Google sign-in to Reach</h4>
              <p>
                This Reach installation needs a Google OAuth connection before
                this button can open Google’s sign-in page. Your Google password
                is entered only on accounts.google.com.
              </p>
              <p>For the person running this site:</p>
              <ol>
                <li>
                  Open{" "}
                  <a
                    href="https://console.cloud.google.com/auth/clients"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Auth Platform → Clients
                  </a>
                  , configure the consent screen, and create a{" "}
                  <strong>Web application</strong> OAuth client.
                </li>
                <li>
                  Register this exact redirect URI:{" "}
                  <code>{localOrigin}/api/auth/google/callback</code>.
                </li>
                <li>
                  In the project’s private <code>.env.local</code>, set{" "}
                  <code>REACH_APP_ORIGIN={localOrigin}</code> and fill{" "}
                  <code>GOOGLE_CLIENT_ID</code> and{" "}
                  <code>GOOGLE_CLIENT_SECRET</code> using that client. Preserve
                  your existing settings. Don’t enter the secret here or share
                  it in chat.
                </li>
                <li>
                  Restart Reach, reload this page, and select Continue with
                  Google. For an OAuth app in Testing, add your Google account
                  as a test user in Google Auth Platform.
                </li>
              </ol>
              <p>
                A Google Maps API key cannot enable account sign-in. Google
                decides whether to show an account chooser or an
                email-and-password sign-in page.
              </p>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setShowSetup(false);
                  void load();
                }}
              >
                Check connection again
              </button>
            </section>
          )}
        </>
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          {!status && !loading && (
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => void load()}
            >
              Retry Google sign-in status
            </button>
          )}
        </>
      )}
    </section>
  );
}
