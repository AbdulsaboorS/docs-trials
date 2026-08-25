import { z, type JSONType } from "zod";

const secretKey =
  "api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|bearer[_-]?token|private[_-]?key|token|secret|password|passwd|cookie";
const sameLineWhitespace = "[^\\S\\r\\n\\u2028\\u2029]*";
const lineBreak = "(?:\\r\\n|[\\r\\n\\u2028\\u2029])";
const identifier = "[#$_\\p{ID_Start}][$_\\p{ID_Continue}]*";
const sourceReferencePattern = new RegExp(
  `^(?:${identifier})(?:(?:\\.|\\?\\.)${identifier})*!?$`,
  "u",
);
const sourceDeclarationPattern = /^(?:const|let|var)[^\S\r\n\u2028\u2029]+$/;

/**
 * Redaction masks values. It never rewrites the surrounding text.
 *
 * An earlier implementation replaced whole matches, which turned
 * `const token = useToken();` into `const [REDACTED];`. Evidence must stay
 * readable, so every pattern below preserves its key and masks only the value.
 */
type MaskingPattern = { pattern: RegExp; replacement: string };

const patternsBeforeUnquotedAssignment: MaskingPattern[] = [
  {
    pattern: new RegExp(
      `(["']?(?:${secretKey})["']?${sameLineWhitespace}[:=]${sameLineWhitespace})(\\x60)(?:\\\\[\\s\\S]|(?!\\2)[^\\\\])*?\\2`,
      "gi",
    ),
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    pattern: new RegExp(
      `(["']?(?:${secretKey})["']?${sameLineWhitespace}[:=]${sameLineWhitespace})(${lineBreak}(?:[+-]${sameLineWhitespace}|${sameLineWhitespace}))(["'\\x60])(?:\\\\.|(?!\\3)[^\\\\\\r\\n\\u2028\\u2029])*\\3`,
      "gi",
    ),
    replacement: "$1$2$3[REDACTED]$3",
  },
  {
    pattern: new RegExp(
      `(["']?(?:${secretKey})["']?${sameLineWhitespace}[:=]${sameLineWhitespace})(["'\\x60])(?:\\\\.|(?!\\2)[^\\\\\\r\\n\\u2028\\u2029])*\\2`,
      "gi",
    ),
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern: new RegExp(`([?&](?:${secretKey})=)[^&#\\s"']+`, "gi"),
    replacement: "$1[REDACTED]",
  },
];

const unquotedAssignmentPattern = new RegExp(
  `(^|[\\s,{+-]|--)((?:(?:const|let|var)[^\\S\\r\\n\\u2028\\u2029]+)?)(["']?(?:${secretKey})["']?${sameLineWhitespace}[:=]${sameLineWhitespace})(?!["'\\x60]|\\[REDACTED\\])(?=[^\\s,;{}()[\\]"'\\x60]*[0-9._~+/=-])([^\\s,;{}()[\\]"'\\x60]+)`,
  "gim",
);

const patternsAfterUnquotedAssignment: MaskingPattern[] = [
  {
    pattern: new RegExp(
      `^(${sameLineWhitespace}[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)${sameLineWhitespace}=${sameLineWhitespace})\\S+`,
      "gim",
    ),
    replacement: "$1[REDACTED]",
  },
  {
    pattern:
      /(\bauthorization[^\S\r\n\u2028\u2029]*[:=][^\S\r\n\u2028\u2029]*)(["'])(?:Basic|Bearer|ApiKey|Digest|Token|AWS4-HMAC-SHA256)\s+(?!\[REDACTED\])[^\r\n\u2028\u2029]*?\2/gi,
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern:
      /^((?:[^\r\n\u2028\u2029]*?>[^\S\r\n\u2028\u2029]*)?authorization[^\S\r\n\u2028\u2029]*[:=][^\S\r\n\u2028\u2029]*)(?!\[REDACTED\])(?:Basic|Bearer|ApiKey|Digest|Token|AWS4-HMAC-SHA256)\s+[^\r\n\u2028\u2029]+$/gim,
    replacement: "$1[REDACTED]",
  },
  {
    pattern:
      /((?:^|[\r\n\u2028\u2029])[^\S\r\n\u2028\u2029]*(?:set-)?cookie[^\S\r\n\u2028\u2029]*:[^\S\r\n\u2028\u2029]*)[^\r\n\u2028\u2029]+/gi,
    replacement: "$1[REDACTED]",
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: "Bearer [REDACTED]" },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED JWT]",
  },
  {
    pattern: new RegExp(`\\b(${knownPrefixes()})[A-Za-z0-9_-]{12,}\\b`, "g"),
    replacement: "$1[REDACTED]",
  },
];

