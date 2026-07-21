import { z } from "zod";

const accessHeaderSchema = z.object({
  alg: z.literal("RS256"),
  kid: z.string().min(1),
});

const accessClaimsSchema = z.object({
  iss: z.string().url(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  email: z.string().email().optional(),
  exp: z.number().int(),
  iat: z.number().int(),
});

const accessCertsSchema = z.object({
  keys: z.array(
    z.object({
      kty: z.literal("RSA"),
      kid: z.string(),
      use: z.string().optional(),
      alg: z.string().optional(),
      n: z.string(),
      e: z.string(),
    }),
  ),
});

export type AuthenticatedIdentity = {
  id: string;
  email?: string;
};

export type AccessConfiguration = {
  teamDomain: string;
  audience: string;
};

export function validateAccessClaims(
  value: unknown,
  configuration: AccessConfiguration,
  now = new Date(),
): AuthenticatedIdentity {
  const claims = accessClaimsSchema.parse(value);
  const issuer = `https://${configuration.teamDomain}`;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (claims.iss !== issuer) throw new Error("Access token issuer is not approved.");
  if (!audiences.includes(configuration.audience)) {
    throw new Error("Access token audience is not approved.");
  }
  if (claims.exp <= Math.floor(now.getTime() / 1_000)) throw new Error("Access token expired.");

  return { id: claims.sub, ...(claims.email ? { email: claims.email } : {}) };
}

export async function authenticateAccessRequest(
  request: Request,
  configuration: AccessConfiguration,
  fetcher: typeof fetch = fetch,
): Promise<AuthenticatedIdentity> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Error("Cloudflare Access authentication is required.");

  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error("Access token is malformed.");
  }
  const header = accessHeaderSchema.parse(JSON.parse(decodeBase64UrlText(parts[0])));
  const claims: unknown = JSON.parse(decodeBase64UrlText(parts[1]));
  const response = await fetcher(`https://${configuration.teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Unable to retrieve Access signing certificates.");
  const certs = accessCertsSchema.parse(await response.json());
  const key = certs.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error("Access token signing key is not recognized.");

  const subtle = crypto.subtle as unknown as SubtleCrypto;
  const cryptoKey = await subtle.importKey(
    "jwk",
    key as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    toArrayBuffer(decodeBase64UrlBytes(parts[2])),
    toArrayBuffer(new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
  );
  if (!verified) throw new Error("Access token signature is invalid.");

  return validateAccessClaims(claims, configuration);
}

function decodeBase64UrlText(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
