import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { projectUrn, userUrn } from "../urn";
import { readContext, str } from "./context";

/**
 * Simple leaf nodes: Bitbucket projects and users. Neither emits observed edges from its own
 * payload (a project doesn't enumerate its repos; a user is referenced by repos/PRs), so
 * their edges are emitted by the referencing modules (repository, pull-request).
 */

/** Stable user key — nickname (readable, matches the demo) → account_id → uuid. Shared so a
 *  PR author and a workspace member resolve to the SAME urn. */
export function userKeyOf(user: unknown): string | undefined {
  return (
    str(user, "nickname") ?? str(user, "account_id") ?? str(user, "uuid")?.replace(/[{}]/g, "")
  );
}

export function projectNode(payload: unknown): NodeUpsert {
  const { workspace } = readContext(payload);
  const key = str(payload, "key") ?? "";
  return {
    urn: projectUrn(workspace, key),
    kind: "bitbucket.project",
    displayName: str(payload, "name") ?? key,
    attributes: {
      key,
      description: str(payload, "description"),
      isPrivate: (payload as Record<string, unknown>)?.is_private === true,
    },
  };
}

export function userNode(payload: unknown): NodeUpsert {
  const { workspace } = readContext(payload);
  const key = userKeyOf(payload) ?? "unknown";
  return {
    urn: userUrn(workspace, key),
    kind: "bitbucket.user",
    displayName: str(payload, "display_name") ?? str(payload, "nickname") ?? key,
    attributes: {
      nickname: str(payload, "nickname"),
      accountId: str(payload, "account_id"),
    },
  };
}

export const noSignals = (): Signal[] => [];
export const noEdges = (): EdgeUpsert[] => [];
