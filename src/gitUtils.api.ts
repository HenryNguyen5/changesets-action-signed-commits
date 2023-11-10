import { getOctokit } from "@actions/github";
import {
  CreateCommitOnBranchInput,
  CreateCommitOnBranchPayload,
  FileChanges,
  FileAddition,
  FileDeletion,
} from "./generated/graphql";
import { ExecOptions, exec } from "@actions/exec";
import { readFileSync } from "fs";

interface GitFileStatus {
  filePath: string;
  indexStatus: "A" | "M" | "D" | "R" | "C" | "U" | "?" | "!";
  workingTreeStatus: "A" | "M" | "D" | "R" | "C" | "U" | "?" | "!";
}

async function execWithOutputAndErr(
  cmd: Parameters<typeof exec>[0],
  args: Parameters<typeof exec>[1],
  cwd?: string
) {
  let stdout = "";
  let stderr = "";

  const options: ExecOptions = {
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString();
      },
      stderr: (data: Buffer) => {
        stderr += data.toString();
      },
    },
    cwd,
  };

  await exec(cmd, args, options);

  return { stdout, stderr };
}

export async function getGitStatusPorcelainV1(cwd?: string) {
  const { stderr, stdout } = await execWithOutputAndErr(
    "git",
    ["status", "--porcelain=v1"],
    cwd
  );
  if (stderr) {
    throw new Error(stderr);
  }

  return stdout;
}

interface FilesToAddOrDelete {
  additions: string[];
  deletions: string[];
}

export function calculateAdditionsAndDeletions(
  fileStatuses: GitFileStatus[]
): FilesToAddOrDelete {
  const additions: string[] = [];
  const deletions: string[] = [];

  for (const fileStatus of fileStatuses) {
    if (
      ["M", "A", "T", "?"].includes(fileStatus.indexStatus) ||
      ["M", "T", "?"].includes(fileStatus.workingTreeStatus)
    ) {
      additions.push(fileStatus.filePath);
    }

    if (
      fileStatus.indexStatus === "D" ||
      fileStatus.workingTreeStatus === "D"
    ) {
      deletions.push(fileStatus.filePath);
    }

    if (
      fileStatus.indexStatus === "R" ||
      fileStatus.workingTreeStatus === "R"
    ) {
      const [oldFilePath, newFilePath] = fileStatus.filePath.split("->");
      deletions.push(oldFilePath.trim());
      additions.push(newFilePath.trim());
    }
  }

  return {
    additions,
    deletions,
  };
}

export function listChanges(output: string): GitFileStatus[] {
  function parseStatusCode(code: string): {
    indexStatus: string;
    workingTreeStatus: string;
  } {
    // Assuming the code is always two characters long
    return {
      indexStatus: code.charAt(0),
      workingTreeStatus: code.charAt(1),
    };
  }

  /**
   *  Expects the output of `git status --porcelain=v1` as input
   *
   * @param output
   * @returns
   */
  function parseGitStatusPorcelainOutput(output: string): GitFileStatus[] {
    const lines = output.split("\n");
    // remove newline
    lines.pop();
    return lines.map((line) => {
      // only split the first two characters, as the rest is the file path
      const [status, filePath] = [
        line.substring(0, 2),
        line.substring(2).trim(),
      ];
      const { indexStatus, workingTreeStatus } = parseStatusCode(status);

      return { filePath, indexStatus, workingTreeStatus } as GitFileStatus;
    });
  }

  return parseGitStatusPorcelainOutput(output);
}

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
    expectedHeadOid: await getRemoteHeadOid(client, { branch, owner, repo }),
    fileChanges: await getFileChanges(),
  };

  await createCommitOnBranch(client, input);
}

async function getFileChanges() {
  const output = await getGitStatusPorcelainV1();
  const changes = listChanges(output);
  const additionsAndDeletions = calculateAdditionsAndDeletions(changes);
  const fileChanges = await calculateFileChanges(additionsAndDeletions);

  return fileChanges;
}

export async function calculateFileChanges(
  changes: FilesToAddOrDelete
): Promise<FileChanges> {
  const additions: FileAddition[] = changes.additions.map((path) => {
    const contents = readFileSync(path).toString("base64");
    return {
      path,
      contents,
    };
  });

  const deletions: FileDeletion[] = changes.deletions.map((path) => {
    return { path };
  });

  return {
    additions,
    deletions,
  };
}

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
