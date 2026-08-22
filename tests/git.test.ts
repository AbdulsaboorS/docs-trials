import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maximumSourceDiffBytes, readDiff } from "../src/util/git";

const run = promisify(execFile);
let workspace: string;
let baseline: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "docs-trials-git-"));
  await run("git", ["init", "--quiet"], { cwd: workspace });
  await writeFile(join(workspace, "tracked.txt"), "before\n");
  await run("git", ["add", "tracked.txt"], { cwd: workspace });
  await run(
    "git",
    [
      "-c",
      "user.name=Docs Trials",
      "-c",
      "user.email=docs@example.com",
      "commit",
      "--quiet",
      "-m",
      "baseline",
    ],
    { cwd: workspace },
  );
  baseline = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("source diff evidence", () => {
  it("represents tracked changes and untracked text content", async () => {
    await writeFile(join(workspace, "tracked.txt"), "after\n");
    await writeFile(join(workspace, "new.txt"), "new line\nsecond line");

    const diff = await readDiff(workspace, baseline);

    expect(diff.complete).toBe(true);
    expect(diff.content).toContain("-before");
    expect(diff.content).toContain("+after");
    expect(diff.content).toContain("# Untracked text file");
    expect(diff.content).toContain("@@ -0,0 +1,2 @@\n+new line\n+second line");
    expect(diff.content).toContain("\\ No newline at end of file");
  });

  it("represents binary and oversized untracked files by digest and size", async () => {
    await writeFile(join(workspace, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(workspace, "large.txt"), "x".repeat(128_001));

    const diff = await readDiff(workspace, baseline);

    expect(diff.complete).toBe(true);
    expect(diff.content).toMatch(
      /# Untracked binary file[\s\S]*size: 4 bytes[\s\S]*sha256: [a-f0-9]{64}/,
    );
    expect(diff.content).toMatch(
      /# Untracked oversized text file[\s\S]*size: 128001 bytes[\s\S]*sha256: [a-f0-9]{64}/,
    );
    expect(diff.content).not.toContain("x".repeat(1_000));
  });

  it("marks symlink omissions incomplete without following them", async () => {
    const outside = join(tmpdir(), `docs-trials-outside-${String(process.pid)}.txt`);
    await writeFile(outside, "outside contents\n");
    await symlink(outside, join(workspace, "link.txt"));
    try {
      const diff = await readDiff(workspace, baseline);
      expect(diff.complete).toBe(false);
      expect(diff.detail).toContain("symbolic links are not followed");
      expect(diff.content).not.toContain("outside contents");
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("explicitly excludes ignored files from Git-visible source capture", async () => {
    await writeFile(join(workspace, ".gitignore"), "ignored/\n");
    await run("git", ["add", ".gitignore"], { cwd: workspace });
    await run("git", ["commit", "--quiet", "-m", "ignore fixture"], { cwd: workspace });
    baseline = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    await mkdir(join(workspace, "ignored"));
    await writeFile(join(workspace, "ignored", "runtime.js"), "export const value = 1;\n");

    const diff = await readDiff(workspace, baseline);

    expect(diff.complete).toBe(true);
    expect(diff.ignoredPathsExcluded).toBe(true);
    expect(diff.content).toContain("Git-ignored workspace paths are outside this source diff");
  });

  it("strictly bounds and marks truncated tracked evidence incomplete", async () => {
    await writeFile(join(workspace, "tracked.txt"), `${"changed line\n".repeat(200_000)}`);

    const diff = await readDiff(workspace, baseline);

    expect(diff.complete).toBe(false);
    expect(diff.detail).toMatch(/truncated|aggregate evidence limit/);
    expect(Buffer.byteLength(diff.content)).toBeLessThanOrEqual(maximumSourceDiffBytes);
  });
});
