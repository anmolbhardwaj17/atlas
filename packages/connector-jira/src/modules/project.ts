import type { NodeUpsert } from "@atlas/connector-sdk";
import { projectUrn } from "../urn";
import { readContext, str } from "./context";

/** A Jira project — the container for its issues. Edges (CONTAINS) are emitted by the issue module. */
export function projectNode(payload: unknown): NodeUpsert {
  const { site } = readContext(payload);
  const key = str(payload, "key") ?? "";
  return {
    urn: projectUrn(site, key),
    kind: "jira.project",
    displayName: str(payload, "name") ?? key,
    attributes: {
      key,
      projectType: str(payload, "projectTypeKey"),
      url: `https://${site}.atlassian.net/browse/${key}`,
    },
  };
}
