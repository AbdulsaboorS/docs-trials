import { z } from "zod";
import type { AXReport, TrialRun, TrialSpec } from "./domain";
import { redact, redactValue } from "./redact";
import type { StarterFile } from "./starter-assets";

const artifactNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export async function createArtifactsRepository(
  accountId: string,
  apiToken: string,
  namespace: string,
  repository: string,
): Promise<{ id: string; name: string }> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/artifacts/namespaces/${encodeURIComponent(artifactNameSchema.parse(namespace))}/repos`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: artifactNameSchema.parse(repository), default_branch: "main" }),
    },
  );
  if (!response.ok) throw new Error(`Artifacts repository creation failed: ${response.status}`);
  const body: unknown = await response.json();
  const parsed = z.object({ result: z.object({ id: z.string(), name: z.string() }) }).parse(body);
  return parsed.result;
}

export function redactArtifactError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

export type ArtifactFile = {
  path: string;
  mediaType: string;
  content: string | Uint8Array;
};

export type TrialArtifactPackage = {
  repository: string;
  files: ArtifactFile[];
};

export interface ArtifactRepository {
  save(trialPackage: TrialArtifactPackage): Promise<{ repository: string; version: string }>;
}

export class ArtifactsUnavailableError extends Error {
  constructor() {
    super("Artifacts persistence is unavailable until account entitlement is confirmed.");
    this.name = "ArtifactsUnavailableError";
  }
}

export class UnavailableArtifactRepository implements ArtifactRepository {
  async save(_trialPackage: TrialArtifactPackage): Promise<never> {
    void _trialPackage;
    throw new ArtifactsUnavailableError();
  }
}

export function assembleTrialArtifactPackage(input: {
  spec: TrialSpec;
  run: TrialRun;
  report: AXReport;
  generatedSource: StarterFile[];
  agentTrace: unknown;
  commands: unknown;
  browserSummary: unknown;
  screenshot?: Uint8Array;
  maxBytes: number;
}): TrialArtifactPackage {
  const files: ArtifactFile[] = [
    jsonFile("trial.json", input.spec),
    jsonFile("run.json", input.run),
    jsonLineFile("agent-trace.jsonl", input.agentTrace),
    jsonLineFile("commands.jsonl", input.commands),
    jsonFile("browser-evidence/summary.json", input.browserSummary),
    jsonFile("grader-results.json", input.run.graderResults),
    { path: "AX.md", mediaType: "text/markdown", content: redact(input.report.markdown) },
    ...input.generatedSource.map((file) => ({
      path: artifactPath(`generated-source/${file.path}`),
      mediaType: sourceMediaType(file.path),
      content: redact(file.content),
    })),
    ...(input.screenshot
      ? [
          {
            path: "browser-evidence/final.png",
            mediaType: "image/png",
            content: input.screenshot,
          },
        ]
      : []),
  ];
  const bytes = files.reduce(
    (total, file) =>
      total +
      new TextEncoder().encode(file.path).byteLength +
      (typeof file.content === "string"
        ? new TextEncoder().encode(file.content).byteLength
        : file.content.byteLength),
    0,
  );
  if (bytes > input.maxBytes) throw new Error("Trial artifact package exceeds evidence limit.");
  return { repository: artifactNameSchema.parse(input.run.id), files };
}

function jsonFile(path: string, value: unknown): ArtifactFile {
  return {
    path: artifactPath(path),
    mediaType: "application/json",
    content: redact(JSON.stringify(redactValue(value), null, 2)),
  };
}

function jsonLineFile(path: string, value: unknown): ArtifactFile {
  return {
    path: artifactPath(path),
    mediaType: "application/x-ndjson",
    content: `${redact(JSON.stringify(redactValue(value)))}\n`,
  };
}

function artifactPath(path: string): string {
  if (
    path.startsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid artifact path: ${path}`);
  }
  return path;
}

function sourceMediaType(path: string): string {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "text/javascript";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "application/yaml";
  return "text/plain";
}
