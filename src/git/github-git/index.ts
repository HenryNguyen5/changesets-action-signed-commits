import { getOctokit } from "@actions/github";
import { CreateCommitOnBranchInput } from "../../generated/graphql";
import * as repoStatus from "./repo-status";
import * as repoCommit from "./repo-commit";
import * as repoHead from "./repo-head";

export { pushTags } from "./repo-tags";

/**
 * Note that this diverges from the original implementation in that it does not
 * pull down the updated HEAD from the remote after creating the commit. This means that
 * locally, the HEAD will still contain the old commit, and the non-committed changes.
 *
 * @param message
 */
export async function commitAll(
  client: ReturnType<typeof getOctokit>,
  branch: string,
  owner: string,
  repo: string,
  message: string,
  body = ""
) {
  const input: CreateCommitOnBranchInput = {
    branch: {
      branchName: branch,
      repositoryNameWithOwner: `${owner}/${repo}`,
    },
    message: {
      headline: message,
      body,
    },
    expectedHeadOid: await repoHead.getRemoteHeadOid(client, {
      branch,
      owner,
      repo,
    }),
    fileChanges: await repoStatus.getFileChanges(),
  };

  await repoCommit.createCommitOnBranch(client, input);
}
