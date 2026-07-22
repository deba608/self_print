// Salted PBKDF2 hashing for opaque secrets stored in the DB (currently: agent
// tokens in `agent_tokens.token_hash`). Split out from security.ts so it has
// no coupling to admin-session concerns — this is a generic secret-hashing
// utility, not part of the auth flow.
import crypto from "node:crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 120000;
const DIGEST = "sha256";

function deriveKey(secret: string, salt: string) {
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
}

export function hashToken(secret: string) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  return `${salt}:${deriveKey(secret, salt)}`;
}

export function verifyToken(secret: string, stored: string) {
  let salt: string, hash: string;

  if (stored.includes(":")) {
    [salt, hash] = stored.split(":");
  } else {
    salt = crypto.createHash("sha256").update("selfprint-static-salt").digest("hex");
    hash = stored;
  }

  const actual = deriveKey(secret, salt);
  if (actual.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
}
