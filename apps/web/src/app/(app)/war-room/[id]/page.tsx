import { notFound } from "next/navigation";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { WarRoomView } from "@/components/war-room/war-room-view";
import type { NodeEvent } from "@/components/war-room/war-room-context";
import type { Incident } from "@/lib/browser-api";
import type { MapData } from "@/lib/map-types";

export const dynamic = "force-dynamic";

/**
 * Incident War Room (docs/plans/war-room.md). Loads the persisted incident + the bounded graph + the
 * broken node's real change timeline and blast radius, then hands them to the client view (context bar,
 * live map, streamed diagnosis chat, timeline). Secrets stay server-side; a foreign/missing id → 404.
 */
export default async function WarRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { token, orgId } = await requireShell();

  const incident = (await apiGet<ApiOk<Incident>>(`/incidents/${id}`, { token, orgId })).body?.data;
  if (!incident) notFound();

  const [mapRes, eventsRes, blastRes] = await Promise.all([
    apiGet<ApiOk<MapData>>("/graph?limit=400", { token, orgId }),
    apiGet<ApiOk<NodeEvent[]>>(`/nodes/${incident.nodeId}/events`, { token, orgId }),
    apiGet<ApiOk<{ impacted?: unknown[] }>>(`/nodes/${incident.nodeId}/blast-radius`, {
      token,
      orgId,
    }),
  ]);

  const map = mapRes.body?.data ?? { nodes: [], edges: [], truncated: false };
  const events = eventsRes.body?.data ?? [];
  const impactCount = blastRes.body?.data?.impacted?.length ?? 0;

  return (
    <WarRoomView
      incident={incident}
      map={map}
      events={events}
      impactCount={impactCount}
      orgId={orgId}
    />
  );
}
