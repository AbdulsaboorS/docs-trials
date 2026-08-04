import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const maxDiffBytes = 2_000_000;

export type GitBaseline = { revision: string; dirty: string[] };

/**
 * Records the workspace revision so `verify` can show exactly what the agent
 * changed. A dirty tree is reported but not rejected: the caller decides.
 */
export async function readBaseline(workspace: string): Promise<GitBaseline | undefined> {
  const cwd = resolve(workspace);
  try {
    const [{ stdout: revision }, { stdout: status }] = await Promise.all([
      run("git", ["rev-parse", "HEAD"], { cwd, maxBuffer: 1_000 }),
      run("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd,
        maxBuffer: 2_000_000,
      }),
    ]);
    const head = revision.trim();
    if (!/^[a-f0-9]{7,64}$/.test(head)) return undefined;
    return {
      revision: head,
      dirty: status
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean),
    };
  } catch {
    return undefined;
  }
}

/** Diff of tracked changes since the baseline, plus a list of new files. */
export async function readDiff(workspace: string, baselineRevision: string): Promise<string> {
  const cwd = resolve(workspace);
  try {
    const { stdout: diff } = await run("git", ["diff", baselineRevision, "--", "."], {
      cwd,
      maxBuffer: maxDiffBytes,
    });
    const { stdout: untracked } = await run(
      "git",
      ["ls-files", "--others", "--exclude-standard", "--", "."],
      { cwd, maxBuffer: 1_000_000 },
    );
    const added = untracked.split("\n").filter(Boolean);
    const addedSection = added.length
      ? `\n# Untracked files created during the run\n${added.map((path) => `+ ${path}`).join("\n")}\n`
      : "";
    const body = `${diff}${addedSection}`;
    if (!body.trim()) return "No source change was recorded against the baseline revision.";
    return body.length > maxDiffBytes
      ? `${body.slice(0, maxDiffBytes)}\n\n[diff truncated at ${maxDiffBytes} bytes]`
      : body;
  } catch (error) {
    return `Could not collect a source diff: ${error instanceof Error ? error.message : String(error)}`;
  }
}
