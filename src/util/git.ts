import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const maximumSourceDiffBytes = 2_000_000;
const maximumUntrackedTextBytes = 128_000;
const diagnosticReserveBytes = 256;

export type GitBaseline = { revision: string; dirty: string[] };
export type SourceDiff = {
  content: string;
  complete: boolean;
  detail: string;
  ignoredPathsExcluded: boolean;
};
type GitCollection = { output: Buffer; truncated: boolean; error?: string };

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

/** Collects tracked patches and bounded representations of every untracked file. */
export async function readDiff(workspace: string, baselineRevision: string): Promise<SourceDiff> {
  const cwd = resolve(workspace);
  const issues: string[] = [];
  let content = "";
  const append = (section: string): boolean => {
    const available = maximumSourceDiffBytes - diagnosticReserveBytes - Buffer.byteLength(content);
    if (Buffer.byteLength(section) > available) return false;
    content += section;
    return true;
  };

  const tracked = await collectGit(
    cwd,
    ["diff", baselineRevision, "--", "."],
    maximumSourceDiffBytes,
  );
  if (tracked.error) issues.push(`tracked diff failed (${tracked.error})`);
  if (tracked.truncated) issues.push("tracked diff was truncated");
  if (tracked.output.length > 0) {
    const section = tracked.output.toString("utf8");
    if (!append(section)) {
      content += truncateUtf8(section, maximumSourceDiffBytes - diagnosticReserveBytes);
      issues.push("tracked diff exceeded the aggregate evidence limit");
    }
  }

  const untracked = await collectGit(
    cwd,
    ["ls-files", "-z", "--others", "--exclude-standard", "--", "."],
    maximumSourceDiffBytes,
  );
  if (untracked.error) issues.push(`untracked file listing failed (${untracked.error})`);
  if (untracked.truncated) issues.push("untracked file listing was truncated");
  const paths = untracked.output.toString("utf8").split("\0");
  if (paths.at(-1) !== "") issues.push("the final untracked path was incomplete");
  else paths.pop();

  for (const path of paths) {
    const representation = await representUntrackedFile(cwd, path);
    if (!representation.complete) issues.push(representation.detail);
    if (!append(representation.content)) {
      issues.push(`untracked file ${path} was omitted by the aggregate evidence limit`);
      break;
    }
  }

  const ignored = await collectGit(
    cwd,
    ["status", "--porcelain=v1", "-z", "--ignored=matching", "--", "."],
    128_000,
  );
  if (ignored.error) issues.push(`ignored path inspection failed (${ignored.error})`);
  if (ignored.truncated) issues.push("ignored path inspection was truncated");
  const ignoredPathsExcluded = ignored.output.includes(Buffer.from("!! "));
  if (ignoredPathsExcluded) {
    append("\n# Excluded paths\nGit-ignored workspace paths are outside this source diff.\n");
  }

  if (!content.trim() && issues.length === 0) {
    content = "No source change was recorded against the baseline revision.\n";
  }
  if (issues.length > 0) {
    const diagnostic = `\n# Source diff incomplete\n${issues.length} collection issue(s) occurred. See the run's ungraded observation.\n`;
    content += truncateUtf8(diagnostic, maximumSourceDiffBytes - Buffer.byteLength(content));
  }
  return {
    content,
    complete: issues.length === 0,
    detail: summarizeIssues(issues),
    ignoredPathsExcluded,
  };
}

function summarizeIssues(issues: string[]): string {
  if (issues.length === 0) return "All source changes were represented.";
  const detail = issues.join("; ");
  const summary = truncateUtf8(detail, 4_000);
  return summary === detail ? summary : `${summary} [${issues.length} total collection issues]`;
}

