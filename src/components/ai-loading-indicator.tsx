import styles from "./ai-loading-indicator.module.css";

/** Inline feedback: never takes focus or covers the map. */
export function AILoadingIndicator({
  label = "Analyzing…",
}: {
  label?: string;
}) {
  return (
    <span className={styles.indicator} role="status" aria-live="polite">
      <span className={styles.circle} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function RecommendationSkeletons() {
  return (
    <div
      className={styles.recommendations}
      role="region"
      aria-label="Preparing recommendations"
      aria-busy="true"
    >
      {[0, 1].map((index) => (
        <div key={index} className={styles.skeletonCard} aria-hidden="true">
          <span className={styles.shortLine} />
          <span className={styles.line} />
          <span className={styles.line} />
        </div>
      ))}
    </div>
  );
}
