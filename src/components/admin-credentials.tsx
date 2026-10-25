"use client";
import { useState } from "react";
import Link from "next/link";

export function AdminCredentials({
  changePassword = false,
}: {
  changePassword?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <h1 className="text-3xl font-bold mb-6">
        {changePassword ? "Change password" : "Administrator sign in"}
      </h1>
      {done ? (
        <p role="status">
          Password changed. All previous sessions were signed out.{" "}
          <Link href="/admin/sign-in">Sign in with your new password</Link>.
        </p>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const value = (key: string) => String(form.get(key) || "");
            setError("");
            if (
              changePassword &&
              value("newPassword") !== value("confirmPassword")
            ) {
              setError("New passwords do not match.");
              return;
            }
            setBusy(true);
            try {
              const response = await fetch(
                `/api/account/${changePassword ? "change-password" : "login"}`,
                {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(
                    changePassword
                      ? {
                          currentPassword: value("currentPassword"),
                          newPassword: value("newPassword"),
                        }
                      : { email: value("email"), password: value("password") },
                  ),
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error || "Please try again.");
              if (changePassword) setDone(true);
              else
                window.location.assign(
                  result.user?.mustChangePassword
                    ? "/admin/change-password"
                    : "/admin",
                );
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Could not reach Reach. Please try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {changePassword ? (
            <>
              <p>
                Choose at least 12 characters. You will need to sign in again
                afterward.
              </p>
              <label>
                Current password
                <input
                  className="input w-full"
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <label>
                New password
                <input
                  className="input w-full"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
              <label>
                Confirm new password
                <input
                  className="input w-full"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Email
                <input
                  className="input w-full"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  className="input w-full"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <button className="btn btn-primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : changePassword
                ? "Change password"
                : "Sign in"}
          </button>
        </form>
      )}
      <p className="mt-6">
        <Link href={changePassword ? "/admin/sign-in" : "/share"}>
          {changePassword ? "Back to sign in" : "Back to Share food"}
        </Link>
      </p>
    </main>
  );
}
