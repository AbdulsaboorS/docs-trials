import { z, type JSONType } from "zod";

const secretKey =
  "api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|bearer[_-]?token|private[_-]?key|token|secret|password|passwd|cookie";

/**
 * Redaction masks values. It never rewrites the surrounding text.
 *
 * An earlier implementation replaced whole matches, which turned
 * `const token = useToken();` into `const [REDACTED];`. Evidence must stay
 * readable, so every pattern below preserves its key and masks only the value.
 */
const patterns: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },
  {
    pattern: new RegExp(`(["']?(?:${secretKey})["']?\\s*[:=]\\s*)(["'])[^"'\\n]*\\2`, "gi"),
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern: new RegExp(`([?&](?:${secretKey})=)[^&#\\s"']+`, "gi"),
    replacement: "$1[REDACTED]",
  },
  {
    pattern: new RegExp(
      `(^|[\\s,{]|--)(["']?(?:${secretKey})["']?\\s*[:=]\\s*)(?!["']|\\[REDACTED\\])(?=[^\\s,;{}()[\\]"']*[0-9._~+/=-])[^\\s,;{}()[\\]"']+`,
      "gim",
    ),
    replacement: "$1$2[REDACTED]",
  },
  {
    pattern: new RegExp(`^(\\s*[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\\s*=\\s*)\\S+`, "gim"),
    replacement: "$1[REDACTED]",
  },
  {
    pattern:
      /(\bauthorization\s*[:=]\s*)(["'])(?:Basic|Bearer|ApiKey|Digest|Token|AWS4-HMAC-SHA256)\s+(?!\[REDACTED\])[^\r\n]*?\2/gi,
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern:
      /^((?:[^\r\n]*?>\s*)?authorization\s*[:=]\s*)(?!\[REDACTED\])(?:Basic|Bearer|ApiKey|Digest|Token|AWS4-HMAC-SHA256)\s+[^\r\n]+$/gim,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /((?:^|\n)\s*(?:set-)?cookie\s*:\s*)[^\n]+/gi,
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
  return patterns.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    value,
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
