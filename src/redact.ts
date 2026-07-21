const secretPatterns: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern:
      /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|cookie)["']?\s*:\s*)["'][^"']*["']/gi,
    replacement: '$1"[REDACTED]"',
  },
  {
    pattern:
      /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|cookie)\s*[:=]\s*)["'][^"']*["']/gi,
    replacement: '$1"[REDACTED]"',
  },
  {
    pattern:
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password)=)[^&#\s]+/gi,
    replacement: "$1[REDACTED]",
  },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: "[REDACTED]" },
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED]",
  },
  {
    pattern: /(authorization\s*[:=]\s*)(?!\[REDACTED\])[^\s,;]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    pattern: /((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/gi,
    replacement: "$1[REDACTED]",
  },
  { pattern: /\b(?:rtk|cf|art)_v1_[A-Za-z0-9?=&._-]+/gi, replacement: "[REDACTED]" },
  {
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|cookie)\s*[:=]\s*(?!\[REDACTED\])[^\s,;&#"']+/gi,
    replacement: "[REDACTED]",
  },
];

export function redact(value: string): string {
  return secretPatterns.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    value,
  );
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        /^(?:apiKey|accessToken|refreshToken|clientSecret|token|secret|password|authorization|cookie)$/i.test(
          key,
        )
          ? "[REDACTED]"
          : redactValue(entry),
      ]),
    );
  }
  return value;
}
