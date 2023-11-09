import { getOctokit } from "@actions/github";
import {
  CreateCommitOnBranchInput,
  CreateCommitOnBranchPayload,
} from "./generated/graphql";

export async function getRemoteHeadOid(
  client: ReturnType<typeof getOctokit>,
  opts: Parameters<typeof client.rest.repos.getBranch>[0]
) {
  const res = await client.rest.repos.getBranch(opts);

  return res.data.commit.sha;
}

export async function createCommitOnBranch(
  client: ReturnType<typeof getOctokit>,
  input: CreateCommitOnBranchInput
) {
  const query = `
    mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit {
          url
        }
      }
    }
  `;
  try {
    const response = await client.graphql<{
      createCommitOnBranch: CreateCommitOnBranchPayload;
    }>(query, {
      input,
    });
    return response;
  } catch (error) {
    console.error(error);
    throw error;
  }
}
