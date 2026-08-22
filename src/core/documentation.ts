import { createHash } from "node:crypto";
import { z } from "zod";
import {
  docLabel,
  inlineText,
  isSafeDocumentationUrl,
  urlDocument,
  type ManifestDoc,
} from "./manifest";

export const maximumDocumentationBytes = 2 * 1024 * 1024;
export const documentationTimeoutMs = 15_000;

export const documentationFileSchema = z
  .string()
  .regex(
    /^documentation\/[0-9]{3}-[a-z0-9][a-z0-9-]*\.txt$/,
    "Use a confined documentation snapshot path.",
  );

const commonProvenanceSchema = z.object({
  label: z.string().min(1),
  retrievedAt: z.iso.datetime(),
});

const frozenDocumentationSchema = commonProvenanceSchema
  .extend({
    status: z.literal("frozen"),
    sourceType: z.enum(["inline", "url"]),
    sourceUrl: z.url().optional(),
    finalUrl: z.url().optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    contentType: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().min(0).max(maximumDocumentationBytes),
    file: documentationFileSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    const urlFieldsPresent = entry.sourceUrl && entry.finalUrl && entry.httpStatus;
    if (entry.sourceType === "url" && !urlFieldsPresent) {
      context.addIssue({
        code: "custom",
        message: "Frozen URL documentation requires source URL, final URL, and HTTP status.",
      });
    }
    if (
      entry.sourceType === "inline" &&
      (entry.sourceUrl !== undefined ||
        entry.finalUrl !== undefined ||
        entry.httpStatus !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Inline documentation cannot contain HTTP provenance.",
      });
    }
  });

const liveDocumentationSchema = commonProvenanceSchema
  .extend({
    status: z.literal("live"),
    sourceType: z.literal("url"),
    sourceUrl: z.url(),
    finalUrl: z.url().optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    contentType: z.string().min(1).optional(),
    error: z.string().min(1),
  })
  .strict();

export const documentationProvenanceSchema = z.discriminatedUnion("status", [
  frozenDocumentationSchema,
  liveDocumentationSchema,
]);
export type DocumentationProvenance = z.infer<typeof documentationProvenanceSchema>;

export type DocumentationRetrievalDependencies = {
  fetch: typeof fetch;
  now: () => Date;
};

const defaultDependencies: DocumentationRetrievalDependencies = {
  fetch: globalThis.fetch,
  now: () => new Date(),
};

export type DocumentationCapture = {
  provenance: DocumentationProvenance;
  content?: Uint8Array;
};

type ObservedHttpResponse = {
  sourceType: "url";
  label: string;
  sourceUrl: string;
  finalUrl: string;
  retrievedAt: string;
  httpStatus: number;
  contentType?: string;
};

export async function captureDocumentation(
  doc: ManifestDoc,
  index: number,
  dependencies: DocumentationRetrievalDependencies = defaultDependencies,
): Promise<DocumentationCapture> {
  const inline = inlineText(doc);
  const file = documentationFile(index, inline?.label ?? docLabel(doc));
  const retrievedAt = dependencies.now().toISOString();
  if (inline) {
    const content = new TextEncoder().encode(inline.text);
    if (content.byteLength > maximumDocumentationBytes) {
      throw new Error(`Inline documentation exceeds the ${maximumDocumentationBytes}-byte limit.`);
    }
    return {
      content,
      provenance: {
        status: "frozen",
        sourceType: "inline",
        label: inline.label,
        retrievedAt,
        contentType: "text/plain; charset=utf-8",
        sha256: digestDocumentation(content),
        byteLength: content.byteLength,
        file,
      },
    };
  }

  const urlDoc = urlDocument(doc);
  if (!urlDoc) throw new Error("Documentation source is neither inline text nor a URL.");
  const { url: sourceUrl, label } = urlDoc;
  const protocol = new URL(sourceUrl).protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return {
      provenance: {
        status: "live",
        sourceType: "url",
        label,
        sourceUrl,
        retrievedAt,
        error: "Only HTTP(S) documentation can be frozen.",
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), documentationTimeoutMs);
  try {
    const response = await dependencies.fetch(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
    });
    const finalUrl = response.url || sourceUrl;
    if (!isSafeDocumentationUrl(finalUrl)) {
      await response.body?.cancel();
      return {
        provenance: {
          status: "live",
          sourceType: "url",
          label,
          sourceUrl,
          retrievedAt,
          httpStatus: response.status,
          error:
            "The redirect URL contained credentials or sensitive parameters and was not stored.",
        },
      };
    }
    const common: ObservedHttpResponse = {
      sourceType: "url" as const,
      label,
      sourceUrl,
      finalUrl,
      retrievedAt,
      httpStatus: response.status,
    };
    const responseContentType = response.headers.get("content-type");
    if (responseContentType) common.contentType = responseContentType;
    if (!response.ok) {
      await response.body?.cancel();
      return {
        provenance: {
          status: "live",
          ...common,
          error: `Documentation retrieval returned HTTP ${response.status}.`,
        },
      };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maximumDocumentationBytes) {
      await response.body?.cancel();
      return {
        provenance: {
          status: "live",
          ...common,
          error: `Documentation exceeds the ${maximumDocumentationBytes}-byte snapshot limit.`,
        },
      };
    }
    let content: Uint8Array = new Uint8Array();
    if (response.body) {
      try {
        content = await readBounded(response.body);
      } catch (error) {
        return {
          provenance: {
            status: "live",
            ...common,
            error:
              error instanceof DocumentationTooLargeError
                ? error.message
                : controller.signal.aborted
                  ? `Documentation retrieval timed out after ${documentationTimeoutMs} ms.`
                  : "Documentation response body could not be read.",
          },
        };
      }
    }
    const contentType = common.contentType ?? "application/octet-stream";
    return {
      content,
      provenance: {
        status: "frozen",
        ...common,
        contentType,
        sha256: digestDocumentation(content),
        byteLength: content.byteLength,
        file,
      },
    };
  } catch {
    return {
      provenance: {
        status: "live",
        sourceType: "url",
        label,
        sourceUrl,
        retrievedAt,
        error: controller.signal.aborted
          ? `Documentation retrieval timed out after ${documentationTimeoutMs} ms.`
          : "Documentation retrieval failed before a safe response was available.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function digestDocumentation(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumDocumentationBytes) {
        throw new DocumentationTooLargeError(
          `Documentation exceeds the ${maximumDocumentationBytes}-byte snapshot limit.`,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const content = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}

function documentationFile(index: number, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `documentation/${String(index + 1).padStart(3, "0")}-${slug || "document"}.txt`;
}

class DocumentationTooLargeError extends Error {}
