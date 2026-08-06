import { createHash } from "node:crypto";

export type LatestJson = {
  version: string;
  kind: "code" | "full";
  file: string;
  sha256: string;
  publishedAt: string;
};

/**
 * Compare two dotted numeric versions segment by segment.
 * Missing segments count as 0, so "1.4" === "1.4.0".
 * Returns -1 if a < b, 1 if a > b, 0 if equal.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const as = String(a).split(".");
  const bs = String(b).split(".");
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const av = Number(as[i] ?? 0);
    const bv = Number(bs[i] ?? 0);
    const an = Number.isFinite(av) ? av : 0;
    const bn = Number.isFinite(bv) ? bv : 0;
    if (an < bn) return -1;
    if (an > bn) return 1;
  }
  return 0;
}

function fail(reason: string): never {
  throw new Error(`latest.json invalid: ${reason}`);
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * Parse and validate a latest.json manifest.
 * Unknown extra fields are ignored on purpose — the manifest is forward-compatible.
 * Throws Error("latest.json invalid: <reason>") on any bad shape.
 */
export function parseLatestJson(raw: string): LatestJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("expected a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const version = requireString(obj, "version");
  const file = requireString(obj, "file");
  const publishedAt = requireString(obj, "publishedAt");

  const kind = obj.kind;
  if (kind !== "code" && kind !== "full") {
    fail(`kind must be "code" or "full"`);
  }

  const sha256 = requireString(obj, "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    fail("sha256 must be 64 lowercase hex characters");
  }

  return { version, kind, file, sha256, publishedAt };
}

/** Lowercase hex sha256 digest of the given bytes. */
export function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}
