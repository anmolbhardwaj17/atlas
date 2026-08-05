/** War Room board skeleton — mirrors the real layout (header, active cards, closed list). */
export default function WarRoomLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-44 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-16 animate-pulse rounded bg-muted" />
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-[110px] animate-pulse rounded-xl border border-border bg-muted/40"
          />
        ))}
      </div>
    </div>
  );
}
