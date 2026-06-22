import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_SECRET } from "./config";
import { getAdminUser, getAgentToken } from "./db";

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 120000;
const DIGEST = "sha256";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function deriveKey(secret: string, salt: string) {
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
}

export function hashSecret(secret: string) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  return `${salt}:${deriveKey(secret, salt)}`;
}

export function verifySecret(secret: string, stored: string) {
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

export async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  const [username, rawTimestamp] = payload.split(":");
  if (!username || !rawTimestamp) return null;

  const age = Date.now() - Number(rawTimestamp);
  if (Number.isNaN(age) || age > SESSION_MAX_AGE_MS) return null;

  return getAdminUser(username);
}

export async function requireAdminResponse() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  return null;
}

export async function verifyAgentToken(authHeader: string | null) {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const row = await getAgentToken(token);
  return Boolean(row);
}

function sign(value: string) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export function makeSession(username: string) {
  const payload = `${username}:${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
