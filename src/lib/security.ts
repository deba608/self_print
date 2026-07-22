import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_SECRET } from "./config";
import { getAgentToken } from "./db";
import { createClient } from "@/lib/supabase/server";
import type { StaffProfile } from "./types";

const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
// TODO(Task 13): remove — legacy PBKDF2 constants/helpers, superseded by Supabase auth
const ITERATIONS = 120000;
// TODO(Task 13): remove — legacy PBKDF2 constants/helpers, superseded by Supabase auth
const DIGEST = "sha256";
// TODO(Task 13): remove — legacy session-cookie max age, superseded by Supabase auth
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function deriveKey(secret: string, salt: string) {
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
}

// TODO(Task 13): remove — still called by db.ts's seedDefaults until that's cleaned up
export function hashSecret(secret: string) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  return `${salt}:${deriveKey(secret, salt)}`;
}

// TODO(Task 13): remove — still called by db.ts/db-supabase.ts's getAgentToken and the legacy admin login route until those are cleaned up
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

export async function requireAdmin(): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, email, display_name, role, invited_by, created_at")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    invitedBy: profile.invited_by,
    createdAt: profile.created_at,
  };
}

export async function requireAdminResponse(): Promise<NextResponse | null> {
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

// TODO(Task 13): remove — legacy HMAC session signer, superseded by Supabase auth
function sign(value: string) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

// TODO(Task 13): remove — still called by the legacy admin login route until it's cleaned up
export function makeSession(username: string) {
  const payload = `${username}:${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}
