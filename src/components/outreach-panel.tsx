"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  OutreachHistory,
  OutreachMessage,
  OutreachRecipient,
} from "@/lib/outreach-types";
import type { CommunityMine } from "@/lib/community-types";
import { LocationPicker, type SelectedLocation } from "./location-picker";
import "./outreach-panel.css";

type Props = { pantryId?: string; onAvailabilityChange?: () => void };
type DraftResponse = {
  message: OutreachMessage;
  assistance: "ai" | "template";
};
class OutreachError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, method = "GET", body?: unknown) {
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
    throw new OutreachError(
      typeof data?.error === "string"
        ? data.error
        : "Reach could not complete this request. Please try again.",
      response.status,
    );
  if (response.status === 204) return {} as T;
  if (!data || typeof data !== "object")
    throw new OutreachError(
      "Reach returned an incomplete response.",
      response.status,
    );
  return data as T;
}

function statusLabel(message: OutreachMessage) {
  switch (message.status) {
    case "queued":
      return "Queued for delivery";
    case "accepted":
      return "Accepted by email provider · delivery not confirmed";
    case "delivered":
      return "Delivered";
    case "replied":
      return "Reply received · needs your review";
    case "preview":
      return "Preview only · no email sent";
    case "sending":
      return "Sending";
    case "bounced":
      return "Delivery failed";
    case "uncertain":
      return "Delivery status uncertain";
    case "failed":
      return "Not sent";
    case "cancelled":
      return "Cancelled";
    default:
      return "Draft";
  }
}

function dateLabel(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return "Date unknown";
  // A pickup date is a Chicago calendar day, not midnight UTC converted locally.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Chicago",
  }).format(new Date(value));
}

function requestHelp(error: unknown) {
  if (error instanceof OutreachError && error.status === 401)
    return "Sign in with Google or your Reach account to contact a trusted recipient and review your outreach history. Google sign-in does not grant Gmail access; Reach sends only inquiries you explicitly approve.";
  if (error instanceof OutreachError && error.status === 403)
    return "Verify your email address in your account before using outreach.";
  return error instanceof Error
    ? error.message
    : "Outreach could not be loaded. Please try again.";
}

