import { getOctokit } from "@actions/github";

export async function getRemoteHeadOid(
  client: ReturnType<typeof getOctokit>,
  opts: Parameters<typeof client.rest.repos.getBranch>[0]
) {
  const res = await client.rest.repos.getBranch(opts);

  return res.data.commit.sha;
}
