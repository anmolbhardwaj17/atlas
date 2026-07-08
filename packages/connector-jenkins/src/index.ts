/**
 * @atlas/connector-jenkins — the Jenkins CI/CD connector (docs/07c). Emits `jenkins.job` nodes
 * and `jenkins.deploy` signals that R1 turns into observed DEPLOYS_TO edges, bridging code↔infra.
 */
export { JenkinsConnector } from "./jenkins-connector";
export { createJenkinsConnector } from "./factory";
export { parseJenkinsConfig, parseJenkinsCredentials } from "./config";
export type { JenkinsConfig, JenkinsCredentials } from "./config";
export { jobUrn, hostOf } from "./urn";
export { parsePipelineDeploys } from "./parsers/pipeline-deploy";
export type {
  EcrImageRef,
  DeployTargetRef,
  PipelineDeployEvidence,
} from "./parsers/pipeline-deploy";
