import { describe, it, expect } from "vitest";
import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  it("records http requests keyed by method/route/status and exposes them", async () => {
    const m = new MetricsService();
    m.recordHttp("GET", "/orgs/:orgId", 200, 0.12);
    m.recordHttp("GET", "/orgs/:orgId", 200, 0.34);
    m.recordHttp("POST", "/orgs/:orgId/connections", 500, 0.5);

    const out = await m.render();
    expect(out).toMatch(
      /http_requests_total\{[^}]*method="GET"[^}]*route="\/orgs\/:orgId"[^}]*status="200"[^}]*\} 2/,
    );
    expect(out).toMatch(/http_requests_total\{[^}]*status="500"[^}]*\} 1/);
    // Latency histogram observed both GET samples.
    expect(out).toMatch(
      /http_request_duration_seconds_count\{[^}]*route="\/orgs\/:orgId"[^}]*status="200"[^}]*\} 2/,
    );
  });

  it("records sync-job outcomes and queue depth", async () => {
    const m = new MetricsService();
    m.recordSyncJob("succeeded");
    m.recordSyncJob("failed");
    m.recordSyncJob("failed");
    m.setQueueDepth("waiting", 3);
    m.setQueueDepth("active", 1);

    const out = await m.render();
    expect(out).toMatch(/atlas_sync_jobs_total\{[^}]*outcome="succeeded"[^}]*\} 1/);
    expect(out).toMatch(/atlas_sync_jobs_total\{[^}]*outcome="failed"[^}]*\} 2/);
    expect(out).toMatch(/atlas_sync_queue_depth\{[^}]*state="waiting"[^}]*\} 3/);
    expect(out).toMatch(/atlas_sync_queue_depth\{[^}]*state="active"[^}]*\} 1/);
  });

  it("exposes the Prometheus text content type", () => {
    expect(new MetricsService().contentType).toMatch(/text\/plain/);
  });
});
