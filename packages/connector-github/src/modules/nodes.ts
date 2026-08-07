/**
 * Small node modules for the targets other modules point at: team, user (CODEOWNERS/PR targets)
 * and external package (DEPENDS_ON_PKG target). They exist so those edges resolve to real nodes
 * (docs/07 §7.2/§7.3). User and package are pure leaves; `team` also emits HAS_MEMBER → user once
 * the org's team membership has been resolved (US-10).
 */
import { teamUrn, userUrn, packageUrn } from "../urn";
import { observed, type GithubModule } from "./module";

export interface TeamPayload {
  owner: string;
  data: { slug: string; name?: string; description?: string };
  /** Member logins resolved from the org's team API (US-10); absent when `members:read` isn't granted. */
  members?: string[];
}

export const teamModule: GithubModule<TeamPayload> = {
  kind: "github.team",
  normalize({ owner, data, members }) {
    return {
      urn: teamUrn(owner, data.slug),
      kind: "github.team",
      displayName: data.name ?? data.slug,
      attributes: {
        owner,
        slug: data.slug,
        name: data.name,
        // Recorded on the node too, so "how many people own this?" needs no edge traversal.
        // `undefined` (not 0) when unresolved — an unknown team size must not read as an empty one.
        memberCount: members?.length,
      },
    };
  },
  // HAS_MEMBER: team → user (US-10, docs/07 §7.2). Observed, because it comes straight from
  // GitHub's team API rather than being reasoned about. Empty when the permission was declined,
  // which yields no edges rather than wrong ones (P3).
  observedEdges({ owner, data, members }) {
    const self = teamUrn(owner, data.slug);
    return (members ?? []).map((login) => observed("HAS_MEMBER", self, userUrn(login)));
  },
  extractSignals() {
    return [];
  },
};

export interface UserPayload {
  data: { login: string; name?: string | null; type?: string };
}

export const userModule: GithubModule<UserPayload> = {
  kind: "github.user",
  normalize({ data }) {
    return {
      urn: userUrn(data.login),
      kind: "github.user",
      displayName: data.name ?? data.login,
      attributes: { login: data.login, name: data.name ?? null, type: data.type },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};

export interface PackagePayload {
  ecosystem: string;
  name: string;
  version?: string | null;
}

export const packageModule: GithubModule<PackagePayload> = {
  kind: "external.package",
  normalize({ ecosystem, name, version }) {
    return {
      urn: packageUrn(ecosystem, name),
      kind: "external.package",
      displayName: name,
      attributes: { ecosystem, name, version: version ?? null },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals() {
    return [];
  },
};
