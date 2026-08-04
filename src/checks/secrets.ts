import { knownPrefixes } from "../core/redact";

export type SecretFinding = { asset: string; kind: string; sample: string };

/**
 * Detects credentials in browser-delivered assets.
 *
 * Only unambiguous evidence counts: published issuer prefixes, JWTs, and PEM
 * private keys. Entropy heuristics were deliberately left out. A build hash
 * looks exactly like a high-entropy secret, and a detector that cries wolf on
 * every bundle is a detector nobody trusts.
 */
const detectors: Array<{ kind: string; pattern: RegExp }> = [
  {
    kind: "issuer-prefixed credential",
    pattern: new RegExp(`\\b(?:${knownPrefixes()})[A-Za-z0-9_-]{12,}`, "g"),
  },
  {
    kind: "JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g,
  },
  {
    kind: "private key block",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
];

export function findSecrets(assets: ReadonlyArray<{ url: string; body: string }>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const asset of assets) {
    for (const { kind, pattern } of detectors) {
      for (const match of asset.body.matchAll(pattern)) {
        findings.push({ asset: asset.url, kind, sample: mask(match[0]) });
        if (findings.length >= 20) return findings;
      }
    }
  }
  return findings;
}

/** Keeps enough of the value to locate it, never enough to use it. */
function mask(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-2)} (${value.length} chars)`;
}
