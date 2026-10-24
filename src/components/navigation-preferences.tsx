"use client";

import type { NavigationNeeds } from "../lib/navigation-types";
import "./navigation-ui.css";

type Props = {
  value: NavigationNeeds;
  onChange: (value: NavigationNeeds) => void;
  aiEnabled: boolean;
  aiAvailable?: boolean;
  onAIEnabledChange: (value: boolean) => void;
};

const serviceLabels: Record<NavigationNeeds["service"], string> = {
  food: "Food assistance",
  groceries: "Groceries",
  "prepared-meals": "Prepared meals",
  shelter: "Shelter",
};

const urgencyLabels: Record<NavigationNeeds["urgency"], string> = {
  soon: "Soon",
  today: "Today",
  flexible: "I’m flexible",
};

export function NavigationPreferences({
  value,
  onChange,
  aiEnabled,
  aiAvailable = true,
  onAIEnabledChange,
}: Props) {
  function update(patch: Partial<NavigationNeeds>) {
    onChange({ ...value, ...patch });
  }

  return (
    <section
      className="navigation-ui navigation-preferences"
      aria-labelledby="navigation-preferences-heading"
    >
      <h2 id="navigation-preferences-heading">What would help right now?</h2>
      <p className="navigation-ui__intro">
        Pick a service and timing. You do not need an account or to explain
        personal circumstances.
      </p>

      <div className="navigation-preferences__primary">
        <label>
          Service
          <select
            className="select select-bordered"
            value={value.service}
            onChange={(event) =>
              update({
                service: event.target.value as NavigationNeeds["service"],
              })
            }
          >
            {Object.entries(serviceLabels).map(([service, label]) => (
              <option key={service} value={service}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          When do you need it?
          <select
            className="select select-bordered"
            value={value.urgency}
            onChange={(event) =>
              update({
                urgency: event.target.value as NavigationNeeds["urgency"],
              })
            }
          >
            {Object.entries(urgencyLabels).map(([urgency, label]) => (
              <option key={urgency} value={urgency}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="navigation-preferences__advanced">
        <summary>More preferences (optional)</summary>
        <div className="navigation-preferences__advanced-content">
          <label>
            Household size (optional)
            <select
              className="select select-bordered"
              value={value.householdSize ?? ""}
              onChange={(event) =>
                update({
                  householdSize: event.target.value
                    ? Number(event.target.value)
                    : undefined,
                })
              }
            >
              <option value="">Prefer not to say</option>
              {Array.from({ length: 20 }, (_, index) => index + 1).map(
                (size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Do you have identification?
            <select
              className="select select-bordered"
              value={value.hasIdentification}
              onChange={(event) =>
                update({
                  hasIdentification: event.target
                    .value as NavigationNeeds["hasIdentification"],
                })
              }
            >
              <option value="unknown">Not sure / prefer not to say</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="navigation-ui__check-label">
            <input
              className="checkbox checkbox-primary"
              type="checkbox"
              checked={value.preferTransitNearby}
              onChange={(event) =>
                update({ preferTransitNearby: event.target.checked })
              }
            />
            Prefer places near public transit
          </label>
        </div>
      </details>

      {aiAvailable && (
        <>
          <label className="navigation-ui__check-label navigation-preferences__ai">
            <input
              className="checkbox checkbox-primary"
              type="checkbox"
              checked={aiEnabled}
              onChange={(event) => onAIEnabledChange(event.target.checked)}
            />
            Use optional AI-assisted guidance
          </label>
          <p className="navigation-ui__note">
            {aiEnabled
              ? "AI-assisted guidance is enabled. Review any suggestions before acting on them."
              : "AI guidance is off. You can change this choice at any time."}
          </p>
        </>
      )}
      <p className="navigation-ui__coverage-note">
        This catalog does not have verified coverage for prepared meals or
        shelter. Listings and matches cannot guarantee service, eligibility,
        hours, or availability.
      </p>
    </section>
  );
}
