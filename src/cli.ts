#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { ZodError } from "zod";
import { init } from "./commands/init";
import { prepare } from "./commands/prepare";
import { recover } from "./commands/recover";
import { verify } from "./commands/verify";
import { countByOutcome, type Outcome } from "./core/outcome";
import { latestRunId, loadRun } from "./core/run";

const usage = `docs-trials — check whether an agent can build from your documentation

Usage
  docs-trials init [path]              Write a starter trial.json
  docs-trials prepare [options]        Freeze the task and print agent instructions
  docs-trials verify [run]             Run the baseline checks and write AX.md
  docs-trials recover [run] [--force]  Remove locks left by a stopped verifier
  docs-trials show [run]               Print the report for a run

Options
  -m, --manifest <path>   Manifest path (default: trial.json)
  -w, --workspace <path>  Workspace the agent works in (default: .)
  -q, --quiet             Suppress progress output
  -f, --force             Remove invalid metadata from bounded lock files
  -h, --help              Show this message

Run identifiers accept a run id, a run directory, or "latest".
`;

const exitCodes = { passed: 0, failed: 1, inconclusive: 2 } satisfies Record<Outcome, number>;

async function main(argv: string[]): Promise<number> {
  const args = parse(argv);
  if (args.flags.help || args.command === "help" || !args.command) {
    process.stdout.write(usage);
    return 0;
  }

  switch (args.command) {
    case "init": {
      const created = await init({
        path: args.positional[0] ?? args.options.manifest ?? "trial.json",
        workspace: args.options.workspace ?? ".",
      });
      process.stdout.write(
        `Wrote ${rel(created.path)}\n\nEdit it, then run:\n  docs-trials prepare\n`,
      );
      return 0;
    }

    case "prepare": {
      const prepared = await prepare({
        manifest: args.options.manifest ?? args.positional[0] ?? "trial.json",
        workspace: args.options.workspace ?? ".",
      });
      if (!prepared.baseline) {
        warn("The workspace is not a Git repository. The report will not include a source diff.");
      } else if (prepared.baseline.dirty.length > 0) {
        warn(
          `The workspace has ${prepared.baseline.dirty.length} uncommitted change(s). The diff will include them.`,
        );
      }
      process.stdout.write(
        [
          `Run ${prepared.runId}`,
          `Stored in ${prepared.runDirectory}`,
          "",
          "Give the following to your coding agent, then run `docs-trials verify latest`.",
          "",
          "-".repeat(72),
          prepared.instructions.trimEnd(),
          "-".repeat(72),
          "",
        ].join("\n"),
      );
      return 0;
    }

    case "verify": {
      const target = args.positional[0] ?? "latest";
      const outcome = await verify({ run: target, quiet: Boolean(args.flags.quiet) });
      const totals = countByOutcome(outcome.results);
      process.stdout.write(
        [
          "",
          `BASELINE ${outcome.outcome.toUpperCase()} — ${totals.passed} passed, ${totals.failed} failed, ${totals.inconclusive} inconclusive`,
          "",
          ...outcome.results.map(
            (entry) => `  ${label(entry.outcome)}  ${entry.title}\n        ${entry.detail}`,
          ),
          "",
          `Report: ${outcome.directory}/AX.md`,
          "",
        ].join("\n"),
      );
      return exitCodes[outcome.outcome];
    }

    case "show": {
      const target = args.positional[0] ?? "latest";
      const { location, record } = await loadRun(target);
      if (record.status !== "verified") {
        throw new Error(`Run ${record.runId} has not been verified. Run \`docs-trials verify\`.`);
      }
      process.stdout.write(await readFile(`${location.directory}/AX.md`, "utf8"));
      return exitCodes[record.verification.outcome];
    }

    case "recover": {
      const recovered = await recover(args.positional[0] ?? "latest", Boolean(args.flags.force));
      process.stdout.write(
        recovered.removed.length === 0
          ? `Run ${recovered.runId} has no lock files.\n`
          : `Recovered run ${recovered.runId}: ${recovered.removed.join(", ")}\n`,
      );
      return 0;
    }

    case "runs": {
      const latest = await latestRunId();
      process.stdout.write(latest ? `${latest}\n` : "No runs yet.\n");
      return 0;
    }

    default:
      process.stderr.write(`Unknown command: ${args.command}\n\n${usage}`);
      return 64;
  }
}

type Parsed = {
  command: string | undefined;
  positional: string[];
  options: { manifest?: string; workspace?: string };
  flags: { force?: boolean; help?: boolean; quiet?: boolean };
};

function parse(argv: string[]): Parsed {
  const parsed: Parsed = { command: undefined, positional: [], options: {}, flags: {} };
  const rest = [...argv];
  const assign = (key: "manifest" | "workspace", value: string | undefined) => {
    if (value === undefined) throw new Error(`Option --${key} needs a value.`);
    parsed.options[key] = value;
  };
  while (rest.length > 0) {
    const token = rest.shift();
    if (token === undefined || token === "--") continue;
    if (token === "-h" || token === "--help") parsed.flags.help = true;
    else if (token === "-q" || token === "--quiet") parsed.flags.quiet = true;
    else if (token === "-f" || token === "--force") parsed.flags.force = true;
    else if (token === "-m" || token === "--manifest") assign("manifest", rest.shift());
    else if (token === "-w" || token === "--workspace") assign("workspace", rest.shift());
    else if (token.startsWith("--manifest=")) parsed.options.manifest = token.slice(11);
    else if (token.startsWith("--workspace=")) parsed.options.workspace = token.slice(12);
    else if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    else if (!parsed.command) parsed.command = token;
    else parsed.positional.push(token);
  }
  return parsed;
}

function label(outcome: Outcome): string {
  return { passed: "PASS", failed: "FAIL", inconclusive: "N/A " }[outcome];
}

function warn(message: string): void {
  process.stderr.write(`warning: ${message}\n`);
}

function rel(path: string): string {
  const relative_ = relative(process.cwd(), path);
  return relative_.startsWith("..") ? path : relative_ || ".";
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((cause: unknown) => {
    if (cause instanceof ZodError) {
      process.stderr.write("The manifest is not valid:\n");
      for (const issue of cause.issues) {
        process.stderr.write(`  ${issue.path.join(".") || "(root)"}: ${issue.message}\n`);
      }
      process.exit(65);
    }
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(70);
  });
