import { z } from "zod";

export const aiSearchRunIdSchema = z
  .string()
  .min(8)
  .max(24)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Invalid AI Search trial run ID.");

export const aiSearchResourceNamesSchema = z
  .object({
    namespace: z.string().regex(/^dt-[a-z0-9-]+$/),
    instance: z.literal("internal-research"),
    worker: z.string().regex(/^dt-ai-search-[a-z0-9-]+$/),
  })
  .strict();

export const aiSearchResourcePolicySchema = z
  .object({
    maxInstances: z.literal(1),
    maxDocuments: z.literal(3),
    maxDocumentBytes: z.literal(4_096),
    maxResearchRequests: z.literal(10),
    maxLifetimeSeconds: z.literal(900),
    allowWebsiteCrawl: z.literal(false),
    allowR2Source: z.literal(false),
    allowGeneration: z.literal(false),
    syntheticContentOnly: z.literal(true),
    requireCleanupVerification: z.literal(true),
  })
  .strict();

export const aiSearchResourcePolicy = aiSearchResourcePolicySchema.parse({
  maxInstances: 1,
  maxDocuments: 3,
  maxDocumentBytes: 4_096,
  maxResearchRequests: 10,
  maxLifetimeSeconds: 900,
  allowWebsiteCrawl: false,
  allowR2Source: false,
  allowGeneration: false,
  syntheticContentOnly: true,
  requireCleanupVerification: true,
});

const aiSearchCompatibilityDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => value >= "2026-03-27",
    "AI Search requires compatibility date 2026-03-27 or later.",
  );

export function aiSearchDeploymentConfigSchema(names: AiSearchResourceNames) {
  return z
    .object({
      $schema: z.string().optional(),
      name: z.literal(names.worker),
      main: z.literal("src/index.ts"),
      compatibility_date: aiSearchCompatibilityDateSchema,
      ai_search_namespaces: z
        .array(
          z
            .object({
              binding: z.literal("AI_SEARCH"),
              namespace: z.literal(names.namespace),
              remote: z.literal(true),
            })
            .strict(),
        )
        .length(1),
    })
    .strict();
}

export function aiSearchResourceNames(runId: string) {
  const parsed = aiSearchRunIdSchema.parse(runId);
  return aiSearchResourceNamesSchema.parse({
    namespace: `dt-${parsed}`,
    instance: "internal-research",
    worker: `dt-ai-search-${parsed}`,
  });
}

export type AiSearchResourceNames = z.infer<typeof aiSearchResourceNamesSchema>;
export type AiSearchResourcePolicy = z.infer<typeof aiSearchResourcePolicySchema>;
