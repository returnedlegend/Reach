"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, X } from "lucide-react";
import type {
  PantryCorrection,
  PantryDetailResponse,
  PantryInventoryItem,
  PantryPatch,
  PantryRecord,
} from "@/lib/pantry-types";
import type { PantryWindow, ScheduleRule } from "@/lib/types";
import { BusyTimes } from "./busy-times";
import { pantryRequest, type PantryAccount } from "./pantry-detail";
import "./pantry-pages.css";

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
type PantryFields = Omit<PantryPatch, "version">;
type Source = PantryRecord["sources"][number];
function messageFrom(reason: unknown) {
  return reason instanceof Error
    ? reason.message
    : "The change could not be saved.";
}
function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="pantry-pagination" aria-label="Pages">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="btn btn-primary"
      >
        Previous
      </button>
      <span>
        Page {page} · {total} {total === 1 ? "result" : "results"}
      </span>
      <button
        type="button"
        disabled={page * 20 >= total}
        onClick={() => onChange(page + 1)}
        className="btn btn-primary"
      >
        Next
      </button>
    </nav>
  );
}

function PantryInformationForm({
  pantry,
  onSave,
  submitLabel = "Save pantry information",
  busy,
}: {
  pantry?: PantryRecord;
  onSave: (fields: PantryFields) => Promise<void>;
  submitLabel?: string;
  busy: boolean;
}) {
  const [sources, setSources] = useState<Source[]>(pantry?.sources ?? []);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    try {
      const lat = value("latitude"),
        lng = value("longitude");
      if (Boolean(lat) !== Boolean(lng))
        throw new Error(
          "Supply both latitude and longitude, or leave both blank for an unverified map pin.",
        );
      await onSave({
        name: value("name"),
        address: value("address"),
        phone: value("phone"),
        website: value("website") || null,
        eligibility: value("eligibility"),
        accessibility: value("accessibility"),
        offering: value("offering"),
        notes: value("notes"),
        coordinates: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
        verificationStatus: value("verificationStatus") as
          | "confirmed-site"
          | "needs-confirmation",
        detailsNeedConfirmation: form.has("detailsNeedConfirmation"),
        lastVerified: value("lastVerified") || null,
        sources: sources.map((source) => ({
          title: source.title.trim(),
          ...(source.url?.trim() ? { url: source.url.trim() } : {}),
          ...(source.checkedOn ? { checkedOn: source.checkedOn } : {}),
        })),
      });
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }
  function updateSource(index: number, fields: Partial<Source>) {
    setSources((current) =>
      current.map((source, at) =>
        at === index ? { ...source, ...fields } : source,
      ),
    );
  }
  return (
    <form onSubmit={submit} className="pantry-form">
      <fieldset disabled={busy}>
        <div className="pantry-field-grid">
          <label>
            Pantry name
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={pantry?.name}
              className="input input-bordered"
            />
          </label>
          <label>
            Street address
            <input
              name="address"
              required
              maxLength={500}
              defaultValue={pantry?.address}
              autoComplete="street-address"
              className="input input-bordered"
            />
          </label>
          <label>
            Phone
            <input
              name="phone"
              type="tel"
              maxLength={80}
              defaultValue={pantry?.phone}
              className="input input-bordered"
            />
          </label>
          <label>
            Website
            <input
              name="website"
              type="url"
              maxLength={2000}
              defaultValue={pantry?.website ?? ""}
              placeholder="https://"
              className="input input-bordered"
            />
          </label>
        </div>
        <label>
          Food and services offered
          <textarea
            name="offering"
            maxLength={2000}
            rows={2}
            defaultValue={pantry?.offering ?? ""}
            className="textarea textarea-bordered"
          />
        </label>
        <label>
          Eligibility and required documents
          <textarea
            name="eligibility"
            maxLength={2000}
            rows={3}
            defaultValue={pantry?.eligibility ?? "Eligibility not verified."}
            className="textarea textarea-bordered"
          />
        </label>
        <label>
          Accessibility information
          <textarea
            name="accessibility"
            maxLength={2000}
            rows={2}
            defaultValue={
              pantry?.accessibility ?? "Accessibility not verified."
            }
            className="textarea textarea-bordered"
          />
        </label>
        <label>
          Visit notes
          <textarea
            name="notes"
            maxLength={4000}
            rows={3}
            defaultValue={pantry?.notes ?? ""}
            className="textarea textarea-bordered"
          />
        </label>
        <div className="pantry-field-grid">
          <label>
            Location verification
            <select
              name="verificationStatus"
              defaultValue={pantry?.verificationStatus ?? "needs-confirmation"}
              className="input input-bordered"
            >
              <option value="needs-confirmation">Needs confirmation</option>
              <option value="confirmed-site">Site location confirmed</option>
            </select>
          </label>
          <label>
            Last verified date
            <input
              type="date"
              name="lastVerified"
              defaultValue={pantry?.lastVerified?.slice(0, 10) ?? ""}
              className="input input-bordered"
            />
          </label>
        </div>
        <label className="pantry-check">
          <input
            name="detailsNeedConfirmation"
            type="checkbox"
            defaultChecked={pantry?.detailsNeedConfirmation ?? true}
            className="checkbox checkbox-primary"
          />
          Some details need provider confirmation
        </label>
        <details>
          <summary>Advanced: verify map pin</summary>
          <p>
            Only add a map pin supported by an address check or provider
            confirmation. Precision does not establish a safe or accessible
            entrance.
          </p>
          <div className="pantry-field-grid">
            <label>
              Latitude
              <input
                name="latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                defaultValue={pantry?.coordinates?.lat ?? ""}
                className="input input-bordered"
              />
            </label>
            <label>
              Longitude
              <input
                name="longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                defaultValue={pantry?.coordinates?.lng ?? ""}
                className="input input-bordered"
              />
            </label>
          </div>
        </details>
        <h3>Information sources</h3>
        <p className="pantry-muted">
          Record where the information was confirmed. Do not update verification
          dates without checking the provider.
        </p>
        {sources.map((source, index) => (
          <fieldset className="pantry-edit-row" key={index}>
            <legend>Source {index + 1}</legend>
            <label>
              Source title
              <input
                required
                maxLength={200}
                value={source.title}
                onChange={(event) =>
                  updateSource(index, { title: event.target.value })
                }
                className="input input-bordered"
              />
            </label>
            <label>
              Source website
              <input
                type="url"
                maxLength={2000}
                value={source.url ?? ""}
                onChange={(event) =>
                  updateSource(index, { url: event.target.value })
                }
                className="input input-bordered"
              />
            </label>
            <label>
              Date checked
              <input
                type="date"
                value={source.checkedOn ?? ""}
                onChange={(event) =>
                  updateSource(index, { checkedOn: event.target.value })
                }
                className="input input-bordered"
              />
            </label>
            <button
              type="button"
              className="btn btn-outline pantry-secondary"
              onClick={() =>
                setSources((current) => current.filter((_, at) => at !== index))
              }
            >
              Remove source {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-outline pantry-secondary"
          disabled={sources.length >= 30}
          onClick={() => setSources((current) => [...current, { title: "" }])}
        >
          <Plus size={16} />
          Add source
        </button>
        <div className="pantry-actions">
          <button type="submit" className="btn btn-primary">
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="pantry-warning">
          {error}
        </p>
      )}
    </form>
  );
}

function HoursForm({
  pantry,
  busy,
  onSave,
}: {
  pantry: PantryRecord;
  busy: boolean;
  onSave: (windows: PantryWindow[], closures: string[]) => Promise<void>;
}) {
  const [windows, setWindows] = useState(pantry.windows);
  const scheduleSources = pantry.scheduleSources ?? [];
  const currentSourceIds = new Set(scheduleSources.map((source) => source.id));
  const [closures, setClosures] = useState(pantry.closures);
  const [error, setError] = useState("");
  const update = (index: number, fields: Partial<PantryWindow>) =>
    setWindows((current) =>
      current.map((window, at) =>
        at === index ? { ...window, ...fields } : window,
      ),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onSave(windows, closures.filter(Boolean));
    } catch (reason) {
      setError(messageFrom(reason));
    }
  }
  return (
    <form className="pantry-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <p>
          Publish confirmed distribution windows in Central Time. Keep unknown
          policies and conflicting sources marked until resolved. With no
          windows, hours remain unknown.
        </p>
        {windows.map((window, index) => (
          <fieldset className="pantry-edit-row" key={window.id}>
            <legend>Distribution window {index + 1}</legend>
            <label>
              Repeats
              <select
                value={window.rule.kind}
                onChange={(event) => {
                  const kind = event.target.value;
                  const rule: ScheduleRule =
                    kind === "weekly"
                      ? { kind, weekdays: [] }
                      : kind === "nth-weekday"
                        ? { kind, weekday: 1, nth: 1 }
                        : kind === "first-weekdays"
                          ? { kind, weekday: 1, count: 2 }
                          : { kind: "dates", dates: [""] };
                  update(index, { rule });
                }}
                className="input input-bordered"
              >
                <option value="weekly">Every week</option>
                <option value="nth-weekday">One weekday each month</option>
                <option value="first-weekdays">
                  First few weekdays each month
                </option>
                <option value="dates">Specific dates</option>
              </select>
            </label>
            {window.rule.kind === "weekly" && (
              <fieldset>
                <legend>Days of the week</legend>
                <div className="pantry-weekday-checks">
                  {weekdays.map((day, dayIndex) => (
                    <label className="pantry-check" key={day}>
                      <input
                        type="checkbox"
                        checked={
                          window.rule.kind === "weekly" &&
                          window.rule.weekdays.includes(dayIndex)
                        }
                        onChange={(event) => {
                          if (window.rule.kind === "weekly")
                            update(index, {
                              rule: {
                                kind: "weekly",
                                weekdays: event.target.checked
                                  ? [...window.rule.weekdays, dayIndex].sort()
                                  : window.rule.weekdays.filter(
                                      (value) => value !== dayIndex,
                                    ),
                              },
                            });
                        }}
                        className="checkbox checkbox-primary"
                      />
                      {day}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {(window.rule.kind === "nth-weekday" ||
              window.rule.kind === "first-weekdays") && (
              <div className="pantry-field-grid">
                <label>
                  {window.rule.kind === "nth-weekday"
                    ? "Occurrence in the month"
                    : "Number of occurrences"}
                  <select
                    value={
                      window.rule.kind === "nth-weekday"
                        ? window.rule.nth
                        : window.rule.count
                    }
                    onChange={(event) => {
                      const rule = window.rule;
                      if (rule.kind === "nth-weekday")
                        update(index, {
                          rule: { ...rule, nth: Number(event.target.value) },
                        });
                      else if (rule.kind === "first-weekdays")
                        update(index, {
                          rule: { ...rule, count: Number(event.target.value) },
                        });
                    }}
                    className="input input-bordered"
                  >
                    {[1, 2, 3, 4, 5].map((number) => (
                      <option key={number} value={number}>
                        {window.rule.kind === "nth-weekday"
                          ? ["", "First", "Second", "Third", "Fourth", "Fifth"][
                              number
                            ]
                          : number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Weekday
                  <select
                    value={window.rule.weekday}
                    onChange={(event) => {
                      const rule = window.rule;
                      if (
                        rule.kind === "nth-weekday" ||
                        rule.kind === "first-weekdays"
                      )
                        update(index, {
                          rule: {
                            ...rule,
                            weekday: Number(event.target.value),
                          },
                        });
                    }}
                    className="input input-bordered"
                  >
                    {weekdays.map((day, value) => (
                      <option key={day} value={value}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {window.rule.kind === "dates" && (
              <div>
                {window.rule.dates.map((date, dateIndex) => (
                  <div className="pantry-inline-field" key={dateIndex}>
                    <label>
                      Distribution date
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(event) => {
                          if (window.rule.kind === "dates")
                            update(index, {
                              rule: {
                                kind: "dates",
                                dates: window.rule.dates.map((value, at) =>
                                  at === dateIndex ? event.target.value : value,
                                ),
                              },
                            });
                        }}
                        className="input input-bordered"
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-outline pantry-secondary"
                      onClick={() => {
                        if (window.rule.kind === "dates")
                          update(index, {
                            rule: {
                              kind: "dates",
                              dates: window.rule.dates.filter(
                                (_, at) => at !== dateIndex,
                              ),
                            },
                          });
                      }}
                    >
                      Remove date
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-outline pantry-secondary"
                  onClick={() => {
                    if (window.rule.kind === "dates")
                      update(index, {
                        rule: {
                          ...window.rule,
                          dates: [...window.rule.dates, ""],
                        },
                      });
                  }}
                >
                  Add date
                </button>
              </div>
            )}
            <div className="pantry-field-grid">
              <label>
                Distribution opens
                <input
                  required
                  type="time"
                  value={window.opens}
                  onChange={(event) =>
                    update(index, { opens: event.target.value })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Distribution closes
                <input
                  required
                  type="time"
                  value={window.closes}
                  onChange={(event) =>
                    update(index, { closes: event.target.value })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Registration opens (optional)
                <input
                  type="time"
                  value={window.registrationOpens ?? ""}
                  onChange={(event) =>
                    update(index, {
                      registrationOpens: event.target.value || undefined,
                    })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Registration cutoff (optional)
                <input
                  type="time"
                  value={window.registrationCutoff ?? ""}
                  onChange={(event) =>
                    update(index, {
                      registrationCutoff: event.target.value || undefined,
                    })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Distribution cutoff (optional)
                <input
                  type="time"
                  value={window.distributionCutoff ?? ""}
                  onChange={(event) =>
                    update(index, {
                      distributionCutoff: event.target.value || undefined,
                    })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Appointment policy
                <select
                  value={
                    window.appointmentRequired === undefined
                      ? "unknown"
                      : String(window.appointmentRequired)
                  }
                  onChange={(event) =>
                    update(index, {
                      appointmentRequired:
                        event.target.value === "unknown"
                          ? undefined
                          : event.target.value === "true",
                    })
                  }
                  className="input input-bordered"
                >
                  <option value="unknown">Not verified</option>
                  <option value="true">Appointment required</option>
                  <option value="false">Appointment not required</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Sources supporting these hours</legend>
              <p className="pantry-muted">
                Select the sources that support this distribution window. Keep
                conflicting schedules marked until the provider resolves them.
              </p>
              {scheduleSources.length ? (
                scheduleSources.map((source) => (
                  <label className="pantry-check" key={source.id}>
                    <input
                      type="checkbox"
                      checked={window.sourceIds.includes(source.id)}
                      onChange={(event) =>
                        update(index, {
                          sourceIds: event.target.checked
                            ? [...window.sourceIds, source.id]
                            : window.sourceIds.filter((id) => id !== source.id),
                        })
                      }
                      className="checkbox checkbox-primary"
                    />
                    {source.title}
                  </label>
                ))
              ) : (
                <p>
                  No schedule sources are available. Add a verified source in
                  the Information editor, then reload this pantry.
                </p>
              )}
              {window.sourceIds.some((id) => !currentSourceIds.has(id)) && (
                <p className="pantry-warning">
                  A previously linked source needs confirmation. Its reference
                  will be preserved when you save; confirm the hours with the
                  provider.
                </p>
              )}
            </fieldset>
            <label className="pantry-check">
              <input
                type="checkbox"
                checked={window.policyKnown}
                onChange={(event) =>
                  update(index, { policyKnown: event.target.checked })
                }
                className="checkbox checkbox-primary"
              />
              Pickup policy confirmed
            </label>
            <label className="pantry-check">
              <input
                type="checkbox"
                checked={window.conflictingSources ?? false}
                onChange={(event) =>
                  update(index, { conflictingSources: event.target.checked })
                }
                className="checkbox checkbox-primary"
              />
              Published sources conflict
            </label>
            <button
              type="button"
              className="btn btn-outline pantry-secondary"
              onClick={() =>
                setWindows((current) => current.filter((_, at) => at !== index))
              }
            >
              Remove distribution window {index + 1}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-outline pantry-secondary"
          disabled={windows.length >= 50}
          onClick={() =>
            setWindows((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                rule: { kind: "weekly", weekdays: [] },
                opens: "",
                closes: "",
                policyKnown: false,
                sourceIds: [],
              },
            ])
          }
        >
          Add distribution window
        </button>
        <h3>Closure exceptions</h3>
        {closures.map((date, index) => (
          <div className="pantry-inline-field" key={index}>
            <label>
              Closed on
              <input
                type="date"
                required
                value={date}
                onChange={(event) =>
                  setClosures((current) =>
                    current.map((value, at) =>
                      at === index ? event.target.value : value,
                    ),
                  )
                }
                className="input input-bordered"
              />
            </label>
            <button
              type="button"
              className="btn btn-outline pantry-secondary"
              onClick={() =>
                setClosures((current) =>
                  current.filter((_, at) => at !== index),
                )
              }
            >
              Remove closure
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-outline pantry-secondary"
          onClick={() => setClosures((current) => [...current, ""])}
        >
          Add closure date
        </button>
        <div className="pantry-actions">
          <button type="submit" className="btn btn-primary">
            {busy ? "Saving…" : "Save distribution hours"}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="pantry-warning">
          {error}
        </p>
      )}
    </form>
  );
}

function InventoryForm({
  items: initialItems,
  busy,
  onSave,
}: {
  items: PantryInventoryItem[];
  busy: boolean;
  onSave: (items: PantryInventoryItem[]) => Promise<void>;
}) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState("");
  const update = (index: number, fields: Partial<PantryInventoryItem>) =>
    setItems((current) =>
      current.map((item, at) => (at === index ? { ...item, ...fields } : item)),
    );
  return (
    <form
      className="pantry-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        try {
          await onSave(items);
        } catch (reason) {
          setError(messageFrom(reason));
        }
      }}
    >
      <fieldset disabled={busy}>
        <p>
          Share a recent observation and its source. Unknown availability is
          shown when no current inventory is recorded. Saving updates the report
          timestamp for every listed category; reconfirm each entry.
        </p>
        {items.map((item, index) => (
          <fieldset className="pantry-edit-row" key={index}>
            <legend>Food category {index + 1}</legend>
            <div className="pantry-field-grid">
              <label>
                Category
                <input
                  required
                  maxLength={100}
                  value={item.category}
                  onChange={(event) =>
                    update(index, { category: event.target.value })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Availability
                <select
                  value={item.status}
                  onChange={(event) =>
                    update(index, {
                      status: event.target
                        .value as PantryInventoryItem["status"],
                    })
                  }
                  className="input input-bordered"
                >
                  <option value="unknown">Unknown</option>
                  <option value="available">Available</option>
                  <option value="limited">Limited</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <label>
                Quantity (optional)
                <input
                  type="number"
                  min="0"
                  max="10000000"
                  step="1"
                  value={item.quantity ?? ""}
                  onChange={(event) =>
                    update(index, {
                      quantity:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                  className="input input-bordered"
                />
              </label>
              <label>
                Source of this observation
                <input
                  required
                  maxLength={300}
                  value={item.source}
                  onChange={(event) =>
                    update(index, { source: event.target.value })
                  }
                  className="input input-bordered"
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-outline pantry-secondary"
              onClick={() =>
                setItems((current) => current.filter((_, at) => at !== index))
              }
            >
              Remove category {index + 1}
            </button>
          </fieldset>
        ))}
        {!items.length && <p>No inventory categories are recorded.</p>}
        <button
          type="button"
          className="btn btn-outline pantry-secondary"
          disabled={items.length >= 100}
          onClick={() =>
            setItems((current) => [
              ...current,
              {
                category: "",
                status: "unknown",
                quantity: null,
                source: "",
                updatedAt: "",
              },
            ])
          }
        >
          Add food category
        </button>
        <div className="pantry-actions">
          <button type="submit" className="btn btn-primary">
            {busy ? "Saving…" : "Save food availability"}
          </button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="pantry-warning">
          {error}
        </p>
      )}
    </form>
  );
}

type Assignment = {
  pantryId: string;
  userId: string;
  email: string;
  name: string;
};
type Audit = {
  id: number;
  actorId: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  pantryName?: string | null;
  action: string;
  pantryId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};
export function PantryManagement() {
  const [user, setUser] = useState<PantryAccount | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [tab, setTab] = useState("directory");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<PantryRecord[]>([]);
  const [corrections, setCorrections] = useState<PantryCorrection[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<PantryDetailResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [editing, setEditing] = useState("information");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [managerEmail, setManagerEmail] = useState("");
  const [review, setReview] = useState<PantryCorrection | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const isAdmin = user?.role === "administrator";
  useEffect(() => {
    const controller = new AbortController();
    pantryRequest<{ user: PantryAccount | null }>("/api/account/me", {
      signal: controller.signal,
    })
      .then((data) => setUser(data.user))
      .catch((reason) => {
        if (!controller.signal.aborted) setAuthError(messageFrom(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthReady(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!user?.emailVerified) return;
    const controller = new AbortController();
    setListBusy(true);
    setError("");
    const endpoint =
      tab === "directory" ? `management?q=${encodeURIComponent(query)}` : tab;
    pantryRequest<{
      pantries?: PantryRecord[];
      corrections?: PantryCorrection[];
      audit?: Audit[];
      total: number;
    }>(
      `/api/pantries/${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}&pageSize=20`,
      { signal: controller.signal },
    )
      .then((data) => {
        setRows(data.pantries ?? []);
        setCorrections(data.corrections ?? []);
        setAudit(data.audit ?? []);
        setTotal(data.total);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(messageFrom(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListBusy(false);
      });
    return () => controller.abort();
  }, [user, tab, query, page, refresh]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setSelection(null);
    setSelectionError("");
    setAssignments([]);
    setConfirmation("");
    pantryRequest<PantryDetailResponse>(
      `/api/pantries/${encodeURIComponent(selectedId)}`,
      { signal: controller.signal },
    )
      .then(setSelection)
      .catch((reason) => {
        if (!controller.signal.aborted) setSelectionError(messageFrom(reason));
      });
    if (isAdmin) {
      const all: Assignment[] = [];
      const loadPage = async (number: number): Promise<void> => {
        const data = await pantryRequest<{
          assignments: Assignment[];
          total: number;
        }>(`/api/pantries/assignments?page=${number}&pageSize=100`, {
          signal: controller.signal,
        });
        all.push(...data.assignments);
        if (number * 100 < data.total) return loadPage(number + 1);
        setAssignments(all.filter((item) => item.pantryId === selectedId));
      };
      loadPage(1).catch((reason) => {
        if (!controller.signal.aborted) setSelectionError(messageFrom(reason));
      });
    }
    return () => controller.abort();
  }, [selectedId, isAdmin, refresh]);
  async function mutate(
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) {
    setBusy(true);
    setNotice("");
    try {
      await pantryRequest(path, { method, body: JSON.stringify(body) });
      setNotice(success);
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  function select(pantryId: string) {
    setSelectedId(pantryId);
    setCreating(false);
    setEditing("information");
    setReview(null);
    setSelectionError("");
    setNotice("");
  }
  const pantry = selection?.pantry;
  const title = !authReady
    ? "Loading your management access…"
    : !user
      ? "Sign in to manage pantries"
      : "Pantry management";
  return (
    <main className="pantry-page pantry-management" id="main-content">
      <nav className="pantry-nav" aria-label="Management navigation">
        <Link href="/" className="pantry-back">
          <ArrowLeft size={18} />
          Back to Reach
        </Link>
        <Link href="/account">Your account</Link>
      </nav>
      <header className="pantry-hero">
        <p className="pantry-eyebrow">Provider workspace</p>
        <h1>{title}</h1>
        <p>Keep pantry information useful, current and supported by sources.</p>
      </header>
      {authError && <p role="alert">{authError}</p>}
      {authReady && !user && (
        <section className="card bg-base-100 pantry-section">
          <p>
            Pantry managers can edit assigned listings. Administrators can
            manage the directory and review corrections.
          </p>
          <Link className="btn btn-primary pantry-button" href="/account">
            Sign in to your account
          </Link>
        </section>
      )}
      {user && !user.emailVerified && (
        <section className="card bg-base-100 pantry-section">
          <h2>Verify your email to continue</h2>
          <p>
            Use the verification email sent to your account before accessing
            pantry management.
          </p>
          <Link href="/account">Open your account</Link>
        </section>
      )}
      {user?.emailVerified && (
        <>
          <nav
            className="tabs tabs-box pantry-tabs"
            aria-label="Management sections"
          >
            {[
              ["directory", "Pantry directory"],
              ...(isAdmin
                ? [
                    ["corrections", "Suggested corrections"],
                    ["audit", "Audit log"],
                  ]
                : []),
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={tab === value}
                onClick={() => {
                  setTab(value);
                  setPage(1);
                  setSelectedId(null);
                  setCreating(false);
                  setReview(null);
                }}
                className={`tab btn ${tab === value ? "tab-active btn-primary" : "btn-ghost"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          {notice && (
            <p className="pantry-notice" role="status">
              {notice}
            </p>
          )}
          <section className="card bg-base-100 pantry-section">
            <div className="pantry-section-heading">
              <h2>
                {tab === "directory"
                  ? isAdmin
                    ? "Pantry directory"
                    : "Your assigned pantries"
                  : tab === "corrections"
                    ? "Suggested corrections"
                    : "Administrative activity"}
              </h2>
              {tab === "directory" && isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setCreating(true);
                    setSelectedId(null);
                    setReview(null);
                    setNotice("");
                  }}
                  className="btn btn-primary"
                >
                  <Plus size={17} />
                  Add pantry
                </button>
              )}
            </div>
            {tab === "directory" && (
              <form
                className="pantry-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  setQuery(search);
                  setPage(1);
                }}
              >
                <label>
                  Search name or address
                  <input
                    value={search}
                    maxLength={200}
                    onChange={(event) => setSearch(event.target.value)}
                    className="input input-bordered"
                  />
                </label>
                <button type="submit" className="btn btn-primary">
                  Search
                </button>
              </form>
            )}
            {listBusy ? (
              <p role="status">Loading…</p>
            ) : error ? (
              <div role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setRefresh((value) => value + 1)}
                  className="btn btn-primary"
                >
                  Try again
                </button>
              </div>
            ) : (
              <>
                {tab === "directory" && (
                  <div className="pantry-directory">
                    {rows.length ? (
                      rows.map((record) => (
                        <article key={record.id}>
                          <div>
                            <h3>{record.name}</h3>
                            <p>{record.address}</p>
                            <span className="pantry-tag">
                              {record.active
                                ? "Active listing"
                                : "Archived listing"}
                            </span>
                          </div>
                          <div className="pantry-actions">
                            <button
                              type="button"
                              onClick={() => select(record.id)}
                              className="btn btn-primary"
                            >
                              Manage{" "}
                              <span className="pantry-sr-only">
                                {record.name}
                              </span>
                            </button>
                            {record.active && (
                              <Link
                                href={`/pantries/${encodeURIComponent(record.id)}`}
                              >
                                View listing
                              </Link>
                            )}
                          </div>
                        </article>
                      ))
                    ) : (
                      <p className="pantry-empty">
                        {query
                          ? "No pantries match your search."
                          : "No assigned pantries. An administrator can assign your verified account to a pantry."}
                      </p>
                    )}
                  </div>
                )}
                {tab === "corrections" && (
                  <div className="pantry-directory">
                    {corrections.length ? (
                      corrections.map((item) => (
                        <article key={item.id}>
                          <div>
                            <h3>{item.pantryName}</h3>
                            <span className="pantry-tag">{item.status}</span>
                            <p className="pantry-preserve">
                              {item.description}
                            </p>
                            <p className="pantry-muted">
                              Submitted{" "}
                              {new Date(item.createdAt).toLocaleString()}
                            </p>
                            {item.notes && <p>Review notes: {item.notes}</p>}
                          </div>
                          {item.status === "pending" && (
                            <button
                              type="button"
                              onClick={() => {
                                select(item.pantryId);
                                setReview(item);
                                setReviewNotes("");
                              }}
                              className="btn btn-primary"
                            >
                              Review correction
                            </button>
                          )}
                        </article>
                      ))
                    ) : (
                      <p className="pantry-empty">No suggested corrections.</p>
                    )}
                  </div>
                )}
                {tab === "audit" && (
                  <div className="pantry-directory">
                    {audit.length ? (
                      audit.map((item) => (
                        <article key={item.id}>
                          <div>
                            <h3>{item.action.replaceAll("-", " ")}</h3>
                            {item.pantryName && (
                              <p>
                                <strong>{item.pantryName}</strong>
                              </p>
                            )}
                            <p>{new Date(item.createdAt).toLocaleString()}</p>
                            <p className="pantry-muted">
                              {item.actorName ||
                                item.actorEmail ||
                                (item.actorId
                                  ? "Account no longer available"
                                  : "System action")}
                            </p>
                            {typeof item.details.notes === "string" && (
                              <p>{item.details.notes}</p>
                            )}
                          </div>
                          {item.pantryId && (
                            <button
                              type="button"
                              onClick={() => select(item.pantryId!)}
                              className="btn btn-primary"
                            >
                              Inspect pantry
                            </button>
                          )}
                        </article>
                      ))
                    ) : (
                      <p className="pantry-empty">
                        No administrative activity recorded.
                      </p>
                    )}
                  </div>
                )}
                <Pager page={page} total={total} onChange={setPage} />
              </>
            )}
          </section>
          {creating && (
            <section className="card bg-base-100 pantry-section">
              <div className="pantry-section-heading">
                <h2>Add a pantry</h2>
                <button
                  type="button"
                  className="btn btn-outline pantry-secondary"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </div>
              <p>
                Unknown fields should stay unverified. Add confirmed hours and
                inventory after creating the listing.
              </p>
              <PantryInformationForm
                busy={busy}
                submitLabel="Create pantry listing"
                onSave={async (fields) => {
                  setBusy(true);
                  try {
                    const result = await pantryRequest<{
                      pantry: PantryRecord;
                    }>("/api/pantries", {
                      method: "POST",
                      body: JSON.stringify(fields),
                    });
                    setCreating(false);
                    select(result.pantry.id);
                    setNotice(
                      "Pantry created. Add its confirmed distribution schedule below.",
                    );
                    setRefresh((value) => value + 1);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </section>
          )}
          {selectedId && (
            <section
              className="card bg-base-100 pantry-section"
              aria-label="Selected pantry workspace"
            >
              <div className="pantry-section-heading">
                <h2>
                  {review
                    ? "Review suggested correction"
                    : (pantry?.name ?? "Loading pantry…")}
                </h2>
                <button
                  type="button"
                  className="btn btn-outline pantry-secondary"
                  aria-label="Close pantry editor"
                  onClick={() => {
                    setSelectedId(null);
                    setReview(null);
                  }}
                >
                  <X size={18} />
                  Close
                </button>
              </div>
              {selectionError && <p role="alert">{selectionError}</p>}
              <button
                type="button"
                className="btn btn-outline pantry-secondary"
                disabled={busy}
                onClick={() => {
                  setSelectionError("");
                  setRefresh((value) => value + 1);
                }}
              >
                Reload latest pantry information
              </button>
              <p className="pantry-muted">
                Reloading replaces any unsaved edits with the latest listing.
              </p>
              {!pantry && !selectionError && (
                <p role="status">Loading pantry workspace…</p>
              )}
              {pantry &&
                selection &&
                (selection.permissions.canEdit ? (
                  <>
                    <p>
                      {pantry.address} ·{" "}
                      {pantry.active ? "Active listing" : "Archived listing"}
                    </p>
                    {review ? (
                      <>
                        <div className="pantry-notice">
                          <strong>Suggested change</strong>
                          <p className="pantry-preserve">
                            {review.description}
                          </p>
                        </div>
                        <p>
                          Verify the suggested change, edit the relevant
                          information below, and record the reason for your
                          decision. Approving publishes the reviewed information
                          fields.
                        </p>
                        <p className="pantry-notice">
                          This review form updates listing information and
                          sources. For distribution hours or food availability,
                          use the corresponding pantry editor first, then return
                          to this correction to record your decision.
                        </p>
                        <div className="pantry-actions">
                          <button
                            type="button"
                            className="btn btn-outline pantry-secondary"
                            onClick={() => {
                              setReview(null);
                              setEditing("hours");
                            }}
                          >
                            Edit distribution hours
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline pantry-secondary"
                            onClick={() => {
                              setReview(null);
                              setEditing("inventory");
                            }}
                          >
                            Edit food availability
                          </button>
                        </div>
                        <label className="pantry-review-notes">
                          Review notes
                          <textarea
                            rows={3}
                            maxLength={1000}
                            value={reviewNotes}
                            onChange={(event) =>
                              setReviewNotes(event.target.value)
                            }
                            className="textarea textarea-bordered"
                          />
                        </label>
                        <PantryInformationForm
                          key={`${pantry.id}-${pantry.version}-${review.id}`}
                          pantry={pantry}
                          busy={busy}
                          submitLabel="Approve and publish reviewed information"
                          onSave={async (fields) => {
                            await mutate(
                              `/api/pantries/corrections/${encodeURIComponent(review.id)}/review`,
                              "POST",
                              {
                                decision: "approve",
                                notes: reviewNotes,
                                changes: { ...fields, version: pantry.version },
                              },
                              "Correction approved and reviewed information published.",
                            );
                            setReview(null);
                            setSelectedId(null);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-error pantry-danger"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              await mutate(
                                `/api/pantries/corrections/${encodeURIComponent(review.id)}/review`,
                                "POST",
                                { decision: "reject", notes: reviewNotes },
                                "Correction rejected; pantry information unchanged.",
                              );
                              setReview(null);
                              setSelectedId(null);
                            } catch (reason) {
                              setSelectionError(messageFrom(reason));
                            }
                          }}
                        >
                          Reject correction
                        </button>
                      </>
                    ) : (
                      <>
                        <nav
                          className="tabs tabs-box pantry-tabs"
                          aria-label="Pantry editing sections"
                        >
                          {[
                            ["information", "Information"],
                            ["hours", "Hours & closures"],
                            ["inventory", "Food availability"],
                            ["crowd", "Crowd observations"],
                            ...(isAdmin
                              ? [
                                  ["managers", "Managers"],
                                  ["status", "Archive & restore"],
                                ]
                              : []),
                          ].map(([value, label]) => (
                            <button
                              type="button"
                              key={value}
                              aria-pressed={editing === value}
                              onClick={() => {
                                setEditing(value);
                                setSelectionError("");
                              }}
                              className={`tab btn ${editing === value ? "tab-active btn-primary" : "btn-ghost"}`}
                            >
                              {label}
                            </button>
                          ))}
                        </nav>
                        {editing === "information" && (
                          <PantryInformationForm
                            key={`${pantry.id}-${pantry.version}`}
                            pantry={pantry}
                            busy={busy}
                            onSave={(fields) =>
                              mutate(
                                `/api/pantries/${encodeURIComponent(pantry.id)}`,
                                "PATCH",
                                { ...fields, version: pantry.version },
                                "Pantry information saved.",
                              )
                            }
                          />
                        )}
                        {editing === "hours" && (
                          <HoursForm
                            key={`${pantry.id}-${pantry.version}`}
                            pantry={pantry}
                            busy={busy}
                            onSave={(windows, closures) =>
                              mutate(
                                `/api/pantries/${encodeURIComponent(pantry.id)}/hours`,
                                "PUT",
                                { windows, closures, version: pantry.version },
                                "Distribution schedule saved.",
                              )
                            }
                          />
                        )}
                        {editing === "inventory" && (
                          <InventoryForm
                            key={`${pantry.id}-${pantry.version}`}
                            items={selection.inventory}
                            busy={busy}
                            onSave={(items) =>
                              mutate(
                                `/api/pantries/${encodeURIComponent(pantry.id)}/inventory`,
                                "PUT",
                                {
                                  items: items.map(
                                    ({ updatedAt: _, ...item }) => item,
                                  ),
                                  version: pantry.version,
                                },
                                "Food availability saved.",
                              )
                            }
                          />
                        )}
                        {editing === "crowd" && (
                          <BusyTimes pantryId={pantry.id} canReport />
                        )}
                        {editing === "managers" && isAdmin && (
                          <>
                            <h3>Assigned pantry managers</h3>
                            <p>
                              Assign an existing account with a verified email.
                              A manager can edit this pantry’s information,
                              schedule and inventory.
                            </p>
                            {assignments.length ? (
                              <ul className="pantry-manager-list">
                                {assignments.map((assignment) => (
                                  <li key={assignment.userId}>
                                    <span>
                                      {assignment.name || assignment.email} ·{" "}
                                      {assignment.email}
                                    </span>
                                    <button
                                      type="button"
                                      className="btn btn-outline pantry-secondary"
                                      disabled={busy}
                                      onClick={async () => {
                                        if (
                                          !window.confirm(
                                            `Remove ${assignment.email} as a manager of ${pantry.name}?`,
                                          )
                                        )
                                          return;
                                        try {
                                          await mutate(
                                            "/api/pantries/assignments",
                                            "POST",
                                            {
                                              pantryId: pantry.id,
                                              email: assignment.email,
                                              assign: false,
                                            },
                                            "Manager assignment removed.",
                                          );
                                        } catch (reason) {
                                          setSelectionError(
                                            messageFrom(reason),
                                          );
                                        }
                                      }}
                                    >
                                      Remove manager
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>No pantry managers assigned.</p>
                            )}
                            <form
                              className="pantry-form"
                              onSubmit={async (event) => {
                                event.preventDefault();
                                try {
                                  await mutate(
                                    "/api/pantries/assignments",
                                    "POST",
                                    {
                                      pantryId: pantry.id,
                                      email: managerEmail,
                                      assign: true,
                                    },
                                    "Pantry manager assigned.",
                                  );
                                  setManagerEmail("");
                                } catch (reason) {
                                  setSelectionError(messageFrom(reason));
                                }
                              }}
                            >
                              <label>
                                Manager’s verified email
                                <input
                                  type="email"
                                  required
                                  autoComplete="email"
                                  maxLength={254}
                                  value={managerEmail}
                                  onChange={(event) =>
                                    setManagerEmail(event.target.value)
                                  }
                                  className="input input-bordered"
                                />
                              </label>
                              <button
                                type="submit"
                                disabled={busy}
                                className="btn btn-primary"
                              >
                                Assign pantry manager
                              </button>
                            </form>
                          </>
                        )}
                        {editing === "status" && isAdmin && (
                          <>
                            <h3>
                              {pantry.active
                                ? "Archive this pantry"
                                : "Restore this pantry"}
                            </h3>
                            <p>
                              {pantry.active
                                ? "Archiving removes the pantry from public results while preserving its history. You can restore it later."
                                : "Restoring makes this pantry visible in public results again. Confirm its information is current first."}
                            </p>
                            <form
                              className="pantry-form"
                              onSubmit={async (event) => {
                                event.preventDefault();
                                try {
                                  await mutate(
                                    `/api/pantries/${encodeURIComponent(pantry.id)}/${pantry.active ? "archive" : "restore"}`,
                                    "POST",
                                    { confirmation },
                                    pantry.active
                                      ? "Pantry archived and removed from public results."
                                      : "Pantry restored to public results.",
                                  );
                                  setConfirmation("");
                                } catch (reason) {
                                  setSelectionError(messageFrom(reason));
                                }
                              }}
                            >
                              <label>
                                Type “{pantry.name}” to confirm
                                <input
                                  required
                                  value={confirmation}
                                  onChange={(event) =>
                                    setConfirmation(event.target.value)
                                  }
                                  autoComplete="off"
                                  className="input input-bordered"
                                />
                              </label>
                              <button
                                type="submit"
                                className={`btn ${pantry.active ? "btn-error pantry-danger" : "btn-primary"}`}
                                disabled={busy || confirmation !== pantry.name}
                              >
                                {busy
                                  ? "Saving…"
                                  : pantry.active
                                    ? "Confirm archive pantry"
                                    : "Confirm restore pantry"}
                              </button>
                            </form>
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p role="alert">
                    Your account does not have permission to edit this pantry.
                  </p>
                ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
