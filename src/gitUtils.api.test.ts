// src/__tests__/createCommitOnBranch.test.js
import { getOctokit } from "@actions/github";
import { execSync } from "child_process";
import * as fs from "fs";
import nock from "nock";
import path from "path";
import { CreateCommitOnBranchInput } from "./generated/graphql";
import {
  calculateAdditionsAndDeletions,
  createCommitOnBranch,
  getGitStatusPorcelainV1,
  getRemoteHeadOid,
  listChanges,
} from "./gitUtils.api";

// nock-back provides the recording and playback functionality
const nockBack = nock.back;
// Set the fixture path and nockBack mode
nockBack.fixtures = path.join(__dirname, "__fixtures__");
nockBack.setMode("lockdown"); // Change to 'lockdown' to use existing fixtures

// Test to record the fixture
test("creates a commit on a branch", async () => {
  const { nockDone } = await nockBack("createCommitOnBranch.json");

  const token =
    nockBack.currentMode === "dryrun" ? "fake-token" : process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN must be set when recording fixtures");
  }
  const octokit = getOctokit(token);

  const fileContents = "hello world";
  const base64FileContents = Buffer.from(fileContents).toString("base64");
  const branch = {
    repositoryNameWithOwner: "smartcontractkit-test/changesets-test",
    branchName: "main",
  };
  const [owner, repo] = branch.repositoryNameWithOwner.split("/");
  const expectedHeadOid = await getRemoteHeadOid(octokit, {
    branch: branch.branchName,
    owner,
    repo,
  });

  const input: CreateCommitOnBranchInput = {
    expectedHeadOid,
    branch,
    message: {
      headline: "Create a new something",
      body: "This is the body of the commit message",
    },
    fileChanges: {
      additions: [{ contents: base64FileContents, path: "test.txt" }],
      deletions: [],
    },
  };

  const data = await createCommitOnBranch(octokit, input);

  expect(data).toMatchObject({
    createCommitOnBranch: {
      commit: {
        url: expect.stringContaining(
          "https://github.com/smartcontractkit-test/changesets-test/commit/"
        ),
      },
    },
  });

  nockDone(); // Ensure nockBack knows we're done recording
});

describe("getGitStatusPorcelainV1", () => {
  it("should return the correct status", async () => {
    const repoPath = createTestRepository("getGitStatusPorcelainV1");
    const stdout = await getGitStatusPorcelainV1(repoPath);
    console.log({
      stdout,
      repoPath,
    });
    expect(stdout).toMatchInlineSnapshot(`
      " M file1.txt
       D file2.txt
      R  file3.txt -> file3renamed.txt
       T file4.txt
      A  file5.txt
      ?? untracked.txt
      "
    `);
  });
});

describe("listChanges", () => {
  it("should return the correct additions and deletions", async () => {
    const repoPath = createTestRepository("listChanges");
    const stdout = await getGitStatusPorcelainV1(repoPath);
    const changes = listChanges(stdout);

    expect(changes).toMatchInlineSnapshot(`
      [
        {
          "filePath": "file1.txt",
          "indexStatus": " ",
          "workingTreeStatus": "M",
        },
        {
          "filePath": "file2.txt",
          "indexStatus": " ",
          "workingTreeStatus": "D",
        },
        {
          "filePath": "file3.txt -> file3renamed.txt",
          "indexStatus": "R",
          "workingTreeStatus": " ",
        },
        {
          "filePath": "file4.txt",
          "indexStatus": " ",
          "workingTreeStatus": "T",
        },
        {
          "filePath": "file5.txt",
          "indexStatus": "A",
          "workingTreeStatus": " ",
        },
        {
          "filePath": "untracked.txt",
          "indexStatus": "?",
          "workingTreeStatus": "?",
        },
      ]
    `);
  });
});

describe("calculateAdditionsAndDeletions", () => {
  it("should return the correct additions and deletions", async () => {
    const repoPath = createTestRepository("listChanges");
    const stdout = await getGitStatusPorcelainV1(repoPath);
    const changes = listChanges(stdout);
    const { additions, deletions } = calculateAdditionsAndDeletions(changes);

    expect(additions).toMatchInlineSnapshot(`
      [
        "file1.txt",
        "file3renamed.txt",
        "file4.txt",
        "file5.txt",
        "untracked.txt",
      ]
    `);
    expect(deletions).toMatchInlineSnapshot(`
      [
        "file2.txt",
        "file3.txt",
      ]
    `);
  });
});

function createTestRepository(name: string): string {
  // create 8 byte random string
  const randomString = Math.random().toString(36).substring(2, 10);
  const repoPath = `/tmp/${name}-test-repo-${randomString}`;
  if (fs.existsSync(repoPath)) {
    throw new Error("Test repository already exists");
  }

  // Create the repository
  execSync(`mkdir ${repoPath}`);
  execSync(`cd ${repoPath} && git init`);

  // Create initial files and commit
  fs.writeFileSync(`${repoPath}/file1.txt`, "Initial content");
  fs.writeFileSync(`${repoPath}/file2.txt`, "Initial content");
  fs.writeFileSync(`${repoPath}/file4.txt`, "This file will be a symlink");

  execSync(`cd ${repoPath} && git add . && git commit -m "Initial commit"`);

  // Modify a file
  fs.writeFileSync(`${repoPath}/file1.txt`, "Modified content");

  // Delete a file
  fs.unlinkSync(`${repoPath}/file2.txt`);

  // Rename a file
  fs.writeFileSync(`${repoPath}/file3.txt`, "New file");
  execSync(
    `cd ${repoPath} && git add file3.txt && git commit -m "Add file3.txt"`
  );
  execSync(`cd ${repoPath} && git mv file3.txt file3renamed.txt`);

  // Add a file
  fs.writeFileSync(`${repoPath}/file5.txt`, "This file will be added");
  execSync(`cd ${repoPath} && git add file5.txt`);

  // Create an untracked file
  fs.writeFileSync(`${repoPath}/untracked.txt`, "Untracked file");

  // Change the type of a file (e.g., from a regular file to a symlink)
  fs.unlinkSync(`${repoPath}/file4.txt`);
  fs.symlinkSync(`${repoPath}/file1.txt`, `${repoPath}/file4.txt`);

  return repoPath;
}

function createAnnotatedTestTags(repoPath: string, count: number) {
  return new Array(count).fill(null).map((_, i) => {
    const tagName = `tag-${i}`;
    const tagMessage = `This is tag ${i}`;
    execSync(
      `cd ${repoPath} && git tag -a ${tagName} -m "${tagMessage}" HEAD~${i}`
    );

    return { tagName, tagMessage };
  });
}
