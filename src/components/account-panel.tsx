"use client";

import { LoadingState } from "./loading-state";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import "./account-panel.css";
import { NotificationPreferences } from "./notification-preferences";
import { GoogleSignIn, googleSignInNotice } from "./google-sign-in";

type Actor = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
  role: "user" | "administrator";
};
type SavedLocation = {
  id: string;
  label: string;
  coordinates: { lat: number; lng: number };
};
type Favorite = { id: string; name: string; address?: string };
type Preferences = {
  accessibility?: "standard" | "step-free";
  transportation?: "walk" | "transit" | "drive";
};
type Status = {
  enabled: boolean;
  emailConfigured: boolean;
  deliveryMode?: "resend" | "smtp" | "preview" | "disabled";
};
type LinkAction = { kind: "verify" | "reset"; token: string };

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    path.startsWith("/") ? path : `/api/account/${path}`,
    {
      method,
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    },
  );
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : "This request could not be completed. Please try again.",
    );
  if (!data || typeof data !== "object")
    throw new Error("Reach returned an incomplete response. Please try again.");
  return data as T;
}

function Field({
  name,
  label,
  type = "text",
  autoComplete,
  minLength,
  defaultValue,
  required = true,
  help,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  defaultValue?: string;
  required?: boolean;
  help?: string;
}) {
  const helpId = useId();
  return (
    <div className="account-field">
      <label htmlFor={`${helpId}-input`}>{label}</label>
      <input
        id={`${helpId}-input`}
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        defaultValue={defaultValue}
        required={required}
        aria-describedby={help ? helpId : undefined}
        className="input input-bordered"
      />
      {help && <small id={helpId}>{help}</small>}
    </div>
  );
}
function Card({
  title,
  children,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`card bg-base-100 account-card${danger ? " account-danger" : ""}`}
    >
      <h2>{title}</h2>
      {children}
    </section>
  );
}
const value = (form: HTMLFormElement, key: string) =>
  String(new FormData(form).get(key) || "");