async function representUntrackedFile(
  cwd: string,
  path: string,
): Promise<{ content: string; complete: boolean; detail: string }> {
  const candidate = resolve(cwd, path);
  const confined =
    path.length > 0 &&
    !isAbsolute(path) &&
    candidate.startsWith(`${cwd}${sep}`) &&
    !relative(cwd, candidate).startsWith(`..${sep}`);
  if (!confined) return omitted(path, "path was not confined to the workspace");

  try {
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink()) return omitted(path, "symbolic links are not followed");
    if (!stats.isFile()) return omitted(path, "path was not a regular file");
    const [workspaceReal, parentReal] = await Promise.all([
      realpath(cwd),
      realpath(resolve(candidate, "..")),
    ]);
    if (parentReal !== workspaceReal && !parentReal.startsWith(`${workspaceReal}${sep}`)) {
      return omitted(path, "parent directory resolved outside the workspace");
    }

    const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const openedStats = await handle.stat();
      if (!openedStats.isFile()) return omitted(path, "opened path was not a regular file");
      const sampleLength = Math.min(openedStats.size, maximumUntrackedTextBytes + 1);
      const sample = Buffer.alloc(sampleLength);
      const { bytesRead } = await handle.read(sample, 0, sampleLength, 0);
      const observed = sample.subarray(0, bytesRead);
      const sha256 = await digestHandle(handle);
      const binary = observed.includes(0) || !isUtf8(observed);
      if (binary || openedStats.size > maximumUntrackedTextBytes) {
        const kind = binary ? "binary" : "oversized text";
        return {
          content: `\n# Untracked ${kind} file\npath: ${path}\nsize: ${openedStats.size} bytes\nsha256: ${sha256}\n`,
          complete: true,
          detail: "represented by metadata",
        };
      }
      const text = observed.toString("utf8");
      const hasFinalNewline = text.endsWith("\n");
      const lines = text === "" ? [] : text.slice(0, hasFinalNewline ? -1 : undefined).split("\n");
      const patch =
        lines.length === 0
          ? ""
          : `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${hasFinalNewline ? "" : "\\ No newline at end of file\n"}`;
      return {
        content: `\n# Untracked text file\ndiff --git a/${path} b/${path}\nnew file mode ${mode(openedStats.mode)}\n--- /dev/null\n+++ b/${path}\n${patch}`,
        complete: true,
        detail: "represented as text",
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return omitted(path, `read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function omitted(path: string, reason: string) {
  return {
    content: `\n# Untracked file omitted\npath: ${path}\nreason: ${reason}\n`,
    complete: false,
    detail: `untracked file ${path} ${reason}`,
  };
}

async function digestHandle(handle: Awaited<ReturnType<typeof open>>): Promise<string> {
  const hash = createHash("sha256");
  const stream = handle.createReadStream({ autoClose: false, start: 0 });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function isUtf8(value: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(value);
    return true;
  } catch {
    return false;
  }
}

function mode(value: number): string {
  return (value & 0o111) === 0 ? "100644" : "100755";
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  const source = Buffer.from(value);
  if (source.byteLength <= maximumBytes) return value;
  let end = maximumBytes;
  while (end > 0) {
    const candidate = source
      .subarray(0, end)
      .toString("utf8")
      .replace(/\uFFFD$/u, "");
    if (Buffer.byteLength(candidate) <= maximumBytes) return candidate;
    end -= 1;
  }
  return "";
}

async function collectGit(
  cwd: string,
  arguments_: string[],
  maximumBytes: number,
): Promise<GitCollection> {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn("git", arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveResult({
        output: Buffer.alloc(0),
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    child.stdout.on("data", (chunk: Buffer) => {
      const remaining = maximumBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const bounded = chunk.subarray(0, remaining);
      chunks.push(bounded);
      bytes += bounded.byteLength;
      if (bounded.byteLength < chunk.byteLength) truncated = true;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const retained = Buffer.concat(errors).byteLength;
      if (retained < 20_000) errors.push(chunk.subarray(0, 20_000 - retained));
    });
    child.once("error", (error) =>
      resolveResult({ output: Buffer.concat(chunks), truncated, error: error.message }),
    );
    child.once("close", (code, signal) => {
      const error =
        code === 0 && signal === null
          ? undefined
          : `git exited with code ${String(code)}${signal ? ` after ${signal}` : ""}: ${Buffer.concat(errors).toString("utf8").trim()}`;
      const result: GitCollection = {
        output: Buffer.concat(chunks),
        truncated,
      };
      if (error) result.error = error;
      resolveResult(result);
    });
  });
}
