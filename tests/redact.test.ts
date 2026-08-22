import { describe, expect, it } from "vitest";
import { redact, redactValue } from "../src/core/redact";
import { findSecrets } from "../src/checks/secrets";

// Assembled at runtime so no literal credential pattern is stored in Git.
const stripeKey = ["sk", "live", "51ABCDEFGHIJKLMNOP"].join("_");
const githubToken = ["ghp", "abcdefghijklmnopqrst"].join("_");

describe("redact", () => {
  it("masks assigned secret values but keeps the key", () => {
    expect(redact(`apiKey: "${stripeKey}"`)).toBe('apiKey: "[REDACTED]"');
    expect(redact("password = 'hunter2'")).toBe("password = '[REDACTED]'");
    expect(redact("token=plain-text-secret")).toBe("token=[REDACTED]");
    expect(redact("password=hunter2")).toBe("password=[REDACTED]");
    expect(redact("log: token=plain-text-secret")).toBe("log: token=[REDACTED]");
    expect(redact("$ curl --password=hunter2 https://example.test")).toBe(
      "$ curl --password=[REDACTED] https://example.test",
    );
    expect(redact("prefix password=hunter2 suffix")).toBe("prefix password=[REDACTED] suffix");
  });

  it("does not corrupt ordinary source that mentions a secret word", () => {
    // The previous implementation rewrote this to `const [REDACTED];`.
    expect(redact("const token = useToken();")).toBe("const token = useToken();");
    expect(redact("authorization = await canAccess(user)")).toBe(
      "authorization = await canAccess(user)",
    );
    expect(redact("authorization = new Header(value)")).toBe("authorization = new Header(value)");
    expect(redact("function readPassword(input) { return input; }")).toBe(
      "function readPassword(input) { return input; }",
    );
    expect(redact("// clear the cookie before logout")).toBe("// clear the cookie before logout");
  });

  it("masks bearer tokens, JWTs, and private keys", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toContain("[REDACTED]");
    expect(redact("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef")).toBe(
      "[REDACTED JWT]",
    );
    expect(redact("-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----")).toBe(
      "[REDACTED PRIVATE KEY]",
    );
  });

  it("masks complete authorization credentials without corrupting source", () => {
    const input = [
      "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "Authorization: Bearer abcdefghijklmnop",
      "const authorization = canAccess(user);",
    ].join("\n");

    expect(redact(input)).toBe(
      [
        "Authorization: [REDACTED]",
        "Authorization: [REDACTED]",
        "const authorization = canAccess(user);",
      ].join("\n"),
    );
  });

  it("masks authorization credentials in common log and object forms", () => {
    expect(redact("Authorization=Basic dXNlcjpwYXNzd29yZA==")).toBe("Authorization=[REDACTED]");
    expect(redact("curl: > Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "curl: > Authorization: [REDACTED]",
    );
    expect(redact('headers: { Authorization: "Basic dXNlcjpwYXNzd29yZA==" }')).toBe(
      'headers: { Authorization: "[REDACTED]" }',
    );
    expect(redact("Authorization: ApiKey abcdefghijklmnop")).toBe("Authorization: [REDACTED]");
    expect(redact('Authorization: Digest username="user", response="secret"')).toBe(
      "Authorization: [REDACTED]",
    );
  });

  it("masks credentials in query strings", () => {
    expect(redact("https://api.test/v1?access_token=abc123&page=2")).toBe(
      "https://api.test/v1?access_token=[REDACTED]&page=2",
    );
  });

  it("masks issuer-prefixed credentials anywhere", () => {
    expect(redact(`key is ${githubToken} here`)).toContain("ghp_[REDACTED]");
  });

  it("leaves ordinary text untouched", () => {
    const text = "The build produced 12 chunks in 4.2 seconds.";
    expect(redact(text)).toBe(text);
  });
});

describe("redactValue", () => {
  it("masks values under secret-shaped keys", () => {
    expect(redactValue({ token: "abc", name: "docs" })).toEqual({
      token: "[REDACTED]",
      name: "docs",
    });
  });

  it("recurses into arrays and objects", () => {
    expect(redactValue({ list: [{ password: "x" }] })).toEqual({
      list: [{ password: "[REDACTED]" }],
    });
  });
});

describe("findSecrets", () => {
  it("detects issuer-prefixed credentials in delivered assets", () => {
    const findings = findSecrets([{ url: "http://x/app.js", body: `const k='${stripeKey}';` }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("issuer-prefixed credential");
    expect(findings[0]?.sample).not.toContain("51ABCDEFGHIJKLMNOP");
  });

  it("does not flag build hashes or ordinary bundles", () => {
    expect(
      findSecrets([
        { url: "http://x/app.js", body: "import './index-CFxLqrX7.js';const a=1;export{a};" },
      ]),
    ).toEqual([]);
  });
});