export function OutreachPanel({ pantryId, onAvailabilityChange }: Props) {
  const [history, setHistory] = useState<OutreachHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountStatus, setAccountStatus] = useState<401 | 403 | null>(null);
  const [notice, setNotice] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState<OutreachMessage | null>(null);
  const [assistance, setAssistance] = useState<"ai" | "template" | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [followup, setFollowup] = useState(false);
  const [reviewedReplies, setReviewedReplies] = useState<
    Record<string, boolean>
  >({});
  const [pickupLocations, setPickupLocations] = useState<
    Record<string, SelectedLocation | null>
  >({});
  const [pickupConsents, setPickupConsents] = useState<Record<string, boolean>>(
    {},
  );
  const [stoppedRecipients, setStoppedRecipients] = useState<
    Record<string, boolean>
  >({});
  const [householdOffers, setHouseholdOffers] = useState<
    CommunityMine["offers"]
  >([]);
  const [householdOfferStatus, setHouseholdOfferStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [offerId, setOfferId] = useState("");
  const [enrollmentConsent, setEnrollmentConsent] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    setAccountStatus(null);
    try {
      const result = await request<OutreachHistory>("/api/outreach");
      setHistory({
        ...result,
        recipients: result.recipients.filter(
          (recipient) =>
            !pantryId ||
            recipient.pantryId === pantryId ||
            recipient.offerId === pantryId,
        ),
      });
      try {
        setHouseholdOfferStatus("loading");
        const own = await request<CommunityMine>("/api/community/mine");
        setHouseholdOffers(
          own.offers.filter(
            (offer) => offer.kind === "offer" && offer.status === "approved",
          ),
        );
        setHouseholdOfferStatus("ready");
      } catch {
        setHouseholdOffers([]);
        setHouseholdOfferStatus("unavailable");
      }
    } catch (cause) {
      setHistory(null);
      setHouseholdOffers([]);
      setHouseholdOfferStatus("unavailable");
      setError(requestHelp(cause));
      if (
        cause instanceof OutreachError &&
        (cause.status === 401 || cause.status === 403)
      )
        setAccountStatus(cause.status);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [pantryId]);
  useEffect(() => {
    setRecipientId("");
  }, [pantryId]);

  async function act<T>(path: string, body: unknown, success: string) {
    setBusy(true);
    setError("");
    setAccountStatus(null);
    setNotice("");
    try {
      const result = await request<T>(path, "POST", body);
      setNotice(success);
      return result;
    } catch (cause) {
      setError(requestHelp(cause));
      if (
        cause instanceof OutreachError &&
        (cause.status === 401 || cause.status === 403)
      )
        setAccountStatus(cause.status);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!recipientId || cleanQuestion.length < 5 || cleanQuestion.length > 400)
      return;
    const result = await act<DraftResponse>(
      "/api/outreach/draft",
      { recipientId, question: cleanQuestion },
      "Draft ready. Review and edit both the subject and message before authorizing it.",
    );
    if (result) {
      setDraft(result.message);
      setAssistance(result.assistance);
      setAuthorized(false);
      setFollowup(false);
    }
  }

  async function authorizeDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !authorized) return;
    const result = await act<unknown>(
      `/api/outreach/${encodeURIComponent(draft.id)}/authorize`,
      {
        subject: draft.subject,
        body: draft.body,
        authorized: true,
        ...(followup
          ? {
              followup: {
                optIn: true,
                intervalHours: 24,
                expiresInHours: 48,
                max: 1,
              },
            }
          : {}),
      },
      "Your authorization was recorded. Check the history for the current delivery status.",
    );
    if (result) {
      setDraft(null);
      setQuestion("");
      setAuthorized(false);
      setFollowup(false);
      await load();
    }
  }

  async function cancelMessage(message: OutreachMessage) {
    const result = await act<unknown>(
      `/api/outreach/${encodeURIComponent(message.id)}/cancel`,
      {},
      message.followup?.remaining
        ? "The follow-up was cancelled."
        : "The message was cancelled.",
    );
    if (result) await load();
  }

  async function confirmReply(message: OutreachMessage) {
    if (!message.reply) return;
    const replyId = message.reply.id;
    const pickupLocation = pickupLocations[replyId];
    const pickupConsent = !!pickupConsents[replyId];
    const result = await act<unknown>(
      `/api/outreach/${encodeURIComponent(message.id)}/confirm`,
      {
        confirmed: true,
        replyId,
        ...(message.recipient.kind === "household" &&
        pickupConsent &&
        pickupLocation
          ? {
              pickupCoordinates: pickupLocation.coordinates,
              pickupConsent: true,
            }
          : {}),
      },
      "Your private review was recorded. The reply remains private; no general pantry availability was changed.",
    );
    if (result) {
      setReviewedReplies((current) => ({ ...current, [message.id]: false }));
      setPickupLocations((current) => ({ ...current, [replyId]: null }));
      setPickupConsents((current) => ({ ...current, [replyId]: false }));
      await load();
      onAvailabilityChange?.();
    }
  }

  async function suppressRecipient(recipient: OutreachRecipient) {
    const result = await act<unknown>(
      "/api/outreach/suppress",
      { recipientId: recipient.id, consent: true },
      `Availability inquiries stopped for ${recipient.name}.`,
    );
    if (result) {
      setStoppedRecipients((current) => ({ ...current, [recipient.id]: true }));
      await load();
    }
  }

  async function discardDraft() {
    if (!draft) return;
    const result = await act<unknown>(
      `/api/outreach/${encodeURIComponent(draft.id)}/cancel`,
      {},
      "Draft cancelled.",
    );
    if (result) {
      setDraft(null);
      setAuthorized(false);
      setFollowup(false);
      await load();
    }
  }

  async function enrollHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!offerId || !enrollmentConsent) return;
    const result = await act<unknown>(
      "/api/outreach/enroll",
      { offerId, consent: true },
      "Household offer enrolled. Reach may send availability inquiries to your verified account email.",
    );
    if (result) {
      setOfferId("");
      setEnrollmentConsent(false);
      await load();
    }
  }

  const recipients = (history?.recipients || []).filter(
    (recipient) => recipient.id && recipient.name,
  );
  const historyOwnedRecipientIds = (
    history as (OutreachHistory & { ownedRecipientIds?: string[] }) | null
  )?.ownedRecipientIds;
  const ownedRecipientIds = Array.isArray(historyOwnedRecipientIds)
    ? historyOwnedRecipientIds
    : [];
  return (
    <section
      className="outreach-panel card bg-base-100"
      aria-labelledby="outreach-title"
    >
      <header className="outreach-header">
        <div>
          <p className="outreach-eyebrow">PRIVATE OUTREACH</p>
          <h2 id="outreach-title">Ask a trusted recipient</h2>
          <p>
            Draft a question for a recipient already trusted by Reach. Messages
            are queued for delivery; a reply does not guarantee food is
            available.
          </p>
        </div>
        <button
          className="btn btn-outline outreach-secondary"
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          Refresh
        </button>
      </header>

      <div className="outreach-feedback" aria-live="polite">
        {notice && (
          <p className="outreach-notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="outreach-error" role="alert">
            {error}
          </p>
        )}
        {accountStatus && (
          <a className="btn btn-primary" href="/account">
            {accountStatus === 401
              ? "Sign in to your account"
              : "Verify your email in your account"}
          </a>
        )}
      </div>

      {loading ? (
        <p role="status">Loading trusted recipients and private history…</p>
      ) : history ? (
        <>
          {history.deliveryMode === "disabled" && (
            <p className="outreach-callout" role="status">
              Email delivery is not configured. You can review history, but new
              messages cannot be sent right now.
            </p>
          )}
          {history.deliveryMode === "preview" && (
            <p className="outreach-callout" role="status">
              Preview mode is active. Authorized messages will be recorded as
              previews and will not be emailed.
            </p>
          )}
          {!history.inboundConfigured && (
            <p className="outreach-callout" role="status">
              Replies cannot currently be collected automatically. Check
              recipient replies through your existing private contact
              arrangements.
            </p>
          )}

          <details className="outreach-enrollment">
            <summary>Household donor enrollment</summary>
            <p>
              Enroll an existing approved food offer that you own. Reach will
              use your verified account email for questions; no contact address
              is collected here.
            </p>
            {householdOfferStatus === "unavailable" ? (
              <p className="outreach-empty">
                Your approved offers could not be loaded right now. Refresh to
                try again.
              </p>
            ) : householdOfferStatus === "ready" && householdOffers.length ? (
              <form
                className="outreach-form"
                onSubmit={(event) => void enrollHousehold(event)}
              >
                <label htmlFor="outreach-own-offer">Your approved offer</label>
                <select
                  id="outreach-own-offer"
                  className="select select-bordered"
                  value={offerId}
                  required
                  disabled={busy}
                  onChange={(event) => setOfferId(event.target.value)}
                >
                  <option value="">Choose an offer you own</option>
                  {householdOffers.map((offer) => (
                    <option value={offer.id} key={offer.id}>
                      {offer.title}
                    </option>
                  ))}
                </select>
                <label className="outreach-check">
                  <input
                    className="checkbox checkbox-primary"
                    type="checkbox"
                    checked={enrollmentConsent}
                    disabled={busy}
                    onChange={(event) =>
                      setEnrollmentConsent(event.target.checked)
                    }
                  />
                  <span>
                    Allow Reach food-availability inquiries about this offer
                    using my verified account email
                  </span>
                </label>
                <div className="outreach-actions">
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || !offerId || !enrollmentConsent}
                  >
                    Enroll this offer
                  </button>
                </div>
              </form>
            ) : householdOfferStatus === "ready" ? (
              <p className="outreach-empty">
                No approved offers you own are available to enroll. Create and
                receive approval for an offer first.
              </p>
            ) : (
              <p role="status">Loading your approved offers…</p>
            )}
          </details>

          <form
            className="outreach-form"
            onSubmit={(event) => void createDraft(event)}
          >
            <h3>Start a message</h3>
            {recipients.length ? (
              <>
                <label htmlFor="outreach-recipient">Trusted recipient</label>
                <select
                  id="outreach-recipient"
                  className="select select-bordered"
                  value={recipientId}
                  required
                  disabled={busy || history.deliveryMode === "disabled"}
                  onChange={(event) => setRecipientId(event.target.value)}
                >
                  <option value="">Choose a recipient</option>
                  {recipients.map((recipient: OutreachRecipient) => (
                    <option value={recipient.id} key={recipient.id}>
                      {recipient.name} ·{" "}
                      {recipient.kind === "household"
                        ? "Household"
                        : "Organization"}
                    </option>
                  ))}
                </select>
                <label htmlFor="outreach-question">
                  What would you like to ask?
                </label>
                <textarea
                  id="outreach-question"
                  className="textarea textarea-bordered"
                  value={question}
                  onChange={(event) =>
                    setQuestion(event.target.value.slice(0, 400))
                  }
                  minLength={5}
                  maxLength={400}
                  rows={3}
                  required
                  disabled={busy || history.deliveryMode === "disabled"}
                  aria-describedby="outreach-question-help"
                  placeholder="For example: Is there a good time to contact you about current food availability?"
                />
                <small id="outreach-question-help">
                  Up to 400 characters. Do not include addresses, precise
                  locations, or private account details.
                </small>
                <div className="outreach-actions">
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={
                      busy ||
                      history.deliveryMode === "disabled" ||
                      question.trim().length < 5
                    }
                  >
                    {busy ? "Working…" : "Create a draft"}
                  </button>
                </div>
              </>
            ) : (
              <p className="outreach-empty">
                No trusted recipients are available
                {pantryId ? " for this pantry" : ""}. Reach does not accept
                arbitrary email addresses.
              </p>
            )}
          </form>

          {draft && (
            <form
              className="outreach-editor"
              onSubmit={(event) => void authorizeDraft(event)}
            >
              <h3>Review your draft</h3>
              <p>
                For <strong>{draft.recipient.name}</strong>. Assistance:{" "}
                {assistance === "ai" ? "AI-assisted draft" : "message template"}
                . Edit anything that needs correcting.
              </p>
              <label htmlFor="outreach-subject">Subject</label>
              <input
                id="outreach-subject"
                className="input input-bordered"
                value={draft.subject}
                maxLength={180}
                required
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    subject: event.target.value.slice(0, 180),
                  })
                }
              />
              <label htmlFor="outreach-body">Message</label>
              <textarea
                id="outreach-body"
                className="textarea textarea-bordered"
                value={draft.body}
                maxLength={5000}
                rows={7}
                required
                disabled={busy}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    body: event.target.value.slice(0, 5000),
                  })
                }
              />
              <p className="outreach-small">
                This message is a question, not a promise that food is
                available. Do not include a home address or private location
                details.
              </p>
              <label className="outreach-check">
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={authorized}
                  disabled={busy}
                  onChange={(event) => setAuthorized(event.target.checked)}
                />
                <span>
                  I reviewed the recipient and message and authorize this email.
                </span>
              </label>
              <label className="outreach-check">
                <input
                  className="checkbox checkbox-primary"
                  type="checkbox"
                  checked={followup}
                  disabled={busy}
                  onChange={(event) => setFollowup(event.target.checked)}
                />
                <span>
                  Allow one follow-up after 24 hours if there is no reply. It
                  expires after 48 hours.
                </span>
              </label>
              <div className="outreach-actions">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={
                    busy ||
                    !authorized ||
                    !draft.subject.trim() ||
                    !draft.body.trim()
                  }
                >
                  {busy ? "Saving…" : "Authorize and queue"}
                </button>
                <button
                  className="btn btn-outline outreach-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void discardDraft()}
                >
                  Cancel draft
                </button>
              </div>
            </form>
          )}

          <section
            className="outreach-history"
            aria-labelledby="outreach-history-title"
          >
            <div className="outreach-history-heading">
              <h3 id="outreach-history-title">Private message history</h3>
              <span>
                {history.messages.length}{" "}
                {history.messages.length === 1 ? "message" : "messages"}
              </span>
            </div>
            {history.messages.length ? (
              <div className="outreach-list">
                {history.messages.map((message, messageIndex) => (
                  <article className="outreach-message" key={message.id}>
                    <div className="outreach-message-head">
                      <div>
                        <h4>{message.recipient.name}</h4>
                        <p>{message.subject}</p>
                      </div>
                      <span
                        className={`outreach-status outreach-status-${message.status}`}
                      >
                        {statusLabel(message)}
                      </span>
                    </div>
                    <p className="outreach-small">
                      Created {dateLabel(message.createdAt)}
                      {message.sentAt
                        ? ` · submitted ${dateLabel(message.sentAt)}`
                        : ""}
                    </p>
                    {(message.status === "draft" ||
                      message.status === "queued" ||
                      (message.followup && message.followup.remaining > 0)) && (
                      <button
                        type="button"
                        className="btn btn-outline outreach-secondary"
                        disabled={busy}
                        onClick={() => void cancelMessage(message)}
                      >
                        Cancel{" "}
                        {message.followup?.remaining ? "follow-up" : "message"}
                      </button>
                    )}
                    {ownedRecipientIds.includes(message.recipient.id) &&
                      !stoppedRecipients[message.recipient.id] &&
                      history.messages.findIndex(
                        (item) => item.recipient.id === message.recipient.id,
                      ) === messageIndex && (
                        <button
                          type="button"
                          className="btn btn-outline outreach-secondary"
                          disabled={busy}
                          onClick={() =>
                            void suppressRecipient(message.recipient)
                          }
                        >
                          Stop availability inquiries
                        </button>
                      )}
                    {message.reply && (
                      <div className="outreach-reply">
                        <h5>Reply · private · sender unverified</h5>
                        <p className="outreach-reply-text">
                          {message.reply.text}
                        </p>
                        <p className="outreach-small">
                          Received {dateLabel(message.reply.receivedAt)}.
                          Confirmed facts expire{" "}
                          {dateLabel(message.reply.expiresAt)}. A reply does not
                          confirm current stock or reserve food.
                        </p>
                        <dl className="outreach-facts">
                          <div>
                            <dt>Availability</dt>
                            <dd>{message.reply.facts.availability}</dd>
                          </div>
                          <div>
                            <dt>Date</dt>
                            <dd>
                              {message.reply.facts.date
                                ? dateLabel(message.reply.facts.date)
                                : "Unknown"}
                            </dd>
                          </div>
                          <div>
                            <dt>Pickup time · America/Chicago</dt>
                            <dd>
                              {message.reply.facts.pickupStart ||
                              message.reply.facts.pickupEnd
                                ? `${message.reply.facts.pickupStart || "Unknown"} – ${message.reply.facts.pickupEnd || "Unknown"}`
                                : "Unknown"}
                            </dd>
                          </div>
                          <div>
                            <dt>Food type</dt>
                            <dd>{message.reply.facts.foodType || "Unknown"}</dd>
                          </div>
                          <div>
                            <dt>Requirements</dt>
                            <dd>
                              {message.reply.facts.requirements || "Unknown"}
                            </dd>
                          </div>
                          <div>
                            <dt>Source text</dt>
                            <dd>
                              {message.reply.facts.supportingText ||
                                "Not provided"}
                            </dd>
                          </div>
                        </dl>
                        {message.reply.facts.uncertainty.length > 0 && (
                          <p className="outreach-small">
                            Needs checking:{" "}
                            {message.reply.facts.uncertainty.join(" · ")}
                          </p>
                        )}
                        {message.recipient.kind === "household" && (
                          <details className="outreach-pickup-destination">
                            <summary>
                              Optional public pickup destination
                            </summary>
                            <p>
                              This is a destination for this household pickup,
                              never your starting point. Only choose a public
                              meeting place you have confirmed with the donor.
                              Reach will not infer or add coordinates
                              automatically.
                            </p>
                            <LocationPicker
                              value={pickupLocations[message.reply.id] || null}
                              onChange={(location) =>
                                setPickupLocations((current) => ({
                                  ...current,
                                  [message.reply!.id]: location,
                                }))
                              }
                              resources={[]}
                            />
                            <label className="outreach-check">
                              <input
                                className="checkbox checkbox-primary"
                                type="checkbox"
                                checked={!!pickupConsents[message.reply.id]}
                                disabled={busy}
                                onChange={(event) =>
                                  setPickupConsents((current) => ({
                                    ...current,
                                    [message.reply!.id]: event.target.checked,
                                  }))
                                }
                              />
                              <span>
                                I confirmed this public meeting place with the
                                donor and want Reach to save it privately for
                                this pickup
                              </span>
                            </label>
                            {pickupConsents[message.reply.id] &&
                              !pickupLocations[message.reply.id] && (
                                <p role="status">
                                  Choose the confirmed public meeting place
                                  above, or clear this consent to review without
                                  saving a destination.
                                </p>
                              )}
                          </details>
                        )}
                        <p className="outreach-callout">
                          Confirming keeps this reply private in your account.
                          It does not update general pantry availability. Make
                          any arrangements directly with the recipient after
                          checking the details.
                        </p>
                        {!message.reply.reviewedAt && (
                          <>
                            <label className="outreach-check">
                              <input
                                className="checkbox checkbox-primary"
                                type="checkbox"
                                checked={!!reviewedReplies[message.id]}
                                disabled={busy}
                                onChange={(event) =>
                                  setReviewedReplies((current) => ({
                                    ...current,
                                    [message.id]: event.target.checked,
                                  }))
                                }
                              />
                              <span>
                                I reviewed this private reply. Its sender is
                                unverified, stock may change, and Reach will not
                                publish these facts or arrange pickup for me.
                              </span>
                            </label>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={
                                busy ||
                                !reviewedReplies[message.id] ||
                                (!!pickupConsents[message.reply.id] &&
                                  !pickupLocations[message.reply.id])
                              }
                              onClick={() => void confirmReply(message)}
                            >
                              Confirm private review
                            </button>
                          </>
                        )}
                        {message.reply.reviewedAt && (
                          <p className="outreach-small">
                            Privately reviewed{" "}
                            {dateLabel(message.reply.reviewedAt)}. No public
                            availability was changed.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="outreach-empty">No outreach messages yet.</p>
            )}
          </section>
        </>
      ) : (
        <div className="outreach-unavailable">
          <p>
            Trusted recipients and private outreach history are unavailable
            right now. Try refreshing in a moment.
          </p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
