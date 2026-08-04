import { z } from "zod";
import { deriveTrialOutcome, type GraderResult, type TrialOutcome } from "../domain";
import { redact } from "../redact";
import type { AiSearchPrivateRun } from "./contract";
import { aiSearchCriteria } from "./fixture";

const unavailableSchema = z
  .object({
    available: z.literal(false),
    collectedAt: z.iso.datetime(),
    detail: z.string().min(1),
  })
  .strict();

function availableSchema<T extends z.ZodType>(value: T) {
  return z.object({ available: z.literal(true), collectedAt: z.iso.datetime(), value }).strict();
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const aiSearchObservationsSchema = z
  .object({
    build: z.discriminatedUnion("available", [
      unavailableSchema,
      availableSchema(
        z
          .object({
            command: z.string().min(1),
            exitCode: z.number().int(),
            sourceManifestSha256: sha256Schema,
          })
          .strict(),
      ),
    ]),
    instances: z.discriminatedUnion("available", [
      unavailableSchema,
      availableSchema(
        z
          .object({
            namespace: z.string().min(1),
            ids: z.array(z.string().min(1)),
            total: z.number().int().min(0),
          })
          .strict(),
      ),
    ]),
    indexing: z.discriminatedUnion("available", [
      unavailableSchema,
      availableSchema(
        z
          .object({
            namespace: z.string().min(1),
            instance: z.string().min(1),
            total: z.number().int().min(0),
            items: z.array(
              z
                .object({
                  key: z.string().min(1),
                  status: z.enum(["indexed", "failed", "pending"]),
                  sha256: sha256Schema,
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    ]),
    mcp: z.discriminatedUnion("available", [
      unavailableSchema,
      availableSchema(
        z
          .object({
            namespace: z.string().min(1),
            instance: z.string().min(1),
            instancePublicId: z.string().min(1),
            endpointHost: z.string().min(1),
            endpointEnabled: z.boolean(),
            searchToolListed: z.boolean(),
            actor: z.enum(["coding-agent", "human", "trusted-adapter"]),
            requestMethod: z.literal("tools/call"),
            requestQuery: z.string().min(1),
            responseText: z.string().max(100_000),
            sourceKeys: z.array(z.string().min(1)),
          })
          .strict(),
      ),
    ]),
    credentialScan: z.discriminatedUnion("available", [
      unavailableSchema,
      availableSchema(
        z
          .object({
            scannedScopes: z.array(z.enum(["generated-source", "retained-evidence"])).length(2),
            sourceManifestSha256: sha256Schema,
            matches: z.array(
              z
                .object({
                  rule: z.string().min(1),
                  path: z.string().min(1),
                  line: z.number().int().min(1).optional(),
                  fingerprint: sha256Schema,
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    ]),
    cleanup: z.discriminatedUnion("available", [
      unavailableSchema,
      availableSchema(
        z
          .object({
            worker: z.string().min(1),
            namespace: z.string().min(1),
            instance: z.string().min(1),
            workerAbsent: z.boolean(),
            instanceAbsent: z.boolean(),
            namespaceAbsent: z.boolean(),
          })
          .strict(),
      ),
    ]),
  })
  .strict();

export type AiSearchObservations = z.infer<typeof aiSearchObservationsSchema>;

export function assertNonLiveAiSearchObservations(input: AiSearchObservations): void {
  const observations = aiSearchObservationsSchema.parse(input);
  if (Object.values(observations).some((observation) => observation.available)) {
    throw new Error(
      "Checked-in grading accepts only unavailable non-live observations. Passing evidence must come directly from the future trusted provider adapter.",
    );
  }
}

export function gradeAiSearchTrial(
  run: AiSearchPrivateRun,
  input: AiSearchObservations,
): GraderResult[] {
  const observations = aiSearchObservationsSchema.parse(input);
  const build = observedResult(
    aiSearchCriteria.build,
    observations.build,
    (value) => value.command === run.trial.runtime.buildCommand && value.exitCode === 0,
    (value) =>
      `Expected immutable build command: ${value.command === run.trial.runtime.buildCommand}; exit code: ${value.exitCode}.`,
    "command-build",
  );
  const instances = observedResult(
    aiSearchCriteria.instance,
    observations.instances,
    (value) =>
      value.namespace === run.resources.namespace &&
      value.total === 1 &&
      value.ids.length === 1 &&
      value.ids[0] === run.resources.instance,
    (value) =>
      `Observed ${value.total} instance(s) in the expected run namespace: ${value.namespace === run.resources.namespace}.`,
    "ai-search-instance",
  );
  const indexing = observedResult(
    aiSearchCriteria.indexing,
    observations.indexing,
    (value) => {
      const expected = new Map(
        run.knowledge.documents.map((document) => [document.key, document.sha256]),
      );
      const observed = new Set(value.items.map((item) => `${item.key}:${item.sha256}`));
      return (
        value.namespace === run.resources.namespace &&
        value.instance === run.resources.instance &&
        value.total === expected.size &&
        value.items.length === expected.size &&
        observed.size === expected.size &&
        value.items.every(
          (item) => item.status === "indexed" && expected.get(item.key) === item.sha256,
        )
      );
    },
    (value) =>
      `Observed ${value.items.filter((item) => item.status === "indexed").length} indexed item(s) out of ${value.total}.`,
    "ai-search-items",
  );
  const mcpTool = observedResult(
    aiSearchCriteria.mcpTool,
    observations.mcp,
    (value) =>
      value.namespace === run.resources.namespace &&
      value.instance === run.resources.instance &&
      value.endpointHost === `${value.instancePublicId}.search.ai.cloudflare.com` &&
      value.endpointEnabled &&
      value.searchToolListed &&
      value.actor === "coding-agent",
    (value) =>
      `MCP endpoint enabled: ${value.endpointEnabled}; search tool listed: ${value.searchToolListed}; agent action observed: ${value.actor === "coding-agent"}.`,
    "mcp-session",
  );
  const research = observedResult(
    aiSearchCriteria.research,
    observations.mcp,
    (value) =>
      value.namespace === run.resources.namespace &&
      value.instance === run.resources.instance &&
      value.actor === "coding-agent" &&
      value.requestQuery === run.knowledge.researchQuestion &&
      value.responseText.includes(run.knowledge.expectedFact) &&
      value.sourceKeys.includes(run.knowledge.expectedSourceKey),
    (value) =>
      `Expected query: ${value.requestQuery === run.knowledge.researchQuestion}; expected fact: ${value.responseText.includes(run.knowledge.expectedFact)}; expected source: ${value.sourceKeys.includes(run.knowledge.expectedSourceKey)}.`,
    "mcp-session",
  );
  const credentials = observedResult(
    aiSearchCriteria.credentials,
    observations.credentialScan,
    (value) =>
      value.matches.length === 0 &&
      new Set(value.scannedScopes).size === 2 &&
      observations.build.available &&
      value.sourceManifestSha256 === observations.build.value.sourceManifestSha256,
    (value) =>
      value.matches.length === 0
        ? `The bounded credential scan found no matches across ${value.scannedScopes.length} declared scope(s), bound to the built source manifest: ${observations.build.available && value.sourceManifestSha256 === observations.build.value.sourceManifestSha256}.`
        : `The bounded credential scan found ${value.matches.length} potential credential leak(s).`,
    "credential-scan",
  );
  const cleanup = cleanupResult(run, observations.cleanup);

  return [build, instances, indexing, mcpTool, research, credentials, cleanup];
}

export function deriveAiSearchTerminalOutcome(
  expectedCriteria: readonly string[],
  results: readonly GraderResult[],
): TrialOutcome {
  const cleanup = results.find((result) => result.criterion === aiSearchCriteria.cleanup);
  if (cleanup?.outcome !== "passed") return "inconclusive";
  return deriveTrialOutcome(expectedCriteria, results);
}

function observedResult<T>(
  criterion: string,
  observation:
    | { available: false; collectedAt: string; detail: string }
    | { available: true; collectedAt: string; value: T },
  passed: (value: T) => boolean,
  detail: (value: T) => string,
  evidenceId: string,
): GraderResult {
  if (!observation.available) {
    return {
      criterion,
      outcome: "inconclusive",
      detail: `Verification was unavailable: ${redact(observation.detail)}`,
      evidenceIds: [evidenceId],
    };
  }

  const success = passed(observation.value);
  return {
    criterion,
    outcome: success ? "passed" : "failed",
    detail: redact(detail(observation.value)),
    evidenceIds: [evidenceId],
  };
}

function cleanupResult(
  run: AiSearchPrivateRun,
  observation: AiSearchObservations["cleanup"],
): GraderResult {
  if (!observation.available) {
    return {
      criterion: aiSearchCriteria.cleanup,
      outcome: "inconclusive",
      detail: `Cleanup verification was unavailable: ${redact(observation.detail)}`,
      evidenceIds: ["cleanup"],
    };
  }

  const complete =
    observation.value.worker === run.resources.worker &&
    observation.value.namespace === run.resources.namespace &&
    observation.value.instance === run.resources.instance &&
    observation.value.workerAbsent &&
    observation.value.instanceAbsent &&
    observation.value.namespaceAbsent;
  return {
    criterion: aiSearchCriteria.cleanup,
    outcome: complete ? "passed" : "inconclusive",
    detail: complete
      ? "The Worker, AI Search instance, and namespace were confirmed absent."
      : "Cleanup could not confirm every run-scoped resource was absent. Admission must remain quarantined.",
    evidenceIds: ["cleanup"],
  };
}
