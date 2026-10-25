"use client";

import { useEffect, useState } from "react";
import "./notification-preferences.css";

type Preferences = {
  pantry: boolean;
  volunteer: boolean;
  pickup: boolean;
  volunteerParticipation: boolean;
};
type Configuration = {
  preferences: Preferences;
  deliveryMode: "smtp" | "preview" | "disabled";
};
type Delivery = {
  id: string;
  status: string;
  createdAt?: string;
  kind?: string;
};
const labels: Record<string, string> = {
  queued: "Queued",
  pending: "Pending with the email provider — delivery is not confirmed",
  delayed: "Delayed by the email provider",
  held: "Held by the email provider",
  bounced: "Bounced — could not be delivered",
  accepted: "Accepted by the email provider — delivery is not confirmed",
  delivered:
    "Accepted by recipient mail server — inbox placement is not confirmed",
  failed: "Failed",
  uncertain: "Delivery uncertain",
  preview: "Preview only — no email sent",
  suppressed: "Suppressed — no email sent",
};
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
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
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error || "Notifications are unavailable. Please try again.",
    );
  return data as T;
}

export function NotificationPreferences({
  emailVerified = false,
}: {
  emailVerified?: boolean;
}) {
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  async function load() {
    setError("");
    try {
      setConfiguration(await request<Configuration>("/api/notifications"));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load notification preferences.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(preferences: Preferences) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/notifications", "PUT", preferences);
      setConfiguration((current) => current && { ...current, preferences });
      setNotice("Notification preferences saved.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save preferences.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="card bg-base-100 account-card notification-preferences"
      aria-labelledby="notification-heading"
    >
      <h2 id="notification-heading">Notifications & volunteering</h2>
      <p>
        Choose optional emails. Essential security messages, including account
        verification and password recovery, cannot be turned off here.
      </p>
      <div aria-live="polite">
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {!configuration ? (
        <>
          <p>
            {error
              ? "Your preferences could not be loaded."
              : "Loading notification preferences…"}
          </p>
          {error && (
            <button
              type="button"
              onClick={() => void load()}
              className="btn btn-primary"
            >
              Try notifications again
            </button>
          )}
        </>
      ) : (
        <>
          {configuration.deliveryMode === "preview" && (
            <p className="notification-mode">
              Preview mode: messages are recorded for testing. No real email is
              sent.
            </p>
          )}
          {configuration.deliveryMode === "disabled" && (
            <p className="notification-mode">
              Email delivery is disabled. You can still save your choices.
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(configuration.preferences);
            }}
          >
            <fieldset disabled={busy}>
              <legend className="notification-legend">Optional updates</legend>
              {(
                [
                  ["pantry", "Pantry updates"],
                  ["volunteer", "Volunteer opportunities"],
                  ["pickup", "Pickup coordination updates"],
                  [
                    "volunteerParticipation",
                    "I want to participate as a volunteer",
                  ],
                ] as const
              ).map(([key, label]) => (
                <label className="account-check" key={key}>
                  <input
                    type="checkbox"
                    checked={configuration.preferences[key]}
                    disabled={!emailVerified && !configuration.preferences[key]}
                    onChange={(event) =>
                      setConfiguration({
                        ...configuration,
                        preferences: {
                          ...configuration.preferences,
                          [key]: event.target.checked,
                        },
                      })
                    }
                    className="checkbox checkbox-primary"
                  />
                  <span>{label}</span>
                </label>
              ))}
              {!emailVerified && (
                <p>
                  Verify your email in your profile before opting in to optional
                  emails or volunteer participation.
                </p>
              )}
              <p className="notification-help">
                Participation is separate from optional email updates. You
                choose each pickup before accepting it.
              </p>
              <button type="submit" className="btn btn-primary">
                {busy ? "Saving…" : "Save notification preferences"}
              </button>
              <button
                type="button"
                className="btn btn-outline account-secondary"
                onClick={() =>
                  void save({
                    ...configuration.preferences,
                    pantry: false,
                    volunteer: false,
                    pickup: false,
                  })
                }
              >
                Unsubscribe from optional emails
              </button>
            </fieldset>
          </form>
          <a href="/volunteer">
            Coordinate a pickup or find a volunteer opportunity
          </a>
          <details>
            <summary>Recent email status</summary>
            <p>
              “Accepted” means the provider accepted the message. It does not
              confirm delivery to an inbox.
            </p>
            <button
              type="button"
              className="btn btn-outline account-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await request<{ deliveries: Delivery[] }>(
                    "/api/notifications/deliveries",
                  );
                  setDeliveries(result.deliveries);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not load email status.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh email status
            </button>
            {deliveries &&
              (deliveries.length ? (
                <ul>
                  {deliveries.map((delivery, index) => (
                    <li key={delivery.id || index}>
                      {labels[delivery.status] || "Status unavailable"}
                      {delivery.createdAt && (
                        <span>
                          {" "}
                          · {new Date(delivery.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recent email activity.</p>
              ))}
          </details>
        </>
      )}
    </section>
  );
}

export function UnsubscribePanel() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const capture = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const captured = fragment.get("token");
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      if (captured) {
        setToken(captured);
        setDone(false);
        setError("");
      }
      setReady(true);
    };
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  return (
    <section className="card bg-base-100 account-card notification-preferences">
      <h1>Unsubscribe from optional emails</h1>
      <p>
        Confirm below to stop optional Reach emails associated with this link.
        Essential account security messages will continue.
      </p>
      {error && <p role="alert">{error}</p>}
      {done ? (
        <p role="status">
          If this link is current, optional emails are now off. You can also
          review your preferences in your account.
        </p>
      ) : !ready ? (
        <p role="status">Checking your link…</p>
      ) : token ? (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await request("/api/notifications/unsubscribe", "POST", {
                token,
              });
              setToken("");
              setDone(true);
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not unsubscribe. Please try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
          className="btn btn-primary"
        >
          {busy ? "Unsubscribing…" : "Confirm unsubscribe"}
        </button>
      ) : (
        <p>
          This link is missing its confirmation token. Open the complete
          unsubscribe link from your email, or manage preferences in your
          account.
        </p>
      )}
      <p>
        <a href="/account">Manage your account preferences</a>
      </p>
    </section>
  );
}
