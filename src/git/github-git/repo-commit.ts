import { getOctokit } from "@actions/github";
import {
  CreateCommitOnBranchInput,
  CreateCommitOnBranchPayload,
} from "../../generated/graphql";

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
    throw error;
  }
}
