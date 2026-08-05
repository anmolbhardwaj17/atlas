/**
 * War Room board skeleton. Mirrors the real layout (masthead → live cards → archive) on the same
 * dark surface, so the page doesn't flash a light shell before going dark — a theme flip during load
 * is the cheapest way to make a considered design feel unfinished.
 */
export default function WarRoomLoading() {
  return (
    <div className="dark -mx-4 -mt-4 min-h-[calc(100dvh-4rem)] bg-[hsl(0_0%_6.5%)] px-4 pt-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-10">
        <div className="space-y-3 pt-2">
          <div className="h-2.5 w-40 animate-pulse rounded bg-white/[0.07]" />
          <div className="h-11 w-56 animate-pulse rounded bg-white/[0.07]" />
          <div className="h-4 w-full max-w-xl animate-pulse rounded bg-white/[0.05]" />
        </div>
        <div className="space-y-3">
          <div className="h-2.5 w-28 animate-pulse rounded bg-white/[0.07]" />
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-[148px] animate-pulse rounded-xl border border-border/60 bg-white/[0.03]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
