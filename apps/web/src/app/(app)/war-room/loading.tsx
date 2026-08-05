/** Board skeleton — mirrors the header + table so the layout doesn't shift when data lands. */
export default function WarRoomLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-44 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        <div className="overflow-hidden rounded-xl border border-border">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-12 animate-pulse bg-muted/40 ${i ? "border-t border-border" : ""}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
