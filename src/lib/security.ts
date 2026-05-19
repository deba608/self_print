import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_SECRET } from "./config";
import { getAdminUser, getAgentToken } from "./db";

export function hashSecret(secret: string) {
  const salt = crypto.createHash("sha256").update("selfprint-static-salt").digest("hex");
  return crypto.pbkdf2Sync(secret, salt, 120000, 32, "sha256").toString("hex");
}

export function verifySecret(secret: string, hash: string) {
  const actual = hashSecret(secret);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
}

export async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  const username = payload.split(":")[0];
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
  const tokenHash = hashSecret(token);
  const row = await getAgentToken(tokenHash);
  return Boolean(row);
}

function sign(value: string) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

export function makeSession(username: string) {
  const payload = `${username}:${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
