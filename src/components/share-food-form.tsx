"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import { PickupLocationFields } from "@/components/pickup-location-fields";
import type { SharingKind, SharingSubmissionInput } from "@/lib/sharing-types";
import { COMMUNITY_PICKUP_AREAS } from "@/lib/community-types";
import "./sharing-pages.css";

export function ShareFoodForm() {
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<SharingKind>("hotspot");
  const [photo, setPhoto] = useState<string>();
  const [testId, setTestId] = useState<string>();
  const [testIdConsent, setTestIdConsent] = useState(false);
  const [error, setError] = useState("");
  const [locationError, setLocationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [publicKind, setPublicKind] = useState<"email" | "phone">("email");
  const [timeZone, setTimeZone] = useState("your device’s local time");
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    setTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "your device’s local time",
    );
    if (new URLSearchParams(window.location.search).get("kind") === "offer")
      setKind("offer");
  }, []);

  async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return setPhoto(undefined);
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setPhoto(undefined);
      setError("Choose an image up to 2 MB.");
      event.target.value = "";
      return;
    }
    try {
      setPhoto(
        await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("Could not read this image."));
          reader.readAsDataURL(file);
        }),
      );
      setError("");
    } catch {
      setPhoto(undefined);
      event.target.value = "";
      setError(
        "Could not read this image. Choose another file or continue without a photo.",
      );
    }
  }

  async function readTestId(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setTestIdConsent(false);
    if (!file) return setTestId(undefined);
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setTestId(undefined);
      setError("Choose a JPEG, PNG or WebP image up to 2 MB.");
      event.target.value = "";
      return;
    }
    try {
      setTestId(
        await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("Could not read this image."));
          reader.readAsDataURL(file);
        }),
      );
      setError("");
    } catch {
      setTestId(undefined);
      event.target.value = "";
      setError("Could not read this image. Choose another file.");
    }
  }

  function advance() {
    const fields = formRef.current?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >(
      `fieldset[data-step="${step}"] input, fieldset[data-step="${step}"] select, fieldset[data-step="${step}"] textarea`,
    );
    for (const field of fields ?? []) if (!field.reportValidity()) return;
    if (step === 0 && kind === "hotspot") {
      const data = new FormData(formRef.current!);
      if (!data.get("lat") || !data.get("lng")) {
        setLocationError(
          "Choose the public pickup location or enter its coordinates.",
        );
        return;
      }
    }
    setError("");
    setStep(step + 1);
    formRef.current?.scrollIntoView({ block: "start" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 2) {
      advance();
      return;
    }
    for (const field of event.currentTarget.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input,select,textarea")) {
      if (!field.checkValidity()) {
        setStep(
          Number(field.closest("fieldset")?.getAttribute("data-step") ?? 0),
        );
        setError("Please complete the required fields before sending.");
        return;
      }
    }
    if (testId && !testIdConsent) {
      setStep(1);
      setError(
        "Please consent separately before including the optional test image.",
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const v = (key: string) => String(form.get(key) ?? "").trim();
    const date = (key: string) => new Date(v(key)).toISOString();
    if (kind === "hotspot") {
      const lat = v("lat");
      const lng = v("lng");
      const latitude = Number(lat);
      const longitude = Number(lng);
      if (
        !lat ||
        !lng ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < 30.4 ||
        latitude > 30.9 ||
        longitude < -96.7 ||
        longitude > -96.1
      ) {
        setLocationError(
          "Search and select the public pickup location or enter valid coordinates within the Bryan–College Station area.",
        );
        return;
      }
      setLocationError("");
    }
    setBusy(true);
    setError("");
    let data: Record<string, unknown>;
    try {
      data =
        kind === "hotspot"
          ? {
              title: v("title"),
              description: v("description"),
              organizerName: v("organizerName"),
              address: v("address"),
              lat: Number(v("lat")),
              lng: Number(v("lng")),
              startsAt: date("startsAt"),
              endsAt: date("endsAt"),
              foodCategory: v("foodCategory"),
              ...(v("quantityText") ? { quantityText: v("quantityText") } : {}),
              eligibility:
                v("eligibility") ||
                "Requirements not provided. Contact the host.",
              accessibility:
                v("accessibility") ||
                "Accessibility not verified. Contact the host.",
              contact: v("publicContact"),
              pickupInstructions: v("pickupInstructions"),
            }
          : {
              title: v("title"),
              description: v("description"),
              pickupAreaId: v("pickupAreaId"),
              startsAt: date("startsAt"),
              endsAt: date("endsAt"),
              quantity: Number(v("quantity")),
              allergens: v("allergens"),
              storage: v("storage"),
              useBy: v("useBy"),
              foodCategory: v("foodCategory"),
              labelsIntact: true,
              noExcludedProducts: true,
              sealed: true,
              shelfStable: true,
              notHomemade: true,
              packagingUndamaged: true,
              notRecalled: true,
              privatePickupInstructions:
                "Contact the donor to arrange pickup at a public place.",
              pickupIsPublicPlace: true,
              sharePickupInstructions: false,
            };
      const payload = {
        kind,
        contactName: v("contactName"),
        contactEmail: v("contactEmail"),
        publicContact: { kind: publicKind, value: v("publicContact") },
        data,
        ...(photo ? { photo } : {}),
        ...(testId ? { testId, testIdConsent: true as const } : {}),
      };
      const fingerprint = JSON.stringify(payload);
      if (!requestRef.current || requestRef.current.fingerprint !== fingerprint)
        requestRef.current = { fingerprint, key: crypto.randomUUID() };
      const input: SharingSubmissionInput = {
        requestKey: requestRef.current.key,
        kind,
        contactName: v("contactName"),
        contactEmail: v("contactEmail"),
        publicContact: { kind: publicKind, value: v("publicContact") },
        adultConfirmed: true,
        permissionConfirmed: true,
        publicContactConsent: true,
        policyAccepted: true,
        data,
        ...(photo ? { photo } : {}),
        ...(testId ? { testId, testIdConsent: true } : {}),
      };
      const response = await fetch("/api/sharing/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error || "We couldn't submit this yet. Please try again.",
        );
      setSubmitted(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Check the required fields and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (submitted)
    return (
      <main className="sharing-shell">
        <section className="sharing-card sharing-success" aria-live="polite">
          <span className="sharing-kicker">Thank you for sharing</span>
          <h1>Your submission is awaiting approval</h1>
          <p>It will not appear publicly until a reviewer approves it.</p>
          <Link className="sharing-link" href="/">
            Return to Reach
          </Link>
        </section>
      </main>
    );

  return (
    <main className="sharing-shell">
      <header className="sharing-header">
        <Link href="/" className="sharing-back">
          ← Reach
        </Link>
        <span className="sharing-kicker">Community food sharing</span>
        <h1>Share food with your neighbors</h1>
        <p>
          Send a food pickup or extra groceries for review. You can submit
          without an account.
        </p>
      </header>
      <div
        className="sharing-choice"
        role="group"
        aria-label="What would you like to share?"
      >
        <button
          type="button"
          aria-pressed={kind === "hotspot"}
          onClick={() => {
            setKind("hotspot");
            setStep(0);
          }}
        >
          <strong>Host a Food Pickup</strong>
          <span>Tell neighbors about a community meal or pickup event.</span>
        </button>
        <button
          type="button"
          aria-pressed={kind === "offer"}
          onClick={() => {
            setKind("offer");
            setStep(0);
          }}
        >
          <strong>Share Extra Food</strong>
          <span>Offer sealed, shelf-stable groceries for pickup.</span>
        </button>
      </div>
      <form ref={formRef} className="sharing-card" onSubmit={submit} noValidate>
        <p className="sharing-kicker" aria-live="polite">
          Step {step + 1} of 3 ·{" "}
          {["Food details", "Contact & photo", "Confirm"][step]}
        </p>
        <fieldset data-step="0" hidden={step !== 0}>
          <legend>
            {kind === "hotspot" ? "Pickup details" : "Food offer details"}
          </legend>
          <label>
            Title
            <input name="title" required maxLength={100} />
          </label>
          <label>
            Description
            <textarea name="description" required maxLength={500} rows={3} />
          </label>
          <div className="sharing-grid">
            <label>
              Pickup starts
              <input name="startsAt" type="datetime-local" required />
              <small>
                Pickup can already be underway or start within 30 days. It can
                last up to 7 days and must end in the future, within the food’s
                use-by date.
              </small>
            </label>
            <label>
              Pickup ends
              <input name="endsAt" type="datetime-local" required />
            </label>
          </div>
          <p className="sharing-hint">Times use {timeZone}.</p>
          {kind === "hotspot" ? (
            <>
              <div className="sharing-grid">
                <label>
                  Organizer or host name
                  <input name="organizerName" required maxLength={100} />
                </label>
                <label>
                  Food type
                  <input name="foodCategory" required maxLength={100} />
                </label>
              </div>
              <PickupLocationFields />
              {locationError && (
                <p className="sharing-error" role="alert">
                  {locationError}
                </p>
              )}
              <label>
                Eligibility or who can come
                <input
                  name="eligibility"
                  maxLength={300}
                  placeholder="Optional: requirements, if known"
                />
              </label>
              <label>
                Accessibility information
                <input
                  name="accessibility"
                  maxLength={300}
                  placeholder="Optional: verified access information"
                />
              </label>
              <label>
                Pickup instructions
                <textarea
                  name="pickupInstructions"
                  required
                  maxLength={500}
                  rows={2}
                />
              </label>
              <label>
                Quantity, if known
                <input name="quantityText" maxLength={100} />
              </label>
            </>
          ) : (
            <>
              <label>
                Approximate pickup area
                <select name="pickupAreaId" required defaultValue="">
                  <option value="" disabled>
                    Select an area
                  </option>
                  {COMMUNITY_PICKUP_AREAS.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sharing-grid">
                <label>
                  Number of portions or items
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    max="20"
                    required
                  />
                </label>
                <label>
                  Food type
                  <select name="foodCategory" required defaultValue="">
                    <option value="" disabled>
                      Select a type
                    </option>
                    <option value="canned-groceries">Canned groceries</option>
                    <option value="dry-groceries">Dry groceries</option>
                    <option value="sealed-snacks">Sealed snacks</option>
                  </select>
                </label>
              </div>
              <div className="sharing-grid">
                <label>
                  Use by date
                  <input name="useBy" type="date" required />
                </label>
                <label>
                  Storage instructions
                  <input name="storage" required maxLength={300} />
                </label>
              </div>
              <label>
                Allergens or cross-contact information
                <input name="allergens" required maxLength={300} />
              </label>
              <p className="sharing-notice">
                Offers are limited to sealed, in-date, commercially packaged
                shelf-stable groceries with intact labels and packaging.
                Homemade meals, perishables, and recalled food are not eligible.
                Use a mutually agreed public pickup place.
              </p>
              <div className="sharing-attest">
                <label className="sharing-check">
                  <input type="checkbox" required /> I confirm this is sealed,
                  in-date, commercially packaged shelf-stable food with intact
                  labels and packaging, and is not homemade, perishable, or
                  recalled.
                </label>
              </div>
            </>
          )}
        </fieldset>
        <fieldset data-step="1" hidden={step !== 1}>
          <legend>How reviewers can reach you</legend>
          <div className="sharing-grid">
            <label>
              Your name
              <input
                name="contactName"
                required
                maxLength={100}
                autoComplete="name"
              />
            </label>
            <label>
              Your email (private)
              <input
                name="contactEmail"
                required
                type="email"
                autoComplete="email"
              />
            </label>
          </div>
          <div className="sharing-grid">
            <label>
              Public contact type
              <select
                value={publicKind}
                onChange={(e) =>
                  setPublicKind(e.target.value as "email" | "phone")
                }
              >
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
            </label>
            <label>
              Contact shown publicly
              <input
                name="publicContact"
                required
                type={publicKind === "email" ? "email" : "tel"}
              />
            </label>
          </div>
          <label>
            Optional photo
            <input type="file" accept="image/*" onChange={readPhoto} />
            <small>
              Up to 2 MB. Avoid photos that show private information.
            </small>
          </label>
          <label>
            Optional test ID — developer testing only
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={readTestId}
            />
            <small>
              Use a synthetic or fully redacted sample; do not upload a real
              government ID. This does not verify identity. JPEG, PNG or WebP up
              to 2 MB. Private review access expires after 24 hours. The active
              copy is removed on review or the next cleanup.
            </small>
          </label>
          {testId && (
            <label className="sharing-check">
              <input
                type="checkbox"
                checked={testIdConsent}
                onChange={(event) => setTestIdConsent(event.target.checked)}
                required
              />{" "}
              I consent to storing this test image privately for developer
              testing. Review access ends after 24 hours; the active copy is
              removed on review or the next cleanup.
            </label>
          )}
        </fieldset>
        <fieldset data-step="2" hidden={step !== 2} className="sharing-attest">
          <legend>Confirm before sending</legend>
          <label className="sharing-check">
            <input type="checkbox" required /> I am an adult and have permission
            to share this food or host this pickup.
          </label>
          <label className="sharing-check">
            <input type="checkbox" required /> I agree that the public contact
            above can be shown with this approved listing.
          </label>
          <label className="sharing-check">
            <input type="checkbox" required />
            <span>
              I agree to the{" "}
              <Link href="/terms">community food sharing rules</Link> and
              understand Reach reviews submissions before anything is made
              public.
            </span>
          </label>
          <p className="sharing-hint">
            Your name and email are private to reviewers. See the{" "}
            <Link href="/privacy">privacy information</Link>. You can send up to
            3 submissions per day.
          </p>
        </fieldset>
        {error && (
          <p className="sharing-error" role="alert">
            {error}
          </p>
        )}
        <div className="sharing-actions">
          {step > 0 && (
            <button
              type="button"
              className="sharing-refresh"
              disabled={busy}
              onClick={() => {
                setStep(step - 1);
                setError("");
              }}
            >
              Back
            </button>
          )}
          <button className="sharing-submit" disabled={busy}>
            {busy ? "Sending…" : step < 2 ? "Continue" : "Send for review"}
          </button>
        </div>
      </form>
    </main>
  );
}