export function AccountPanel() {
  const [preferences, setPreferences] = useState<Preferences>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [user, setUser] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [linkAction, setLinkAction] = useState<LinkAction | null>(null);
  const [preferredLocation, setPreferredLocation] =
    useState<SelectedLocation | null>(null);
  const [locations, setLocations] = useState<SavedLocation[]>([]);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [savedError, setSavedError] = useState("");
  const [savedLoading, setSavedLoading] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const activeUser = useRef<string | undefined>(undefined);
  activeUser.current = user?.id;

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [configuration, session] = await Promise.all([
        request<Status>("status"),
        request<{ user: Actor | null; preferences?: Preferences }>("me"),
      ]);
      setStatus(configuration);
      setUser(session.user);
      setPreferences(session.preferences || {});
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause.message : "Could not load your account.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function loadSaved() {
    const owner = user?.id;
    setSavedLoading(true);
    setSavedError("");
    const results = await Promise.allSettled([
      request<{ locations: SavedLocation[] }>("locations"),
      request<{ pantries: Favorite[] }>("/api/pantries/favorites"),
    ]);
    if (activeUser.current !== owner) return;
    if (results[0].status === "fulfilled")
      setLocations(results[0].value.locations || []);
    if (results[1].status === "fulfilled")
      setFavorites(results[1].value.pantries || []);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length)
      setSavedError("Some saved items could not be loaded. Try again.");
    setSavedLoading(false);
  }
  useEffect(() => {
    const captureLink = () => {
      if (!window.location.hash) return;
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const verify = fragment.get("verify");
      const reset = fragment.get("reset");
      const googleNotice = googleSignInNotice(fragment.get("google"));
      // Keep the token only in memory, including links opened on this document.
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      if (googleNotice) {
        setNotice(googleNotice);
        setError("");
      }
      if (verify || reset) {
        setLinkAction({
          kind: verify ? "verify" : "reset",
          token: (verify || reset)!,
        });
        setNotice("");
        setError("");
      }
    };
    captureLink();
    window.addEventListener("hashchange", captureLink);
    if (!initialized.current) {
      initialized.current = true;
      void load();
    }
    return () => window.removeEventListener("hashchange", captureLink);
  }, []);
  useEffect(() => {
    setLocations([]);
    setFavorites([]);
    setPreferredLocation(null);
    if (user) void loadSaved();
  }, [user]);

  useEffect(() => {
    if (notice || error) feedback.current?.focus();
  }, [notice, error]);

  async function act(
    action: () => Promise<{ message?: string }>,
    fallback: string,
    refresh = false,
  ) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await action();
      setNotice(result.message || fallback);
      if (refresh) await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = {
      email: value(form, "email"),
      password: value(form, "password"),
      ...(mode === "signup"
        ? { name: value(form, "name"), adultConfirmed: true }
        : {}),
    };
    const success = await act(
      () =>
        request(
          mode === "forgot" ? "forgot-password" : mode,
          "POST",
          mode === "forgot" ? { email: data.email } : data,
        ),
      mode === "forgot"
        ? "Request received. If recovery is available for this address, check your email."
        : mode === "signup"
          ? "Your account was created."
          : "You are signed in.",
      mode !== "forgot",
    );
    if (success) form.reset();
  }

  return (
    <main className="account-page">
      <header className="account-header">
        <a className="account-brand" href="/">
          Reach<span>A little more within reach</span>
        </a>
        <nav aria-label="Account navigation">
          <a href="/">Find food</a>
          <a href="/manage">Manage pantries</a>
        </nav>
      </header>
      <div className="account-intro">
        <p className="account-eyebrow">YOUR REACH</p>
        <h1>Your Reach account</h1>
        <p>
          Save places, manage food sharing, and choose your notifications.
          Finding food never requires an account.
        </p>
      </div>
      <div
        ref={feedback}
        tabIndex={-1}
        className="account-feedback"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice && <p className="account-success">{notice}</p>}
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
      </div>
      {linkAction && (
        <Card
          title={
            linkAction.kind === "verify"
              ? "Confirm your email"
              : "Choose a new password"
          }
        >
          <p>
            {linkAction.kind === "verify"
              ? "Confirm that you want to verify the email address associated with this link."
              : "Enter a new password to complete your recovery request. This link is kept only while this page is open."}
          </p>
          {linkAction.kind === "verify" ? (
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  async () => {
                    const result = await request<{ message?: string }>(
                      "verify-email",
                      "POST",
                      { token: linkAction.token },
                    );
                    setLinkAction(null);
                    return result;
                  },
                  "Email verified. You can sign in to continue.",
                  true,
                )
              }
              className="btn btn-primary"
            >
              Confirm email verification
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void act(
                  async () => {
                    const result = await request<{ message?: string }>(
                      "reset-password",
                      "POST",
                      {
                        token: linkAction.token,
                        password: value(form, "newPassword"),
                      },
                    );
                    setLinkAction(null);
                    form.reset();
                    return result;
                  },
                  "Password reset. Sign in with your new password.",
                  true,
                );
              }}
            >
              <fieldset disabled={busy}>
                <Field
                  name="newPassword"
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  help="Use at least 12 characters."
                />
                <button className="btn btn-primary">Reset password</button>
              </fieldset>
            </form>
          )}
          <button
            className="btn btn-outline account-secondary"
            disabled={busy}
            onClick={() => setLinkAction(null)}
          >
            Dismiss link
          </button>
        </Card>
      )}
      {loading ? (
        <LoadingState label="Loading your account…" />
      ) : loadError ? (
        <Card title="Account temporarily unavailable">
          <p role="alert">{loadError}</p>
          <button onClick={() => void load()} className="btn btn-primary">
            Try again
          </button>
        </Card>
      ) : (
        <>
          {status?.deliveryMode === "preview" && (
            <p className="account-notice" role="status">
              Development email preview is enabled. Messages are saved privately
              on this server; no email is sent.
            </p>
          )}
          {status && !status.emailConfigured && (
            <p className="account-warning">
              Email delivery is not configured. New email accounts, email
              verification and password recovery are unavailable right now.
              Existing accounts can still sign in.
            </p>
          )}
          {!user ? (
            <Card
              title={
                mode === "login"
                  ? "Welcome back"
                  : mode === "signup"
                    ? "Create an account"
                    : "Recover your account"
              }
            >
              <GoogleSignIn
                signedIn={false}
                onDisconnected={() => void load()}
              />
              <div
                className="tabs tabs-box account-tabs"
                aria-label="Sign in options"
              >
                {(
                  [
                    ["login", "Sign in"],
                    ["signup", "Create account"],
                    ["forgot", "Forgot password"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`tab btn ${
                      mode === key
                        ? "tab-active btn-primary account-tab-active"
                        : "btn-ghost account-secondary"
                    }`}
                    aria-pressed={mode === key}
                    disabled={
                      busy || (key !== "login" && !status?.emailConfigured)
                    }
                    onClick={() => {
                      setMode(key);
                      setNotice("");
                      setError("");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === "signup" && (
                <p>
                  Your account is private. Public community posts use your
                  display name.
                </p>
              )}
              <form key={mode} onSubmit={authenticate}>
                <fieldset
                  disabled={
                    busy || (mode !== "login" && !status?.emailConfigured)
                  }
                >
                  {mode === "signup" && (
                    <Field
                      name="name"
                      label="Display name"
                      autoComplete="nickname"
                    />
                  )}
                  <Field
                    name="email"
                    label="Email address"
                    type="email"
                    autoComplete="email"
                  />
                  {mode !== "forgot" && (
                    <Field
                      name="password"
                      label="Password"
                      type="password"
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      minLength={mode === "signup" ? 12 : undefined}
                      help={
                        mode === "signup"
                          ? "Use at least 12 characters."
                          : undefined
                      }
                    />
                  )}
                  {mode === "signup" && (
                    <label className="account-check">
                      <input
                        type="checkbox"
                        required
                        name="adultConfirmed"
                        className="checkbox checkbox-primary"
                      />{" "}
                      <span>
                        I confirm I am at least 18 years old and agree to the{" "}
                        <a href="/terms">terms</a> and{" "}
                        <a href="/privacy">privacy policy</a>.
                      </span>
                    </label>
                  )}
                  <button className="btn btn-primary">
                    {busy
                      ? "Please wait…"
                      : mode === "login"
                        ? "Sign in"
                        : mode === "signup"
                          ? "Create account"
                          : "Request recovery email"}
                  </button>
                </fieldset>
              </form>
              <p className="account-help">
                Have a community username account? Use the existing sign-in form
                in <a href="/">Community</a>. Your community identity is
                preserved.
              </p>
            </Card>
          ) : (
            <div className="account-grid">
              <Card title="Your profile">
                <GoogleSignIn
                  signedIn
                  onDisconnected={() => {
                    setUser(null);
                    setNotice(
                      "Google sign-in disconnected. Sign in with your Reach email and password.",
                    );
                    void load();
                  }}
                />
                <p className="account-identity">
                  {user.email || "Community account"}
                  <span
                    className={`account-badge${user.emailVerified ? " verified" : ""}`}
                  >
                    {user.emailVerified
                      ? "Email verified"
                      : "Email not verified"}
                  </span>
                </p>
                {!user.emailVerified && user.email && (
                  <>
                    <p>
                      Verify your email to use features that require a verified
                      account.
                    </p>
                    <button
                      className="btn btn-outline account-secondary"
                      disabled={busy || !status?.emailConfigured}
                      onClick={() =>
                        void act(
                          () => request("resend-verification", "POST", {}),
                          "Verification requested. Check your email if delivery is available.",
                        )
                      }
                    >
                      Request verification email
                    </button>
                  </>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    void act(
                      () =>
                        request("profile", "PATCH", {
                          name: value(form, "name"),
                          preferences: {
                            accessibility: value(form, "accessibility"),
                            transportation: value(form, "transportation"),
                          },
                        }),
                      "Profile updated.",
                      true,
                    );
                  }}
                >
                  <fieldset disabled={busy}>
                    <Field
                      key={user.name}
                      name="name"
                      label="Display name"
                      defaultValue={user.name}
                      autoComplete="nickname"
                    />
                    <label className="account-field">
                      <span>Accessibility preference</span>
                      <select
                        key={preferences.accessibility || "standard"}
                        name="accessibility"
                        defaultValue={preferences.accessibility || "standard"}
                        className="input input-bordered"
                      >
                        <option value="standard">Standard routes</option>
                        <option value="step-free">
                          Prefer step-free routes
                        </option>
                      </select>
                    </label>
                    <label className="account-field">
                      <span>Travel preference</span>
                      <select
                        key={preferences.transportation || "walk"}
                        name="transportation"
                        defaultValue={preferences.transportation || "walk"}
                        className="input input-bordered"
                      >
                        <option value="walk">Walking</option>
                        <option value="transit">Public transit</option>
                        <option value="drive">Driving</option>
                      </select>
                    </label>
                    <button className="btn btn-primary">Save profile</button>
                  </fieldset>
                </form>
                <button
                  className="btn btn-outline account-secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await request<{ message?: string }>(
                        "logout",
                        "POST",
                        {},
                      );
                      setUser(null);
                      setLinkAction(null);
                      return result;
                    }, "You are signed out.")
                  }
                >
                  Sign out
                </button>
              </Card>
              {!user.email && (
                <Card title="Add an email to your community account">
                  <p>
                    Keep your existing community identity and add verified email
                    sign-in and recovery. Confirm your current password, then
                    verify the address using the link you receive.
                  </p>
                  <p>
                    Your email will stay unlinked until you confirm that link.
                    An address already used by another account cannot be linked
                    here.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      void act(async () => {
                        const result = await request<{ message?: string }>(
                          "attach-email",
                          "POST",
                          {
                            email: value(form, "attachEmail"),
                            currentPassword: value(form, "attachPassword"),
                          },
                        );
                        form.reset();
                        return result;
                      }, "Request received. If this address can be linked, check your email for a verification link.");
                    }}
                  >
                    <fieldset disabled={busy || !status?.emailConfigured}>
                      <Field
                        name="attachEmail"
                        label="Email address to link"
                        type="email"
                        autoComplete="email"
                      />
                      <Field
                        name="attachPassword"
                        label="Current community password"
                        type="password"
                        autoComplete="current-password"
                      />
                      <button className="btn btn-primary">
                        Request email verification
                      </button>
                    </fieldset>
                  </form>
                </Card>
              )}
              <Card title="Favorite pantries">
                <p>
                  Save pantries from the <a href="/">food finder</a> to keep
                  them here.
                </p>
                {savedLoading ? (
                  <p role="status">Loading saved items…</p>
                ) : favorites.length ? (
                  <ul className="account-saved-list">
                    {favorites.map((pantry) => (
                      <li key={pantry.id}>
                        <strong>{pantry.name}</strong>
                        {pantry.address && <span>{pantry.address}</span>}
                        <a href={`/pantries/${encodeURIComponent(pantry.id)}`}>
                          View pantry
                        </a>
                        <button
                          className="btn btn-outline account-secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const result = await request<{
                                message?: string;
                              }>("/api/pantries/favorites", "DELETE", {
                                id: pantry.id,
                              });
                              await loadSaved();
                              return result;
                            }, "Pantry removed from favorites.")
                          }
                        >
                          Remove favorite
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No favorite pantries saved yet.</p>
                )}
                {savedError && <p role="alert">{savedError}</p>}
                <button
                  className="btn btn-outline account-secondary"
                  disabled={savedLoading}
                  onClick={() => void loadSaved()}
                >
                  Refresh saved items
                </button>
              </Card>
              <NotificationPreferences emailVerified={user.emailVerified} />
              <Card title="Preferred locations">
                <p>
                  These locations are private to your account. Save only places
                  you want Reach to remember. Up to 10 locations.
                </p>
                {savedLoading ? (
                  <p role="status">Loading saved locations…</p>
                ) : locations.length ? (
                  <ul className="account-saved-list">
                    {locations.map((location) => (
                      <li key={location.id}>
                        <strong>{location.label}</strong>
                        <details className="account-location-details">
                          <summary>View saved coordinates</summary>
                          <p>
                            {location.coordinates.lat.toFixed(5)},{" "}
                            {location.coordinates.lng.toFixed(5)}
                          </p>
                        </details>
                        <button
                          className="btn btn-outline account-secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const result = await request<{
                                message?: string;
                              }>("locations", "DELETE", { id: location.id });
                              await loadSaved();
                              return result;
                            }, "Saved location removed.")
                          }
                        >
                          Remove {location.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No locations saved.</p>
                )}
                <p>
                  Choosing a place does not save it. Address searches send your
                  search to Reach’s configured geocoding provider.
                </p>
                <fieldset disabled={busy || locations.length >= 10}>
                  <LocationPicker
                    value={preferredLocation}
                    onChange={setPreferredLocation}
                  />
                </fieldset>
                <form
                  key={
                    preferredLocation
                      ? `${preferredLocation.coordinates.lat}/${preferredLocation.coordinates.lng}/${preferredLocation.timestamp}`
                      : "no-location"
                  }
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    if (!preferredLocation) {
                      setError("Choose a location before saving.");
                      return;
                    }
                    const selected = preferredLocation;
                    void act(async () => {
                      const result = await request<{ message?: string }>(
                        "locations",
                        "POST",
                        {
                          label: value(form, "label"),
                          coordinates: selected.coordinates,
                          consent: true,
                        },
                      );
                      form.reset();
                      setPreferredLocation(null);
                      await loadSaved();
                      return result;
                    }, "Location saved privately.");
                  }}
                >
                  <fieldset
                    disabled={
                      busy || locations.length >= 10 || !preferredLocation
                    }
                  >
                    <Field
                      name="label"
                      label="Location label"
                      autoComplete="off"
                      help="For example, Campus or Library."
                    />
                    <label className="account-check">
                      <input
                        type="checkbox"
                        name="consent"
                        required
                        className="checkbox checkbox-primary"
                      />
                      <span>
                        I consent to saving this selected location privately in
                        my Reach account.
                      </span>
                    </label>
                    <button className="btn btn-primary">
                      Save preferred location
                    </button>
                  </fieldset>
                </form>
              </Card>
              <Card title="Change password">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    void act(
                      async () => {
                        const result = await request<{ message?: string }>(
                          "change-password",
                          "POST",
                          {
                            currentPassword: value(form, "currentPassword"),
                            newPassword: value(form, "newPassword"),
                          },
                        );
                        form.reset();
                        return result;
                      },
                      "Password changed. Sign in again with your new password.",
                      true,
                    );
                  }}
                >
                  <fieldset disabled={busy}>
                    <Field
                      name="currentPassword"
                      label="Current password"
                      type="password"
                      autoComplete="current-password"
                    />
                    <Field
                      name="newPassword"
                      label="New password"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      help="Use at least 12 characters."
                    />
                    <button className="btn btn-primary">Change password</button>
                  </fieldset>
                </form>
              </Card>
              <Card title="Delete account" danger>
                <p>
                  This permanently deletes your account and private saved items.
                  Enter your password and type DELETE to confirm.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    void act(async () => {
                      const result = await request<{ message?: string }>(
                        "delete",
                        "DELETE",
                        {
                          password: value(form, "deletePassword"),
                          confirmation: value(form, "confirmation"),
                        },
                      );
                      setUser(null);
                      setLinkAction(null);
                      form.reset();
                      return result;
                    }, "Your account has been deleted.");
                  }}
                >
                  <fieldset disabled={busy}>
                    <Field
                      name="deletePassword"
                      label="Password to confirm deletion"
                      type="password"
                      autoComplete="current-password"
                    />
                    <label className="account-field">
                      <span>Type DELETE</span>
                      <input
                        name="confirmation"
                        pattern="DELETE"
                        autoComplete="off"
                        required
                        className="input input-bordered"
                      />
                    </label>
                    <button className="btn btn-error account-delete">
                      Permanently delete account
                    </button>
                  </fieldset>
                </form>
              </Card>
            </div>
          )}
        </>
      )}
      <footer className="account-footer">
        <a href="/privacy">Privacy and location</a>
        <a href="/terms">Terms</a>
        <span>Here to help you get there.</span>
      </footer>
    </main>
  );
}
