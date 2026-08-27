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
    expect(
      redact(
        '+    "build": "BETTER_AUTH_SECRET=local-development-secret-at-least-32-characters BETTER_AUTH_URL=http://127.0.0.1:4316 next build",',
      ),
    ).toBe(
      '+    "build": "BETTER_AUTH_SECRET=[REDACTED] BETTER_AUTH_URL=http://127.0.0.1:4316 next build",',
    );
    expect(
      redact(
        "$ BETTER_AUTH_SECRET=local-development-secret-at-least-32-characters BETTER_AUTH_URL=http://127.0.0.1:4316 next build",
      ),
    ).toBe("$ BETTER_AUTH_SECRET=[REDACTED] BETTER_AUTH_URL=http://127.0.0.1:4316 next build");
    expect(redact("API_SECRET=foo; next")).toBe("API_SECRET=[REDACTED]; next");
    expect(redact("API_SECRET = foo")).toBe("API_SECRET = [REDACTED]");
    expect(redact("API_TOKEN=foo&& next")).toBe("API_TOKEN=[REDACTED]&& next");
    expect(redact("const BETTER_AUTH_SECRET=process.env.BETTER_AUTH_SECRET;")).toBe(
      "const BETTER_AUTH_SECRET=process.env.BETTER_AUTH_SECRET;",
    );
    expect(redact("const API_SECRET=config.apiSecret;")).toBe("const API_SECRET=config.apiSecret;");
    expect(redact("const API_SECRET=secretMatch?.[1] || fallback;")).toBe(
      "const API_SECRET=secretMatch?.[1] || fallback;",
    );
    expect(redact('+  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");')).toBe(
      '+  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");',
    );
    expect(redact('process.env.API_SECRET = randomBytes (32).toString("base64");')).toBe(
      'process.env.API_SECRET = randomBytes (32).toString("base64");',
    );
    expect(redact("import.meta.env.API_SECRET = crypto.randomUUID();")).toBe(
      "import.meta.env.API_SECRET = crypto.randomUUID();",
    );
    expect(redact("process.env.API_SECRET = randomUUID();")).toBe(
      "process.env.API_SECRET = randomUUID();",
    );
    expect(redact("process.env.API_SECRET = config.apiSecret;")).toBe(
      "process.env.API_SECRET = config.apiSecret;",
    );
    expect(redact("process.env.API_SECRET = hunter2;")).toBe(
      "process.env.API_SECRET = [REDACTED];",
    );
    expect(redact("config.API_SECRET = hunter2;")).toBe("config.API_SECRET = [REDACTED];");
    expect(redact("process.env.API_SECRET = abc/def;")).toBe(
      "process.env.API_SECRET = [REDACTED];",
    );
    expect(redact("process.env.API_SECRET = abc:def;")).toBe(
      "process.env.API_SECRET = [REDACTED];",
    );
    expect(redact("process.env.API_SECRET = abc%def;")).toBe(
      "process.env.API_SECRET = [REDACTED];",
    );
    expect(redact("process.env.API_SECRET = hunter2(callback);")).toBe(
      "process.env.API_SECRET = hunter2(callback);",
    );
    expect(redact("myprocess.env.API_SECRET = config.apiSecret;")).toBe(
      "myprocess.env.API_SECRET = config.apiSecret;",
    );
    expect(redact("foo.process.env.API_SECRET = abc.def;")).toBe(
      "foo.process.env.API_SECRET = abc.def;",
    );
    expect(
      redact('process.env.API_SECRET = randomBytes(32).toString("base64"); // generated'),
    ).toBe('process.env.API_SECRET = randomBytes(32).toString("base64"); // generated');
    expect(
      redact('process.env.API_SECRET = randomBytes(32).toString("base64") /* generated */;'),
    ).toBe('process.env.API_SECRET = randomBytes(32).toString("base64") /* generated */;');
    expect(redact("process.env.API_SECRET = crypto.randomUUID(); // password=hunter2")).toBe(
      "process.env.API_SECRET = crypto.randomUUID(); // password=[REDACTED]",
    );
    expect(redact('foo.process.env.API_SECRET = randomBytes(32).toString("base64");')).toBe(
      'foo.process.env.API_SECRET = randomBytes(32).toString("base64");',
    );
    expect(redact('process.env.API_SECRET = crypto.randomUUID("base64");')).toBe(
      'process.env.API_SECRET = crypto.randomUUID("base64");',
    );
    expect(redact('process.env.API_SECRET = randomBytes(\r\n  32).toString("base64");')).toBe(
      'process.env.API_SECRET = randomBytes(\r\n  32).toString("base64");',
    );
    expect(
      redact('process.env.API_SECRET = require("node:crypto").randomBytes(32).toString("hex");'),
    ).toBe('process.env.API_SECRET = require("node:crypto").randomBytes(32).toString("hex");');
    expect(
      redact('process.env.API_SECRET = randomBytes(32).toString("base64") satisfies string;'),
    ).toBe('process.env.API_SECRET = randomBytes(32).toString("base64") satisfies string;');
    expect(redact('const code = "process.env.API_SECRET = hunter2";')).toBe(
      'const code = "process.env.API_SECRET = hunter2";',
    );
    expect(redact('const code = "process.env.API_SECRET = hunter2;";')).toBe(
      'const code = "process.env.API_SECRET = hunter2;";',
    );
    expect(redact("const code = ' process.env.API_SECRET = hunter2;';")).toBe(
      "const code = ' process.env.API_SECRET = hunter2;';",
    );
    expect(redact("process.env.API_SECRET = /hunter2;stillsecret/;")).toBe(
      "process.env.API_SECRET = /hunter2;stillsecret/;",
    );
    expect(redact("const pattern = / password=hunter2;/;")).toBe(
      "const pattern = / password=hunter2;/;",
    );
    expect(redact('const pattern = / password="hunter2";/;')).toBe(
      'const pattern = / password="hunter2";/;',
    );
    expect(redact("const pattern = / token=`abc123`;/;")).toBe(
      "const pattern = / token=`abc123`;/;",
    );
    expect(redact("process.env.API_SECRET = /actual-secret;")).toBe(
      "process.env.API_SECRET = [REDACTED];",
    );
    expect(redact("process.env.API_SECRET = /srv/credential;")).toBe(
      "process.env.API_SECRET = /srv/credential;",
    );
    expect(redact("/* process.env.API_SECRET = hunter2; */")).toBe(
      "/* process.env.API_SECRET = [REDACTED]; */",
    );
    expect(redact("// don't expose process.env.API_SECRET = abc/def;")).toBe(
      "// don't expose process.env.API_SECRET = [REDACTED];",
    );
    expect(redact('const pattern = /"/; process.env.API_SECRET = abc/def;')).toBe(
      'const pattern = /"/; process.env.API_SECRET = [REDACTED];',
    );
    expect(redact("const code = `\nprocess.env.API_SECRET = abc/def;\n`;")).toBe(
      "const code = `\nprocess.env.API_SECRET = abc/def;\n`;",
    );
    expect(redact("const code = `${process.env.API_SECRET = abc/def;}`;")).toBe(
      "const code = `${process.env.API_SECRET = [REDACTED];}`;",
    );
    expect(redact("/* don't expose\n*/ process.env.API_SECRET = abc/def;")).toBe(
      "/* don't expose\n*/ process.env.API_SECRET = [REDACTED];",
    );
    expect(redact('process.env["API_SECRET"] = getSecret("actual-secret");')).toBe(
      'process.env["API_SECRET"] = getSecret("actual-secret");',
    );
    expect(redact('process["env"].API_SECRET = getSecret("actual-secret");')).toBe(
      'process["env"].API_SECRET = getSecret("actual-secret");',
    );
    expect(
      redact(
        "process.env.API_SECRET = crypto.randomUUID();\nimport.meta.env.API_TOKEN = crypto.randomUUID();",
      ),
    ).toBe(
      "process.env.API_SECRET = crypto.randomUUID();\nimport.meta.env.API_TOKEN = crypto.randomUUID();",
    );
    expect(
      redact(
        '\0\0\n+  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");\npassword=hunter2',
      ),
    ).toBe(
      '\0\0\n+  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");\npassword=[REDACTED]',
    );
    expect(
      redact(
        [
          "+if (!process.env.BETTER_AUTH_SECRET) {",
          '+  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");',
          "+  password=hunter2",
          "+}",
        ].join("\n"),
      ),
    ).toBe(
      [
        "+if (!process.env.BETTER_AUTH_SECRET) {",
        '+  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("base64");',
        "+  password=[REDACTED]",
        "+}",
      ].join("\n"),
    );
    const generatedThenSource = `process.env.API_SECRET = crypto.randomUUID();${" ".repeat(50_000)}x`;
    expect(redact(generatedThenSource)).toBe(generatedThenSource);
    expect(redact("\0".repeat(50_000))).toBe("\0".repeat(50_000));
    expect(
      redact(
        `${"\0".repeat(50_000)}\nprocess.env.API_SECRET = crypto.randomUUID();\npassword=hunter2`,
      ),
    ).toBe(
      `${"\0".repeat(50_000)}\nprocess.env.API_SECRET = crypto.randomUUID();\npassword=[REDACTED]`,
    );
    const generators = Array.from(
      { length: 2_000 },
      (_, index) => `process.env.API_SECRET = randomBytes(${index + 1}).toString("hex");`,
    ).join("\n");
    expect(redact(generators)).toBe(generators);
    expect(redact("const first=1, API_SECRET=config.apiSecret;")).toBe(
      "const first=1, API_SECRET=config.apiSecret;",
    );
    expect(redact(String.raw`API_SECRET=\"local development secret\"`)).toBe(
      String.raw`API_SECRET=\"[REDACTED]\"`,
    );
    expect(redact(String.raw`API_SECRET=\"abc\\\"def\" next`)).toBe(
      String.raw`API_SECRET=\"[REDACTED]\" next`,
    );
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
    expect(
      redact('const secret = secretMatch?.[1] || randomBytes(32).toString("base64url");'),
    ).toBe('const secret = secretMatch?.[1] || randomBytes(32).toString("base64url");');
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
    expect(redact("+  secret: process.env.BETTER_AUTH_SECRET ?? localSecret,")).toBe(
      "+  secret: process.env.BETTER_AUTH_SECRET ?? localSecret,",
    );
    expect(redact('+      password: form.get("password"),')).toBe(
      '+      password: form.get("password"),',
    );
    expect(redact("function readPassword(input) { return input; }")).toBe(
      "function readPassword(input) { return input; }",
    );
    expect(redact("// clear the cookie before logout")).toBe("// clear the cookie before logout");
  });

  it("still masks unquoted credential-like values followed by parentheses", () => {
    expect(redact("token=abc123(callback)")).toBe("token=[REDACTED](callback)");
    expect(redact("CONST token=abc123(callback)")).toBe("CONST token=[REDACTED](callback)");
    expect(redact("password: abc.def")).toBe("password: [REDACTED]");
    expect(redact("+ password: abc.def")).toBe("+ password: [REDACTED]");
    expect(redact("+ password: hunter2")).toBe("+ password: [REDACTED]");
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
