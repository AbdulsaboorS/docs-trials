import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const docUrlSchema = z.url();
const labeledUrlDocSchema = z.object({ label: z.string().min(1), url: z.url() }).strict();
const inlineTextDocSchema = z
  .object({ label: z.string().min(1), text: z.string().min(1) })
  .strict();
const environmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use a portable environment-variable name.");

/**
 * `goals` describe what the author wants the integration to do. Docs Trials
 * shows them in the report and never grades them. Only the baseline checks in
 * `core/outcome.ts` produce an outcome.
 */
export const manifestSchema = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits, and hyphens."),
    title: z.string().min(1),
    task: z.string().min(1),
    docs: z.array(z.union([docUrlSchema, labeledUrlDocSchema, inlineTextDocSchema])).min(1),
    goals: z.array(z.string().min(1)).default([]),
    run: z
      .object({
        install: z.string().min(1).default("npm install"),
        build: z.string().min(1).optional(),
        start: z.string().min(1),
        url: z
          .url()
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === "http:" &&
              ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
              url.username === "" &&
              url.password === ""
            );
          }, "Use an unauthenticated loopback HTTP URL, for example http://127.0.0.1:5173.")
          .default("http://127.0.0.1:5173"),
        startupTimeoutSeconds: z.number().int().min(1).max(300).default(60),
        commandTimeoutSeconds: z.number().int().min(1).max(1800).default(600),
        observationWindowSeconds: z.number().int().min(1).max(60).default(5),
      })
      .strict(),
    allowedOrigins: z.array(z.url()).default([]),
    allowedEnvironment: z
      .array(environmentNameSchema)
      .refine((names) => new Set(names).size === names.length, {
        message: "List each allowed environment-variable name at most once.",
      })
      .default([]),
    agent: z
      .object({ name: z.string().min(1), model: z.string().min(1).optional() })
      .strict()
      .optional(),
  })
  .strict();

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestDoc = Manifest["docs"][number];

export async function loadManifest(path: string): Promise<{ manifest: Manifest; digest: string }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`Cannot read the manifest at ${path}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `The manifest at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const manifest = manifestSchema.parse(parsed);
  return { manifest, digest: digestManifest(manifest) };
}

export function digestManifest(manifest: Manifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export function docLabel(doc: ManifestDoc): string {
  const url = docUrlSchema.safeParse(doc);
  if (url.success) return url.data;
  const labeledUrl = labeledUrlDocSchema.safeParse(doc);
  if (labeledUrl.success) return `${labeledUrl.data.label}: ${labeledUrl.data.url}`;
  return `${inlineTextDocSchema.parse(doc).label} (inline text)`;
}

export function inlineText(doc: ManifestDoc): { label: string; text: string } | undefined {
  const parsed = inlineTextDocSchema.safeParse(doc);
  return parsed.success ? parsed.data : undefined;
}
