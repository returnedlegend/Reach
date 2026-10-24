export function LoadingState({ label }: { label: string }) {
  return (
    <div className="reach-loading card bg-base-100" role="status">
      <span className="flex items-center gap-3">
        <i
          className="loading loading-spinner loading-sm text-primary"
          aria-hidden="true"
        />
        {label}
      </span>
      <div className="reach-skeleton" aria-hidden="true">
        <i className="skeleton" />
        <i className="skeleton" />
        <i className="skeleton" />
      </div>
    </div>
  );
}
