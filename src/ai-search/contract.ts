import { z } from "zod";
import { trialSpecSchema } from "../domain";
import { aiSearchResearchTrial, createAiSearchKnowledgeFixture } from "./fixture";
import {
  aiSearchResourceNames,
  aiSearchResourceNamesSchema,
  aiSearchResourcePolicy,
  aiSearchResourcePolicySchema,
  aiSearchRunIdSchema,
} from "./policy";

const knowledgeDocumentSchema = z
  .object({
    key: z.string().min(1).max(128),
    content: z
      .string()
      .min(1)
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <= aiSearchResourcePolicy.maxDocumentBytes,
        `Document must not exceed ${aiSearchResourcePolicy.maxDocumentBytes} bytes.`,
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const resourceSnapshotSchema = z
  .object({
    locator: z.url(),
    sourceUrl: z.url(),
    retrievedAt: z.iso.datetime(),
    mediaType: z.literal("text/markdown"),
    path: z.string().regex(/^assigned-docs\/[0-9]{2}\.md$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const aiSearchPrivateRunSchema = z
  .object({
    version: z.literal(1),
    runId: aiSearchRunIdSchema,
    createdAt: z.iso.datetime(),
    liveResourcesCreated: z.literal(false),
    contractSha256: z.string().regex(/^[a-f0-9]{64}$/),
    trial: trialSpecSchema,
    resources: aiSearchResourceNamesSchema,
    policy: aiSearchResourcePolicySchema,
    resourceSnapshots: z
      .array(resourceSnapshotSchema)
      .length(aiSearchResearchTrial.resources.length),
    knowledge: z
      .object({
        documents: z.array(knowledgeDocumentSchema).length(aiSearchResourcePolicy.maxDocuments),
        researchQuestion: z.string().min(1),
        expectedFact: z.string().min(1),
        expectedSourceKey: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export function prepareAiSearchPrivateRun(
  runId: string,
  resourceSnapshots: readonly z.infer<typeof resourceSnapshotSchema>[],
  createdAt = new Date(),
) {
  return prepare(runId, resourceSnapshots, createdAt);
}

async function prepare(
  runId: string,
  resourceSnapshots: readonly z.infer<typeof resourceSnapshotSchema>[],
  createdAt: Date,
) {
  const parsedSnapshots = resourceSnapshots.map((snapshot) =>
    resourceSnapshotSchema.parse(snapshot),
  );
  const expectedLocators = aiSearchResearchTrial.resources.map((resource) => resource.locator);
  if (
    parsedSnapshots.length !== expectedLocators.length ||
    parsedSnapshots.some(
      (snapshot, index) =>
        snapshot.locator !== expectedLocators[index] ||
        snapshot.sourceUrl !== new URL("index.md", expectedLocators[index]).toString() ||
        snapshot.path !== `assigned-docs/${String(index + 1).padStart(2, "0")}.md`,
    )
  ) {
    throw new Error("AI Search resource snapshots do not match the assigned documentation.");
  }
  const fixture = createAiSearchKnowledgeFixture(runId);
  const knowledge = {
    ...fixture,
    documents: await Promise.all(
      fixture.documents.map(async (document) => ({
        ...document,
        sha256: await sha256(document.content),
      })),
    ),
  };
  const trial = {
    ...aiSearchResearchTrial,
    resources: aiSearchResearchTrial.resources.map((resource, index) => ({
      ...resource,
      revision: `sha256:${parsedSnapshots[index]!.sha256}`,
      retrievedAt: parsedSnapshots[index]!.retrievedAt,
    })),
  };
  const frozen = {
    version: 1 as const,
    runId,
    createdAt: createdAt.toISOString(),
    liveResourcesCreated: false as const,
    trial,
    resources: aiSearchResourceNames(runId),
    policy: aiSearchResourcePolicy,
    resourceSnapshots: parsedSnapshots,
    knowledge,
  };
  return aiSearchPrivateRunSchema.parse({
    contractSha256: await sha256(JSON.stringify(frozen)),
    ...frozen,
  });
}

export async function assertFrozenAiSearchPrivateRun(run: AiSearchPrivateRun): Promise<void> {
  const expected = await prepare(run.runId, run.resourceSnapshots, new Date(run.createdAt));
  if (JSON.stringify(expected) !== JSON.stringify(run)) {
    throw new Error("AI Search private run does not match the checked-in frozen contract.");
  }
}

export async function digestStarterFiles(
  files: readonly { path: string; content: string }[],
): Promise<string> {
  const entries = await Promise.all(
    [...files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(async (file) => ({ path: file.path, sha256: await sha256(file.content) })),
  );
  return sha256(JSON.stringify(entries));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type AiSearchPrivateRun = z.infer<typeof aiSearchPrivateRunSchema>;
