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
    expect(redact("token\u00a0=\u00a0plain-text-secret")).toBe("token\u00a0=\u00a0[REDACTED]");
    expect(redact(`password="don't-leak"`)).toBe('password="[REDACTED]"');
    expect(redact('password="abc\\"def-123"')).toBe('password="[REDACTED]"');
  });

  it("does not corrupt ordinary source that mentions a secret word", () => {
    // The previous implementation rewrote this to `const [REDACTED];`.
    expect(redact("const token = useToken();")).toBe("const token = useToken();");
    expect(redact("authorization = await canAccess(user)")).toBe(
      "authorization = await canAccess(user)",
    );
    expect(redact("authorization = new Header(value)")).toBe("authorization = new Header(value)");
    expect(redact('const token = form.get("cf-turnstile-response");')).toBe(
      'const token = form.get("cf-turnstile-response");',
    );
    expect(redact("let token = process.env.ACCESS_TOKEN;")).toBe(
      "let token = process.env.ACCESS_TOKEN;",
    );
    expect(redact("const token = config.token!;")).toBe("const token = config.token!;");
    expect(redact("const token = this.#token;")).toBe("const token = this.#token;");
    expect(redact("const token = données.jeton;")).toBe("const token = données.jeton;");
    expect(redact('var token = form.get\n("cf-turnstile-response");')).toBe(
      'var token = form.get\n("cf-turnstile-response");',
    );
    expect(redact("const first = 1, token = process.env.TOKEN;")).toBe(
      "const first = 1, token = process.env.TOKEN;",
    );
    expect(redact("const /* note */ token = process.env.TOKEN;")).toBe(
      "const /* note */ token = process.env.TOKEN;",
    );
    expect(redact('+const token = form.get("value");')).toBe('+const token = form.get("value");');
    expect(redact('-const token = form.get("value");')).toBe('-const token = form.get("value");');
    expect(redact("function readPassword(input) { return input; }")).toBe(
      "function readPassword(input) { return input; }",
    );
    expect(redact("// clear the cookie before logout")).toBe("// clear the cookie before logout");
  });

  it("still masks unquoted credential-like values followed by parentheses", () => {
    expect(redact("token=abc123(callback)")).toBe("token=[REDACTED](callback)");
    expect(redact("CONST token=abc123(callback)")).toBe("CONST token=[REDACTED](callback)");
    expect(redact("const password = 123456789;")).toBe("const password = [REDACTED];");
    expect(redact("const token = `generic-secret-123`; ")).toBe("const token = `[REDACTED]`; ");
    expect(redact("const token = `generic-\nsecret-123`; ")).toBe("const token = `[REDACTED]`; ");
    expect(redact("const token = `generic\\\nsecret-123`; ")).toBe("const token = `[REDACTED]`; ");
    expect(redact("const token = `generic\\\r\nsecret-123`; ")).toBe(
      "const token = `[REDACTED]`; ",
    );
  });

  it("leaves a long unterminated template unchanged without excessive backtracking", () => {
    const input = `token = \`${"\\a".repeat(2_000)}`;
    expect(redact(input)).toBe(input);
  });

  it("preserves diff prefixes around multiline secret expressions", () => {
    const diff = [
      "+export const auth = betterAuth({",
      "+  secret:",
      "+    process.env.BETTER_AUTH_SECRET ??",
      '+    "local-development-secret-change-me-123456789",',
      "+});",
    ].join("\n");

    expect(redact(diff)).toBe(diff);
  });

  it("masks a quoted value on the next line without changing its diff prefix", () => {
    expect(redact('+password =\n+  "hunter2"')).toBe('+password =\n+  "[REDACTED]"');
    expect(redact(`+password =\n+  "don't-leak"`)).toBe('+password =\n+  "[REDACTED]"');
  });

  it.each(["\r", "\u2028", "\u2029"])(
    "does not consume the %j line separator inside a quoted value",
    (separator) => {
      const input = `secret: "abc${separator}+next"`;
      expect(redact(input)).toBe(input);
    },
  );

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
