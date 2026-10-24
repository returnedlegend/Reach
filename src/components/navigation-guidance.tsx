"use client";

import type { AccessOption } from "../lib/access-types";
import type { NavigationGuidance } from "../lib/navigation-types";
import "./navigation-ui.css";

type Props = {
  guidance: NavigationGuidance;
  options: AccessOption[];
  onSelect: (id: string) => void;
};

const moduleLabels: Record<
  NavigationGuidance["modules"][number]["name"],
  string
> = {
  needs: "Your preferences",
  resources: "Food and grocery listings",
  transport: "Transport and routes",
  ranking: "Comparing options",
  guidance: "Written guidance",
};

function optionLabel(option: AccessOption) {
  return option.kind === "household"
    ? `${option.resource.name} · private pickup point, not verified`
    : option.resource.name;
}

export function NavigationGuidanceView({ guidance, options, onSelect }: Props) {
  const selected = options.find((option) => option.id === guidance.selectedId);
  const alternatives = guidance.alternativeIds
    .filter((id) => id !== guidance.selectedId)
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is AccessOption => Boolean(option));
  const resourceNames = new Map(
    options.map((option) => [option.resource.id, option.resource.name]),
  );

  return (
    <section
      className="navigation-ui navigation-guidance"
      aria-labelledby="navigation-guidance-heading"
    >
      <div className="navigation-guidance__heading-row">
        <div>
          {guidance.assistance === "ai" && guidance.status === "ready" && (
            <p className="navigation-guidance__ai-label">AI-assisted summary</p>
          )}
          <h2 id="navigation-guidance-heading">
            {guidance.headline || "Guidance for finding local help"}
          </h2>
        </div>
        {guidance.status === "unavailable" && (
          <span className="navigation-guidance__status">
            AI guidance unavailable
          </span>
        )}
        {guidance.status === "not-requested" && (
          <span className="navigation-guidance__status">Computed guidance</span>
        )}
      </div>

      {guidance.status === "unavailable" && (
        <p className="navigation-ui__note">
          Optional AI guidance could not be prepared. The computed explanation
          below remains available. Review details with each provider.
        </p>
      )}
      {guidance.status === "not-requested" && (
        <p className="navigation-ui__note">
          This explanation uses computed routes and published facts. No AI
          guidance was requested. Confirm details with each provider.
        </p>
      )}

      {guidance.paragraphs.map((paragraph, index) => (
        <p key={`paragraph-${index}`}>{paragraph}</p>
      ))}

      {selected && (
        <div className="navigation-guidance__choice">
          <h3>Suggested option</h3>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => onSelect(selected.id)}
          >
            {optionLabel(selected)}
          </button>
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="navigation-guidance__choice">
          <h3>Other options to consider</h3>
          <div className="navigation-guidance__alternatives">
            {alternatives.map((option) => (
              <button
                className="btn btn-outline"
                type="button"
                key={option.id}
                onClick={() => onSelect(option.id)}
              >
                {optionLabel(option)}
              </button>
            ))}
          </div>
        </div>
      )}

      {guidance.modules.length > 0 && (
        <details className="navigation-guidance__details">
          <summary>What information was considered?</summary>
          <ul>
            {guidance.modules.map((module) => (
              <li key={module.name}>
                <strong>{moduleLabels[module.name]}:</strong>{" "}
                {module.status === "complete"
                  ? "included in this guidance"
                  : "some information was unavailable, so this part may be incomplete"}
              </li>
            ))}
          </ul>
        </details>
      )}

      {guidance.evidence.length > 0 && (
        <details className="navigation-guidance__details">
          <summary>Sources and supporting details</summary>
          <ul>
            {guidance.evidence.map((item) => (
              <li key={item.id}>
                {item.resourceId && resourceNames.has(item.resourceId) && (
                  <strong>{resourceNames.get(item.resourceId)}: </strong>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {guidance.limitations.length > 0 && (
        <div className="navigation-guidance__limitations">
          <h3>What to confirm</h3>
          <ul>
            {guidance.limitations.map((limitation, index) => (
              <li key={`limitation-${index}`}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="navigation-ui__coverage-note">
        This catalog does not have verified coverage for prepared meals or
        shelter. Listings and suggestions do not guarantee eligibility, hours,
        or availability.
      </p>
    </section>
  );
}
