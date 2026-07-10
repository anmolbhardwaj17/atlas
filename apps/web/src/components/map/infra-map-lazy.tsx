"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { InfraMap } from "@/components/map/infra-map";

/**
 * Client-side lazy loader for the infrastructure map (perf P4). `@xyflow/react` (React Flow) + its
 * CSS are the heaviest client dependency in the app and are used ONLY here (and Explore). Loading
 * `InfraMap` through `next/dynamic({ ssr: false })` keeps React Flow out of the initial route JS and
 * off the server render (the canvas can't SSR anyway) — the chunk downloads when the map mounts,
 * behind the skeleton below. `ssr: false` requires a client boundary, which is why this thin wrapper
 * exists (the map page itself is a Server Component). Props are forwarded verbatim.
 */
const InfraMapImpl = dynamic(() => import("@/components/map/infra-map").then((m) => m.InfraMap), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-56 rounded-lg" />
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-[calc(100dvh-14rem)] min-h-[480px] w-full rounded-xl" />
    </div>
  ),
});

export function InfraMapLazy(props: ComponentProps<typeof InfraMap>) {
  return <InfraMapImpl {...props} />;
}
