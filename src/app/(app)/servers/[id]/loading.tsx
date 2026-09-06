export default function OverviewLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      {/* Metric bar skeletons */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border bg-muted/30" />
        ))}
      </div>
      {/* Stats row skeleton */}
      <div className="h-20 animate-pulse rounded-xl border bg-muted/30" />
    </div>
  );
}
