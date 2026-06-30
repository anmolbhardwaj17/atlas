/**
 * Single-call discoverers whose List/Describe returns full objects: ECR repositories
 * and RDS instances (docs/06 §4/§5.2).
 */
import { ECRClient, paginateDescribeRepositories } from "@aws-sdk/client-ecr";
import { RDSClient, paginateDescribeDBInstances } from "@aws-sdk/client-rds";
import { clientConfig } from "../aws/client-config";
import { emit, type Discoverer } from "../aws/discoverer";

export const ecrDiscoverer: Discoverer = {
  service: "ecr",
  scope: "region",
  kind: "aws.ecr.repository",
  iamAction: "ecr:DescribeRepositories",
  async *crawl(input) {
    const client = new ECRClient(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeRepositories({ client }, {})) {
      for (const repo of page.repositories ?? []) {
        if (repo.repositoryName) yield emit(this, input, repo.repositoryName, repo);
      }
    }
  },
};

export const rdsDiscoverer: Discoverer = {
  service: "rds",
  scope: "region",
  kind: "aws.rds.instance",
  iamAction: "rds:DescribeDBInstances",
  async *crawl(input) {
    const client = new RDSClient(clientConfig(input.credentials, input.region));
    for await (const page of paginateDescribeDBInstances({ client }, {})) {
      for (const db of page.DBInstances ?? []) {
        if (db.DBInstanceIdentifier) yield emit(this, input, db.DBInstanceIdentifier, db);
      }
    }
  },
};
