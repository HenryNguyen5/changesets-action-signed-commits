import { execWithOutput } from "../../utils";

export interface GitTag {
  name: string;
  ref: string;
}

/**
 * Pushes any missing tags to the remote first replacing those tags with lightweight versions.
 * We replace annotated tags with lightweight ones because we cannot sign annotated tags, but
 * lightweight tags pointing to signed commits will show up as verified in GitHub.
 */
export async function pushTags(cwd?: string) {
  const onlyLocalTags = await getOnlyLocalTags(cwd);

  await deleteTags(onlyLocalTags, cwd);
  const createdTags = await createLightweightTags(onlyLocalTags, cwd);
  await execWithOutput("git", ["push", "origin", "--tags"], { cwd });

  return createdTags;
}

export async function getOnlyLocalTags(cwd?: string): Promise<GitTag[]> {
  const localTags = await getLocalTags(cwd);
  // Checkout action uses origin for the remote
  // https://github.com/actions/checkout/blob/main/src/git-source-provider.ts#L111
  const remoteTagNames = await getRemoteTagNames("origin", cwd);

  const diff = computeTagDiff(localTags, remoteTagNames);

  return diff;
}

export async function createLightweightTags(
  tags: GitTag[],
  cwd?: string
): Promise<GitTag[]> {
  const createdTags = tags.map(async (tag) => {
    await execWithOutput("git", ["tag", tag.name, tag.ref], { cwd });

    return tag;
  });

  return await Promise.all(createdTags);
}

export async function deleteTags(tags: GitTag[], cwd?: string) {
  const deleteCommands = tags.map(async (tag) => {
    await execWithOutput("git", ["tag", "-d", tag.name], { cwd });
    return tag;
  });
  await Promise.all(deleteCommands);

  return deleteCommands;
}

export function computeTagDiff(
  localTags: GitTag[],
  remoteTags: string[]
): GitTag[] {
  const remoteSet = new Set(remoteTags);
  const diff = localTags.filter((tag) => !remoteSet.has(tag.name));

  return diff;
}

export async function getLocalTags(cwd?: string): Promise<GitTag[]> {
  const stdout = await execWithOutput("git", ["tag", "--list"], { cwd });

  const tagNames = stdout.split("\n");
  const tags: Promise<GitTag>[] = tagNames.map(async (name) => {
    const ref = await execWithOutput("git", ["rev-list", "-1", name], { cwd });
    return { name, ref: ref };
  });

  return await Promise.all(tags);
}

export async function getRemoteTagNames(
  remote: string,
  cwd?: string
): Promise<string[]> {
  const stdout = await execWithOutput(
    "git",
    // Note that --refs will filter out peeled tags from the output
    // meaning that annotated tags will only have one entry in the output
    // which is the ref to the tag itself, rather than the ref to the commit.
    //
    // On the other hand, lightweight tags will have their ref to the commit
    // that they point to.
    ["ls-remote", "--refs", "--tags", remote],
    { cwd }
  );

  const tags = stdout.split("\n").map((line) => {
    const [_ref, tag] = line.split("\t");

    return tag.replace("refs/tags/", "");
  });

  return tags;
}