/** Credential prefixes published by their issuers. Each is unambiguous. */
export function knownPrefixes(): string {
  return [
    "sk_live_",
    "sk_test_",
    "rk_live_",
    "pk_live_",
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "glpat-",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "AKIA",
    "ASIA",
    "AIza",
    "SG\\.",
    "npm_",
    "dop_v1_",
    "sq0atp-",
    "sq0csp-",
    "rtk_v1_",
    "cf_v1_",
  ].join("|");
}

export function redact(value: string): string {
  const before = applyPatterns(value, patternsBeforeUnquotedAssignment);
  const unquoted = before.replace(
    unquotedAssignmentPattern,
    (
      match,
      boundary: string,
      declaration: string,
      assignment: string,
      assignedValue: string,
      offset: number,
      input: string,
    ) =>
      isSourceReferenceAssignment(
        input,
        offset,
        match.length,
        boundary,
        declaration,
        assignment,
        assignedValue,
      )
        ? match
        : `${boundary}${declaration}${assignment}[REDACTED]`,
  );
  return applyPatterns(unquoted, patternsAfterUnquotedAssignment);
}

function applyPatterns(value: string, patterns: MaskingPattern[]): string {
  return patterns.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    value,
  );
}

function isSourceReferenceAssignment(
  input: string,
  offset: number,
  matchLength: number,
  boundary: string,
  declaration: string,
  assignment: string,
  assignedValue: string,
): boolean {
  if (!sourceReferencePattern.test(assignedValue)) return false;
  if (sourceDeclarationPattern.test(declaration)) return true;

  const lineStart = Math.max(
    input.lastIndexOf("\n", offset - 1),
    input.lastIndexOf("\r", offset - 1),
    input.lastIndexOf("\u2028", offset - 1),
    input.lastIndexOf("\u2029", offset - 1),
  );
  const prefix = input.slice(lineStart + 1, offset + boundary.length);
  if (
    assignment.includes(":") &&
    /^[+-][^\S\r\n\u2028\u2029]*$/.test(prefix) &&
    (assignedValue.startsWith("process.env.") ||
      assignedValue.startsWith("import.meta.env.") ||
      (assignedValue.includes(".") &&
        /^[^\S\r\n\u2028\u2029]*\(/.test(input.slice(offset + matchLength))))
  ) {
    return true;
  }
  return /^[+-]?[^\S\r\n\u2028\u2029]*(?:const|let|var)\b[^;\r\n\u2028\u2029]*(?:,[^\S\r\n\u2028\u2029]*|\*\/[^\S\r\n\u2028\u2029]*)$/.test(
    prefix,
  );
}

const secretKeyName = new RegExp(`^(?:${secretKey.replace(/\[_-\]\?/g, "[_-]?")})$`, "i");

const stringValueSchema = z.string();
const objectValueSchema = z.record(z.string(), z.json());

export function redactValue(value: JSONType): JSONType {
  const stringValue = stringValueSchema.safeParse(value);
  if (stringValue.success) return redact(stringValue.data);
  if (Array.isArray(value)) return value.map(redactValue);
  const objectValue = objectValueSchema.safeParse(value);
  if (objectValue.success) {
    return Object.fromEntries(
      Object.entries(objectValue.data).map(([key, entry]) => [
        key,
        secretKeyName.test(key.replace(/[_-]/g, "")) || secretKeyName.test(key)
          ? "[REDACTED]"
          : redactValue(entry),
      ]),
    );
  }
  return value;
}
